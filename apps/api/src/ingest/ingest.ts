/**
 * Live ingestion from the AirGradient Map API — the Phase-2 swap of the seed's
 * mock monitors for real public sensors, with NO change to the schema or the API
 * contract. Reference data (country polygons, PM2.5-attributable deaths, population)
 * stays seeded — those are annual GBD/UN datasets, not a live feed.
 *
 *   monitors      ← GET /measurements/current   (real sensors + latest PM2.5)
 *   urban_centers ← GET /urban-centers          (real cities)
 *   country/city  ← assigned via PostGIS ST_Contains; density recomputed (gap = ntile quintile)
 *
 *   npm run ingest         # or INGEST_ON_START=true at boot
 */
import { Pool, PoolClient } from 'pg';

const AG_BASE = process.env.AIRGRADIENT_MAP_API ?? 'https://map-data.airgradient.com/map/api/v1';
const FRESH_MS = 48 * 3600 * 1000; // a sensor reading newer than this counts as "online"

interface Measurement {
  locationId: number;
  locationName: string;
  longitude: number | null;
  latitude: number | null;
  sensorType: string | null;
  pm25: number | null;
  measuredAt: string | null;
  dataSource: string | null;
}
interface UrbanCenter {
  cityName: string;
  countryName: string;
  countryCode: string | null;
  population: number | null;
  averagePm25: number | null;
  locationCount: number | null;
}

function aqiFromPm(p: number): number {
  const bp = [
    [0, 12, 0, 50], [12.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200], [150.5, 250.4, 201, 300], [250.5, 500, 301, 500],
  ];
  for (const [cl, ch, al, ah] of bp) if (p <= ch) return Math.round(((ah - al) / (ch - cl)) * (p - cl) + al);
  return 500;
}

async function fetchPaged<T>(path: string, key: 'data' | 'items'): Promise<T[]> {
  const out: T[] = [];
  const size = 10000;
  let page = 1;
  // the API's `total` field is unreliable across page sizes — page until a short page
  for (;;) {
    const res = await fetch(`${AG_BASE}${path}${path.includes('?') ? '&' : '?'}pagesize=${size}&page=${page}`);
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;
    const batch = (json[key] as T[]) ?? [];
    out.push(...batch);
    if (batch.length < size) break;
    page++;
  }
  return out;
}

async function insertMonitors(client: PoolClient, rows: Measurement[], now: number): Promise<number> {
  const cols = 11; // external_id,name,manufacturer,type,owner,status,pm25,aqi,last_seen,lng,lat
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 800) {
    const chunk = rows.slice(i, i + 800);
    const values: unknown[] = [];
    const tuples = chunk.map((m, j) => {
      const b = j * cols;
      const ts = m.measuredAt ?? new Date(now).toISOString();
      const online = m.measuredAt ? now - Date.parse(m.measuredAt) < FRESH_MS : false;
      values.push(
        String(m.locationId),
        m.locationName,
        m.dataSource ?? 'Public',
        m.sensorType === 'Reference' ? 'reference' : 'low_cost',
        m.dataSource ?? 'Public',
        online ? 'online' : 'offline',
        m.pm25,
        aqiFromPm(m.pm25 as number),
        ts,
        m.longitude,
        m.latitude,
      );
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},` +
        `ST_SetSRID(ST_MakePoint($${b + 10},$${b + 11}),4326))`;
    });
    await client.query(
      `INSERT INTO monitors (external_id,name,manufacturer,type,owner,status,pm25,aqi,last_seen,location)
       VALUES ${tuples.join(',')}
       ON CONFLICT (external_id) DO UPDATE SET
         name=EXCLUDED.name, manufacturer=EXCLUDED.manufacturer, type=EXCLUDED.type,
         owner=EXCLUDED.owner, status=EXCLUDED.status, pm25=EXCLUDED.pm25, aqi=EXCLUDED.aqi,
         last_seen=EXCLUDED.last_seen, location=EXCLUDED.location`,
      values,
    );
    inserted += chunk.length;
  }
  return inserted;
}

async function insertUrbanCenters(client: PoolClient, cities: UrbanCenter[]): Promise<void> {
  for (let i = 0; i < cities.length; i += 800) {
    const chunk = cities.slice(i, i + 800);

    // urban_centers catalog (direct VALUES so column types are inferred from the target)
    const uvals: unknown[] = [];
    const utuples = chunk.map((c, j) => {
      const b = j * 5;
      uvals.push(c.cityName, c.countryName, c.countryCode, c.population, c.averagePm25);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`;
    });
    await client.query(
      `INSERT INTO urban_centers (name, country_name, iso2, population, avg_pm25) VALUES ${utuples.join(',')}`,
      uvals,
    );

    // density_stats city rows straight from the API counts (no per-monitor city mapping needed)
    const dvals: unknown[] = [];
    const dtuples = chunk.map((c, j) => {
      const b = j * 6;
      const loc = c.locationCount ?? 0;
      const per100k = c.population && c.population > 0 ? +((loc / (c.population / 100000)).toFixed(3)) : null;
      dvals.push(c.cityName, c.countryName, c.population, loc, c.averagePm25, per100k);
      return `('city',$${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 4},$${b + 5},$${b + 6},NULL,NULL)`;
    });
    await client.query(
      `INSERT INTO density_stats
         (scope_type, scope_name, country_name, population, monitors_total, monitors_online, avg_pm25, monitors_per_100k, deaths_per_100k, gap_ratio)
       VALUES ${dtuples.join(',')}
       ON CONFLICT (scope_type, scope_name) DO NOTHING`,
      dvals,
    );
  }
}

export async function runIngest(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://openair:openair@localhost:5432/openair',
    max: 4,
  });
  const log = (m: string) => console.log(`[ingest] ${m}`);
  const now = Date.now();
  try {
    log(`fetching from ${AG_BASE} …`);
    const [measures, cities] = await Promise.all([
      fetchPaged<Measurement>('/measurements/current', 'data'),
      fetchPaged<UrbanCenter>('/urban-centers', 'items'),
    ]);
    const usable = measures.filter(
      (m) => m.pm25 != null && Number.isFinite(m.latitude) && Number.isFinite(m.longitude),
    );
    log(`fetched ${measures.length} sensors (${usable.length} with a reading), ${cities.length} urban centers`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // density + city catalog are snapshots — rebuilt each run. monitors are UPSERTed (stable
      // ids) and measurements are APPENDED, so the time-series accumulates across refreshes.
      // (DELETE, not TRUNCATE CASCADE, on urban_centers — CASCADE would wipe monitors via FK.)
      await client.query(`DELETE FROM density_stats`);
      await client.query(`DELETE FROM urban_centers`);

      await insertMonitors(client, usable, now);
      // graceful staleness — anything not refreshed recently is offline (keeps vanished sensors)
      await client.query(
        `UPDATE monitors SET status = CASE
           WHEN last_seen >= now() - interval '48 hours' THEN 'online' ELSE 'offline' END`,
      );
      // assign each sensor to a country by point-in-polygon (PostGIS)
      await client.query(
        `UPDATE monitors m SET country_id = c.id, country = c.name
         FROM countries c WHERE ST_Contains(c.geom, m.location)`,
      );
      // append the latest reading per monitor; dedupe by (monitor_id, ts) so unchanged readings
      // don't create duplicate history points
      await client.query(
        `INSERT INTO measurements (monitor_id, ts, pm25, aqi)
         SELECT id, last_seen, pm25, aqi FROM monitors
         ON CONFLICT (monitor_id, ts) DO NOTHING`,
      );

      // country density from real monitors + reference deaths/population
      await client.query(
        `INSERT INTO density_stats
           (scope_type, scope_id, scope_name, country_name, population, monitors_total, monitors_online,
            reference, low_cost, monitors_per_100k, deaths_per_100k, avg_pm25, gap_ratio, gap_level)
         SELECT 'country', c.id, c.name, c.name, c.population,
                COUNT(m.id),
                COUNT(m.id) FILTER (WHERE m.status='online'),
                COUNT(m.id) FILTER (WHERE m.type='reference'),
                COUNT(m.id) FILTER (WHERE m.type='low_cost'),
                ROUND((COUNT(m.id) / (c.population/100000.0))::numeric, 3),
                hi.deaths_per_100k,
                ROUND(AVG(m.pm25)::numeric, 1),
                CASE WHEN c.population > 0 AND hi.deaths_per_100k IS NOT NULL
                     THEN ROUND((hi.deaths_per_100k / NULLIF(COUNT(m.id)/(c.population/100000.0),0))::numeric)
                     ELSE NULL END,
                NULL
         FROM countries c
         JOIN monitors m ON m.country_id = c.id
         LEFT JOIN LATERAL (
           SELECT deaths_per_100k FROM health_impacts h
           WHERE h.country_name = c.name AND h.pollutant='pm25' ORDER BY year DESC LIMIT 1
         ) hi ON true
         GROUP BY c.id, c.name, c.population, hi.deaths_per_100k`,
      );
      // quintile gap level (1 = lowest gap … 5 = highest) over countries that have a gap_ratio
      await client.query(
        `UPDATE density_stats d SET gap_level = q.lvl
         FROM (SELECT id, ntile(5) OVER (ORDER BY gap_ratio) AS lvl
               FROM density_stats WHERE scope_type='country' AND gap_ratio IS NOT NULL) q
         WHERE d.id = q.id`,
      );

      await insertUrbanCenters(client, cities);

      await client.query('COMMIT');
      const [{ n }] = (await client.query<{ n: string }>('SELECT COUNT(*)::text n FROM monitors')).rows;
      const [{ c }] = (await client.query<{ c: string }>(
        `SELECT COUNT(*)::text c FROM density_stats WHERE scope_type='country' AND gap_level IS NOT NULL`,
      )).rows;
      log(`done — ${n} real monitors, ${cities.length} cities, ${c} countries with a gap level.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runIngest().catch((err) => {
    console.error('[ingest] failed:', err);
    process.exit(1);
  });
}

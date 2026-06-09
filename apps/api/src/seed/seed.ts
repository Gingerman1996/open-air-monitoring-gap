/**
 * Deterministic seed — ports the prototype's `demo-data.js` generator into PostGIS.
 * Same 35 cities, same monitor-scatter maths, but a seeded PRNG so the data (and the
 * monitoring-gap quintiles derived from it) is reproducible across runs. Swapping this
 * for live AirGradient / State of Global Air ingestion is the Phase-2 step and does not
 * touch the schema or the API contract.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';

// ---------- source data (verbatim from the prototype) ----------
// name, nameTh, country, iso2, lat, lng, metro pop, avg pm2.5, deaths_per_100k/yr, planned monitors
const C: [string, string, string, string, number, number, number, number, number, number][] = [
  ['Berlin', 'เบอร์ลิน', 'Germany', 'DE', 52.52, 13.405, 3700000, 12, 11, 40],
  ['Paris', 'ปารีส', 'France', 'FR', 48.857, 2.352, 11000000, 14, 12, 38],
  ['London', 'ลอนดอน', 'United Kingdom', 'GB', 51.507, -0.127, 9000000, 11, 13, 44],
  ['New York', 'นิวยอร์ก', 'United States', 'US', 40.713, -74.006, 18800000, 8, 12, 56],
  ['Los Angeles', 'ลอสแอนเจลิส', 'United States', 'US', 34.052, -118.244, 12500000, 13, 14, 46],
  ['Sydney', 'ซิดนีย์', 'Australia', 'AU', -33.868, 151.209, 5300000, 7, 6, 26],
  ['Tokyo', 'โตเกียว', 'Japan', 'JP', 35.689, 139.692, 37000000, 12, 18, 52],
  ['Madrid', 'มาดริด', 'Spain', 'ES', 40.416, -3.703, 6600000, 11, 16, 24],
  ['Toronto', 'โทรอนโต', 'Canada', 'CA', 43.651, -79.383, 6200000, 8, 9, 28],
  ['Stockholm', 'สตอกโฮล์ม', 'Sweden', 'SE', 59.329, 18.068, 2400000, 6, 6, 18],
  ['Bangkok', 'กรุงเทพฯ', 'Thailand', 'TH', 13.756, 100.501, 10700000, 26, 56, 16],
  ['Manila', 'มะนิลา', 'Philippines', 'PH', 14.599, 120.984, 13900000, 30, 60, 9],
  ['Istanbul', 'อิสตันบูล', 'Türkiye', 'TR', 41.008, 28.978, 15500000, 24, 52, 14],
  ['Mexico City', 'เม็กซิโกซิตี', 'Mexico', 'MX', 19.432, -99.133, 21800000, 22, 40, 20],
  ['São Paulo', 'เซาเปาลู', 'Brazil', 'BR', -23.55, -46.633, 22400000, 17, 18, 22],
  ['Nairobi', 'ไนโรบี', 'Kenya', 'KE', -1.286, 36.817, 4900000, 36, 68, 5],
  ['Accra', 'อักกรา', 'Ghana', 'GH', 5.603, -0.187, 5400000, 38, 70, 4],
  ['Tehran', 'เตหะราน', 'Iran', 'IR', 35.689, 51.389, 9400000, 38, 70, 8],
  ['Johannesburg', 'โจฮันเนสเบิร์ก', 'South Africa', 'ZA', -26.204, 28.047, 6200000, 25, 55, 7],
  ['Tashkent', 'ทาชเคนต์', 'Uzbekistan', 'UZ', 41.299, 69.24, 2900000, 40, 70, 5],
  ['Delhi', 'เดลี', 'India', 'IN', 28.704, 77.102, 32900000, 92, 120, 18],
  ['Mumbai', 'มุมไบ', 'India', 'IN', 19.076, 72.877, 21000000, 55, 110, 12],
  ['Kolkata', 'โกลกาตา', 'India', 'IN', 22.572, 88.363, 15000000, 65, 115, 8],
  ['Lahore', 'ลาฮอร์', 'Pakistan', 'PK', 31.52, 74.358, 13500000, 100, 125, 5],
  ['Karachi', 'การาจี', 'Pakistan', 'PK', 24.86, 67.001, 16800000, 64, 118, 6],
  ['Dhaka', 'ธากา', 'Bangladesh', 'BD', 23.81, 90.412, 22000000, 80, 122, 7],
  ['Kathmandu', 'กาฐมาณฑุ', 'Nepal', 'NP', 27.717, 85.324, 1500000, 60, 105, 3],
  ['Beijing', 'ปักกิ่ง', 'China', 'CN', 39.904, 116.407, 21500000, 40, 93, 30],
  ['Cairo', 'ไคโร', 'Egypt', 'EG', 30.044, 31.236, 21300000, 58, 89, 5],
  ['Lagos', 'ลากอส', 'Nigeria', 'NG', 6.524, 3.379, 15400000, 50, 96, 3],
  ['Kinshasa', 'กินชาซา', 'DR Congo', 'CD', -4.322, 15.307, 16000000, 45, 85, 1],
  ['Jakarta', 'จาการ์ตา', 'Indonesia', 'ID', -6.208, 106.846, 11000000, 42, 74, 10],
  ['Kabul', 'คาบูล', 'Afghanistan', 'AF', 34.555, 69.207, 4600000, 70, 110, 2],
  ['Baghdad', 'แบกแดด', 'Iraq', 'IQ', 33.315, 44.366, 7500000, 60, 85, 3],
  ['Hanoi', 'ฮานอย', 'Vietnam', 'VN', 21.028, 105.804, 8100000, 48, 65, 6],
];

const OWN = ['Community', 'University', 'City Government', 'NGO', 'Private'];

// country deaths attributable to PM2.5 + population (millions), keyed by world-atlas names
const CDraw: Record<string, [number, number]> = {
  India: [1600000, 1417], China: [1300000, 1412],
  Indonesia: [220000, 275], Pakistan: [256000, 235], Bangladesh: [173000, 171],
  'United States of America': [90000, 333], Russia: [130000, 144], Brazil: [66000, 215], Japan: [75000, 125],
  Germany: [72000, 83], Egypt: [90000, 110], Nigeria: [100000, 218], Vietnam: [70000, 98], Philippines: [66000, 114],
  Myanmar: [80000, 54], Turkey: [70000, 85], Iran: [70000, 88], Mexico: [64000, 128], Ukraine: [64000, 43],
  Ethiopia: [90000, 123], 'Dem. Rep. Congo': [80000, 99], Thailand: [64000, 72],
  'United Kingdom': [30000, 67], France: [40000, 68], Italy: [45000, 59], Spain: [25000, 47], Poland: [45000, 38],
  'South Africa': [40000, 60], Argentina: [30000, 46], Colombia: [30000, 52], Iraq: [35000, 43], Afghanistan: [50000, 41],
  Uzbekistan: [40000, 35], Sudan: [40000, 46], Tanzania: [45000, 65], Kenya: [35000, 54], Uganda: [30000, 47],
  Nepal: [42000, 30], Morocco: [30000, 37], Algeria: [30000, 44], 'Saudi Arabia': [30000, 36], Peru: [25000, 34],
  Kazakhstan: [25000, 19], Ghana: [25000, 33], Malaysia: [25000, 33], 'South Korea': [30000, 52], Netherlands: [21000, 17],
  Canada: [18000, 38], Australia: [9000, 26], Sweden: [4000, 10], Norway: [3000, 5], Finland: [4000, 6], Chile: [18000, 19],
};

// my city-country display name -> world-atlas country name
const MY2WA: Record<string, string> = {
  'United States': 'United States of America',
  Türkiye: 'Turkey',
  'DR Congo': 'Dem. Rep. Congo',
};
const waName = (n: string) => MY2WA[n] ?? n;

// ---------- deterministic helpers ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(42);
const rand = (a: number, b: number) => a + rng() * (b - a);
const pick = <T>(a: T[]): T => a[Math.floor(rng() * a.length)];

function aqiFromPm(p: number): number {
  const bp = [
    [0, 12, 0, 50], [12.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200], [150.5, 250.4, 201, 300], [250.5, 500, 301, 500],
  ];
  for (const [cl, ch, al, ah] of bp) if (p <= ch) return Math.round(((ah - al) / (ch - cl)) * (p - cl) + al);
  return 500;
}

/** yearly deaths series 1990-2023 (rising trend off the latest figure) — mirrors the sparkline */
function deathSeries(d: number): { y: number; v: number }[] {
  const out: { y: number; v: number }[] = [];
  const s = 0.6;
  for (let y = 1990; y <= 2023; y++) {
    const t = (y - 1990) / 33;
    let f = s + (1 - s) * Math.pow(t, 0.9);
    if (y >= 2019 && y <= 2021) f *= 0.97;
    out.push({ y, v: Math.round(d * f) });
  }
  return out;
}

// ---------- generated entities ----------
interface City {
  name: string; nameTh: string; country: string; iso2: string;
  lat: number; lng: number; pop: number; avg_pm25: number; deaths_per_100k: number; planned: number;
}
interface Monitor {
  external_id: string; name: string; city: string; country: string; iso2: string;
  lat: number; lng: number; manufacturer: string; type: 'low_cost' | 'reference';
  owner: string; status: 'online' | 'offline'; pm25: number; aqi: number;
}

function generate(): { cities: City[]; monitors: Monitor[] } {
  const cities: City[] = C.map((r) => ({
    name: r[0], nameTh: r[1], country: r[2], iso2: r[3], lat: r[4], lng: r[5],
    pop: r[6], avg_pm25: r[7], deaths_per_100k: r[8], planned: r[9],
  }));
  const monitors: Monitor[] = [];
  let id = 1000;
  for (const c of cities) {
    const spread = 0.1 + Math.min(c.pop / 1e8, 0.16);
    for (let i = 0; i < c.planned; i++) {
      id++;
      const lat = c.lat + rand(-spread, spread);
      const lng = c.lng + rand(-spread, spread) / Math.max(0.4, Math.cos((c.lat * Math.PI) / 180));
      const pm = Math.max(3, c.avg_pm25 + rand(-10, 14));
      const type: 'low_cost' | 'reference' = rng() < 0.16 ? 'reference' : 'low_cost';
      const manufacturer =
        type === 'reference' ? 'Reference (Gov)' : pick(['AirGradient', 'PurpleAir', 'Clarity', 'Sensirion']);
      monitors.push({
        external_id: `AG-${id}`,
        name: `${c.iso2}-${String(i + 1).padStart(3, '0')}`,
        city: c.name, country: waName(c.country), iso2: c.iso2,
        lat: +lat.toFixed(4), lng: +lng.toFixed(4),
        manufacturer, type, owner: pick(OWN),
        status: rng() < 0.9 ? 'online' : 'offline',
        pm25: +pm.toFixed(1), aqi: aqiFromPm(pm),
      });
    }
  }
  return { cities, monitors };
}

// ---------- density / quintile maths (mirrors the prototype) ----------
interface CountryDensity {
  name: string; population: number; total: number; online: number; reference: number;
  low_cost: number; avg_pm25: number | null; deaths_per_100k: number;
  monitors_per_100k: number; gap_ratio: number | null; gap_level: number | null;
}

function countryDensity(monitors: Monitor[]): CountryDensity[] {
  const byCountry = new Map<string, Monitor[]>();
  for (const m of monitors) {
    const arr = byCountry.get(m.country) ?? [];
    arr.push(m);
    byCountry.set(m.country, arr);
  }
  const rows: CountryDensity[] = [];
  for (const [name, [deaths, popM]] of Object.entries(CDraw)) {
    const ms = byCountry.get(name) ?? [];
    const population = popM * 1e6;
    const total = ms.length;
    const per100k = total / (population / 100000);
    const deaths_per_100k = (deaths / population) * 100000;
    const avg = total ? ms.reduce((s, m) => s + m.pm25, 0) / total : null;
    rows.push({
      name, population, total,
      online: ms.filter((m) => m.status === 'online').length,
      reference: ms.filter((m) => m.type === 'reference').length,
      low_cost: ms.filter((m) => m.type === 'low_cost').length,
      avg_pm25: avg == null ? null : +avg.toFixed(1),
      deaths_per_100k: +deaths_per_100k.toFixed(1),
      monitors_per_100k: +per100k.toFixed(3),
      gap_ratio: total > 0 ? Math.round(deaths_per_100k / Math.max(per100k, 0.001)) : null,
      gap_level: null,
    });
  }
  // quintile levels over countries that have both monitors and data
  const vals = rows.filter((r) => r.gap_ratio != null).map((r) => r.gap_ratio as number).sort((a, b) => a - b);
  if (vals.length) {
    const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
    const t = [q(0.2), q(0.4), q(0.6), q(0.8)];
    for (const r of rows) {
      if (r.gap_ratio == null) continue;
      let i = 0;
      while (i < 4 && r.gap_ratio >= t[i]) i++;
      r.gap_level = i + 1;
    }
  }
  return rows;
}

// ---------- path resolution ----------
function findFile(candidates: string[]): string {
  for (const c of candidates) if (c && existsSync(c)) return c;
  throw new Error(`file not found in: ${candidates.join(', ')}`);
}
const worldAtlasPath = () =>
  findFile([
    process.env.WORLD_ATLAS_PATH ?? '',
    resolve(__dirname, '../../../../db/data/countries-110m.json'),
    resolve(process.cwd(), '../../db/data/countries-110m.json'),
    '/app/db/data/countries-110m.json',
  ]);
const initSqlPath = () =>
  findFile([
    process.env.INIT_SQL_PATH ?? '',
    resolve(__dirname, '../../../../db/init.sql'),
    resolve(process.cwd(), '../../db/init.sql'),
    '/app/db/init.sql',
  ]);

// ---------- seed ----------
export async function runSeed(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://openair:openair@localhost:5432/openair',
    max: 4,
  });
  const log = (m: string) => console.log(`[seed] ${m}`);
  try {
    // schema is created here too, so the seed is self-sufficient even without the init mount
    await pool.query(readFileSync(initSqlPath(), 'utf8'));

    const existing = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM monitors');
    if (Number(existing.rows[0].n) > 0 && process.env.FORCE_RESEED !== 'true') {
      log(`already seeded (${existing.rows[0].n} monitors) — skip. Set FORCE_RESEED=true to rebuild.`);
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `TRUNCATE measurements, monitors, density_stats, health_impacts, urban_centers, regions, countries, sources
         RESTART IDENTITY CASCADE`,
      );

      // sources
      for (const s of [
        ['State of Global Air', 'deaths', 'https://www.stateofglobalair.org/data', 'HEI / GBD (IHME)'],
        ['UN World Population Prospects', 'population', 'https://population.un.org/wpp/', 'UN, World Bank'],
        ['AirGradient Map API', 'monitors', 'https://map-data-int.airgradient.com/map/api/v1/docs', 'AirGradient'],
        ['Natural Earth (world-atlas)', 'boundaries', 'https://github.com/topojson/world-atlas', 'public domain'],
      ]) {
        await client.query('INSERT INTO sources(name, kind, url, license) VALUES ($1,$2,$3,$4)', s);
      }

      // countries (geom from world-atlas) + population from CDraw where known
      const topo = JSON.parse(readFileSync(worldAtlasPath(), 'utf8'));
      const fc = feature(topo, topo.objects.countries) as unknown as FeatureCollection<
        Geometry,
        { name: string }
      >;
      for (const f of fc.features) {
        const name = f.properties?.name;
        if (!name || !f.geometry) continue;
        const popM = CDraw[name]?.[1];
        await client.query(
          `INSERT INTO countries(name, iso_n3, population, geom)
           VALUES ($1, $2, $3, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)))
           ON CONFLICT (name) DO NOTHING`,
          [name, f.id != null ? Number(f.id) : null, popM ? Math.round(popM * 1e6) : null, JSON.stringify(f.geometry)],
        );
      }
      const cidByName = new Map<string, number>();
      for (const r of (await client.query<{ id: number; name: string }>('SELECT id, name FROM countries')).rows) {
        cidByName.set(r.name, r.id);
      }

      // health_impacts — yearly series per CDraw country
      for (const [name, [deaths, popM]] of Object.entries(CDraw)) {
        const pop = popM * 1e6;
        for (const { y, v } of deathSeries(deaths)) {
          await client.query(
            `INSERT INTO health_impacts(country_id, country_name, year, pollutant, deaths, deaths_per_100k)
             VALUES ($1,$2,$3,'pm25',$4,$5)`,
            [cidByName.get(name) ?? null, name, y, v, +((v / pop) * 100000).toFixed(2)],
          );
        }
      }

      // cities (urban_centers)
      const { cities, monitors } = generate();
      const cityIdByName = new Map<string, number>();
      for (const c of cities) {
        const wa = waName(c.country);
        const res = await client.query<{ id: number }>(
          `INSERT INTO urban_centers(name, name_th, country_id, country_name, iso2, population, avg_pm25, deaths_per_100k, centroid)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8, ST_SetSRID(ST_MakePoint($9,$10),4326)) RETURNING id`,
          [c.name, c.nameTh, cidByName.get(wa) ?? null, wa, c.iso2, c.pop, c.avg_pm25, c.deaths_per_100k, c.lng, c.lat],
        );
        cityIdByName.set(c.name, res.rows[0].id);
      }

      // monitors + a single latest measurement each
      const now = new Date().toISOString();
      for (const m of monitors) {
        const res = await client.query<{ id: number }>(
          `INSERT INTO monitors(external_id, name, city_id, city, country_id, country, iso2,
             manufacturer, type, owner, status, pm25, aqi, last_seen, location)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, ST_SetSRID(ST_MakePoint($15,$16),4326))
           RETURNING id`,
          [m.external_id, m.name, cityIdByName.get(m.city) ?? null, m.city, cidByName.get(m.country) ?? null,
            m.country, m.iso2, m.manufacturer, m.type, m.owner, m.status, m.pm25, m.aqi, now, m.lng, m.lat],
        );
        await client.query(
          'INSERT INTO measurements(monitor_id, ts, pm25, aqi) VALUES ($1,$2,$3,$4)',
          [res.rows[0].id, now, m.pm25, m.aqi],
        );
      }

      // density_stats — city scope
      for (const c of cities) {
        const ms = monitors.filter((m) => m.city === c.name);
        const total = ms.length;
        const per100k = total / (c.pop / 100000);
        const avg = total ? ms.reduce((s, m) => s + m.pm25, 0) / total : null;
        await client.query(
          `INSERT INTO density_stats(scope_type, scope_id, scope_name, country_name, population,
             monitors_total, monitors_online, reference, low_cost, monitors_per_100k, deaths_per_100k, avg_pm25, gap_ratio, gap_level)
           VALUES ('city',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL)`,
          [
            cityIdByName.get(c.name) ?? null, c.name, waName(c.country), c.pop, total,
            ms.filter((m) => m.status === 'online').length,
            ms.filter((m) => m.type === 'reference').length,
            ms.filter((m) => m.type === 'low_cost').length,
            +per100k.toFixed(3), c.deaths_per_100k, avg == null ? null : +avg.toFixed(1),
            +(c.deaths_per_100k / Math.max(per100k, 0.001)).toFixed(1),
          ],
        );
      }

      // density_stats — country scope (with quintile gap_level)
      for (const d of countryDensity(monitors)) {
        await client.query(
          `INSERT INTO density_stats(scope_type, scope_id, scope_name, country_name, population,
             monitors_total, monitors_online, reference, low_cost, monitors_per_100k, deaths_per_100k, avg_pm25, gap_ratio, gap_level)
           VALUES ('country',$1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            cidByName.get(d.name) ?? null, d.name, d.population, d.total, d.online, d.reference,
            d.low_cost, d.monitors_per_100k, d.deaths_per_100k, d.avg_pm25, d.gap_ratio, d.gap_level,
          ],
        );
      }

      await client.query('COMMIT');
      log(`done — ${cities.length} cities, ${monitors.length} monitors, ${fc.features.length} country polygons.`);
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
  runSeed().catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  });
}

/**
 * Seeds REFERENCE data only — country polygons, PM2.5-attributable deaths, and population.
 * These are annual GBD/UN datasets with no live feed, so they're seeded; the live monitor set
 * comes from the AirGradient ingest (src/ingest). Idempotent: skips if countries already exist
 * (set FORCE_RESEED=true to rebuild).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';

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

/** yearly deaths series 1990-2023 (rising trend off the latest figure) — drives the panel sparkline */
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

export async function runSeed(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://openair:openair@localhost:5432/openair',
    max: 4,
  });
  const log = (m: string) => console.log(`[seed] ${m}`);
  try {
    // schema is applied here too, so the seed is self-sufficient even without the init mount
    await pool.query(readFileSync(initSqlPath(), 'utf8'));

    const existing = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM countries');
    if (Number(existing.rows[0].n) > 0 && process.env.FORCE_RESEED !== 'true') {
      log(`reference already seeded (${existing.rows[0].n} countries) — skip. FORCE_RESEED=true to rebuild.`);
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // CASCADE clears monitor/measurement/density rows too (FKs) — ingest repopulates them
      await client.query('TRUNCATE sources, health_impacts, regions, countries RESTART IDENTITY CASCADE');

      for (const s of [
        ['State of Global Air', 'deaths', 'https://www.stateofglobalair.org/data', 'HEI / GBD (IHME)'],
        ['UN World Population Prospects', 'population', 'https://population.un.org/wpp/', 'UN, World Bank'],
        ['AirGradient Map API', 'monitors', 'https://map-data.airgradient.com/map/api/v1/docs', 'AirGradient'],
        ['Natural Earth (world-atlas)', 'boundaries', 'https://github.com/topojson/world-atlas', 'public domain'],
      ]) {
        await client.query('INSERT INTO sources(name, kind, url, license) VALUES ($1,$2,$3,$4)', s);
      }

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

      await client.query('COMMIT');
      log(`done — ${fc.features.length} country polygons, ${Object.keys(CDraw).length} countries with death data.`);
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

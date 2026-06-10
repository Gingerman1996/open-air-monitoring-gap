/**
 * Seeds the STRUCTURAL reference data: the schema, the country polygons (world-atlas /
 * Natural Earth), and the source-provenance rows shown in the UI. Population and the
 * deaths/DALYs series are no longer hardcoded here — they are pulled live from the World
 * Bank + State of Global Air (GBD) APIs by the reference refresh (src/ingest/reference), on boot and monthly.
 * Idempotent: skips if countries already exist (set FORCE_RESEED=true to rebuild).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';

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
        ['State of Global Air 2025', 'deaths', 'https://www.stateofglobalair.org/data', 'HEI / GBD 2023 (IHME)'],
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
        // population is filled live by the reference refresh (World Bank), keyed on iso_n3
        await client.query(
          `INSERT INTO countries(name, iso_n3, geom)
           VALUES ($1, $2, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)))
           ON CONFLICT (name) DO NOTHING`,
          [name, f.id != null ? Number(f.id) : null, JSON.stringify(f.geometry)],
        );
      }

      // world-atlas has a few antimeridian-crossing polygons (Russia/Fiji/Antarctica) where a ring
      // spans -180..180; in the Web-Mercator MVT choropleth that wrap edge draws as a band across the
      // map. Split ONLY the offending ring(s) at the dateline — per-part, where a part spans >180° of
      // longitude — so the mainland stays one piece (splitting the whole polygon fragments it into
      // slivers that render as thin white seams). method=structure avoids linework sliver artifacts.
      await client.query(
        `UPDATE countries c SET geom = (
           SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Collect(q.q), 'method=structure'), 3))
           FROM (
             SELECT CASE WHEN (ST_XMax(dp.geom) - ST_XMin(dp.geom)) > 180
               THEN (WITH sp AS (
                       SELECT ST_MakeValid(ST_ShiftLongitude(ST_MakeValid(dp.geom, 'method=structure')), 'method=structure') s)
                     SELECT ST_Union(
                       ST_Intersection(s, ST_MakeEnvelope(-180,-90,180,90,4326)),
                       ST_Translate(ST_Intersection(s, ST_MakeEnvelope(180,-90,360,90,4326)), -360, 0)) FROM sp)
               ELSE dp.geom END q
             FROM (SELECT (ST_Dump(c.geom)).geom) dp
           ) q
         )
         WHERE EXISTS (SELECT 1 FROM (SELECT (ST_Dump(c.geom)).geom dg) z WHERE ST_XMax(z.dg) - ST_XMin(z.dg) > 180)`,
      );
      // repair any remaining self-intersections (incl. Antarctica's polar rings) so ST_Contains + tiles behave
      await client.query(
        `UPDATE countries SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom, 'method=structure'), 3)) WHERE NOT ST_IsValid(geom)`,
      );

      await client.query('COMMIT');
      log(`done — ${fc.features.length} country polygons. Population + deaths/DALYs pulled by the reference refresh.`);
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

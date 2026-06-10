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

      // Russia/Fiji wrap the antimeridian: their main ring jumps +179→−179, which is a self-
      // intersection in planar lon/lat. Just storing it raw makes ST_MakeValid below fragment the
      // mainland into latitude bands with hairline gaps (white stripes across Russia), and breaks
      // ST_Contains (the degenerate ring's planar interior smears a band across the whole world).
      // ST_ShiftLongitude maps the far-east (<0°) vertices to 180–360°, so the ring becomes a clean,
      // *valid*, monotonically-increasing 20→190° shape — correct for ST_Contains and for the
      // L.geoJSON choropleth (which draws it as one continuous landmass past the dateline edge).
      await client.query(
        `UPDATE countries SET geom = ST_ShiftLongitude(geom) WHERE name IN ('Russia', 'Fiji')`,
      );
      // Repair any remaining invalid polygons so ST_Contains is reliable — except Antarctica, a polar
      // cap whose ring wraps all longitudes: "repairing" it mangles the shape, L.geoJSON renders the
      // raw polygon fine, and it has no monitors/health data anyway. (Russia/Fiji are valid after the
      // shift above, so this skips them.)
      await client.query(
        `UPDATE countries SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom, 'method=structure'), 3))
         WHERE NOT ST_IsValid(geom) AND name <> 'Antarctica'`,
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

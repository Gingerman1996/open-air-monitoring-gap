/**
 * Live refresh of REFERENCE data — the annual GBD/UN datasets the seed used to hardcode.
 * Pulled monthly (1st of the month) by the BullMQ scheduler; also runs on boot and by hand.
 *
 *   countries.population    ← World Bank  SP.POP.TOTL   (most-recent value per country)
 *   health_impacts.deaths   ← WHO GHO     AIR_41        (ambient air pollution attributable deaths)
 *   health_impacts.dalys    ← WHO GHO     AIR_7         (ambient air pollution attributable DALYs)
 *
 * All three key on ISO3 alpha codes; we crosswalk to the world-atlas ISO numeric stored in
 * countries.iso_n3 (db/data/iso3166.json). WHO publishes both-sex, all-cause-attributable
 * totals for 2014–2019, so the panel sparkline gets six real years (was a synthetic trend).
 * Rows stay labelled pollutant='pm25' — the label the MVT tiles, density, and API already
 * join on (WHO ambient air pollution is PM2.5-dominated).
 *
 *   npm run refresh-reference        # or REFERENCE_ON_START=true at boot
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const WB_BASE = process.env.WORLD_BANK_API ?? 'https://api.worldbank.org/v2';
const WHO_BASE = process.env.WHO_GHO_API ?? 'https://ghoapi.azureedge.net/api';
const DEATHS_INDICATOR = 'AIR_41'; // ambient air pollution attributable deaths
const DALYS_INDICATOR = 'AIR_7'; //  ambient air pollution attributable DALYs
const TOTAL_CAUSE = 'GHECAUSE_GHE000000'; // GHE all-cause total (the sub-causes sum to this)
const BOTH_SEX = 'SEX_BTSX';

interface WhoRow {
  SpatialDim: string | null;
  TimeDim: number | null;
  NumericValue: number | null;
}

function findFile(candidates: string[]): string {
  for (const c of candidates) if (c && existsSync(c)) return c;
  throw new Error(`file not found in: ${candidates.join(', ')}`);
}
const crosswalkPath = () =>
  findFile([
    process.env.ISO3166_PATH ?? '',
    resolve(__dirname, '../../../../db/data/iso3166.json'),
    resolve(process.cwd(), '../../db/data/iso3166.json'),
    resolve(process.cwd(), 'db/data/iso3166.json'),
    '/app/db/data/iso3166.json',
  ]);

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

/** World Bank population, most-recent value per country, keyed by ISO3 alpha. */
async function fetchPopulation(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let page = 1;
  let pages = 1;
  do {
    const url = `${WB_BASE}/country/all/indicator/SP.POP.TOTL?format=json&mrnev=1&per_page=400&page=${page}`;
    const [meta, rows] = (await fetchJson(url)) as [
      { pages: number },
      Array<{ countryiso3code: string; value: number | null }> | null,
    ];
    pages = meta?.pages ?? 1;
    for (const r of rows ?? []) {
      if (r.value != null && r.countryiso3code) out.set(r.countryiso3code, r.value);
    }
    page++;
  } while (page <= pages);
  return out;
}

/** WHO GHO indicator: both-sex, all-cause-attributable totals → Map<iso3, Map<year, value>>. */
async function fetchWho(indicator: string): Promise<Map<string, Map<number, number>>> {
  const filter = `SpatialDimType eq 'COUNTRY' and Dim1 eq '${BOTH_SEX}' and Dim2 eq '${TOTAL_CAUSE}'`;
  const json = (await fetchJson(`${WHO_BASE}/${indicator}?$filter=${encodeURIComponent(filter)}`)) as {
    value: WhoRow[];
  };
  const out = new Map<string, Map<number, number>>();
  for (const r of json.value) {
    if (r.NumericValue == null || !r.SpatialDim || r.TimeDim == null) continue;
    if (!out.has(r.SpatialDim)) out.set(r.SpatialDim, new Map());
    out.get(r.SpatialDim)!.set(r.TimeDim, r.NumericValue);
  }
  return out;
}

export async function runReferenceRefresh(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://openair:openair@localhost:5432/openair',
    max: 4,
  });
  const log = (m: string) => console.log(`[reference] ${m}`);
  try {
    const iso3ToN3 = JSON.parse(readFileSync(crosswalkPath(), 'utf8')) as Record<string, number>;
    log('fetching World Bank population + WHO deaths/DALYs …');
    const [pop, deaths, dalys] = await Promise.all([
      fetchPopulation(),
      fetchWho(DEATHS_INDICATOR),
      fetchWho(DALYS_INDICATOR),
    ]);
    log(`World Bank: ${pop.size} countries w/ population; WHO deaths: ${deaths.size}, DALYs: ${dalys.size}`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // our countries keyed by ISO numeric (set by the seed from the world-atlas id)
      const byN3 = new Map<number, { id: number; name: string }>();
      for (const r of (
        await client.query<{ id: number; name: string; iso_n3: number }>(
          'SELECT id, name, iso_n3 FROM countries WHERE iso_n3 IS NOT NULL',
        )
      ).rows) {
        byN3.set(r.iso_n3, { id: r.id, name: r.name });
      }
      const lookup = (iso3: string) => {
        const n3 = iso3ToN3[iso3];
        return n3 != null ? byN3.get(n3) : undefined;
      };

      let popUpdated = 0;
      for (const [iso3, value] of pop) {
        const c = lookup(iso3);
        if (!c) continue;
        await client.query('UPDATE countries SET population = $1 WHERE id = $2', [Math.round(value), c.id]);
        popUpdated++;
      }

      // rebuild the health-impact series from the live WHO figures (per-100k off the latest population)
      await client.query(`DELETE FROM health_impacts WHERE pollutant = 'pm25'`);
      let rows = 0;
      let withDalys = 0;
      let countriesWithData = 0;
      for (const [iso3, yearMap] of deaths) {
        const c = lookup(iso3);
        if (!c) continue;
        const popVal = pop.get(iso3) ?? null;
        const dalyMap = dalys.get(iso3);
        for (const [year, deathCount] of yearMap) {
          const d = Math.round(deathCount);
          const daly = dalyMap?.get(year);
          const per100k = popVal && popVal > 0 ? +(d / (popVal / 100000)).toFixed(2) : null;
          await client.query(
            `INSERT INTO health_impacts (country_id, country_name, year, pollutant, deaths, deaths_per_100k, dalys)
             VALUES ($1, $2, $3, 'pm25', $4, $5, $6)`,
            [c.id, c.name, year, d, per100k, daly != null ? Math.round(daly) : null],
          );
          rows++;
          if (daly != null) withDalys++;
        }
        countriesWithData++;
      }

      await client.query('COMMIT');
      log(
        `done — population for ${popUpdated} countries; ${rows} health rows across ` +
          `${countriesWithData} countries (${withDalys} with DALYs).`,
      );
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
  runReferenceRefresh().catch((err) => {
    console.error('[reference] failed:', err);
    process.exit(1);
  });
}

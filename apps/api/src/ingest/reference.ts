/**
 * Live refresh of REFERENCE data — the annual datasets the seed used to hardcode.
 * Run by the monthly BullMQ job (force=true); on boot it refreshes only when a newer GBD vintage
 * exists (else skips, so restarts stay fast). Also runnable by hand (forced).
 *
 *   countries.population    ← World Bank  SP.POP.TOTL                 (most-recent value per country)
 *   health_impacts.deaths   ← State of Global Air / GBD-2023 burden API (ambient PM2.5 deaths)
 *   health_impacts.dalys    ← same API, measure=daly                  (ambient PM2.5 DALYs)
 *
 * The burden API is the public backend of the State of Global Air data explorer (HEI, hosted by
 * ZeVross). It carries the GBD-2023 vintage — a full 1990→2023 series per country — so the panel
 * sparkline shows real history to the latest year. Per-country endpoint only (no bulk) and it
 * 503s under load, so we fan out at a low concurrency with retry/backoff + a sequential mop-up,
 * and refuse to replace the table unless almost every country came back. Everything keys on ISO3
 * alpha → crosswalk to the world-atlas ISO numeric in countries.iso_n3 (db/data/iso3166.json).
 * Rows stay labelled pollutant='pm25' — the label the choropleth, density, and API already join on.
 *
 *   npm run refresh-reference        # forced; or REFERENCE_ON_START=true at boot (refreshes if newer)
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { backoffMs, shouldAbort } from '../common/metrics';

const WB_BASE = process.env.WORLD_BANK_API ?? 'https://api.worldbank.org/v2';
const GBD_BASE = process.env.SOGA_API ?? 'https://data3.zevross.com/hei/globalburden-2025/v1';
const FETCH_CONCURRENCY = Number(process.env.REFERENCE_FETCH_CONCURRENCY ?? 3);
const MAX_FAIL_FRACTION = 0.05; // refuse to replace the table if more than this share of countries fail
const REFRESH_LOCK_KEY = 770042; // pg advisory lock: serialise boot vs monthly-cron refreshers

interface CountrySeries {
  iso3: string;
  deaths: Map<number, number>;
  dalys: Map<number, number>;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET JSON, retrying ONLY on the burden API's load-shedding 503/429 and transient network errors.
 * Other non-2xx (404/400/5xx) and malformed bodies fail immediately — retrying them is pointless.
 */
async function fetchJson(url: string, tries = 5): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      if (attempt >= tries - 1) throw new Error(`${url} → ${(err as Error).message}`);
      await sleep(backoffMs(attempt));
      continue;
    }
    if (res.status === 503 || res.status === 429) {
      if (attempt >= tries - 1) throw new Error(`${url} → HTTP ${res.status}`);
      await sleep(backoffMs(attempt));
      continue;
    }
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return res.json();
  }
}

/** run an async fn over items with a fixed concurrency cap (the burden API 503s under load). */
async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
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

const burdenUrl = (iso3: string, measure: string) =>
  `${GBD_BASE}/burdens/country/chart?country=${iso3}&pollutant=pm25&measure=${measure}&metric=number`;

/** A GBD burden chart: [{ name, maxy, data: [[year, value], ...] }]. Missing country → []. */
function parseSeries(json: unknown): Map<number, number> {
  const arr = json as Array<{ data?: Array<[number, number]> }>;
  const m = new Map<number, number>();
  for (const [year, value] of arr?.[0]?.data ?? []) {
    if (value != null) m.set(year, value);
  }
  return m;
}

/** Latest year the API publishes (one cheap probe) — drives the boot vintage check. null if unreachable. */
async function latestApiYear(): Promise<number | null> {
  try {
    const m = parseSeries(await fetchJson(burdenUrl('USA', 'death')));
    return m.size ? Math.max(...m.keys()) : null;
  } catch {
    return null;
  }
}

async function fetchBurden(iso3: string): Promise<CountrySeries> {
  const [deaths, dalys] = await Promise.all([
    fetchJson(burdenUrl(iso3, 'death')).then(parseSeries),
    fetchJson(burdenUrl(iso3, 'daly')).then(parseSeries),
  ]);
  return { iso3, deaths, dalys };
}

/**
 * Deaths + DALYs series for every country the burden API knows (GBD-2023, 1990→2023).
 * Throws if too many countries fail, so a degraded API can never replace a full dataset with a partial.
 */
async function fetchGbd(log: (m: string) => void): Promise<CountrySeries[]> {
  const countries = (await fetchJson(`${GBD_BASE}/geo/countries?limit=500`)) as Array<{ iso3: string }>;
  const iso3s = countries.map((c) => c.iso3).filter(Boolean);
  const got = new Map<string, CountrySeries>();

  const pass = async (list: string[], concurrency: number): Promise<string[]> => {
    const failed: string[] = [];
    await mapLimit(list, concurrency, async (iso3) => {
      try {
        got.set(iso3, await fetchBurden(iso3));
      } catch {
        failed.push(iso3);
      }
    });
    return failed;
  };

  let failed = await pass(iso3s, FETCH_CONCURRENCY);
  if (failed.length) {
    // the API sheds load under the burst; once it's over, a patient sequential mop-up clears the rest
    log(`retrying ${failed.length} countries sequentially after a pause …`);
    await sleep(3000);
    failed = await pass(failed, 1);
  }
  if (shouldAbort(failed.length, iso3s.length, MAX_FAIL_FRACTION)) {
    throw new Error(`${failed.length}/${iso3s.length} countries failed — refusing to replace with a partial`);
  }
  if (failed.length) log(`WARN ${failed.length}/${iso3s.length} countries omitted this run: ${failed.join(',')}`);
  return [...got.values()].filter((s) => s.deaths.size > 0);
}

async function replaceHealthImpacts(
  client: PoolClient,
  gbd: CountrySeries[],
  pop: Map<string, number>,
  lookup: (iso3: string) => { id: number; name: string } | undefined,
  log: (m: string) => void,
): Promise<void> {
  // flatten to rows first so we can batch the insert (was ~5700 single-row round-trips)
  const rows: Array<[number, string, number, number, number | null, number | null]> = [];
  let withDalys = 0;
  const countries = new Set<number>();
  for (const s of gbd) {
    const c = lookup(s.iso3);
    if (!c) continue;
    const popVal = pop.get(s.iso3) ?? null;
    for (const [year, deathCount] of s.deaths) {
      const d = Math.round(deathCount);
      const daly = s.dalys.get(year);
      const per100k = popVal && popVal > 0 ? +(d / (popVal / 100000)).toFixed(2) : null;
      rows.push([c.id, c.name, year, d, per100k, daly != null ? Math.round(daly) : null]);
      if (daly != null) withDalys++;
    }
    countries.add(c.id);
  }

  await client.query(`DELETE FROM health_impacts WHERE pollutant = 'pm25'`);
  const COLS = 6;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const values: unknown[] = [];
    const tuples = chunk.map((r, j) => {
      const b = j * COLS;
      values.push(r[0], r[1], r[2], r[3], r[4], r[5]);
      return `($${b + 1},$${b + 2},$${b + 3},'pm25',$${b + 4},$${b + 5},$${b + 6})`;
    });
    await client.query(
      `INSERT INTO health_impacts (country_id, country_name, year, pollutant, deaths, deaths_per_100k, dalys)
       VALUES ${tuples.join(',')}`,
      values,
    );
  }
  log(`replaced health_impacts — ${rows.length} rows across ${countries.size} countries (${withDalys} with DALYs).`);
}

/**
 * @param force monthly cron + manual run pass true (always refresh). Boot passes false, which
 *   refreshes a fresh DB and otherwise refreshes only when the API has a newer year than we hold.
 */
export async function runReferenceRefresh(force = false): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://openair:openair@localhost:5432/openair',
    max: 4,
  });
  const log = (m: string) => console.log(`[reference] ${m}`);
  try {
    if (!force) {
      const dbMax = (
        await pool.query<{ y: number | null }>(`SELECT max(year) AS y FROM health_impacts WHERE pollutant = 'pm25'`)
      ).rows[0].y;
      if (dbMax != null) {
        const apiMax = await latestApiYear();
        if (apiMax == null) {
          log(`have data to ${dbMax} and the API is unreachable — keeping existing data.`);
          return;
        }
        if (dbMax >= apiMax) {
          log(`already current (have ${dbMax}, API latest ${apiMax}) — skip (monthly cron / force re-pulls).`);
          return;
        }
        log(`newer vintage available (API ${apiMax} > have ${dbMax}) — refreshing.`);
      }
    }

    const iso3ToN3 = JSON.parse(readFileSync(crosswalkPath(), 'utf8')) as Record<string, number>;
    log('fetching World Bank population + State of Global Air (GBD-2023) deaths/DALYs …');
    const [pop, gbd] = await Promise.all([fetchPopulation(), fetchGbd(log)]);
    log(`World Bank: ${pop.size} countries w/ population; GBD: ${gbd.length} countries w/ deaths`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // serialise concurrent refreshers (boot vs monthly cron vs manual) so their DELETE+INSERT can't race
      await client.query('SELECT pg_advisory_xact_lock($1)', [REFRESH_LOCK_KEY]);

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
      log(`population updated for ${popUpdated} countries.`);

      await replaceHealthImpacts(client, gbd, pop, lookup, log);

      await client.query('COMMIT');
      log('done.');
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
  runReferenceRefresh(true).catch((err) => {
    console.error('[reference] failed:', err);
    process.exit(1);
  });
}

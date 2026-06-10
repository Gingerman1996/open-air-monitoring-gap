# CLAUDE.md — Open Air Monitoring Gap

Project instructions for Claude Code sessions working in this repo.

## What this is

A single web tool that overlays **where air-quality monitors actually exist** on top of
**where air pollution kills the most people** — making the *monitoring gap* impossible to
ignore, with downloadable CSV data. Built for the Open Air Foundation hackathon.

Origin: handoff bundle from Claude Design. The original HTML/CSS/JS prototypes and the full
chat transcript live in `design-reference/` — they are the source of truth for visual
fidelity and intent. **Read `spec.md` first**, then `design-reference/project/System Demo.html`
when implementing a UI detail.

## Stack (fixed by the design — do not swap without asking)

| Layer | Tech |
|---|---|
| Frontend | Nuxt 3 · Leaflet + leaflet.markercluster · Nuxt `useState` for language (filter state is component-local) |
| Backend | NestJS · `pg` (node-postgres, raw parameterized SQL) · ioredis |
| Database | PostgreSQL + PostGIS + **TimescaleDB** (`measurements` hypertable) |
| Cache | Redis |
| Tiles | **Martin** (PostGIS → vector tiles) consumed by Leaflet.VectorGrid |
| Edge | Nginx (compose profile) |
| Orchestration | Docker Compose |

Ports: web `3000`, api `3001`, postgres `5432`, redis `6379`, martin `3002`.
The browser stays same-origin: Nitro proxies `/api/**`→api and `/tiles/**`→martin.

## Layout

```
apps/web      Nuxt 3 frontend (the dashboard)
apps/api      NestJS API (/api/v1) · src/ingest/{ingest,reference,ingest.scheduler}.ts
db/           init.sql (schema) · data/ (world-atlas polygons + ISO3 crosswalk) · seed (schema + polygons)
docker-compose.yml
scripts/      chrome-debug.mjs — Playwright loop helper
design-reference/  original prototypes + chat (read-only reference)
```

## Run

```bash
# infra only (fast dev loop): Postgres+PostGIS + Redis
docker compose up -d postgres redis

# seed the schema + country polygons + source rows (idempotent; FORCE_RESEED=true to rebuild)
npm --prefix apps/api run seed

# pull LIVE reference: World Bank population + State of Global Air GBD-2023 deaths/DALYs
# (per-country 1990→2023; ~2 min, the API rate-limits so it fans out slowly). CLI = force.
npm --prefix apps/api run refresh-reference

# pull LIVE monitors from the AirGradient Map API
npm --prefix apps/api run ingest

# in the container, boot runs seed → reference → ingest, then BullMQ schedules:
#   monitors  every INGEST_INTERVAL_MS (default 600000 = 10 min)
#   reference on REFERENCE_CRON (default '0 0 1 * *' Asia/Bangkok) — then re-ingests for density
# all gated by INGEST_SCHEDULE. Boot reference (REFERENCE_ON_START) is vintage-aware: it
# refreshes a fresh DB, else refetches only when the API has a newer year than we hold.

# dev servers
npm --prefix apps/api run start:dev     # http://localhost:3001/api/v1  (docs at /api/v1/docs)
npm --prefix apps/web run dev           # http://localhost:3000

# full stack, one command (the deliverable)
docker compose up --build
```

## Data sources (all live — no hardcoded values)

| Data | Source | Notes |
|---|---|---|
| Monitors + readings | AirGradient Map API (`map-data.airgradient.com`) | ~17k sensors; refreshed every 10 min |
| Deaths + DALYs | **State of Global Air GBD-2023** backend (`data3.zevross.com/hei/globalburden-2025`) | the SoGA data-explorer's public JSON API; per-country 1990→2023. Per-country only (no bulk) and **503s under load** → low concurrency + retry/backoff + sequential mop-up; **refuses to replace the table if >5% of countries fail** (so a degraded API can't wipe good data) |
| Population | World Bank `SP.POP.TOTL` | most-recent value per country |
| Boundaries | Natural Earth world-atlas 110m (`db/data/countries-110m.json`) | seeded; antimeridian polygons (Russia/Fiji/Antarctica) are **dateline-split** in the seed so the MVT choropleth has no band |

- Reference deaths/DALYs/population key on **ISO3 → `db/data/iso3166.json` → `countries.iso_n3`**. Rows are labelled `pollutant='pm25'` — the join key for tiles, density, and the API. Don't rename it.
- Coverage: **169/177** map countries have deaths data. The 8 without (Antarctica, Kosovo, N. Cyprus, Somaliland, W. Sahara, Falklands, New Caledonia, Fr. S. Antarctic Lands) are **GBD-untracked** (uninhabited or disputed/dependent) — not a bug. ~35 tiny GBD countries (Singapore, Malta…) have data but no 110m polygon to draw; switching to `countries-50m` would surface them.
- GBD publishes a new vintage roughly annually; the monthly cron + vintage-aware boot pick it up automatically. WHO GHO (the prior source, capped at 2019) was dropped.

## Conventions (follow existing code)

- **TypeScript strict** everywhere. Prefer `const`. `async/await`, not `.then` chains.
- **API SQL is raw + parameterized** via `pg` — never string-interpolate values into SQL.
  PostGIS does the spatial work (bbox, point-in-polygon, per-area counts).
- **Pre-aggregate, don't count live.** Density is computed into `density_stats` by the seed/
  refresh path; the API reads the cached answer (and caches it again in Redis). The browser
  never triggers a live count over all monitors.
- **Bilingual EN/TH.** Every user-facing string ships both. The frontend keeps a single
  `useLang()` composable + `t(en, th)`; technical tokens (stack names, table/column names,
  API paths, code) stay English in both languages — mirror the prototype's rule.
- **Brand:** primary `#159BB5` (Open Air blue). AQI scale green→yellow→red is unchanged.
  Logos in `apps/web/public/` (colored variant is the fixed brand mark).
- Comments only when the *why* is non-obvious. No "what" comments.

## Verify before claiming done

- API change → `curl` the endpoint, show the JSON.
- UI change → run it and drive Chrome (`node scripts/chrome-debug.mjs <url>`); confirm **zero
  console errors** + screenshot. Don't claim a feature works from code-reading alone.

## Debugging through Chrome

`chrome-devtools-mcp` is wired in `.mcp.json` for interactive inspection. For the automated
build→verify→fix loop use `scripts/chrome-debug.mjs` (Playwright) — it loads a URL, captures
console + network errors, and writes a screenshot to `debug-artifacts/`.

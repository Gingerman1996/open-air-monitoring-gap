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
| Database | PostgreSQL + PostGIS |
| Cache | Redis |
| Edge | Nginx (compose profile) |
| Orchestration | Docker Compose |

## Layout

```
apps/web      Nuxt 3 frontend (the dashboard)
apps/api      NestJS API (/api/v1)
db/           init.sql (schema) + seed (TS script that ports the demo mock data)
docker-compose.yml
scripts/      chrome-debug.mjs — Playwright loop helper
design-reference/  original prototypes + chat (read-only reference)
```

## Run

```bash
# infra only (fast dev loop): Postgres+PostGIS + Redis
docker compose up -d postgres redis

# seed the DB (idempotent)
npm --prefix apps/api run seed

# dev servers
npm --prefix apps/api run start:dev     # http://localhost:3001/api/v1  (docs at /api/v1/docs)
npm --prefix apps/web run dev           # http://localhost:3000

# full stack, one command (the deliverable)
docker compose up --build
```

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

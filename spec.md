# Open Air Monitoring Gap — System Spec

> Distilled from the Claude Design handoff (`design-reference/`). This is the implementation
> contract. The HTML prototype is the visual source of truth; this doc is the system of record
> for data shapes, endpoints, and behaviour.

## 1. Problem & goal

Air pollution does not kill equally, and the places that suffer most are often the places that
**measure least**. This tool overlays the global air-quality **monitor network** on top of the
**health burden** (deaths attributable to PM2.5) so the *monitoring gap* is visible at a glance,
and lets anyone download the underlying data.

**Audience:** mixed — journalists / policymakers (story-first) and researchers (data-first).
Public, read-only, no login.

## 2. Core features (parity with `System Demo.html`)

1. **Map** — Leaflet, CARTO light basemap, a separate *labels* pane rendered **above** the
   choropleth so place names stay readable. Zoom control bottom-right. `worldCopyJump`.
2. **Health-burden choropleth** — countries shaded by absolute PM2.5-attributable deaths/year,
   5 buckets navy→red, `fillOpacity` 0.38 (hover 0.6, selected 0.55). Countries with no data
   fall to the lowest bucket (navy), as in State of Global Air maps. Antimeridian fix for
   Russia/Fiji.
3. **Monitor pins** — one pin per monitor coloured by AQI; clustered via markercluster when
   zoomed out (cluster colour = avg AQI of its children, size by child count).
4. **Country info panel** (on country click):
   - Deaths attributable to PM2.5 (absolute + per 100k).
   - **Deaths trend 1990–2023** sparkline (SVG), hover shows the year + value.
   - Monitors in sample (total + online), per 100k.
   - **Monitoring gap** = `deaths_per_100k ÷ monitors_per_100k`. Severity **level 1–5** is the
     **quintile rank** computed *only* over countries that have both monitors and death/pop data
     (1 = lowest gap / blue, 5 = highest / red). A 5-segment scale bar highlights the level.
   - **"To reach the good zone (Lv 1)"** — monitors needed to drop into quintile 1, costed at
     low-cost ×$250 and reference ×$25,000 (indicative averages, configurable).
   - **Donation bar** — raised (value of existing monitors) vs goal (low-cost), "need" remainder.
   - `?` tooltips (instant, custom — no native-title delay) explaining each metric + sources.
   - Countries with zero monitors show a "coverage blind spot" note.
5. **Filters** — monitor type (low-cost / reference), manufacturer, status (online/offline),
   live counts; "N monitors shown".
6. **Layer toggles** — Monitors / Health burden.
7. **Story mode** — 4 narrated steps with `flyTo` framing (burden → where monitors are → the gap).
8. **Export CSV** — 4 datasets: `gap` (by city), `monitors` (filtered, one row/monitor),
   `density` (by city), `health` (deaths · rate_per_100k). UTF-8 + BOM (Excel-Thai safe).
9. **Sources menu** — Deaths · State of Global Air (GBD/IHME); Population · UN WPP + World Bank;
   Monitors · AirGradient API.
10. **i18n EN/TH** toggle, persisted; technical tokens stay English.

## 3. Pricing constants (panel maths)

- Low-cost sensor ≈ **$250** — AirGradient Open Air (~$195–320) / PurpleAir PA-II (~$229–279) midpoint.
- Reference sensor ≈ **$25,000** — regulatory FEM/BAM (e.g. Met One BAM-1020, ~$15k–40k) midpoint.

Indicative, configurable (API/env). Source string is shown to the user in the `?` tooltip.

## 4. Architecture

```
External sources              Ingestion (NestJS workers, future)        Storage
  AirGradient Map API  ─┐        roster sync (upsert monitors)     ┌─►  PostgreSQL + PostGIS
  State of Global Air  ─┼──►     readings sync (measurements)      ├─►    monitors, measurements,
  UN WPP / World Bank  ─┘        aggregate density_stats           │      health_impacts,
                                 (point-in-country via PostGIS)     │      countries/regions/urban_centers,
                                                                    └─►    density_stats
                                                                            │
                       Redis  ◄── cached density/choropleth answers ◄───────┘
                         │
   Browser  ◄──  Nginx  ◄──  NestJS API (/api/v1)  ──►  reads pre-aggregated, cached answers
```

For the hackathon MVP the "ingestion workers" are replaced by a **deterministic seed** that
writes the same shapes the live pipeline would (`db/seed`). Swapping seed → live API calls is
the Phase-2 step and does not change the schema or the API contract.

## 5. Database schema (PostgreSQL + PostGIS)

```sql
sources(id, name, kind, url, license)                          -- provenance rows
countries(iso3 PK, iso2, name, name_th, population, geom Geometry(MultiPolygon,4326))
regions(id PK, country_iso3 FK, name, geom)                    -- (scaffold; not populated in MVP)
urban_centers(id PK, country_iso3 FK, name, name_th, population,
              centroid Geometry(Point,4326))                   -- "cities" in the UI
monitors(id PK, external_id, source_id FK, city_id FK, country_iso3 FK,
         manufacturer, type ['low_cost'|'reference'], owner,
         status ['online'|'offline'], pm25, aqi, last_seen,
         location Geometry(Point,4326))
measurements(monitor_id FK, ts, pm25, aqi)                     -- latest + history
health_impacts(country_iso3 FK, year, pollutant, deaths,
               deaths_per_100k, dalys)                          -- versioned reference data
density_stats(scope_type ['city'|'country'], scope_id, country_iso3,
              population, monitors_total, monitors_online, reference, low_cost,
              monitors_per_100k, deaths_per_100k, avg_pm25, gap_ratio, gap_level,
              computed_at)                                      -- pre-aggregated, cached
```

PostGIS uses: `ST_Contains(country.geom, monitor.location)` for point-in-country,
`&&`/`ST_MakeEnvelope` for bbox queries, `ST_AsGeoJSON` for the choropleth payload.

## 6. API (`/api/v1`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/monitors?bbox=&type=&status=&manufacturer=` | monitors (bbox + filters) |
| GET | `/monitors/:id` | one monitor |
| GET | `/monitors/:id/measurements` | recent readings |
| GET | `/countries` | country list + deaths + population |
| GET | `/density/choropleth` | GeoJSON FeatureCollection (country geom + deaths bucket) |
| GET | `/density?iso3=` | density_stats for a country (or all) |
| GET | `/density/ranking` | countries ranked by gap_ratio |
| GET | `/health-impacts?iso3=&year=` | deaths/DALYs; **no `year` ⇒ yearly series** (sparkline) |
| GET | `/health-impacts/compare?iso3=a,b` | side-by-side |
| GET | `/stats/global` | totals (monitors, cities, widest gap) for the count pill |
| GET | `/export?dataset=gap\|monitors\|density\|health` | streamed CSV, UTF-8+BOM |
| GET | `/docs` | Swagger UI |

Responses cache-keyed in Redis (TTL ~5 min) for the aggregate endpoints.

## 7. Data flow (MVP)

1. `db/init.sql` creates extensions + schema.
2. `db/seed` loads: countries (geom from world-atlas 110m), `health_impacts` (per-country deaths +
   synthesised 1990–2023 series), `urban_centers` (35 cities), `monitors` (scattered per city —
   same generator as `demo-data.js`), then computes `density_stats` (incl. `gap_level` quintiles).
3. API serves pre-aggregated answers; Redis caches the heavy ones.
4. Frontend reads the API, renders the map + panels, exports CSV from `/export`.

## 8. Scaling roadmap (post-hackathon)

- **Phase 1 (MVP):** seed data, single API, Leaflet `L.geoJSON` choropleth. ← *we are here*
- **Phase 2 (Pilot):** real ingestion workers (BullMQ) pulling AirGradient + SoGA on a schedule;
  vector tiles for boundaries (Martin / pg_tileserv) + MapLibre; TimescaleDB for `measurements`.
- **Phase 3 (Global):** Kubernetes, read replicas, CDN-fronted tiles, regional API.

## 9. Success criteria (definition of done)

- `docker compose up --build` brings up Postgres/PostGIS (seeded), Redis, API, Web — all healthy.
- Every endpoint in §6 returns correct data; Swagger renders at `/api/v1/docs`.
- The dashboard loads in Chrome with **zero console errors** and every §2 feature works when
  exercised (verified via `scripts/chrome-debug.mjs`).

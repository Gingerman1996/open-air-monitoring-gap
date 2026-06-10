-- Open Air Monitoring Gap — schema (PostgreSQL + PostGIS)
-- Runs once on first container init. Data is loaded by db/seed (idempotent).

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- provenance rows shown in the UI "Sources" menu
CREATE TABLE IF NOT EXISTS sources (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL,
  kind  TEXT NOT NULL,            -- deaths | population | monitors | boundaries
  url   TEXT,
  license TEXT
);

-- countries keyed by world-atlas (Natural Earth) name, which the death data is keyed on too
CREATE TABLE IF NOT EXISTS countries (
  id          SERIAL PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  name_th     TEXT,
  iso_n3      INTEGER,                          -- ISO 3166-1 numeric (from world-atlas id)
  population  BIGINT,
  geom        geometry(MultiPolygon, 4326)
);
CREATE INDEX IF NOT EXISTS countries_geom_gix ON countries USING GIST (geom);

-- scaffold for sub-national regions (not populated in the MVP seed)
CREATE TABLE IF NOT EXISTS regions (
  id           SERIAL PRIMARY KEY,
  country_id   INTEGER REFERENCES countries(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  geom         geometry(MultiPolygon, 4326)
);

-- "cities" in the UI
CREATE TABLE IF NOT EXISTS urban_centers (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  name_th     TEXT,
  country_id  INTEGER REFERENCES countries(id) ON DELETE SET NULL,
  country_name TEXT NOT NULL,                   -- denormalised for fast export joins
  iso2        TEXT,
  population  BIGINT,
  avg_pm25    NUMERIC,
  deaths_per_100k NUMERIC,
  centroid    geometry(Point, 4326)
);
CREATE INDEX IF NOT EXISTS urban_centers_centroid_gix ON urban_centers USING GIST (centroid);

CREATE TABLE IF NOT EXISTS monitors (
  id            SERIAL PRIMARY KEY,
  external_id   TEXT UNIQUE NOT NULL,           -- e.g. AG-1042 ; idempotent upsert key
  name          TEXT,                           -- station label, e.g. IN-001
  source_id     INTEGER REFERENCES sources(id),
  city_id       INTEGER REFERENCES urban_centers(id) ON DELETE SET NULL,
  city          TEXT,
  country_id    INTEGER REFERENCES countries(id) ON DELETE SET NULL,
  country       TEXT,
  iso2          TEXT,
  manufacturer  TEXT,
  type          TEXT CHECK (type IN ('low_cost','reference')),
  owner         TEXT,
  status        TEXT CHECK (status IN ('online','offline')),
  pm25          NUMERIC,
  aqi           INTEGER,
  last_seen     TIMESTAMPTZ,
  location      geometry(Point, 4326)
);
CREATE INDEX IF NOT EXISTS monitors_location_gix ON monitors USING GIST (location);
CREATE INDEX IF NOT EXISTS monitors_type_idx   ON monitors (type);
CREATE INDEX IF NOT EXISTS monitors_status_idx ON monitors (status);

-- time-series of readings; TimescaleDB hypertable partitioned on ts.
-- UNIQUE(monitor_id, ts) both dedupes re-ingested readings and satisfies the
-- hypertable rule that any unique key include the partitioning column.
CREATE TABLE IF NOT EXISTS measurements (
  monitor_id  INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  ts          TIMESTAMPTZ NOT NULL,
  pm25        NUMERIC,
  aqi         INTEGER,
  UNIQUE (monitor_id, ts)
);
SELECT create_hypertable('measurements', 'ts', if_not_exists => TRUE, migrate_data => TRUE);
CREATE INDEX IF NOT EXISTS measurements_monitor_ts_idx ON measurements (monitor_id, ts DESC);

-- versioned reference data (deaths / DALYs by country, year, pollutant)
CREATE TABLE IF NOT EXISTS health_impacts (
  id              SERIAL PRIMARY KEY,
  country_id      INTEGER REFERENCES countries(id) ON DELETE CASCADE,
  country_name    TEXT NOT NULL,
  year            INTEGER NOT NULL,
  pollutant       TEXT NOT NULL DEFAULT 'pm25',
  deaths          BIGINT,
  deaths_per_100k NUMERIC,
  dalys           BIGINT,
  UNIQUE (country_name, year, pollutant)
);
CREATE INDEX IF NOT EXISTS health_impacts_country_idx ON health_impacts (country_name);

-- pre-aggregated density (read instantly; never counted live in a request)
CREATE TABLE IF NOT EXISTS density_stats (
  id               SERIAL PRIMARY KEY,
  scope_type       TEXT NOT NULL CHECK (scope_type IN ('city','country')),
  scope_id         INTEGER,
  scope_name       TEXT NOT NULL,
  country_name     TEXT,
  population       BIGINT,
  monitors_total   INTEGER,
  monitors_online  INTEGER,
  reference        INTEGER,
  low_cost         INTEGER,
  monitors_per_100k NUMERIC,
  deaths_per_100k  NUMERIC,
  avg_pm25         NUMERIC,
  gap_ratio        NUMERIC,
  gap_level        INTEGER,        -- 1..5 quintile (country scope only); NULL if no monitors/data
  computed_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (scope_type, scope_name)
);
CREATE INDEX IF NOT EXISTS density_scope_idx ON density_stats (scope_type);

-- ---------------------------------------------------------------------------
-- The Martin/MVT tile pipeline was replaced by the L.geoJSON choropleth
-- (GET /density/choropleth); drop its function source from existing volumes.
DROP FUNCTION IF EXISTS public.country_tiles(integer, integer, integer);

-- ---------------------------------------------------------------------------
-- Pledged donations (demo — no real payment). Drives the "fully equip" progress
-- bar per country and the dashboard's top-supporters leaderboard.
CREATE TABLE IF NOT EXISTS donations (
  id          SERIAL PRIMARY KEY,
  donor_name  TEXT NOT NULL,
  country     TEXT,                       -- world-atlas country name; NULL = general fund
  amount      NUMERIC NOT NULL CHECK (amount > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS donations_country_idx ON donations (country);

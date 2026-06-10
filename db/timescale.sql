-- Phase 3 (spec.md §8): TimescaleDB continuous-aggregate rollup + retention on `measurements`.
--
-- Kept OUT of init.sql on purpose: continuous-aggregate DDL and CALL refresh_continuous_aggregate
-- cannot run inside a transaction block, and seed.ts applies init.sql as one multi-statement query
-- (a single implicit transaction). This file is instead applied statement-by-statement (autocommit)
-- by runTimescaleSetup() on boot, and by the postgres initdb mount (psql) on a fresh volume.
-- Every statement is idempotent (IF NOT EXISTS / if_not_exists => TRUE), safe to re-run.
--
-- NOTE for editors: runTimescaleSetup() splits this file naively — it drops full `--` comment lines
-- and splits on `;`. Keep statements free of inline `-- comments` and of `;` inside string literals
-- or dollar-quoted bodies, or the splitter will mis-cut them.

-- Hourly per-monitor rollup of the 10-minute telemetry: avg/min/max PM2.5, avg AQI, sample count.
-- This is what keeps the per-monitor history cheap once raw rows age out below.
CREATE MATERIALIZED VIEW IF NOT EXISTS measurements_hourly
WITH (timescaledb.continuous) AS
  SELECT monitor_id,
         time_bucket(INTERVAL '1 hour', ts) AS bucket,
         avg(pm25) AS avg_pm25,
         min(pm25) AS min_pm25,
         max(pm25) AS max_pm25,
         avg(aqi)  AS avg_aqi,
         count(*)  AS samples
  FROM measurements
  GROUP BY monitor_id, bucket
WITH NO DATA;

-- Keep the rollup current: every hour, refresh the last 7 days up to the previous settled hour.
SELECT add_continuous_aggregate_policy('measurements_hourly',
  start_offset      => INTERVAL '7 days',
  end_offset        => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists     => TRUE);

-- Retention: drop raw readings older than 90 days. The hourly rollup retains the long trend cheaply.
SELECT add_retention_policy('measurements',
  drop_after    => INTERVAL '90 days',
  if_not_exists => TRUE);

-- Backfill the rollup over whatever history already exists so it is queryable immediately.
CALL refresh_continuous_aggregate('measurements_hourly', NULL, NULL);

/**
 * Pure numeric helpers extracted from the ingest/reference pipelines so the load-bearing
 * decisions (EPA AQI mapping, the partial-data abort threshold, retry backoff) can be unit-tested
 * without a live DB or network. Keep these dependency-free.
 */

/** US EPA AQI from a PM2.5 concentration (µg/m³), linear-interpolated within each breakpoint band. */
export function aqiFromPm(p: number): number {
  const bp = [
    [0, 12, 0, 50], [12.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
    [55.5, 150.4, 151, 200], [150.5, 250.4, 201, 300], [250.5, 500, 301, 500],
  ];
  for (const [cl, ch, al, ah] of bp) if (p <= ch) return Math.round(((ah - al) / (ch - cl)) * (p - cl) + al);
  return 500;
}

/**
 * Data-integrity guardrail for the reference refresh: refuse to replace the table when more than
 * `maxFraction` of countries failed to fetch, so a degraded upstream can't overwrite a full
 * dataset with a partial one. Strictly greater-than — exactly at the threshold still proceeds.
 */
export function shouldAbort(failed: number, total: number, maxFraction = 0.05): boolean {
  return failed > total * maxFraction;
}

/** Exponential backoff delay (ms) for retry `attempt` (0-based): base, 2·base, 4·base, … */
export function backoffMs(attempt: number, base = 300): number {
  return base * 2 ** attempt;
}

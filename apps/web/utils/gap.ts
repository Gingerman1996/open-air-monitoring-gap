/**
 * Monitoring-gap maths for the country panel, extracted so it can be unit-tested in isolation.
 * This is the client-side investBlock math (note the 0.001 monitors-per-100k floor) — close kin to,
 * but deliberately not identical to, the country-scope gap_ratio SQL in apps/api ingest.
 */

/** gap_ratio = deaths per 100k ÷ monitors per 100k; null when a country has no monitors. */
export function gapRatio(deathsPer100k: number, pop: number, monitors: number): number | null {
  if (monitors <= 0) return null;
  return deathsPer100k / Math.max(monitors / (pop / 100000), 0.001);
}

/**
 * Monitors to add so a country's gap drops to the Level-1 threshold `t0` (the lowest quintile).
 * Never negative — a country already inside Lv-1 needs zero.
 */
export function monitorsNeeded(deathsPer100k: number, pop: number, monitors: number, t0: number): number {
  return Math.max(0, Math.ceil((deathsPer100k / t0) * pop / 100000) - monitors);
}

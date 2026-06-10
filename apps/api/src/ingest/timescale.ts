/**
 * Phase 3 (spec.md §8): apply the TimescaleDB continuous-aggregate rollup + retention policy on the
 * `measurements` hypertable. The objects live in db/timescale.sql; this runner applies them
 * statement-by-statement (each its own autocommit query) because continuous-aggregate DDL and
 * CALL refresh_continuous_aggregate cannot run inside a transaction block. Every statement is
 * idempotent, so this is safe to run on every boot (gated by TIMESCALE_ON_START).
 *
 *   npm run timescale        # or TIMESCALE_ON_START=true at boot
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

function findFile(candidates: string[]): string {
  for (const c of candidates) if (c && existsSync(c)) return c;
  throw new Error(`file not found in: ${candidates.join(', ')}`);
}
const timescaleSqlPath = () =>
  findFile([
    process.env.TIMESCALE_SQL_PATH ?? '',
    resolve(__dirname, '../../../../db/timescale.sql'),
    resolve(process.cwd(), '../../db/timescale.sql'),
    resolve(process.cwd(), 'db/timescale.sql'),
    '/app/db/timescale.sql',
  ]);

/** Split a SQL file into individual statements: drop `--` comment lines, then split on `;`. */
function statements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function runTimescaleSetup(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://openair:openair@localhost:5432/openair',
    max: 2,
  });
  const log = (m: string) => console.log(`[timescale] ${m}`);
  try {
    const stmts = statements(readFileSync(timescaleSqlPath(), 'utf8'));
    for (const stmt of stmts) await pool.query(stmt);
    log(`continuous aggregate + retention applied (${stmts.length} statements).`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runTimescaleSetup().catch((err) => {
    console.error('[timescale] failed:', err);
    process.exit(1);
  });
}

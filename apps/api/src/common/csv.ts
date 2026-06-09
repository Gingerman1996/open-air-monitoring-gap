type Cell = string | number | null | undefined;

/** RFC-4180 CSV with a UTF-8 BOM so Excel reads Thai correctly. */
export function toCsv(rows: Cell[][]): string {
  const body = rows
    .map((row) =>
      row
        .map((v) => {
          const s = v == null ? '' : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\n');
  return '﻿' + body;
}

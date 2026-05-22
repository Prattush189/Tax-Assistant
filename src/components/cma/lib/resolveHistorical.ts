/**
 * Resolves the uploaded Excel rows + the user's mapping into a
 * canonical-key → values-by-year map. Bridge between the wizard's
 * raw data + the projection engine.
 *
 * Input shape:
 *   - rows: 2D from the uploaded Excel (after sheet selection)
 *   - yearColumns: column indices the user identified as historical
 *     year-value columns (typically the last 2 columns)
 *   - mapping: per-row canonicalKey assignments
 *
 * Output:
 *   - AccountSeries: per canonical key, an array of values indexed
 *     by historical year (length === yearColumns.length)
 *
 * Multiple uploaded rows mapped to the same canonical key are
 * SUMMED — a P&L often breaks Sales into Domestic + Export which
 * the user might both map to pl_revenue.
 */

import type { AccountSeries } from './projectionEngine';
import type { MappingEntry } from './uiModel';
import type { CanonicalSection } from './canonicalAccounts';

function toNumber(raw: string): number {
  if (!raw) return 0;
  // Indian formatting: 1,23,456.78 / (12,345) for negatives / dashes
  // for zero. Strip commas, brackets-as-negative, currency symbols.
  let s = raw.trim();
  if (!s || s === '-' || s === '—' || s === '–') return 0;
  // Bracket-wrapped = negative.
  const isNegative = /^\(.+\)$/.test(s);
  if (isNegative) s = s.slice(1, -1);
  // Drop currency symbols + commas.
  s = s.replace(/[₹$,]/g, '').replace(/\s+/g, '');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return isNegative ? -Math.abs(n) : n;
}

export function resolveHistorical(
  rows: string[][],
  yearColumns: number[],
  mapping: MappingEntry[],
): AccountSeries {
  const series: AccountSeries = {};
  // Index mapping by row for fast lookup. Same row mapped twice =
  // last assignment wins (UI doesn't allow duplicates anyway).
  const byRow = new Map<number, CanonicalSection>();
  for (const m of mapping) {
    byRow.set(m.sourceRowIndex, m.canonicalKey as CanonicalSection);
  }

  for (const [rowIdx, canonicalKey] of byRow) {
    const row = rows[rowIdx];
    if (!row) continue;
    if (!series[canonicalKey]) {
      series[canonicalKey] = new Array(yearColumns.length).fill(0);
    }
    for (let y = 0; y < yearColumns.length; y++) {
      const col = yearColumns[y];
      const raw = row[col] ?? '';
      // Magnitude — sign is implied by the section, not the user's
      // upload (an "Operating Expense" row of 1,00,000 means 1L of
      // expense, not −1L). We store the absolute value here and let
      // the projection engine subtract appropriately.
      const v = Math.abs(toNumber(raw));
      series[canonicalKey]![y] += v;
    }
  }
  return series;
}

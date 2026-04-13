/**
 * 26AS / AIS Reconciliation Engine
 *
 * Compares TDS entries from Form 26AS (or AIS) against the ITR draft's
 * TDSonSalaries + TDSonOthThanSals to flag mismatches.
 */

export interface TDSEntry {
  tan: string;
  deductorName: string;
  section?: string;
  amountPaid: number;
  tdsDeducted: number;
  source: '26AS' | 'ITR';
}

export interface ReconciliationResult {
  matched: MatchedEntry[];
  onlyIn26AS: TDSEntry[];
  onlyInITR: TDSEntry[];
  totalMatched: number;
  total26AS: number;
  totalITR: number;
  tds26AS: number;
  tdsITR: number;
  discrepancy: number;
}

export interface MatchedEntry {
  tan: string;
  deductorName: string;
  amount26AS: number;
  tds26AS: number;
  amountITR: number;
  tdsITR: number;
  tdsDiff: number;
  status: 'match' | 'mismatch';
}

/**
 * Reconcile TDS entries from 26AS against ITR draft entries.
 * Matches by TAN (case-insensitive).
 */
export function reconcileTDS(
  entries26AS: TDSEntry[],
  entriesITR: TDSEntry[],
): ReconciliationResult {
  const matched: MatchedEntry[] = [];
  const onlyIn26AS: TDSEntry[] = [];
  const onlyInITR: TDSEntry[] = [];

  // Index ITR entries by TAN
  const itrByTan = new Map<string, TDSEntry[]>();
  for (const e of entriesITR) {
    const key = (e.tan ?? '').toUpperCase().trim();
    if (!key) continue;
    const arr = itrByTan.get(key) ?? [];
    arr.push(e);
    itrByTan.set(key, arr);
  }

  const matchedTans = new Set<string>();

  for (const e26 of entries26AS) {
    const key = (e26.tan ?? '').toUpperCase().trim();
    const itrMatches = itrByTan.get(key);

    if (!itrMatches || itrMatches.length === 0) {
      onlyIn26AS.push(e26);
      continue;
    }

    // Sum all ITR entries for this TAN
    const totalITRAmount = itrMatches.reduce((a, e) => a + e.amountPaid, 0);
    const totalITRTds = itrMatches.reduce((a, e) => a + e.tdsDeducted, 0);
    const tdsDiff = e26.tdsDeducted - totalITRTds;

    matched.push({
      tan: key,
      deductorName: e26.deductorName || itrMatches[0].deductorName,
      amount26AS: e26.amountPaid,
      tds26AS: e26.tdsDeducted,
      amountITR: totalITRAmount,
      tdsITR: totalITRTds,
      tdsDiff,
      status: Math.abs(tdsDiff) <= 1 ? 'match' : 'mismatch',
    });
    matchedTans.add(key);
  }

  // ITR entries not in 26AS
  for (const [tan, entries] of itrByTan) {
    if (!matchedTans.has(tan)) {
      for (const e of entries) {
        onlyInITR.push(e);
      }
    }
  }

  const tds26AS = entries26AS.reduce((a, e) => a + e.tdsDeducted, 0);
  const tdsITR = entriesITR.reduce((a, e) => a + e.tdsDeducted, 0);

  return {
    matched,
    onlyIn26AS,
    onlyInITR,
    totalMatched: matched.length,
    total26AS: entries26AS.length,
    totalITR: entriesITR.length,
    tds26AS,
    tdsITR,
    discrepancy: tds26AS - tdsITR,
  };
}

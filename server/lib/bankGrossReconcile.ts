/**
 * Gross-turnover cross-check for scanned bank statements.
 *
 * Once the running-balance chain reconciles (net + closing tie out), the
 * only thing that can still differ from the bank's own printed "TOTAL" /
 * "GRAND TOTAL" row is a DROPPED row — OCR never adds rows, only misses
 * them. When both the inflow and outflow are short by the same even
 * amount, the dropped row was a self-cancelling reversal pair (a charge
 * and its RVSL, net zero): harmless to every balance and to the net, but
 * worth explaining rather than leaving the user wondering why turnover is
 * off. These two pure helpers live apart from the route so they're unit-
 * testable without dragging in the DB/Gemini import side effects.
 */

/**
 * Pull the large money figures off a statement's printed "TOTAL" /
 * "GRAND TOTAL" row from the OCR page text. Generous on purpose — the
 * caller (grossTotalNote) matches these to the computed inflow/outflow by
 * proximity, so picking up an extra number (e.g. the trailing closing
 * balance) is harmless. Returns [] when no totals row is found.
 */
export function parsePrintedTotals(pages: string[]): number[] {
  const out: number[] = [];
  const dateAtStart = /^\s*\|?\s*\d{1,2}[-/]/;
  const moneyRe = /\d[\d,]*\.\d{2}\b/g;
  for (const page of pages) {
    for (const line of page.split('\n')) {
      // A totals row mentions TOTAL but isn't a dated transaction line
      // (some narrations contain "total" — the date guard drops those).
      if (!/\btotal\b/i.test(line) || dateAtStart.test(line)) continue;
      const matches = line.match(moneyRe);
      if (!matches || matches.length < 2) continue; // need ≥2 figures
      for (const m of matches) {
        const v = Number(m.replace(/,/g, ''));
        if (Number.isFinite(v)) out.push(v);
      }
    }
  }
  return out;
}

/**
 * Explain a gross-turnover gap when the net already reconciles. We only
 * ever DROP rows (OCR misses), never invent them, so a printed total is
 * an upper bound: if both inflow and outflow are short by the same even
 * amount, a self-cancelling reversal pair (charge + RVSL, net 0) was
 * dropped — it moves neither the net nor any balance, so we reassure
 * rather than alarm. Returns null when nothing matches the pattern
 * (avoids inventing a warning from an OCR-garbled totals line).
 */
export function grossTotalNote(
  inflow: number,
  outflow: number,
  printedTotals: number[] | null | undefined,
): string | null {
  if (!printedTotals || printedTotals.length < 2) return null;
  // ASSIGN two DISTINCT printed figures to the two computed sides — one
  // each, not independently — because the deposits/withdrawals column
  // order is unknown and both sides are close in magnitude (matching each
  // to "nearest" would pick the same figure twice). Each printed figure
  // must be ≥ its computed side (we under-count, never over-count); 2%
  // slack absorbs an OCR digit wobble in the printed total. Among valid
  // assignments, minimise total gap, tie-break toward balanced gaps so a
  // genuine wash pair (equal shortfall both sides) is recognised.
  const slack = (t: number) => Math.max(1, t * 0.02);
  let best: { inGap: number; outGap: number } | null = null;
  for (let i = 0; i < printedTotals.length; i++) {
    for (let j = 0; j < printedTotals.length; j++) {
      if (i === j) continue;
      const pi = printedTotals[i], pj = printedTotals[j];
      if (pi < inflow - slack(inflow) || pj < outflow - slack(outflow)) continue;
      const inGap = pi - inflow, outGap = pj - outflow;
      const sum = inGap + outGap, diff = Math.abs(inGap - outGap);
      if (best === null) { best = { inGap, outGap }; continue; }
      const bSum = best.inGap + best.outGap, bDiff = Math.abs(best.inGap - best.outGap);
      if (sum < bSum - 0.005 || (Math.abs(sum - bSum) <= 0.005 && diff < bDiff)) {
        best = { inGap, outGap };
      }
    }
  }
  if (best === null) return null;
  const { inGap, outGap } = best;
  // Both sides must be genuinely short for there to be anything to say.
  if (inGap < 1 && outGap < 1) return null;
  const even = Math.abs(inGap - outGap) <= Math.max(1, Math.min(inGap, outGap) * 0.01);
  const fmt = (x: number) => x.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  if (even) {
    return `Net and closing balance reconcile exactly. Gross turnover is ₹${fmt(inGap)} below the bank's printed Grand Total on each side — a self-cancelling reversal pair (a charge and its reversal, net zero) we couldn't capture from the scan. It does not affect any balance, the net, or any tax figure.`;
  }
  return `Gross turnover differs from the bank's printed Grand Total (deposits short ₹${fmt(inGap)}, withdrawals short ₹${fmt(outGap)}) — likely one or more rows the scan didn't capture. Net and closing balance still reconcile; verify against the original PDF if exact turnover matters.`;
}

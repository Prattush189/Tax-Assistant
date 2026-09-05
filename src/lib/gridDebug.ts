/**
 * Debug logging for the deterministic PDF / grid pipeline (pdfGrid,
 * per-bank and per-ERP rules, the uploaders that call them).
 *
 * These logs are invaluable when a statement or ledger mis-maps — and
 * pure noise in every other user's console. They were unconditional
 * `console.log` calls (29 of them in the production bundle). They now
 * go through gridLog(), which only prints when the same flag pdfGrid
 * already honours is set:
 *
 *   localStorage.pdfGridDebug = '1'
 *
 * Node harness scripts have no localStorage; they stub it when they
 * want the output (see scripts/debug-*.mts) and get silence otherwise.
 */
export function isGridDebug(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('pdfGridDebug') === '1';
  } catch {
    return false;
  }
}

export function gridLog(...args: unknown[]): void {
  if (isGridDebug()) console.log(...args);
}

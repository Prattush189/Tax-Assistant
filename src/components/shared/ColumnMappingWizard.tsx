import { Fragment, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, X, AlertTriangle } from 'lucide-react';
import type { ColumnMapping, ColumnRole, PdfGrid } from '../../lib/pdfGrid';
import { findTableStart, suggestMapping } from '../../lib/pdfGrid';

interface Props {
  /** "bank" hides voucher/account, "ledger" exposes them. */
  kind: 'bank' | 'ledger';
  grid: PdfGrid;
  filename: string;
  onConfirm: (mapping: ColumnMapping) => void;
  onCancel: () => void;
  /** Optional escape hatch — when provided, a "Use AI Vision instead"
   *  button appears in the footer. Closes the wizard and routes the
   *  same file through the Gemini-based vision pipeline (~1.5×–2×
   *  tokens vs the wizard path, but works on any layout). */
  onUseVision?: () => void;
  /** Optional preset mapping. When supplied, the wizard opens with
   *  this mapping selected instead of running `suggestMapping`.
   *  Used by the per-ERP / per-bank auto-detection rules so the
   *  user sees the deterministic mapping pre-applied and can
   *  review or correct it before clicking Confirm. */
  initialMapping?: ColumnMapping;
  /** Display name of the auto-detected source (e.g. "Busy",
   *  "ICICI Bank") — shown as a banner above the mapping when
   *  `initialMapping` is supplied. Tells the user the mapping was
   *  pre-filled by a rule and they should verify it. */
  detectedSource?: string;
}

// Role-label per kind. Bank statements speak "Withdrawal / Deposit"
// (the customer-facing convention), ledgers speak "Debit / Credit"
// (the bookkeeping convention). Mixing the two confuses ledger users
// because in a bank-account ledger Dr = receipt and Cr = payment —
// the OPPOSITE of how the bank statement labels them.
const BASE_ROLES: Array<{
  value: ColumnRole;
  bankLabel: string;
  ledgerLabel: string;
  bankOnly?: boolean;
  ledgerOnly?: boolean;
}> = [
  { value: 'skip',       bankLabel: 'Skip / Ignore',                 ledgerLabel: 'Skip / Ignore' },
  { value: 'date',       bankLabel: 'Date',                          ledgerLabel: 'Date' },
  { value: 'valueDate',  bankLabel: 'Value Date / Posting Date',     ledgerLabel: 'Value Date / Posting Date' },
  { value: 'narration',  bankLabel: 'Narration / Description',       ledgerLabel: 'Narration / Particulars' },
  { value: 'debit',      bankLabel: 'Debit (Withdrawal)',            ledgerLabel: 'Debit (Dr)' },
  { value: 'credit',     bankLabel: 'Credit (Deposit)',              ledgerLabel: 'Credit (Cr)' },
  { value: 'amount',     bankLabel: 'Amount (single column)',        ledgerLabel: 'Amount (single column)' },
  { value: 'drCrMarker', bankLabel: 'Dr/Cr marker',                  ledgerLabel: 'Dr/Cr marker' },
  { value: 'balance',    bankLabel: 'Running Balance',               ledgerLabel: 'Running Balance' },
  { value: 'reference',  bankLabel: 'Reference / UTR / Cheque',      ledgerLabel: 'Reference / UTR / Cheque' },
  { value: 'voucher',    bankLabel: 'Voucher / Type',                ledgerLabel: 'Voucher / Type', ledgerOnly: true },
  { value: 'account',    bankLabel: 'Account / Ledger Name',         ledgerLabel: 'Account / Ledger Name', ledgerOnly: true },
];

const PREVIEW_ROWS = 12;

export function ColumnMappingWizard({ kind, grid, filename, onConfirm, onCancel, onUseVision, initialMapping, detectedSource }: Props) {
  const [mapping, setMapping] = useState<ColumnMapping>(() => initialMapping ?? suggestMapping(grid));

  // Re-seed mapping if the grid prop changes (e.g. user cancels and
  // picks a different PDF). When the parent supplied a preset
  // mapping (per-ERP / per-bank auto-detection), prefer that over
  // suggestMapping's content-based heuristic — the rule is more
  // accurate when it fires.
  useEffect(() => {
    setMapping(initialMapping ?? suggestMapping(grid));
  }, [grid, initialMapping]);

  const availableRoles = useMemo(
    () => BASE_ROLES
      .filter(r => {
        if (r.bankOnly && kind !== 'bank') return false;
        if (r.ledgerOnly && kind !== 'ledger') return false;
        return true;
      })
      .map(r => ({ value: r.value, label: kind === 'ledger' ? r.ledgerLabel : r.bankLabel })),
    [kind],
  );

  const validation = useMemo(() => validate(mapping, kind), [mapping, kind]);

  // Skip past the metadata block at the top of bank/ledger PDFs
  // (Customer Id / Branch / Address rows etc.) so the preview shows
  // actual transactions — that's the only way the user can verify
  // their column mapping is right. Re-runs whenever the user changes
  // the date column, since the data-row detection depends on it.
  const tableStart = useMemo(() => {
    const dateCol = mapping.roles.indexOf('date');
    return findTableStart(grid, dateCol >= 0 ? dateCol : null);
  }, [grid, mapping]);
  const previewRows = useMemo(() => {
    const startIdx = tableStart ? tableStart.firstDataRowIndex : 0;
    const window = grid.rows.slice(startIdx, startIdx + PREVIEW_ROWS);
    // Find columns that have data SOMEWHERE in the document but
    // happen to be empty across the visible window. For each one,
    // pull one rich row from later in the document and append. The
    // user then sees real data for every column they need to map,
    // not just whichever transactions happened to live near the
    // table start. Canonical example: a Canara epassbook whose
    // first 12 transactions are all withdrawals, leaving the
    // Deposits column blank in the preview — without this lookup
    // the user thinks the column is missing.
    const colHasDataInWindow = new Array(grid.columnCount).fill(false);
    for (const r of window) {
      for (let c = 0; c < grid.columnCount; c++) {
        if ((r[c] ?? '').trim().length > 0) colHasDataInWindow[c] = true;
      }
    }
    const supplementalRows: string[][] = [];
    for (let c = 0; c < grid.columnCount; c++) {
      if (colHasDataInWindow[c]) continue;
      // Walk forward from end of window to find a row where this
      // column has data AND there's a date in the date column
      // (otherwise we might pull a continuation / footer row).
      const dateColIdx = mapping.roles.indexOf('date');
      const searchStart = startIdx + PREVIEW_ROWS;
      for (let r = searchStart; r < grid.rows.length; r++) {
        const row = grid.rows[r];
        const cellVal = (row[c] ?? '').trim();
        if (cellVal.length === 0) continue;
        const hasDate = dateColIdx < 0 || (row[dateColIdx] ?? '').trim().length > 0;
        if (!hasDate) continue;
        // De-dup against rows we've already pulled.
        if (supplementalRows.some(existing => existing.join('|') === row.join('|'))) continue;
        supplementalRows.push(row);
        break;
      }
    }
    return [...window, ...supplementalRows];
  }, [grid, tableStart, mapping]);
  // Index of the first row that's a "supplemental" pull from later
  // in the document — used by the table renderer to draw a divider
  // and label so the user knows those rows aren't sequential.
  const supplementalStartIdx = useMemo(() => {
    const startIdx = tableStart ? tableStart.firstDataRowIndex : 0;
    const windowSize = Math.min(PREVIEW_ROWS, grid.rows.length - startIdx);
    return previewRows.length > windowSize ? windowSize : -1;
  }, [previewRows.length, tableStart, grid.rows.length]);
  const headerHintRow = useMemo(() => {
    if (!tableStart || tableStart.headerRowIndex === null) return null;
    return grid.rows[tableStart.headerRowIndex];
  }, [grid, tableStart]);

  const setRole = (col: number, role: ColumnRole) => {
    setMapping(m => {
      const next = m.roles.slice();
      // Most roles can only be assigned to one column. The wizard
      // un-assigns any other column currently holding the same role
      // (excluding 'skip' which is fine to repeat) so we never end
      // up with two "Date" columns.
      if (role !== 'skip') {
        for (let i = 0; i < next.length; i++) {
          if (i !== col && next[i] === role) next[i] = 'skip';
        }
      }
      next[col] = role;
      return { roles: next };
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 max-w-5xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
              Identify the columns in your {kind === 'bank' ? 'bank statement' : 'ledger'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              We extracted the table from <span className="font-mono text-xs">{filename}</span> deterministically.
              Tag each column below — this is what makes the credit/debit signs reliable.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {detectedSource && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-900/20 p-3 text-sm">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-none text-emerald-600 dark:text-emerald-400" />
              <div className="text-emerald-900 dark:text-emerald-100">
                <span className="font-semibold">Auto-detected as {detectedSource}.</span>{' '}
                The columns below are pre-mapped from a built-in rule. Look them over — adjust any column whose dropdown is wrong, then click Continue.
              </div>
            </div>
          )}
          <div className="border border-gray-200 dark:border-gray-800 rounded-lg overflow-x-auto">
            <table className="text-xs min-w-full">
              <thead className="bg-gray-50 dark:bg-gray-800/60 sticky top-0">
                <tr>
                  {mapping.roles.map((role, c) => (
                    <th key={c} className="p-2 border-b border-gray-200 dark:border-gray-800 text-left font-normal align-top">
                      <select
                        value={role}
                        onChange={e => setRole(c, e.target.value as ColumnRole)}
                        className="w-full text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-1.5 py-1"
                      >
                        {availableRoles.map(r => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {headerHintRow && (
                  <tr className="border-t border-gray-100 dark:border-gray-800/60 bg-blue-50/40 dark:bg-blue-900/10">
                    {mapping.roles.map((_, c) => (
                      <td key={c} className="p-2 text-blue-700 dark:text-blue-300 font-medium whitespace-nowrap max-w-[18rem] overflow-hidden text-ellipsis">
                        {headerHintRow[c] ?? ''}
                      </td>
                    ))}
                  </tr>
                )}
                {previewRows.map((row, r) => {
                  const isFirstSupplemental = supplementalStartIdx >= 0 && r === supplementalStartIdx;
                  return (
                    <Fragment key={r}>
                      {isFirstSupplemental && (
                        <tr className="border-t-2 border-dashed border-amber-300 dark:border-amber-700/60 bg-amber-50/50 dark:bg-amber-900/10">
                          <td colSpan={mapping.roles.length} className="px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300 italic">
                            ↓ Sample rows pulled from later in the document — shown so every column has at least one example. Not sequential to the rows above.
                          </td>
                        </tr>
                      )}
                      <tr className="border-t border-gray-100 dark:border-gray-800/60">
                        {mapping.roles.map((_, c) => (
                          <td key={c} className="p-2 text-gray-700 dark:text-gray-300 whitespace-nowrap max-w-[18rem] overflow-hidden text-ellipsis">
                            {row[c] ?? ''}
                          </td>
                        ))}
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {tableStart && tableStart.skippedCount > 0
              ? `Skipped ${tableStart.skippedCount} metadata row${tableStart.skippedCount === 1 ? '' : 's'} above the transaction table (Customer Id, Branch, Address, etc.). Showing the next ${previewRows.length} of ${grid.rows.length - tableStart.firstDataRowIndex} transaction-area rows.`
              : `Showing first ${previewRows.length} of ${grid.rows.length} rows.`}
            {' '}{grid.columnCount} columns detected · {grid.pageCount} pages.
            {headerHintRow ? ' Highlighted row shows the column labels detected in the PDF.' : ''}
          </p>

          {validation.ok === false && (
            <div className="mt-4 flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{validation.reason}</span>
            </div>
          )}

          <div className="mt-4 text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <p><strong>Tip:</strong> if your statement uses a single Amount column with Dr/Cr marker, set one column to "Amount (single column)" and another to "Dr/Cr marker".</p>
            <p>Header rows, page totals, and "Brought Forward" lines are filtered automatically — only rows with a parseable date count as transactions.</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 p-5 border-t border-gray-200 dark:border-gray-800">
          <div>
            {onUseVision && (
              <button
                type="button"
                onClick={() => {
                  const ok = window.confirm(
                    'Switch to AI Vision?\n\n' +
                    'Vision reads the PDF directly with Gemini 3.1 Flash-Lite and handles unusual layouts the deterministic parser misses. ' +
                    'Trade-off: roughly 1.5×–2× more tokens than the column-mapping path. ' +
                    'Use this if the columns above don\'t match your file or the wizard rejects the mapping.',
                  );
                  if (ok) onUseVision();
                }}
                className="text-sm font-medium text-amber-700 dark:text-amber-400 hover:underline"
              >
                Use AI Vision instead →
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!validation.ok}
              onClick={() => onConfirm(mapping)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
            >
              <CheckCircle2 className="w-4 h-4" />
              Continue with these columns
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function validate(mapping: ColumnMapping, kind: 'bank' | 'ledger'): { ok: true } | { ok: false; reason: string } {
  const roles = new Set(mapping.roles.filter(r => r !== 'skip'));
  if (!roles.has('date')) return { ok: false, reason: 'Pick which column holds the transaction Date.' };
  const hasDebitCredit = roles.has('debit') && roles.has('credit');
  const hasSingleAmount = roles.has('amount');
  if (!hasDebitCredit && !hasSingleAmount) {
    return { ok: false, reason: 'Map either a Debit + Credit pair, or a single Amount column.' };
  }
  if (kind === 'ledger' && !roles.has('narration')) {
    return { ok: false, reason: 'Ledgers need a Narration / Particulars column for audit context.' };
  }
  return { ok: true };
}

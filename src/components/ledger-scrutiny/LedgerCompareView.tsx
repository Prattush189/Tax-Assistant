/**
 * Ledger compare flow: reconcile Entity A's copy of a ledger against
 * Entity B's copy. Each side runs through the same wizard pipeline as
 * the single ledger flow (PDF/CSV/Excel → grid → ColumnMappingWizard →
 * mappedRowsToExtractedLedger), then once both are extracted we POST to
 * /api/ledger-scrutiny/compare which returns a reconciliation report.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, Scale, Upload, FileCheck2, X, Download } from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { ColumnMappingWizard } from '../shared/ColumnMappingWizard';
import { excelToRows } from '../../lib/excelToRows';
import {
  applyMapping,
  extractPdfGrid,
  mappedRowsToExtractedLedger,
  rowsToFakeGrid,
  type ColumnMapping,
  type PdfGrid,
} from '../../lib/pdfGrid';
import { detectAndMapLedgerErp } from '../../lib/perLedgerErpRules';
import {
  createLedgerComparison,
  fetchLedgerComparison,
  fetchLedgerComparisons,
  LEDGER_TYPE_LABELS,
  type LedgerComparisonReport,
  type LedgerType,
} from '../../services/api';
import { cn, formatDate } from '../../lib/utils';

// ── Tab-survival state persistence ─────────────────────────────────────
//
// LedgerCompareView lives under a `mode === 'compare'` conditional in
// LedgerScrutinyView, so flipping the in-app tab from "Compare" to
// "Single ledger" unmounts the component and torches every useState.
// Two failure modes the user hit:
//
//   1. Upload both sides, click Compare, switch tab to check something,
//      come back — Entity A/B fields blank, filename gone, no spinner,
//      no result. Looks like the click never registered.
//   2. Compare POST is still in-flight server-side when the component
//      unmounts; the fetch promise eventually resolves onto a stale
//      closure (silent no-op in React 18+). Server marked the row
//      `completed` with a full report, but the user never sees it.
//
// Persist sideA / sideB / usedLabels / report to sessionStorage so the
// form survives an unmount. When a compare is in-flight, write a
// timestamp to sessionStorage too; on remount, look up the user's
// comparison list and recover the result by matching `created_at`
// against the saved timestamp (±30s skew tolerance).
//
// sessionStorage (not localStorage) so a fresh browser tab gets a
// clean slate; you'd never want yesterday's half-finished compare to
// silently reappear.
const STORAGE_PREFIX = 'ledgerCompare:';
const STORAGE_KEYS = {
  sideA: `${STORAGE_PREFIX}sideA`,
  sideB: `${STORAGE_PREFIX}sideB`,
  usedLabels: `${STORAGE_PREFIX}usedLabels`,
  report: `${STORAGE_PREFIX}report`,
  inFlightAt: `${STORAGE_PREFIX}inFlightAt`,
} as const;

interface StoredSideState {
  label: string;
  ledgerType?: LedgerType;
  filename: string | null;
  extracted: ExtractedLedger | null;
}

function loadStored<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function saveStored(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) {
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // sessionStorage quota or disabled (private window) — silently
    // skip. Persistence is a UX nicety, not a correctness requirement.
  }
}

type Side = 'A' | 'B';

interface ExtractedLedger {
  partyName: string | null;
  gstin: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  accounts: Array<{
    name: string;
    accountType: string | null;
    opening: number;
    closing: number;
    totalDebit: number;
    totalCredit: number;
    transactions: Array<{
      date: string | null;
      narration: string | null;
      voucher: string | null;
      debit: number;
      credit: number;
      balance: number | null;
    }>;
  }>;
}

interface SideState {
  label: string;
  /** Ledger type for this side. Drives the matching headline and is
   *  surfaced on the dashboard. Defaults to sales (A) / purchase (B)
   *  for the most common workflow — confirming a sales-vs-purchase
   *  pair between two parties of the same transaction set. */
  ledgerType: LedgerType;
  filename: string | null;
  extracted: ExtractedLedger | null;
  /** True while a freshly-picked file is being parsed (browser-side
   *  PDF/Excel/CSV read + grid extract) BEFORE the wizard opens or
   *  the result lands in `extracted`. Renders a spinner so the user
   *  sees the click registered — without it the upload button
   *  appears unresponsive for the 1-3s of extractPdfGrid work. */
  processing: boolean;
}

const ACCEPT = '.pdf,.csv,.xlsx,.xls,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
const MAX_BYTES = 10 * 1024 * 1024;

function fmtINR(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + '₹' + Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/**
 * Serialise the comparison report into a single flat CSV covering all
 * buckets. Each row carries a `Status` column so the user can filter /
 * pivot in Excel after download.
 *
 * Status values:
 *   - matched          : same bill, amounts agree
 *   - amount_mismatch  : same bill, amounts differ
 *   - only_in_<labelA> : bill only in side A's ledger
 *   - only_in_<labelB> : bill only in side B's ledger
 *   - no_bill_<labelA> : side-A row without an extractable bill ref
 *   - no_bill_<labelB> : side-B row without an extractable bill ref
 *
 * Amounts are plain numbers (no ₹ symbol, no Indian thousands grouping)
 * so the file reopens cleanly in Excel / Google Sheets as numeric data.
 * Strings containing comma, quote, or newline are wrapped in quotes
 * with internal quotes doubled — RFC 4180 dialect.
 */
function buildCompareCsv(report: LedgerComparisonReport, labelA: string, labelB: string): string {
  const safeLabel = (s: string) => s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const escape = (s: string | number | null | undefined): string => {
    if (s === null || s === undefined) return '';
    const str = String(s);
    if (/[",\n\r]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  };
  const header = [
    'Status', 'Bill',
    `${labelA} Date`, `${labelB} Date`,
    `${labelA} Amount`, `${labelB} Amount`, 'Diff',
    `${labelA} Narration`, `${labelB} Narration`,
  ];
  // Dates are stored as YYYY-MM-DD (the parser's canonical form);
  // present them in CSV as dd/MM/yyyy to match Indian convention and
  // the dashboard display. formatDate returns empty string for null/
  // invalid, which is what we want in the CSV (empty cell).
  const rows: string[][] = [];
  for (const m of report.matched) {
    rows.push(['matched', m.bill, formatDate(m.dateA), formatDate(m.dateB), String(m.amountA), String(m.amountB), '0', m.narrationA, m.narrationB]);
  }
  for (const m of report.amountMismatches) {
    rows.push(['amount_mismatch', m.bill, formatDate(m.dateA), formatDate(m.dateB), String(m.amountA), String(m.amountB), String(m.diff), m.narrationA, m.narrationB]);
  }
  for (const m of report.onlyInA) {
    rows.push([`only_in_${safeLabel(labelA)}`, m.bill, formatDate(m.date), '', String(m.amount), '', '', m.narration, '']);
  }
  for (const m of report.onlyInB) {
    rows.push([`only_in_${safeLabel(labelB)}`, m.bill, '', formatDate(m.date), '', String(m.amount), '', '', m.narration]);
  }
  // Payment matches — pairs without a bill ref, matched by
  // date+amount. We surface the bank reference (cheque/UTR) extracted
  // from each side's narration in the Diff column so a quick Excel
  // scan can confirm "yes, that's the same cheque on both sides".
  for (const m of report.paymentMatches) {
    const ref = [m.bankRefA, m.bankRefB].filter(Boolean).join(' / ');
    rows.push(['payment_matched', '', formatDate(m.date), formatDate(m.date), String(m.amount), String(m.amount), ref, m.narrationA, m.narrationB]);
  }
  for (const m of report.noBillA) {
    rows.push([`no_bill_${safeLabel(labelA)}`, '', formatDate(m.date), '', String(m.amount), '', '', m.narration, '']);
  }
  for (const m of report.noBillB) {
    rows.push([`no_bill_${safeLabel(labelB)}`, '', '', formatDate(m.date), '', String(m.amount), '', '', m.narration]);
  }
  return [header, ...rows].map(r => r.map(escape).join(',')).join('\n');
}

function downloadCsv(filename: string, csv: string): void {
  // BOM prefix tells Excel the file is UTF-8 so Indian-narration
  // characters (rupee symbol in cell content — though we don't emit
  // it, but narrations can contain special chars) render correctly
  // without a per-cell encoding prompt.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoking the URL — some browsers (Safari, older Firefox)
  // need the URL alive past the click handler.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function SideUploader({
  side, state, onLabelChange, onTypeChange, onPickFile, onClear, busy,
}: {
  side: Side;
  state: SideState;
  onLabelChange: (label: string) => void;
  onTypeChange: (type: LedgerType) => void;
  onPickFile: () => void;
  onClear: () => void;
  busy: boolean;
}) {
  const ready = state.extracted !== null;
  const txCount = state.extracted?.accounts.reduce((s, a) => s + a.transactions.length, 0) ?? 0;
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5 space-y-3">
      {/* Ledger-type selector. The matcher uses this to phrase the
        * reconciliation headline (e.g. "12 bills only on the sales
        * side" reads correctly because we know A is sales). Defaults:
        * A = Sales, B = Purchase — the dominant party-confirmation
        * workflow. User can change either side to Sundry Debtor /
        * Sundry Creditor / Other when reconciling a non-trading
        * relationship. */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 shrink-0">
          {`Side ${side} type`}
        </label>
        <select
          value={state.ledgerType}
          onChange={(e) => onTypeChange(e.target.value as LedgerType)}
          className="flex-1 px-3 py-1.5 text-sm rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          {(Object.entries(LEDGER_TYPE_LABELS) as Array<[LedgerType, string]>).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-sm font-bold">
          {side}
        </span>
        <input
          type="text"
          value={state.label}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder={`Entity ${side} name (e.g. Acme Traders)`}
          className="flex-1 px-3 py-1.5 text-sm rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          maxLength={80}
        />
      </div>
      {ready ? (
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/15 border border-emerald-200 dark:border-emerald-800/60">
          <div className="flex items-center gap-2 min-w-0">
            <FileCheck2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{state.filename}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{txCount.toLocaleString('en-IN')} transactions extracted</p>
            </div>
          </div>
          <button type="button" onClick={onClear} className="p-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/30">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
      ) : state.processing ? (
        <div className="flex items-center gap-3 px-3 py-4 rounded-lg bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/60">
          <Loader2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 animate-spin shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">Reading {state.filename ?? 'file'}…</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Detecting ERP, mapping columns, extracting accounts</p>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onPickFile}
          disabled={busy}
          className="w-full flex flex-col items-center gap-2 py-6 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-emerald-400 dark:hover:border-emerald-600 transition-colors disabled:opacity-50"
        >
          <Upload className="w-6 h-6 text-gray-400" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Choose ledger PDF / CSV / Excel</span>
          <span className="text-xs text-gray-400">max 10 MB</span>
        </button>
      )}
    </div>
  );
}

function ReportTable<T>({
  title, rows, columns,
}: {
  title: string;
  rows: T[];
  columns: Array<{ header: string; cell: (row: T) => React.ReactNode; align?: 'left' | 'right' }>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">{title} <span className="text-gray-400 font-normal">({rows.length})</span></h3>
      </div>
      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/30 sticky top-0">
            <tr>
              {columns.map((c, i) => (
                <th key={i} className={cn('px-4 py-2 font-medium text-gray-500 dark:text-gray-400', c.align === 'right' ? 'text-right' : 'text-left')}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                {columns.map((c, j) => (
                  <td key={j} className={cn('px-4 py-2 text-gray-700 dark:text-gray-300', c.align === 'right' ? 'text-right tabular-nums' : '')}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function LedgerCompareView() {
  const inputRefA = useRef<HTMLInputElement>(null);
  const inputRefB = useRef<HTMLInputElement>(null);
  // Initial state is rehydrated from sessionStorage so an in-app tab
  // flip (Compare → Single → Compare) preserves the uploaded ledgers
  // and any completed report.
  const [sideA, setSideA] = useState<SideState>(() => {
    const stored = loadStored<StoredSideState>(STORAGE_KEYS.sideA);
    return {
      label: stored?.label ?? '',
      ledgerType: (stored?.ledgerType as LedgerType) ?? 'sales',
      filename: stored?.filename ?? null,
      extracted: stored?.extracted ?? null,
      processing: false,
    };
  });
  const [sideB, setSideB] = useState<SideState>(() => {
    const stored = loadStored<StoredSideState>(STORAGE_KEYS.sideB);
    return {
      label: stored?.label ?? '',
      ledgerType: (stored?.ledgerType as LedgerType) ?? 'purchase',
      filename: stored?.filename ?? null,
      extracted: stored?.extracted ?? null,
      processing: false,
    };
  });
  const [pendingGrid, setPendingGrid] = useState<{
    side: Side;
    grid: PdfGrid;
    filename: string;
    /** The original File reference so the wizard's "Use AI Vision
     *  instead" button can re-POST it to the extract-only endpoint
     *  if the deterministic mapping doesn't fit. */
    file: File | null;
    presetMapping?: ColumnMapping;
    detectedErp?: string;
  } | null>(null);
  const [comparing, setComparing] = useState(false);
  const [report, setReport] = useState<LedgerComparisonReport | null>(
    () => loadStored<LedgerComparisonReport>(STORAGE_KEYS.report),
  );
  const [usedLabels, setUsedLabels] = useState<{ A: string; B: string } | null>(
    () => loadStored<{ A: string; B: string }>(STORAGE_KEYS.usedLabels),
  );

  // Persist state to sessionStorage on every change. Bound to the
  // serialisable fields only — `processing` is transient UI state and
  // `pendingGrid` carries an unserialisable File ref.
  useEffect(() => {
    saveStored(STORAGE_KEYS.sideA, {
      label: sideA.label,
      ledgerType: sideA.ledgerType,
      filename: sideA.filename,
      extracted: sideA.extracted,
    });
  }, [sideA.label, sideA.ledgerType, sideA.filename, sideA.extracted]);
  useEffect(() => {
    saveStored(STORAGE_KEYS.sideB, {
      label: sideB.label,
      ledgerType: sideB.ledgerType,
      filename: sideB.filename,
      extracted: sideB.extracted,
    });
  }, [sideB.label, sideB.ledgerType, sideB.filename, sideB.extracted]);
  useEffect(() => {
    saveStored(STORAGE_KEYS.usedLabels, usedLabels);
  }, [usedLabels]);
  useEffect(() => {
    saveStored(STORAGE_KEYS.report, report);
  }, [report]);

  // In-flight recovery on mount. If the previous mount started a
  // compare that hadn't completed when the component unmounted, the
  // POST kept running server-side and persisted a row. Recover the
  // result by looking up the user's comparison list and matching by
  // creation time.
  useEffect(() => {
    const inFlightAt = loadStored<number>(STORAGE_KEYS.inFlightAt);
    if (!inFlightAt) return;
    // Skip if the report was already restored from sessionStorage —
    // means the previous mount got the response in time and saved it.
    if (report) {
      saveStored(STORAGE_KEYS.inFlightAt, null);
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const { comparisons } = await fetchLedgerComparisons();
        if (cancelled) return;
        // Match by created_at proximity to our recorded inFlightAt
        // (the server creates the row at request entry — usually
        // within ~1s of our timestamp). Allow 30s of skew for slow
        // networks and Date.now() vs. server-clock drift.
        const candidate = comparisons.find(c => {
          const createdMs = new Date(c.created_at).getTime();
          return Number.isFinite(createdMs) && Math.abs(createdMs - inFlightAt) < 30_000;
        });
        if (!candidate) {
          // Nothing matches — either the server never recorded it
          // (auth dropped before the route ran) or the user cleared
          // their history. Either way, stop watching.
          saveStored(STORAGE_KEYS.inFlightAt, null);
          setComparing(false);
          return;
        }
        if (candidate.status === 'completed') {
          const detail = await fetchLedgerComparison(candidate.id);
          if (cancelled) return;
          if (detail.report) {
            setReport(detail.report);
            setUsedLabels({ A: detail.labelA, B: detail.labelB });
            toast.success('Reconciliation completed in the background — result restored.', { duration: 6000 });
          }
          saveStored(STORAGE_KEYS.inFlightAt, null);
          setComparing(false);
        } else if (candidate.status === 'failed' || candidate.status === 'cancelled') {
          toast.error(
            `Background reconciliation ${candidate.status}: ${candidate.error_message ?? 'no detail returned'}`,
            { duration: 9000 },
          );
          saveStored(STORAGE_KEYS.inFlightAt, null);
          setComparing(false);
        } else {
          // Still pending / comparing — keep the spinner up and
          // re-check every 3s.
          setComparing(true);
          pollTimer = setTimeout(() => { void poll(); }, 3000);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('[ledger-compare] in-flight recovery poll failed:', err);
        // Leave the watch token in place — next mount can retry.
      }
    };
    setComparing(true);
    void poll();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
    // Run once on mount only — the recovery loop manages its own
    // teardown via the cancelled flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFile = async (side: Side, files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const lname = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || lname.endsWith('.pdf');
    const isCsv = file.type === 'text/csv' || lname.endsWith('.csv');
    const isExcel = lname.endsWith('.xlsx') || lname.endsWith('.xls');
    if (!isPdf && !isCsv && !isExcel) {
      toast.error('Only PDF, CSV, and Excel ledger exports are accepted.');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('File exceeds 10 MB. Split the export and try again.');
      return;
    }

    // Show the per-side spinner with the filename as soon as parse
    // work begins. Cleared by a `finally` below — covers the wizard-
    // open path, the error-toast path, and the CSV/Excel quick paths
    // alike. Without this the upload button just disabled itself for
    // the 1-3s of extractPdfGrid work and the user couldn't tell if
    // anything was happening.
    const setProcessing = (on: boolean) => {
      const updater = (prev: SideState) => ({ ...prev, processing: on, filename: on ? file.name : prev.filename });
      if (side === 'A') setSideA(updater);
      else setSideB(updater);
    };
    setProcessing(true);
    try {

    if (isCsv) {
      const text = await file.text();
      const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
      const grid = rowsToFakeGrid(parsed.data as string[][]);
      if (!grid) { toast.error('CSV appears empty.'); return; }
      setPendingGrid({ side, grid, filename: file.name, file: null });
      return;
    }
    if (isExcel) {
      try {
        const rows = await excelToRows(file);
        const grid = rows ? rowsToFakeGrid(rows) : null;
        if (!grid) { toast.error('Excel appears empty.'); return; }
        setPendingGrid({ side, grid, filename: file.name, file: null });
      } catch (err) {
        console.error(err);
        toast.error('Could not read Excel file.');
      }
      return;
    }
    // PDF
    try {
      const grid = await extractPdfGrid(file);
      if (grid && grid.rows.length >= 3) {
        // Per-ERP deterministic auto-mapping. If the grid matches
        // a known Tally / Busy / Marg / Finsys layout, pre-fill the
        // wizard with the rule's mapping + a banner identifying
        // the ERP — the user reviews and confirms rather than
        // having transactions silently extracted on the wrong
        // columns. Finsys is included: its 2-rows-per-transaction
        // layout used to defeat the grid extractor (row-2 voucher
        // rows fail parseDate) and force AI vision, but with the
        // mergeHeaderDataColumnPairs pass + applyMapping's
        // continuation-merge that joins row-2 onto row-1, the
        // deterministic path now handles Finsys cleanly — same as
        // the single-ledger uploader.
        //
        // Use detected.grid (post-preprocess) — when a rule's
        // preprocess hook reshapes the grid (e.g. Tally splits the
        // merged "Vch No. Debit" column into two), the mapping is
        // indexed against the new grid. Feeding the wizard the raw
        // grid would render an off-by-one preview.
        const detected = detectAndMapLedgerErp(grid);
        if (detected) {
          console.log(`[LedgerCompareView] side ${side} auto-detected ${detected.erp} — pre-filling wizard for review`);
          setPendingGrid({
            side,
            grid: detected.grid,
            filename: file.name,
            file,
            presetMapping: detected.mapping,
            detectedErp: detected.erp,
          });
          return;
        }
        setPendingGrid({ side, grid, filename: file.name, file });
        return;
      }
      // No text layer — compare mode requires structured input on
      // both sides for the diff to be reliable, so scanned PDFs
      // are refused here. The user can run the file through
      // single-ledger scrutiny first (which uses vision) then
      // export the parsed result to bring into compare.
      toast.error('This PDF has no readable text layer. Compare mode requires a digital PDF / CSV / Excel on both sides. Scanned files: run single-ledger scrutiny first, then bring the parsed result into compare.', { duration: 9000 });
    } catch (err) {
      console.error(err);
      toast.error('Could not read this PDF.');
    }

    } finally {
      // Always clear the spinner — whether we exited via the wizard
      // (pendingGrid set, the wizard takes over visually), via toast
      // error, or via successful CSV/Excel commit.
      setProcessing(false);
    }
  };

  /** Shared finish path. Used by both the per-ERP auto-mapping
   *  shortcut (no wizard) and the user-confirmed wizard mapping.
   *  Pulls the extracted ledger into the relevant side's state and
   *  surfaces the transaction count + ERP name (when auto-detected)
   *  so the user can see which side mapped automatically. */
  const applyAndStore = (
    side: Side,
    grid: PdfGrid,
    mapping: ColumnMapping,
    filename: string,
    autoErp?: string,
  ) => {
    const { rows: mapped, stats } = applyMapping(grid, mapping, 'ledger');
    if (mapped.length === 0) {
      const reason = stats.skippedNoAmount > 0
        ? `Found ${stats.skippedNoAmount.toLocaleString('en-IN')} candidate row${stats.skippedNoAmount === 1 ? '' : 's'} with parseable dates, but none had a usable Debit / Credit / Amount value. Re-check the amount column mapping.`
        : stats.totalGridRows === 0
          ? 'Grid is empty — re-upload the file.'
          : `Scanned ${stats.totalGridRows.toLocaleString('en-IN')} grid rows but none had a parseable date in the column you mapped to "Date". Open the wizard again and pick the column that actually contains dates.`;
      toast.error(`No transactions extracted. ${reason}`, { duration: 8000 });
      return;
    }
    // Pull party name from the Tally / Finsys "Ledger Account :
    // <NAME>" banner so single-account exports don't bucket
    // everything under literal 'Default'. Same pattern as the
    // single-ledger uploader.
    const bannerText = grid.rows.slice(0, 30).flat().filter(Boolean).join(' ');
    const partyMatch = /(?:ledger\s+account|account|statement\s+of\s+account|acc\s*[:.])\s*[:.]?\s*([A-Z][A-Z0-9 &.,'\-/()]{3,80})/i.exec(bannerText);
    const partyFromBanner = partyMatch?.[1]?.trim().replace(/\s{2,}/g, ' ');
    const extracted = mappedRowsToExtractedLedger(mapped, partyFromBanner);
    if (side === 'A') {
      setSideA(prev => ({ ...prev, filename, extracted }));
    } else {
      setSideB(prev => ({ ...prev, filename, extracted }));
    }
    const prefix = autoErp ? `${autoErp} — ` : '';
    toast.success(`Side ${side}: ${prefix}${mapped.length.toLocaleString('en-IN')} transactions ready.`);
  };

  const handleMappingConfirm = (mapping: ColumnMapping) => {
    if (!pendingGrid) return;
    const { side, grid, filename } = pendingGrid;
    setPendingGrid(null);
    applyAndStore(side, grid, mapping, filename);
  };

  const canCompare = !!sideA.extracted && !!sideB.extracted && !comparing;

  const runCompare = async () => {
    if (!sideA.extracted || !sideB.extracted) return;
    setComparing(true);
    setReport(null);
    // Watch-token timestamp: the server creates its ledger_comparisons
    // row at request entry, so its `created_at` lands within ~1s of
    // this value. If the component unmounts mid-flight, the in-flight
    // recovery effect on the next mount uses this timestamp to find
    // the matching row and re-hydrate the result.
    saveStored(STORAGE_KEYS.inFlightAt, Date.now());
    const labelA = sideA.label.trim() || 'Entity A';
    const labelB = sideB.label.trim() || 'Entity B';
    try {
      const res = await createLedgerComparison({
        labelA, labelB,
        typeA: sideA.ledgerType,
        typeB: sideB.ledgerType,
        filenameA: sideA.filename,
        filenameB: sideB.filename,
        preExtractedA: sideA.extracted,
        preExtractedB: sideB.extracted,
      });
      setReport(res.report);
      setUsedLabels({ A: labelA, B: labelB });
      toast.success('Reconciliation complete.');
    } catch (err) {
      // authFetch now surfaces the server's `detail` field appended
      // to the headline (e.g. "Comparison failed. Try again or
      // contact support. — MAX_TOKENS exceeded at output position…").
      // Show the full message and log the raw error for debugging.
      const message = err instanceof Error ? err.message : String(err);
      console.error('[ledger-compare] failed:', err);
      toast.error(message, { duration: 9000 });
    } finally {
      saveStored(STORAGE_KEYS.inFlightAt, null);
      setComparing(false);
    }
  };

  const reset = () => {
    setSideA({ label: '', ledgerType: 'sales', filename: null, extracted: null, processing: false });
    setSideB({ label: '', ledgerType: 'purchase', filename: null, extracted: null, processing: false });
    setReport(null);
    setUsedLabels(null);
    // Clear persisted state too — Reset means "start over", the
    // user shouldn't get yesterday's upload back on next mount.
    saveStored(STORAGE_KEYS.sideA, null);
    saveStored(STORAGE_KEYS.sideB, null);
    saveStored(STORAGE_KEYS.usedLabels, null);
    saveStored(STORAGE_KEYS.report, null);
    saveStored(STORAGE_KEYS.inFlightAt, null);
  };

  const labelA = usedLabels?.A ?? (sideA.label.trim() || 'Entity A');
  const labelB = usedLabels?.B ?? (sideB.label.trim() || 'Entity B');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
          <Scale className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50">Compare two ledgers</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Upload the same ledger as kept by two entities — we match by date + amount + narration and flag every gap.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SideUploader
          side="A"
          state={sideA}
          onLabelChange={(l) => setSideA(prev => ({ ...prev, label: l }))}
          onTypeChange={(t) => setSideA(prev => ({ ...prev, ledgerType: t }))}
          onPickFile={() => inputRefA.current?.click()}
          onClear={() => setSideA({ label: sideA.label, ledgerType: sideA.ledgerType, filename: null, extracted: null, processing: false })}
          busy={comparing}
        />
        <SideUploader
          side="B"
          state={sideB}
          onLabelChange={(l) => setSideB(prev => ({ ...prev, label: l }))}
          onTypeChange={(t) => setSideB(prev => ({ ...prev, ledgerType: t }))}
          onPickFile={() => inputRefB.current?.click()}
          onClear={() => setSideB({ label: sideB.label, ledgerType: sideB.ledgerType, filename: null, extracted: null, processing: false })}
          busy={comparing}
        />
      </div>

      <input ref={inputRefA} type="file" accept={ACCEPT} className="hidden"
        onChange={(e) => { void handleFile('A', e.target.files); if (inputRefA.current) inputRefA.current.value = ''; }} />
      <input ref={inputRefB} type="file" accept={ACCEPT} className="hidden"
        onChange={(e) => { void handleFile('B', e.target.files); if (inputRefB.current) inputRefB.current.value = ''; }} />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={runCompare}
          disabled={!canCompare}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {comparing ? <><Loader2 className="w-4 h-4 animate-spin" /> Reconciling…</> : 'Reconcile ledgers'}
        </button>
        {(report || comparing) && (
          <button type="button" onClick={reset} className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            Start over
          </button>
        )}
      </div>

      {pendingGrid && (
        <ColumnMappingWizard
          kind="ledger"
          grid={pendingGrid.grid}
          filename={pendingGrid.filename}
          initialMapping={pendingGrid.presetMapping}
          detectedSource={pendingGrid.detectedErp}
          onConfirm={handleMappingConfirm}
          onCancel={() => setPendingGrid(null)}
          /* No onUseVision in compare mode — vision output isn't
             reliable enough for a structural diff (see handleFile
             comment). User cancels and re-runs the file through
             single-ledger scrutiny instead. */
        />
      )}

      {report && (
        <div className="space-y-4">
          {/* Headline + counts + CSV export. Export button sits inline
            * with the headline so it's the first thing the user sees
            * when the report renders — typical workflow is "scan the
            * counts → download the CSV → review in Excel". */}
          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/60 dark:bg-emerald-900/15 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900 dark:text-gray-100">{report.summary.headline}</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Side A ({LEDGER_TYPE_LABELS[report.summary.typeA]}) {report.summary.totalA.toLocaleString('en-IN')} txns · Side B ({LEDGER_TYPE_LABELS[report.summary.typeB]}) {report.summary.totalB.toLocaleString('en-IN')} txns
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const csv = buildCompareCsv(report, labelA, labelB);
                  const today = new Date().toISOString().slice(0, 10);
                  downloadCsv(`ledger-compare-${labelA}-vs-${labelB}-${today}.csv`, csv);
                }}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-white dark:bg-gray-900/60 border border-gray-300 dark:border-gray-700 hover:border-emerald-400 dark:hover:border-emerald-600 text-gray-800 dark:text-gray-100 shrink-0"
                title="Download every match, mismatch, and unmatched row as one CSV — Excel-friendly with status column."
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
            </div>
            {/* 6-tile grid: bills matched, payments matched (no bill —
              * date+amount pairs), amount mismatches, only-in-A, only-in-B,
              * and any leftover rows without a bill ref. The payments-
              * matched tile is "ok" tone — these are still reconciled
              * pairs, just via the secondary matcher rather than bill no. */}
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
              <Stat label="Bills matched" value={report.summary.matchedCount} tone="ok" />
              <Stat label="Payments matched" value={report.summary.paymentMatchedCount} tone="ok" />
              <Stat label="Amount mismatches" value={report.summary.amountMismatchCount} tone={report.summary.amountMismatchCount ? 'warn' : 'ok'} />
              <Stat label={`Only in ${labelA}`} value={report.summary.onlyInACount} tone={report.summary.onlyInACount ? 'warn' : 'ok'} />
              <Stat label={`Only in ${labelB}`} value={report.summary.onlyInBCount} tone={report.summary.onlyInBCount ? 'warn' : 'ok'} />
              <Stat label="Rows w/o bill" value={report.summary.noBillCountA + report.summary.noBillCountB} tone={(report.summary.noBillCountA + report.summary.noBillCountB) ? 'warn' : 'ok'} />
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Balance check</h3>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <BalanceCell label={`Opening — ${labelA}`} value={report.balanceCheck.openingA} />
              <BalanceCell label={`Opening — ${labelB}`} value={report.balanceCheck.openingB} />
              <BalanceCell label="Opening gap" value={report.balanceCheck.openingGap} highlight />
              <BalanceCell label={`Closing — ${labelA}`} value={report.balanceCheck.closingA} />
              <BalanceCell label={`Closing — ${labelB}`} value={report.balanceCheck.closingB} />
              <BalanceCell label="Closing gap" value={report.balanceCheck.closingGap} highlight />
            </div>
            {report.balanceCheck.note && (
              <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{report.balanceCheck.note}</p>
            )}
          </div>

          {/* Render order (per user request 2026-05-18):
            *   1. Matched — bill AND amount agree (the clean case)
            *   2. Amount mismatches — same bill, different amounts
            *   3. Only in A
            *   4. Only in B
            *   5. No-bill A / B
            * The clean case goes first so the user can scroll past the
            * majority of rows quickly when looking for the exception
            * buckets below. */}
          <ReportTable
            title="Matched (bill no. and amount both agree)"
            rows={report.matched}
            columns={[
              { header: 'Bill', cell: (r) => r.bill },
              { header: `${labelA} date`, cell: (r) => formatDate(r.dateA) || '—' },
              { header: `${labelB} date`, cell: (r) => formatDate(r.dateB) || '—' },
              { header: 'Amount', align: 'right', cell: (r) => fmtINR(r.amountA) },
              { header: `${labelA} narration`, cell: (r) => r.narrationA },
              { header: `${labelB} narration`, cell: (r) => r.narrationB },
            ]}
          />

          <ReportTable
            title="Amount mismatches (same bill no., different amounts)"
            rows={report.amountMismatches}
            columns={[
              { header: 'Bill', cell: (r) => r.bill },
              { header: `${labelA} date`, cell: (r) => formatDate(r.dateA) || '—' },
              { header: `${labelB} date`, cell: (r) => formatDate(r.dateB) || '—' },
              { header: `${labelA} amount`, align: 'right', cell: (r) => fmtINR(r.amountA) },
              { header: `${labelB} amount`, align: 'right', cell: (r) => fmtINR(r.amountB) },
              { header: 'Diff', align: 'right', cell: (r) => fmtINR(r.diff) },
              { header: `${labelA} narration`, cell: (r) => r.narrationA },
              { header: `${labelB} narration`, cell: (r) => r.narrationB },
            ]}
          />

          <ReportTable
            title={`Only in ${labelA} (bill missing on ${labelB})`}
            rows={report.onlyInA}
            columns={[
              { header: 'Bill', cell: (r) => r.bill },
              { header: 'Date', cell: (r) => formatDate(r.date) || '—' },
              { header: 'Amount', align: 'right', cell: (r) => fmtINR(r.amount) },
              { header: 'Narration', cell: (r) => r.narration },
            ]}
          />

          <ReportTable
            title={`Only in ${labelB} (bill missing on ${labelA})`}
            rows={report.onlyInB}
            columns={[
              { header: 'Bill', cell: (r) => r.bill },
              { header: 'Date', cell: (r) => formatDate(r.date) || '—' },
              { header: 'Amount', align: 'right', cell: (r) => fmtINR(r.amount) },
              { header: 'Narration', cell: (r) => r.narration },
            ]}
          />

          {/* Payment matches — the date+amount fallback matcher pairs
            * up no-bill rows on both sides (typically payments — cheque
            * deposits, NEFT receipts, RTGS settlements) that wouldn't
            * have surfaced via bill matching alone. Bank refs shown
            * inline are informational only (extracted from narration),
            * not used to match. */}
          <ReportTable
            title="Payments matched (no bill no., paired by date + amount)"
            rows={report.paymentMatches}
            columns={[
              { header: 'Date', cell: (r) => formatDate(r.date) || '—' },
              { header: 'Amount', align: 'right', cell: (r) => fmtINR(r.amount) },
              { header: `${labelA} bank ref`, cell: (r) => r.bankRefA || '—' },
              { header: `${labelB} bank ref`, cell: (r) => r.bankRefB || '—' },
              { header: `${labelA} narration`, cell: (r) => r.narrationA },
              { header: `${labelB} narration`, cell: (r) => r.narrationB },
            ]}
          />

          {(report.noBillA.length > 0 || report.noBillB.length > 0) && (
            <>
              <ReportTable
                title={`${labelA} rows without a bill reference (couldn't match)`}
                rows={report.noBillA}
                columns={[
                  { header: 'Date', cell: (r) => formatDate(r.date) || '—' },
                  { header: 'Amount', align: 'right', cell: (r) => fmtINR(r.amount) },
                  { header: 'Narration', cell: (r) => r.narration },
                ]}
              />
              <ReportTable
                title={`${labelB} rows without a bill reference (couldn't match)`}
                rows={report.noBillB}
                columns={[
                  { header: 'Date', cell: (r) => formatDate(r.date) || '—' },
                  { header: 'Amount', align: 'right', cell: (r) => fmtINR(r.amount) },
                  { header: 'Narration', cell: (r) => r.narration },
                ]}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'warn' }) {
  return (
    <div>
      <p className={cn('text-2xl font-bold tabular-nums', tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400')}>
        {value.toLocaleString('en-IN')}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}

function BalanceCell({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  const isNonZero = Math.abs(value) >= 0.01;
  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className={cn('font-semibold tabular-nums',
        highlight && isNonZero ? 'text-amber-600 dark:text-amber-400'
          : highlight ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-gray-900 dark:text-gray-100')}>
        {fmtINR(value)}
      </p>
    </div>
  );
}

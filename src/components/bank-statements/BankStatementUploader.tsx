import { useRef, useState } from 'react';
import { Upload, FileText, Loader2 } from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { BankStatementManager } from '../../hooks/useBankStatementManager';
import type { BankStatementAnalyzeProgress } from '../../services/api';
import { cn } from '../../lib/utils';
import { ColumnMappingWizard } from '../shared/ColumnMappingWizard';
import { ScannedPdfConfirmDialog, PdfTooLargeDialog } from '../shared/ScannedPdfConfirmDialog';
import { countPdfPagesClient } from '../../lib/pdfText';
import { excelToRows } from '../../lib/excelToRows';
import {
  applyMapping,
  extractPdfGrid,
  mappedRowsToBankCsv,
  rowsToFakeGrid,
  PdfPasswordError,
  type ColumnMapping,
  type PdfGrid,
} from '../../lib/pdfGrid';
import { detectAndMapBank } from '../../lib/perBankRules';
import { detectJkbankRptFormat, extractJkbankRpt } from '../../lib/jkbankRptParser';
import { PasswordPromptDialog } from '../shared/PasswordPromptDialog';

function AnalyzeProgressBar({
  progress,
  chunksDone,
  chunksTotal,
  startedAt,
  providerFallback,
}: {
  progress: BankStatementAnalyzeProgress;
  /** From the polled statement row — surfaces the wizard CSV path's
   *  per-batch progress (TSV chunked path uses `progress` from SSE). */
  chunksDone?: number;
  chunksTotal?: number;
  startedAt?: number;
  providerFallback?: boolean;
}) {
  // Prefer DB-polled chunk progress (wizard CSV path). Fall back to
  // SSE-streamed progress (TSV chunked path).
  const usingChunks = (chunksTotal ?? 0) > 0;
  const total = usingChunks ? chunksTotal! : (progress.total || 0);
  const completed = usingChunks ? (chunksDone ?? 0) : progress.completed;
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  let eta: string | null = null;
  if (usingChunks && completed > 0 && startedAt && completed < total) {
    const elapsedMs = Date.now() - startedAt;
    const avgMsPerChunk = elapsedMs / completed;
    const remainingMs = avgMsPerChunk * (total - completed);
    const mins = Math.ceil(remainingMs / 60000);
    eta = mins <= 1 ? '~1 min remaining' : `~${mins} min remaining`;
  }

  const label = total > 0
    ? usingChunks
      ? `Categorising batch ${completed} of ${total}`
      : `Section ${Math.min(progress.completed + (progress.completed === total ? 0 : 1), total)} of ${total}${progress.pages ? ` · pages ${progress.pages[0]}–${progress.pages[1]}` : ''}`
    : 'Preparing sections…';

  return (
    <div className="mt-3">
      <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
        <div
          className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-300 ease-out"
          style={{ width: total > 0 ? `${pct}%` : '15%' }}
        />
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        {label}{total > 0 ? ` · ${pct}%` : ''}
        {eta ? ` · ${eta}` : ''}
      </p>
      {providerFallback && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
          Server busy — switched to backup model. Hang tight.
        </p>
      )}
    </div>
  );
}

interface Props {
  manager: BankStatementManager;
}

const ACCEPT = '.pdf,.csv,.xlsx,.xls,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

export function BankStatementUploader({ manager }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Wizard state. When set, the user is mid-mapping for a digital PDF;
  // we hold onto the grid + filename until they confirm or cancel.
  // The original File is kept too so the "Use AI Vision instead"
  // escape hatch in the wizard can route the same upload through the
  // vision pipeline without re-prompting.
  // pendingGrid optionally carries a preset mapping + detected bank
  // name. When present, the wizard opens with the columns pre-tagged
  // and a banner saying "Auto-detected as <Bank>" so the user
  // reviews the mapping before clicking Continue rather than having
  // transactions silently extracted on the wrong columns.
  const [pendingGrid, setPendingGrid] = useState<{
    grid: PdfGrid;
    filename: string;
    file: File | null;
    presetMapping?: ColumnMapping;
    detectedBank?: string;
  } | null>(null);
  // Password-protected PDFs go here. The dialog calls onSubmit with
  // the entered password; we re-run extractPdfGrid with it. If it
  // still fails, wrongPassword flips and the user can try again.
  const [pendingPassword, setPendingPassword] = useState<{
    file: File;
    wrongPassword: boolean;
  } | null>(null);
  // True while extractPdfGrid is parsing a freshly-picked PDF, before
  // the column-mapping wizard opens. Without this the dropzone looks
  // idle for the 1-3s pdfjs takes on a multi-page statement, which
  // reads as "did my click register?". Cleared when the wizard opens
  // OR when we route to the analyze pipeline.
  const [isReadingPdf, setIsReadingPdf] = useState(false);
  // Scanned-PDF warning + over-100-page block dialogs. Shown when the
  // PDF has no text layer and we'd route to AI vision — at which point
  // the cost difference vs digital PDFs is large enough to warrant a
  // confirmation step.
  const [pendingScannedPdf, setPendingScannedPdf] = useState<File | null>(null);
  const [pdfTooLarge, setPdfTooLarge] = useState<{ file: File; pageCount: number } | null>(null);

  // Pull batch progress off the in-flight statement (the placeholder
  // row's analyze_chunks_* fields, polled every 5s by the manager).
  const inFlight = manager.statements.find(s => s.status === 'analyzing');
  const chunksDone = inFlight?.analyzeChunksDone ?? 0;
  const chunksTotal = inFlight?.analyzeChunksTotal ?? 0;
  const analyzeStartedAt = useRef<number | null>(null);
  if (chunksTotal > 0 && analyzeStartedAt.current === null) {
    analyzeStartedAt.current = Date.now();
  }
  if (chunksTotal === 0 && analyzeStartedAt.current !== null) {
    analyzeStartedAt.current = null;
  }

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    // Reject anything that isn't PDF or CSV — image upload was the
    // legacy vision path, but the wizard now handles digital PDFs
    // deterministically and the practical accuracy on cellphone-scan
    // images was poor anyway. Scanned PDFs that have no text layer
    // still fall through to the multipart vision path below.
    const lname = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || lname.endsWith('.pdf');
    const isCsv = file.type === 'text/csv' || lname.endsWith('.csv');
    const isExcel = lname.endsWith('.xlsx') || lname.endsWith('.xls');
    if (!isPdf && !isCsv && !isExcel) {
      toast.error('Only PDF, CSV, and Excel (.xlsx / .xls) statements are accepted.');
      return;
    }

    // One analysis at a time. Server enforces the same via
    // findInProgressByHashForUser, but the toast is friendlier than
    // letting the request go through and bounce.
    if (manager.hasInProgressJob) {
      toast.error('A bank statement analysis is already running. Wait for it to finish.');
      return;
    }

    if (isExcel) {
      setIsReadingPdf(true);
      try {
        const rows = await excelToRows(file);
        const grid = rows ? rowsToFakeGrid(rows) : null;
        if (!grid) {
          toast.error('Excel appears empty or has no data rows.');
          setIsReadingPdf(false);
          return;
        }
        setIsReadingPdf(false);
        setPendingGrid({ grid, filename: file.name, file });
      } catch (err) {
        console.error('[BankStatementUploader] excel parse failed:', err);
        toast.error('Could not read this Excel file. Re-export as .xlsx and try again.');
        setIsReadingPdf(false);
      }
      return;
    }

    if (isCsv) {
      // Route CSVs through the same column-mapping wizard PDFs use,
      // not directly to the server CSV path. The server's CSV path
      // falls back to hardcoded header guesses
      // (r.date ?? r.Date ?? r['Txn Date'] ?? ...), and any CSV that
      // doesn't match one of those guesses ends up with the wrong
      // signed amount on some rows — the same sign-flip class of
      // failure the wizard was built to eliminate. Going through
      // applyMapping → mappedRowsToBankCsv normalizes to the canonical
      // header set the server expects, so the deterministic
      // categorisation pass produces totals that match the PDF path
      // exactly.
      setIsReadingPdf(true);
      const text = await file.text();
      const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
      const grid = rowsToFakeGrid(parsed.data as string[][]);
      if (!grid) {
        toast.error('CSV appears empty or has no data rows.');
        setIsReadingPdf(false);
        return;
      }
      setIsReadingPdf(false);
      setPendingGrid({ grid, filename: file.name, file });
      return;
    }

    // Digital PDF → extract a structured 2D grid and route through the
    // mandatory column-mapping wizard. The wizard maps user → CSV → the
    // existing CSV path, which builds signed amounts deterministically
    // (no LLM in the credit/debit decision). Scanned PDFs with no text
    // layer fall through to the legacy multipart vision path.
    if (isPdf) {
      setIsReadingPdf(true);
      try {
        const grid = await extractPdfGrid(file);

        // Wrong-page guard. If the user dropped a ledger PDF (Tally
        // / Busy / Marg / Finsys) here, the per-bank rule will miss
        // and they'll end up in a wizard built for bank statements
        // — confusing roles, broken column hints, no Finsys vision
        // shortcut. Surface a pointed error instead.
        const ledgerFingerprints = [
          { fp: 'generated by finsys erp', erp: 'Finsys ERP' },
          { fp: 'totals c/f', erp: 'Busy' },
          { fp: 'totals b/f', erp: 'Busy' },
          { fp: 'balance c/f:', erp: 'Marg' },
          { fp: 'balance b/f:', erp: 'Marg' },
          { fp: 'continued..', erp: 'Tally' },
          { fp: 'sundry debtors', erp: 'a ledger' },
          { fp: 'sundry creditors', erp: 'a ledger' },
        ];
        const earlyText = grid
          ? grid.rows.slice(0, 100).flat().join(' ').toLowerCase()
          : '';
        const ledgerHit = ledgerFingerprints.find(l => earlyText.includes(l.fp));
        if (ledgerHit) {
          console.log(`[BankStatementUploader] looks like ${ledgerHit.erp} — wrong page`);
          setIsReadingPdf(false);
          toast.error(`This looks like ${ledgerHit.erp === 'a ledger' ? 'a ledger export' : `a ${ledgerHit.erp} ledger`}, not a bank statement. Open the Ledger Scrutiny page from the sidebar and upload it there — the ledger flow handles ERP-specific layouts (and routes Finsys exports to AI vision automatically).`, { duration: 9000 });
          return;
        }

        // J&K Bank "RPT" / "RPTNFS" / loan-recovery report format.
        // Detected BEFORE the per-bank rule because the grid extractor
        // can't recover this layout (date is split into 5 separate
        // x-positions, transactions span 2 lines, narrations wrap
        // mid-word). The parser works on raw pdfjs text items and
        // emits MappedRow directly.
        //
        // UX choice: instead of submitting the parsed rows directly to
        // the CSV endpoint, we round-trip them through the wizard so
        // the user gets a preview + a chance to abort. The wizard
        // shows the parsed Date / Narration / Debit / Credit / Balance
        // columns with the mapping pre-applied and a green "Auto-
        // detected as J&K Bank Report" banner, matching the existing
        // HDFC / ICICI / Canara auto-detect flow. Clicking Continue
        // re-applies the (already correct) mapping and submits to
        // the analyze-CSV endpoint.
        try {
          const rptDetected = await detectJkbankRptFormat(file);
          if (rptDetected) {
            console.log('[BankStatementUploader] detected J&K Bank RPT/RPTNFS format — invoking dedicated parser');
            const rows = await extractJkbankRpt(file);
            if (rows && rows.length > 0) {
              // Convert the parsed MappedRow[] back into a wizard-shaped
              // grid: a header row + one row per transaction with five
              // columns (Date, Narration, Debit, Credit, Balance). The
              // wizard's preset mapping pins each column to its role,
              // so applyMapping in submitMapping turns the grid right
              // back into the same MappedRow[] we already had — but
              // the round-trip lets the user see and confirm the data
              // before any AI cost is incurred.
              const fakeGridRows: string[][] = [
                ['Date', 'Narration', 'Debit', 'Credit', 'Balance'],
                ...rows.map(r => [
                  r.date ?? '',
                  r.narration,
                  r.amount < 0 ? Math.abs(r.amount).toFixed(2) : '',
                  r.amount > 0 ? r.amount.toFixed(2) : '',
                  r.balance != null ? r.balance.toFixed(2) : '',
                ]),
              ];
              const fakeGrid = rowsToFakeGrid(fakeGridRows);
              if (fakeGrid) {
                setIsReadingPdf(false);
                setPendingGrid({
                  grid: fakeGrid,
                  filename: file.name,
                  file,
                  presetMapping: { roles: ['date', 'narration', 'debit', 'credit', 'balance'] },
                  detectedBank: 'J&K Bank Report',
                });
                return;
              }
              console.warn('[BankStatementUploader] RPT parser produced rows but rowsToFakeGrid returned null; falling through');
            } else {
              console.warn('[BankStatementUploader] RPT detected but parser returned 0 rows; falling through to wizard / vision');
            }
          }
        } catch (rptErr) {
          // Detection failure is non-fatal — fall through to the
          // existing pipeline. Log so we can spot a recurring break.
          console.warn('[BankStatementUploader] RPT detection threw:', rptErr);
        }

        // Per-bank deterministic column rule. HDFC / ICICI / Canara
        // have stable header layouts; if the grid extracted cleanly
        // we can pre-fill the column mapping from a bank-specific
        // header→role table. We DON'T auto-submit — the user always
        // sees the wizard with the detected mapping pre-applied so
        // they can verify it. Catches the failure mode where the
        // rule fires but the extractor's column anchors don't
        // actually line up with the rule's role assignments
        // (Canara's "Deposits"/"Balance" data lands in the column
        // next to its left-aligned header; ICICI's compact layout
        // can split "Transaction Date" into two columns). Without
        // the review step the user got an opaque "no transactions
        // extracted" error instead of a fixable mapping screen.
        const detected = detectAndMapBank(grid);
        if (detected && grid) {
          console.log(`[BankStatementUploader] auto-detected ${detected.bank} — pre-filling wizard for review`);
          setIsReadingPdf(false);
          setPendingGrid({
            // Use the rule's preprocessed grid, NOT the raw grid from
            // extractPdfGrid. For Kotak (and any future rule that
            // defines a `preprocess` hook), the grid has been
            // reshaped — e.g. the merged Date+Description column was
            // split into two — and `detected.mapping.roles` is indexed
            // against the post-preprocess column count. Feeding the
            // wizard the raw grid here while passing a mapping array
            // built for the reshaped grid puts the role dropdowns and
            // the data preview off by one (user-reported on Kotak
            // 2026-05: wizard dropdowns showed Date / Narration /
            // Reference / Debit / Credit / Skip / Balance over a
            // preview where col 1 still held "31 Mar 2025 PCI/9710/…"
            // merged). For non-preprocess rules `detected.grid` is
            // equal to the input grid, so this is a no-op.
            grid: detected.grid,
            filename: file.name,
            file,
            presetMapping: detected.mapping,
            detectedBank: detected.bank,
          });
          return;
        }

        // Bank fingerprint shortcut for layouts we don't yet have a
        // per-bank rule for, OR layouts that ship as image-only PDFs
        // and need vision regardless of fingerprint. BoB packs all
        // transaction text into one column. Union/CBI/BoI/Indian
        // Bank/IDBI ship multi-row headers that bleed into data.
        // Axis Bank's e-statement is a glyph-rendered PDF (no text
        // layer at all), so even when the grid extractor returns a
        // grid it has zero useful content. SBI's most common export
        // is similarly image-only.
        //
        // HDFC / ICICI / Canara / PNB / Yes Bank / J&K Bank are NOT
        // in this list — they have deterministic rules above. PNB
        // was previously here but the e-statement turned out to be
        // text-extractable on closer inspection.
        const KNOWN_VISION_ONLY_BANKS = [
          'bank of baroda', 'bob',
          'union bank',
          'central bank of india',
          'bank of india',
          'indian bank',
          'idbi',
          'axis bank', 'axisbank', 'utib0',
          'state bank of india', 'sbin0',
        ];
        const fingerprint = grid
          ? grid.rows.slice(0, 30).flat().join(' ').toLowerCase()
          : '';
        const matchedBank = KNOWN_VISION_ONLY_BANKS.find(b => fingerprint.includes(b));
        if (matchedBank) {
          console.log(`[BankStatementUploader] detected ${matchedBank} — routing to vision (known-difficult layout)`);
          const pageCount = await countPdfPagesClient(file) ?? 0;
          setIsReadingPdf(false);
          if (pageCount > 100) {
            setPdfTooLarge({ file, pageCount });
            return;
          }
          setPendingScannedPdf(file);
          return;
        }

        // Wizard threshold: ≥3 cols is enough to map date + narration +
        // (amount OR debit OR credit), which is the minimum applyMapping
        // requires. The threshold was ≥5 historically — that flagged
        // sparse grids as "broken" and routed them through the AI
        // extraction path (TSV via Gemini), but TSV cost averaged ~3×
        // higher than running the same upload through the wizard with
        // user-confirmed sparse mapping. With TSV killed entirely, the
        // wizard handles every grid it can; only completely-empty grids
        // fall to vision. Wizard's downstream `required` check still
        // refuses uploads that genuinely can't be mapped.
        if (grid && grid.rows.length >= 3 && (grid.columnCount ?? 0) >= 3) {
          setIsReadingPdf(false);
          setPendingGrid({ grid, filename: file.name, file });
          return;
        }
        if (grid && (grid.columnCount ?? 0) < 3) {
          console.log(`[BankStatementUploader] only ${grid.columnCount} columns detected — routing to vision (genuinely sparse)`);
        }
        // Either no text layer or grid is too sparse — route through
        // vision. 100-page block kept as a UX cost guard — Gemini
        // handles longer PDFs technically but vision over a 100+
        // page scan is slow and expensive enough that users deserve
        // a confirm step. The scanned-PDF confirm dialog explains
        // the cost trade-off so dense statements don't surprise.
        const pageCount = await countPdfPagesClient(file) ?? 0;
        setIsReadingPdf(false);
        if (pageCount > 100) {
          setPdfTooLarge({ file, pageCount });
          return;
        }
        setPendingScannedPdf(file);
        return;
      } catch (err) {
        if (err instanceof PdfPasswordError) {
          // Encrypted bank PDFs are common — pop the unlock prompt
          // instead of falling through to the vision path (which
          // would also fail without the password).
          setIsReadingPdf(false);
          setPendingPassword({ file, wrongPassword: false });
          return;
        }
        console.warn('[BankStatementUploader] grid extraction failed; falling back to vision:', err);
      }
      setIsReadingPdf(false);
    }

    await analyzeRawFile(file);
  };

  const analyzeRawFile = async (file: File) => {
    try {
      const result = await manager.analyzeFile(file);
      toast.success(result.alreadyAnalyzed
        ? `This statement was already analyzed earlier — opened the existing one (${result.transactions.length} transactions).`
        : `Analyzed ${result.transactions.length} transactions`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Analysis failed');
    }
  };

  /** Shared finish path for both the auto-mapping bank-rule shortcut
   *  and the user-confirmed wizard mapping. Applies the mapping, surfaces
   *  filter stats, builds the CSV, and submits to the analyze endpoint.
   *  Set successPrefix to label the toast (e.g. "Auto-mapped HDFC Bank
   *  layout — analyzed N transactions"). */
  const submitMapping = async (
    grid: PdfGrid,
    mapping: ColumnMapping,
    filename: string,
    successPrefix?: string,
  ) => {
    const { rows: mapped, stats } = applyMapping(grid, mapping, 'bank');
    if (mapped.length === 0) {
      const reason = stats.skippedNoAmount > 0
        ? `Found ${stats.skippedNoAmount.toLocaleString('en-IN')} dated row${stats.skippedNoAmount === 1 ? '' : 's'} but none had a usable Debit / Credit / Amount value. Re-check the amount column mapping.`
        : stats.totalGridRows === 0
          ? 'Grid is empty — re-upload the file.'
          : `Scanned ${stats.totalGridRows.toLocaleString('en-IN')} grid rows but none had a parseable date in the column mapped to "Date". Re-open the wizard and pick the column that actually contains dates (e.g. 09/04/2025).`;
      toast.error(`No transactions extracted. ${reason}`, { duration: 8000 });
      return;
    }
    const filteredCount = stats.totalGridRows - stats.transactions;
    if (filteredCount > 0) {
      const parts: string[] = [];
      if (stats.mergedContinuations > 0) {
        parts.push(`${stats.mergedContinuations} wrapped narration line${stats.mergedContinuations === 1 ? '' : 's'} merged into previous transactions`);
      }
      if (stats.skippedNoAmount > 0) {
        parts.push(`${stats.skippedNoAmount} row${stats.skippedNoAmount === 1 ? '' : 's'} skipped (date but no debit / credit — usually opening / closing balance or page totals)`);
      }
      if (parts.length > 0) {
        toast(`From ${stats.totalGridRows.toLocaleString('en-IN')} grid rows: ${stats.transactions.toLocaleString('en-IN')} transactions — ${parts.join(', ')}.`, { duration: 6000 });
      }
    }
    const csv = mappedRowsToBankCsv(mapped);
    try {
      const result = await manager.analyzeCsv(csv, filename);
      const prefix = successPrefix ? `${successPrefix} — ` : '';
      toast.success(result.alreadyAnalyzed
        ? `This statement was already analyzed earlier — opened the existing one (${result.transactions.length} transactions).`
        : `${prefix}analyzed ${result.transactions.length} transactions deterministically (no AI sign assignment).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Analysis failed');
    }
  };

  const handleMappingConfirm = async (mapping: ColumnMapping) => {
    if (!pendingGrid) return;
    const { grid, filename } = pendingGrid;
    setPendingGrid(null);
    await submitMapping(grid, mapping, filename);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        void handleFiles(e.dataTransfer.files);
      }}
      className={cn(
        'border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center gap-4 transition-colors',
        isDragging
          ? 'border-blue-400 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-900/10'
          : 'border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/30',
      )}
    >
      <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
        {(manager.isAnalyzing || isReadingPdf)
          ? <Loader2 className="w-8 h-8 text-blue-600 dark:text-blue-400 animate-spin" />
          : <Upload className="w-8 h-8 text-blue-600 dark:text-blue-400" />}
      </div>
      <div className="text-center w-full max-w-md">
        <p className="font-semibold text-gray-800 dark:text-gray-100">
          {manager.isAnalyzing
            ? 'Analyzing your statement…'
            : isReadingPdf
              ? 'Reading PDF…'
              : 'Drop your bank statement here'}
        </p>
        {manager.isAnalyzing || chunksTotal > 0 ? (
          <>
            <AnalyzeProgressBar
              progress={manager.analyzeProgress ?? { completed: 0, total: 0 }}
              chunksDone={chunksDone}
              chunksTotal={chunksTotal}
              startedAt={analyzeStartedAt.current ?? undefined}
              providerFallback={inFlight?.providerFallback}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Scanned PDFs use OCR — extraction can take 30-90 seconds.
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            PDF up to 25 MB — or a CSV / Excel export from your bank
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={manager.hasInProgressJob}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          <FileText className="w-4 h-4" />
          Choose file
        </button>
        {/* Cancel button surfaces here (next to the disabled
            Choose-file button) so the user can stop a long
            chunked-categorisation run without scrolling to the
            statement detail view. inFlight is the placeholder
            row that the analyze handler is operating on. */}
        {inFlight && (
          <button
            type="button"
            onClick={async () => {
              try {
                await manager.cancel(inFlight.id);
                toast.success('Analysis cancelled');
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Cancel failed');
              }
            }}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20 text-sm font-medium transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ACCEPT}
        onChange={(e) => { void handleFiles(e.target.files); if (inputRef.current) inputRef.current.value = ''; }}
      />
      <p className="text-xs text-gray-400 dark:text-gray-500 max-w-md text-center">
        Transactions are categorised automatically — you can reassign any row before exporting.
      </p>
      {pendingGrid && (
        <ColumnMappingWizard
          kind="bank"
          grid={pendingGrid.grid}
          filename={pendingGrid.filename}
          initialMapping={pendingGrid.presetMapping}
          detectedSource={pendingGrid.detectedBank}
          onConfirm={handleMappingConfirm}
          onCancel={() => setPendingGrid(null)}
          onUseVision={pendingGrid.file && pendingGrid.file.type === 'application/pdf' ? () => {
            const file = pendingGrid.file!;
            setPendingGrid(null);
            void analyzeRawFile(file);
          } : undefined}
        />
      )}
      {pendingPassword && (
        <PasswordPromptDialog
          filename={pendingPassword.file.name}
          wrongPassword={pendingPassword.wrongPassword}
          onCancel={() => setPendingPassword(null)}
          onSubmit={async (password) => {
            const file = pendingPassword.file;
            try {
              const grid = await extractPdfGrid(file, password);
              if (grid && grid.rows.length >= 3) {
                setPendingPassword(null);
                setPendingGrid({ grid, filename: file.name, file });
                return;
              }
              // Decrypted but no usable text layer: fall through to
              // AI vision silently — column mapping is unavailable on
              // image-only PDFs but the cost difference isn't worth a
              // separate confirmation step.
              setPendingPassword(null);
              await analyzeRawFile(file);
            } catch (err) {
              if (err instanceof PdfPasswordError) {
                // Wrong password — re-show with the inline error.
                setPendingPassword({ file, wrongPassword: true });
                return;
              }
              setPendingPassword(null);
              toast.error(err instanceof Error ? err.message : 'Failed to read PDF');
            }
          }}
        />
      )}
      {pendingScannedPdf && (
        <ScannedPdfConfirmDialog
          filename={pendingScannedPdf.name}
          documentLabel="statement"
          onCancel={() => setPendingScannedPdf(null)}
          onConfirm={() => {
            const file = pendingScannedPdf;
            setPendingScannedPdf(null);
            void analyzeRawFile(file);
          }}
        />
      )}
      {pdfTooLarge && (
        <PdfTooLargeDialog
          filename={pdfTooLarge.file.name}
          pageCount={pdfTooLarge.pageCount}
          documentLabel="statement"
          onClose={() => setPdfTooLarge(null)}
        />
      )}
    </div>
  );
}

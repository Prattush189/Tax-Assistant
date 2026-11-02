import { useRef, useState } from 'react';
import { Upload, FileText, Loader2 } from 'lucide-react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';
import { FormatSupportNotice } from '../shared/FormatSupportNotice';
import { SUPPORTED_LEDGER_SOFTWARE } from '../../lib/perLedgerErpRules';
import type { LedgerScrutinyManager } from '../../hooks/useLedgerScrutinyManager';
import type { LedgerFormatMeta, LedgerScrutinyProgress } from '../../services/api';
import { cn } from '../../lib/utils';
import { PasswordPromptDialog } from '../shared/PasswordPromptDialog';
import { ScannedPdfConfirmDialog, PdfTooLargeDialog } from '../shared/ScannedPdfConfirmDialog';
import { countPdfPagesClient } from '../../lib/pdfText';
import { excelToRows } from '../../lib/excelToRows';
import { extractPdfGrid, PdfPasswordError, rowsToFakeGrid, type PdfGrid } from '../../lib/pdfGrid';
import { ledgerReaderText, routeLedgerPdf, routeLedgerSheet, type LedgerMapCheck, type LedgerRoute } from '../../lib/ledgerRouting';
import { mapLedgerWithAi } from '../../lib/ledgerAiMapping';

interface Props {
  manager: LedgerScrutinyManager;
}

function ScrutinyProgressBar({
  phase,
  progress,
  scrutinyDone,
  scrutinyTotal,
  extractDone,
  extractTotal,
  startedAt,
  providerFallback,
}: {
  phase: 'extracting' | 'scrutinizing';
  progress: LedgerScrutinyProgress | null;
  scrutinyDone?: number;
  scrutinyTotal?: number;
  extractDone?: number;
  extractTotal?: number;
  /** Wall-clock when the current phase started. Used with done/total
   *  to estimate remaining time. */
  startedAt?: number;
  providerFallback?: boolean;
}) {
  // Prefer the phase-appropriate chunk progress when available.
  // Extract phase has its own counter (pages_total / pages_processed
  // on the server); scrutiny phase has scrutiny_chunks_*. Falls back
  // to the byte-stream estimate from the SSE /scrutinize endpoint
  // (single-call path that doesn't chunk).
  const usingExtractChunks = phase === 'extracting' && (extractTotal ?? 0) > 0;
  const usingScrutinyChunks = phase === 'scrutinizing' && (scrutinyTotal ?? 0) > 0;
  const total = usingExtractChunks ? extractTotal! : (usingScrutinyChunks ? scrutinyTotal! : (progress?.total ?? 0));
  const completed = usingExtractChunks ? (extractDone ?? 0) : (usingScrutinyChunks ? (scrutinyDone ?? 0) : (progress?.completed ?? 0));
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const indeterminate = total === 0;

  let eta: string | null = null;
  if ((usingExtractChunks || usingScrutinyChunks) && completed > 0 && startedAt && completed < total) {
    const elapsedMs = Date.now() - startedAt;
    const avgMsPerChunk = elapsedMs / completed;
    const remainingMs = avgMsPerChunk * (total - completed);
    const mins = Math.ceil(remainingMs / 60000);
    eta = mins <= 1 ? '~1 min remaining' : `~${mins} min remaining`;
  }

  const label = phase === 'extracting'
    ? usingExtractChunks
      ? `Reading ledger structure — chunk ${completed} of ${total}`
      : 'Reading the ledger structure…'
    : usingScrutinyChunks
      ? `Auditing chunk ${completed} of ${total} against §40A(3) / §269ST / TDS rubric`
      : progress?.accountsTotal
        ? `Auditing ${progress.accountsTotal} account${progress.accountsTotal === 1 ? '' : 's'} against §40A(3) / §269ST / TDS rubric`
        : 'Auditing accounts…';

  return (
    <div className="mt-3">
      <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
        <div
          className="h-full bg-emerald-600 dark:bg-emerald-500 transition-all duration-300 ease-out"
          style={{ width: indeterminate ? '15%' : `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        {label}{!indeterminate ? ` · ${pct}%` : ''}
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

const ACCEPT = '.pdf,.csv,.xlsx,.xls,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
const MAX_BYTES = 50 * 1024 * 1024;

export function LedgerUploader({ manager }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  // There is no column-mapping screen for ledgers — see
  // lib/ledgerRouting for where each upload goes.
  // Password-protected PDFs go here; the dialog re-runs extractPdfGrid
  // with the supplied password. wrongPassword flips on a retry so the
  // user gets the inline "try again" hint.
  const [pendingPassword, setPendingPassword] = useState<{
    file: File;
    wrongPassword: boolean;
  } | null>(null);
  // True while extractPdfGrid is parsing a freshly-picked PDF. Bridges
  // the silent 1-3s gap so the dropzone doesn't look idle after the
  // user clicks.
  const [isReadingPdf, setIsReadingPdf] = useState(false);
  // Scans go to AI vision (Claude Sonnet, ~10x a digital read) — the
  // user confirms the cost first. Carries the password of a protected
  // scan so the server can open it.
  const [pendingScannedPdf, setPendingScannedPdf] = useState<{ file: File; pdfPassword?: string } | null>(null);
  const [pdfTooLarge, setPdfTooLarge] = useState<{ file: File; pageCount: number } | null>(null);

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    const lname = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || lname.endsWith('.pdf');
    const isCsv = file.type === 'text/csv' || lname.endsWith('.csv');
    const isExcel = lname.endsWith('.xlsx') || lname.endsWith('.xls');
    if (!isPdf && !isCsv && !isExcel) {
      toast.error('Only PDF, CSV, and Excel (.xlsx / .xls) ledger exports are accepted.');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('Ledger file exceeds the 50 MB size limit. Split the export and re-upload.');
      return;
    }
    // Hard guard against starting a second audit while the first is
    // still running. The server-side findInProgressByHashForUser would
    // refuse a duplicate of the SAME file, but a different file would
    // still spawn a parallel run that doubles cost. Front-end check is
    // friendlier than waiting for the rejection.
    if (manager.hasInProgressJob) {
      toast.error('An audit is already running. Wait for it to finish before starting another.');
      return;
    }

    // CSV / Excel → a grid for the software rules / header guess; a sheet
    // nothing maps goes to the AI reader as its grid's text.
    if (isExcel || isCsv) {
      setIsReadingPdf(true);
      let rows: string[][] | null;
      try {
        rows = isExcel
          ? await excelToRows(file)
          : Papa.parse<string[]>(await file.text(), { skipEmptyLines: true }).data as string[][];
      } catch (err) {
        console.error('[LedgerUploader] sheet parse failed:', err);
        toast.error(isExcel ? 'Could not read this Excel file. Re-export as .xlsx and try again.' : 'Could not read this CSV file.');
        setIsReadingPdf(false);
        return;
      }
      const grid = rows ? rowsToFakeGrid(rows) : null;
      setIsReadingPdf(false);
      if (!rows || !grid) {
        toast.error(`${isExcel ? 'Excel' : 'CSV'} appears empty or has no data rows.`);
        return;
      }
      await followRoute(routeLedgerSheet(grid), file, { grid, sheet: true });
      return;
    }

    // PDF → grid → software rule, else the AI reader (the PDF's text, or
    // vision for a scan).
    setIsReadingPdf(true);
    try {
      const grid = await extractPdfGrid(file);
      setIsReadingPdf(false);
      await followRoute(routeLedgerPdf(grid), file, { grid });
    } catch (err) {
      setIsReadingPdf(false);
      if (err instanceof PdfPasswordError) {
        setPendingPassword({ file, wrongPassword: false });
        return;
      }
      console.warn('[LedgerUploader] grid extraction failed:', err);
      toast.error('Could not read this PDF. If it is scanned or image-only, export the ledger as a digital PDF or CSV and re-upload.');
    }
  };

  const followRoute = async (route: LedgerRoute, file: File, opts: { grid?: PdfGrid | null; sheet?: boolean; pdfPassword?: string } = {}) => {
    if (route.kind === 'mapped') {
      await submitMapped(route.checked, file.name, route.software === 'Columns recognised' ? route.software : `Auto-detected ${route.software}`);
      return;
    }
    if (!route.meta && !opts.sheet) {
      // A scan: AI vision is the expensive path — confirm, and block
      // anything over 100 pages.
      const pageCount = await countPdfPagesClient(file) ?? 0;
      if (pageCount > 100) {
        setPdfTooLarge({ file, pageCount });
        return;
      }
      setPendingScannedPdf({ file, pdfPassword: opts.pdfPassword });
      return;
    }
    toast("This layout isn't one we map automatically yet — reading it with AI.", { duration: 5000 });
    const meta: LedgerFormatMeta = { ...route.meta, pdfPassword: opts.pdfPassword };
    const grid = opts.grid ?? null;
    // 1. AI names the columns; the rows come from the grid, kept only when
    //    the running balances prove the mapping.
    let filed = false;
    if (grid) {
      setIsReadingPdf(true);
      const ai = await mapLedgerWithAi(file, grid, meta);
      setIsReadingPdf(false);
      filed = ai.filed;
      if (ai.checked) {
        await submitMapped(ai.checked, file.name, 'Columns mapped by AI and checked against the running balances');
        return;
      }
    }
    // 2. AI transcription (already filed as a format request by step 1).
    const readMeta = filed ? { pdfPassword: opts.pdfPassword } : meta;
    await readWithAi(file, readMeta, opts.sheet && grid
      ? { sheetText: ledgerReaderText(grid) }
      : { gridText: grid ? ledgerReaderText(grid) : undefined });
  };

  const readWithAi = async (file: File, meta: LedgerFormatMeta, texts: { sheetText?: string; gridText?: string } = {}) => {
    try {
      const result = await manager.upload(file, meta, texts);
      toast.success(`Audit complete: ${result.observations.length} observation${result.observations.length === 1 ? '' : 's'} across ${result.accounts.length} accounts`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    }
  };

  /** A software rule (or a proven header guess) mapped the ledger:
   *  surface filter stats and submit the extracted ledger to the audit.
   *  successPrefix labels the audit-running toast with the software. */
  const submitMapped = async (checked: LedgerMapCheck, filename: string, successPrefix?: string) => {
    const { mapped: { rows: mapped, stats }, extracted } = checked;
    if (!extracted) return; // routing only sends usable mappings
    const filteredCount = stats.totalGridRows - stats.transactions;
    if (filteredCount > 0) {
      const parts: string[] = [];
      if (stats.accountHeaders > 0) parts.push(`${stats.accountHeaders} account-separator row${stats.accountHeaders === 1 ? '' : 's'}`);
      if (stats.mergedContinuations > 0) parts.push(`${stats.mergedContinuations} wrapped narration line${stats.mergedContinuations === 1 ? '' : 's'} merged`);
      if (stats.skippedNoAmount > 0) parts.push(`${stats.skippedNoAmount} non-transaction row${stats.skippedNoAmount === 1 ? '' : 's'} skipped (opening / closing balance, page totals)`);
      if (parts.length > 0) {
        toast(`From ${stats.totalGridRows.toLocaleString('en-IN')} grid rows: ${stats.transactions.toLocaleString('en-IN')} transactions — ${parts.join(', ')}.`, { duration: 6000 });
      }
    }
    if (extracted.accounts.length === 1) {
      // Soft-warn so the user knows this is being audited as a
      // single-account ledger (the only failure mode this hides is a
      // multi-account book whose section headers we missed; if the
      // user knows the file is single-party, they accept).
      toast(`Single-account ledger detected (${extracted.accounts[0].name}). Auditing as one account.`, { duration: 5000 });
    }
    const prefix = successPrefix ? `${successPrefix} — ` : '';
    toast(`${prefix}detected ${extracted.accounts.length.toLocaleString('en-IN')} account${extracted.accounts.length === 1 ? '' : 's'} · ${mapped.length.toLocaleString('en-IN')} transactions — running audit…`);
    try {
      const result = await manager.uploadMapped(extracted, filename);
      toast.success(`Audit complete: ${result.observations.length} observation${result.observations.length === 1 ? '' : 's'} across ${result.accounts.length} accounts`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    }
  };

  const currentStatus = manager.current?.job.status;
  const scrutinyDone = manager.current?.job.scrutinyChunksDone ?? 0;
  const scrutinyTotal = manager.current?.job.scrutinyChunksTotal ?? 0;
  const extractDone = manager.current?.job.extractChunksDone ?? 0;
  const extractTotal = manager.current?.job.extractChunksTotal ?? 0;
  // Per-phase start timestamps for ETA. Reset when the phase changes
  // (extract → scrutinize) so the ETA is accurate to that phase only.
  const phaseStartedAt = useRef<number | null>(null);
  const lastPhase = useRef<string | undefined>(undefined);
  if (currentStatus !== lastPhase.current) {
    phaseStartedAt.current = (currentStatus === 'extracting' || currentStatus === 'scrutinizing') ? Date.now() : null;
    lastPhase.current = currentStatus;
  }
  // `busy` covers both the in-flight upload AND any other in-progress job
  // visible in the user's job list — so the upload zone is locked even
  // if the user navigated away from the running audit's detail view.
  const busy = manager.isUploading
    || manager.hasInProgressJob
    || currentStatus === 'extracting'
    || currentStatus === 'scrutinizing'
    || currentStatus === 'pending';
  const stage = currentStatus === 'scrutinizing' ? 'Auditing for tax exposure…'
    : currentStatus === 'extracting' || manager.isUploading ? 'Extracting accounts…'
    : isReadingPdf ? 'Reading PDF…'
    : 'Drop your ledger PDF here';

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
          ? 'border-emerald-400 bg-emerald-50/50 dark:border-emerald-500 dark:bg-emerald-900/10'
          : 'border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/30',
      )}
    >
      <div className="w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
        {(busy || isReadingPdf)
          ? <Loader2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400 animate-spin" />
          : <Upload className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />}
      </div>
      <div className="text-center w-full max-w-md">
        <p className="font-semibold text-gray-800 dark:text-gray-100">{stage}</p>
        {busy ? (
          <ScrutinyProgressBar
            phase={currentStatus === 'scrutinizing' ? 'scrutinizing' : 'extracting'}
            progress={manager.scrutinizeProgress}
            scrutinyDone={scrutinyDone}
            scrutinyTotal={scrutinyTotal}
            extractDone={extractDone}
            extractTotal={extractTotal}
            startedAt={phaseStartedAt.current ?? undefined}
            providerFallback={manager.current?.job.providerFallback}
          />
        ) : (
          <>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              PDF, CSV, or Excel ledger export · max 50 MB
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Extract + audit run as one step — no buttons to click after upload.
            </p>
            {/* Supported-software list is derived from the ERP rules
                themselves, so it can't drift from what actually works. */}
            <div className="mt-3 text-left" onClick={(e) => e.stopPropagation()}>
              <FormatSupportNotice kind="ledger" supported={SUPPORTED_LEDGER_SOFTWARE} />
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        <FileText className="w-4 h-4" />
        Choose ledger PDF
      </button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ACCEPT}
        onChange={(e) => { void handleFiles(e.target.files); if (inputRef.current) inputRef.current.value = ''; }}
      />
      <p className="text-xs text-gray-400 dark:text-gray-500 max-w-md text-center">
        Every account is graded against §40A(3), §269ST/SS/T, TDS scope, RCM cues, and reconciliation — observations cite the section so a CA can quote them directly.
      </p>
      {pendingPassword && (
        <PasswordPromptDialog
          filename={pendingPassword.file.name}
          wrongPassword={pendingPassword.wrongPassword}
          onCancel={() => setPendingPassword(null)}
          onSubmit={async (password) => {
            const file = pendingPassword.file;
            try {
              const grid = await extractPdfGrid(file, password);
              setPendingPassword(null);
              // Same routing as an unprotected PDF; the AI reader gets the
              // password so it can open the file.
              await followRoute(routeLedgerPdf(grid), file, { grid, pdfPassword: password });
            } catch (err) {
              if (err instanceof PdfPasswordError) {
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
          filename={pendingScannedPdf.file.name}
          documentLabel="ledger"
          onCancel={() => setPendingScannedPdf(null)}
          onConfirm={async () => {
            const { file, pdfPassword } = pendingScannedPdf;
            setPendingScannedPdf(null);
            await readWithAi(file, { pdfPassword });
          }}
        />
      )}
      {pdfTooLarge && (
        <PdfTooLargeDialog
          filename={pdfTooLarge.file.name}
          pageCount={pdfTooLarge.pageCount}
          documentLabel="ledger"
          onClose={() => setPdfTooLarge(null)}
        />
      )}
    </div>
  );
}

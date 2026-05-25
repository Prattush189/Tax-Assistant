/**
 * Final review + export. Aggregates the mapped TB into Schedule III
 * shape, surfaces validation issues, previews the key totals, and
 * offers two actions:
 *   - Download Excel (Schedule III BS + P&L)
 *   - Send to CMA (hand off the computed data to a new CMA draft)
 */
import { useMemo, useState } from 'react';
import { Download, AlertTriangle, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../../itr/shared/Inputs';
import { cn, formatINR } from '../../../lib/utils';
import { markTbBsExported } from '../../../services/api';
import { buildScheduleThreeReport } from '../lib/scheduleThreeBuilder';
import { buildScheduleThreeWorkbook } from '../lib/scheduleThreeExport';
import { buildIcaiNonCorporateWorkbook } from '../lib/icaiNonCorporateExport';
import { buildTallyVerticalWorkbook } from '../lib/tallyVerticalExport';
import { sendToCma } from '../lib/sendToCma';
import { OUTPUT_FORMAT_LABELS, type TbBsDraft, type TbBsOutputFormat } from '../lib/uiModel';

interface Props {
  draft: TbBsDraft;
  draftId: string | null;
  /** Forwarded from the parent wizard so this step can persist
   *  the chosen output format on the draft (so a reload doesn't
   *  lose the user's choice). */
  onChange: (patch: Partial<TbBsDraft>) => void;
}

interface OutputFormatOption {
  id: TbBsOutputFormat;
  label: string;
  description: string;
}

const OUTPUT_FORMAT_OPTIONS: OutputFormatOption[] = [
  {
    id: 'schedule_iii',
    label: 'Schedule III (Corporate)',
    description: 'Companies Act 2013 statutory format. Use for Pvt Ltd / Public Ltd entities.',
  },
  {
    id: 'icai_nc',
    label: 'ICAI Non-Corporate (2023)',
    description: 'Modern non-corporate format per ICAI Technical Guide 2023. Recommended for partnership firms, LLPs, proprietorships, AOPs.',
  },
  {
    id: 'tally_vertical',
    label: 'Tally Sources / Application',
    description: 'Traditional vertical layout — Sources of Funds vs Application of Funds. Familiar to older CA practitioners.',
  },
];

interface ValidationIssue {
  level: 'error' | 'warning';
  text: string;
}

function validate(draft: TbBsDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!draft.firm?.firmName?.trim()) issues.push({ level: 'error', text: 'Firm / company name is required.' });
  if (!draft.currentTb?.rows?.length) issues.push({ level: 'error', text: 'Upload a Trial Balance first.' });
  if ((draft.mapping?.length ?? 0) < 5) {
    issues.push({ level: 'warning', text: 'Very few TB rows mapped — Schedule III sections may be empty.' });
  }
  return issues;
}

export function TbBsReviewStep({ draft, draftId, onChange }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [sending, setSending] = useState(false);
  // Local override of the draft's persisted format — lets the user
  // flip between formats without firing autosave on every click.
  // Persisted to the draft when they click Download (so reloading
  // the draft preserves the last-used format).
  const [localOutputFormat, setLocalOutputFormat] = useState<TbBsOutputFormat | null>(null);
  const issues = useMemo(() => validate(draft), [draft]);
  const hasErrors = issues.some((i) => i.level === 'error');
  const report = useMemo(
    () => (hasErrors ? null : buildScheduleThreeReport(draft)),
    [draft, hasErrors],
  );

  const outputFormat: TbBsOutputFormat = localOutputFormat ?? draft.outputFormat ?? 'schedule_iii';

  const onDownload = async () => {
    if (!report) return;
    setDownloading(true);
    // Persist the format choice on the draft so reloading preserves
    // it. Async-fire-and-forget; the autosave debounce in the manager
    // batches this with any other in-flight changes.
    if (localOutputFormat && localOutputFormat !== draft.outputFormat) {
      onChange({ outputFormat: localOutputFormat });
    }
    try {
      // Dispatch to the right builder based on the user's choice.
      // All three accept the same { draft, report } input shape
      // because they share the canonical aggregate produced by
      // buildScheduleThreeReport.
      let blob: Blob;
      let formatLabel = 'Financials';
      if (outputFormat === 'icai_nc') {
        blob = await buildIcaiNonCorporateWorkbook({ draft, report });
        formatLabel = 'ICAI Non-Corporate';
      } else if (outputFormat === 'tally_vertical') {
        blob = await buildTallyVerticalWorkbook({ draft, report });
        formatLabel = 'Tally vertical';
      } else {
        blob = await buildScheduleThreeWorkbook({ draft, report });
        formatLabel = 'Schedule III';
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safe = (draft.firm?.firmName ?? 'financial-statements').replace(/[^a-z0-9_-]+/gi, '_');
      // Include format in the filename so users keeping multiple
      // exports can tell which is which.
      const fmtSlug = outputFormat === 'schedule_iii' ? 'ScheduleIII'
        : outputFormat === 'icai_nc' ? 'ICAI-NC'
          : 'TallyVertical';
      a.download = `${safe}-${fmtSlug}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      if (draftId) {
        try { await markTbBsExported(draftId); } catch { /* non-fatal */ }
      }
      toast.success(`${formatLabel} financials downloaded.`);
    } catch (err) {
      console.error('[tb-bs] export failed', err);
      toast.error(err instanceof Error ? err.message : 'Excel export failed');
    } finally {
      setDownloading(false);
    }
  };

  const onSendToCma = async () => {
    if (!report) return;
    setSending(true);
    try {
      const { cmaDraftId } = await sendToCma(draft, report);
      toast.success('Sent to CMA. Open the new CMA draft from the CMA Report tab.');
      console.log('[tb-bs] CMA draft created:', cmaDraftId);
    } catch (err) {
      console.error('[tb-bs] send to CMA failed', err);
      toast.error(err instanceof Error ? err.message : 'Send to CMA failed');
    } finally {
      setSending(false);
    }
  };

  const balanceClean = report && Math.abs(report.balanceCheck[0]) < 1;

  return (
    <div className="space-y-4">
      {issues.length > 0 && (
        <Card>
          <div className="space-y-2">
            {issues.map((iss, i) => (
              <div
                key={i}
                className={cn(
                  'flex items-start gap-2 text-sm rounded-lg px-3 py-2',
                  iss.level === 'error'
                    ? 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300'
                    : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300',
                )}
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{iss.text}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {report && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Total assets" value={formatINR(report.totals.totalAssets[0])} tone="ok" />
            <Tile label="Total equity + liab" value={formatINR(report.totals.totalEquityAndLiab[0])} tone="ok" />
            <Tile label="Revenue" value={formatINR(report.totals.totalRevenue[0])} tone="ok" />
            <Tile label="Profit for the period"
              value={formatINR(report.totals.profitForPeriod[0])}
              tone={report.totals.profitForPeriod[0] >= 0 ? 'ok' : 'warn'} />
          </div>

          <Card title="Balance check">
            <div className="flex items-baseline gap-3">
              <span className={cn(
                'text-sm font-medium',
                balanceClean ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400',
              )}>
                {balanceClean ? '✓ Assets = Equity + Liabilities' : `Difference: ${formatINR(Math.abs(report.balanceCheck[0]))}`}
              </span>
              {!balanceClean && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Check the mapping step's tie-out — likely an unmapped row or a mis-picked debit/credit column.
                </span>
              )}
            </div>
          </Card>
        </>
      )}

      <Card title="Output format">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Same data, different layout. Schedule III is the statutory Corporate format;
          ICAI Non-Corporate and Tally vertical are for proprietorships / partnership firms.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {OUTPUT_FORMAT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                // Update local override immediately for UI snappiness;
                // the persisted draft.outputFormat is written on
                // Download. Local override means the user can flip
                // formats without firing autosave on every click.
                setLocalOutputFormat(opt.id);
              }}
              className={cn(
                'p-3 rounded-lg border text-left transition-colors',
                (localOutputFormat ?? outputFormat) === opt.id
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 ring-2 ring-emerald-500/30'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
              )}
            >
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{opt.label}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{opt.description}</p>
            </button>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {report
            ? `${OUTPUT_FORMAT_LABELS[(localOutputFormat ?? outputFormat) as TbBsOutputFormat]} ready. Excel emits both Balance Sheet + Statement of P&L with live formulas.`
            : 'Resolve the errors above to enable download.'}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSendToCma}
            disabled={!report || sending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 text-sm font-medium hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
            {sending ? 'Sending…' : 'Send to CMA'}
          </button>
          <button
            type="button"
            onClick={onDownload}
            disabled={!report || downloading}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            {downloading ? 'Building Excel…' : 'Download Excel'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-4">
      <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-medium">{label}</p>
      <p className={cn(
        'text-lg font-bold mt-1 tabular-nums',
        tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400',
      )}>{value}</p>
    </div>
  );
}

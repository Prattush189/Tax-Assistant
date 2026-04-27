import { useMemo, useState } from 'react';
import {
  AlertTriangle, AlertCircle, Info, ChevronDown, ChevronRight,
  CheckCircle2, Trash2, Download, FileSearch, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { LedgerScrutinyManager } from '../../hooks/useLedgerScrutinyManager';
import type {
  LedgerScrutinyAccount,
  LedgerScrutinyObservation,
  LedgerScrutinySeverity,
} from '../../services/api';
import { cn } from '../../lib/utils';
import { renderLedgerScrutinyPdf } from './ScrutinyExportPdf';

interface Props {
  manager: LedgerScrutinyManager;
}

const SEVERITY_META: Record<LedgerScrutinySeverity, {
  label: string;
  icon: typeof AlertTriangle;
  ring: string;
  bg: string;
  text: string;
}> = {
  high: {
    label: 'High',
    icon: AlertTriangle,
    ring: 'ring-rose-500/30',
    bg: 'bg-rose-50 dark:bg-rose-900/20',
    text: 'text-rose-700 dark:text-rose-300',
  },
  warn: {
    label: 'Warn',
    icon: AlertCircle,
    ring: 'ring-amber-500/30',
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    text: 'text-amber-700 dark:text-amber-300',
  },
  info: {
    label: 'Info',
    icon: Info,
    ring: 'ring-sky-500/30',
    bg: 'bg-sky-50 dark:bg-sky-900/20',
    text: 'text-sky-700 dark:text-sky-300',
  },
};

function fmtINR(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}

export function ScrutinyReport({ manager }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const detail = manager.current;

  const grouped = useMemo(() => {
    const map = new Map<string, LedgerScrutinyObservation[]>();
    if (!detail) return map;
    for (const obs of detail.observations) {
      const key = obs.accountId ?? '__ledger__';
      const arr = map.get(key) ?? [];
      arr.push(obs);
      map.set(key, arr);
    }
    return map;
  }, [detail]);

  if (!detail) return null;

  const { job, accounts, observations } = detail;
  // Job is still running on the server when status isn't `done` or `error`.
  // The 5-s poll loop in useLedgerScrutinyManager refreshes `detail` while
  // it's in this state, so the UI updates as the server transitions
  // through extracting → scrutinizing → done. We disable destructive
  // actions during the run so the user can't delete a job mid-audit or
  // export an empty PDF.
  const isRunning = job.status === 'extracting' || job.status === 'scrutinizing' || job.status === 'pending';
  const isError = job.status === 'error';
  const openCount = observations.filter((o) => o.status === 'open');
  const high = openCount.filter((o) => o.severity === 'high').length;
  const warn = openCount.filter((o) => o.severity === 'warn').length;
  const info = openCount.filter((o) => o.severity === 'info').length;

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDelete = async () => {
    if (!confirm('Delete this scrutiny job? This cannot be undone.')) return;
    try {
      await manager.remove(job.id);
      toast.success('Scrutiny deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  const handleExport = () => {
    try {
      renderLedgerScrutinyPdf(detail);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'PDF export failed');
    }
  };

  const handleToggleStatus = async (obs: LedgerScrutinyObservation) => {
    try {
      await manager.setObservationStatus(obs.id, obs.status === 'open' ? 'resolved' : 'open');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update');
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileSearch className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50 truncate">
                {job.partyName ?? job.name}
              </h2>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {job.gstin ? `GSTIN ${job.gstin} · ` : ''}
              {job.periodFrom ?? '?'} – {job.periodTo ?? '?'} · {accounts.length} accounts ·{' '}
              {accounts.reduce((s, a) => s + a.txCount, 0).toLocaleString('en-IN')} transactions
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleExport}
              disabled={isRunning}
              title={isRunning ? 'Wait for the audit to finish before exporting' : undefined}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              Export PDF
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isRunning}
              title={isRunning ? "Can't delete a job while it's running" : undefined}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* In-progress banner. Drives off job.status which the 5 s poll
          updates as the server transitions extracting → scrutinizing →
          done. Tab close + reload during a run lands here showing live
          status. */}
      {isRunning && (
        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/60 dark:bg-emerald-900/15 p-5">
          <div className="flex items-start gap-3">
            <Loader2 className="w-5 h-5 mt-0.5 text-emerald-600 dark:text-emerald-400 animate-spin shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-gray-900 dark:text-gray-100">
                {job.status === 'extracting' && 'Extracting accounts and transactions…'}
                {job.status === 'scrutinizing' && 'Auditing against §40A(3) / §269ST / TDS rubric…'}
                {job.status === 'pending' && 'Queued — starting shortly…'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Long ledgers can take up to 20 minutes. The server keeps running even if you close this tab — just come back here to see the result.
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                if (!confirm("Cancel this scrutiny? It will count toward your monthly limit — Gemini has already done partial work and we can't refund the slot.")) return;
                try { await manager.cancel(job.id); toast.success('Cancelled'); }
                catch (e) { toast.error(e instanceof Error ? e.message : 'Cancel failed'); }
              }}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20"
            >
              Cancel
            </button>
          </div>
          {/* Indeterminate progress bar — we don't surface chunk counts
              from the server yet, but the spinning gradient signals
              activity while polling refreshes the detail behind it. */}
          <div className="mt-3 h-1.5 w-full rounded-full bg-emerald-100 dark:bg-emerald-900/40 overflow-hidden">
            <div className="h-full w-1/3 bg-emerald-500 dark:bg-emerald-400 animate-[ledgerProgress_1.6s_ease-in-out_infinite]" style={{
              animation: 'ledgerProgress 1.6s ease-in-out infinite',
            }} />
          </div>
          <style>{`@keyframes ledgerProgress { 0% { transform: translateX(-120%); } 50% { transform: translateX(120%); } 100% { transform: translateX(320%); } }`}</style>
        </div>
      )}

      {isError && (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-800/60 bg-rose-50/60 dark:bg-rose-900/15 p-5">
          <p className="font-semibold text-rose-800 dark:text-rose-200">Audit failed</p>
          <p className="text-xs text-rose-700 dark:text-rose-300 mt-1">
            {job.errorMessage ?? 'Unknown error. Try uploading the ledger again.'}
          </p>
        </div>
      )}

      {/* Summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SeverityTile severity="high" count={high} label="High-risk findings" />
        <SeverityTile severity="warn" count={warn} label="Warnings" />
        <SeverityTile severity="info" count={info} label="Notes" />
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-4">
          <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium">
            Total flagged amount
          </p>
          <p className="mt-1 text-xl font-bold text-gray-900 dark:text-gray-50">
            ₹ {fmtINR(job.totalFlaggedAmount)}
          </p>
        </div>
      </div>

      {/* Ledger-wide observations (no accountId) */}
      {grouped.has('__ledger__') && (
        <ObservationGroup
          title="Ledger-wide observations"
          observations={grouped.get('__ledger__')!}
          onToggleStatus={handleToggleStatus}
        />
      )}

      {/* Per-account cards */}
      <div className="space-y-2">
        {accounts.map((acc) => {
          const accObs = grouped.get(acc.id) ?? [];
          const isOpen = expanded.has(acc.id);
          const accHigh = accObs.filter((o) => o.severity === 'high' && o.status === 'open').length;
          const accWarn = accObs.filter((o) => o.severity === 'warn' && o.status === 'open').length;
          const accInfo = accObs.filter((o) => o.severity === 'info' && o.status === 'open').length;
          const hasFindings = accObs.length > 0;
          return (
            <div key={acc.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 overflow-hidden">
              <button
                type="button"
                onClick={() => toggle(acc.id)}
                className={cn(
                  'w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors',
                  hasFindings ? 'hover:bg-gray-50 dark:hover:bg-gray-900/60' : 'hover:bg-gray-50/50 dark:hover:bg-gray-900/30',
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
                  <AccountTypeBadge type={acc.accountType} />
                  <span className="font-medium text-gray-900 dark:text-gray-100 truncate">{acc.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-xs">
                  {accHigh > 0 && <SeverityChip severity="high" count={accHigh} />}
                  {accWarn > 0 && <SeverityChip severity="warn" count={accWarn} />}
                  {accInfo > 0 && <SeverityChip severity="info" count={accInfo} />}
                  {!hasFindings && (
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Clean
                    </span>
                  )}
                  <span className="text-gray-400 dark:text-gray-500 ml-2">
                    Closing ₹ {fmtINR(acc.closing)}
                  </span>
                </div>
              </button>
              {isOpen && (
                <div className="px-4 pb-4">
                  <AccountStats account={acc} />
                  {accObs.length > 0 ? (
                    <ul className="mt-3 space-y-2">
                      {accObs.map((obs) => (
                        <ObservationRow key={obs.id} obs={obs} onToggleStatus={handleToggleStatus} />
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                      No flags raised on this account.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SeverityTile({ severity, count, label }: { severity: LedgerScrutinySeverity; count: number; label: string }) {
  const meta = SEVERITY_META[severity];
  const Icon = meta.icon;
  return (
    <div className={cn('rounded-xl border border-gray-200 dark:border-gray-800 p-4 ring-1', meta.bg, meta.ring)}>
      <div className="flex items-center gap-2">
        <Icon className={cn('w-4 h-4', meta.text)} />
        <p className={cn('text-[11px] uppercase tracking-wide font-semibold', meta.text)}>{meta.label}</p>
      </div>
      <p className="mt-1 text-xl font-bold text-gray-900 dark:text-gray-50">{count}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
    </div>
  );
}

function SeverityChip({ severity, count }: { severity: LedgerScrutinySeverity; count: number }) {
  const meta = SEVERITY_META[severity];
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold', meta.bg, meta.text)}>
      {meta.label} · {count}
    </span>
  );
}

function AccountTypeBadge({ type }: { type: string | null }) {
  if (!type) return null;
  return (
    <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400 dark:text-gray-500 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700">
      {type}
    </span>
  );
}

function AccountStats({ account }: { account: LedgerScrutinyAccount }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
      <Stat label="Opening" value={`₹ ${fmtINR(account.opening)}`} />
      <Stat label="Closing" value={`₹ ${fmtINR(account.closing)}`} />
      <Stat label="Total debit" value={`₹ ${fmtINR(account.totalDebit)}`} />
      <Stat label="Total credit" value={`₹ ${fmtINR(account.totalCredit)}`} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium">{label}</p>
      <p className="font-semibold text-gray-800 dark:text-gray-100">{value}</p>
    </div>
  );
}

function ObservationGroup({
  title,
  observations,
  onToggleStatus,
}: {
  title: string;
  observations: LedgerScrutinyObservation[];
  onToggleStatus: (obs: LedgerScrutinyObservation) => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-4">
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</p>
      <ul className="mt-3 space-y-2">
        {observations.map((obs) => (
          <ObservationRow key={obs.id} obs={obs} onToggleStatus={onToggleStatus} />
        ))}
      </ul>
    </div>
  );
}

function ObservationRow({
  obs,
  onToggleStatus,
}: {
  obs: LedgerScrutinyObservation;
  onToggleStatus: (obs: LedgerScrutinyObservation) => void;
}) {
  const meta = SEVERITY_META[obs.severity];
  const Icon = meta.icon;
  const resolved = obs.status === 'resolved';
  return (
    <li className={cn(
      'rounded-lg border p-3 transition-opacity',
      resolved ? 'opacity-60 border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/30' : `border-transparent ring-1 ${meta.ring} ${meta.bg}`,
    )}>
      <div className="flex items-start gap-2">
        <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', meta.text)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('text-[10px] uppercase tracking-wider font-bold', meta.text)}>
              {meta.label}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-mono">
              {obs.code}
            </span>
            {obs.dateRef && (
              <span className="text-[10px] text-gray-400 dark:text-gray-500">{obs.dateRef}</span>
            )}
            {obs.amount !== null && (
              <span className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">
                ₹ {fmtINR(Math.abs(obs.amount))}
              </span>
            )}
          </div>
          <p className={cn('mt-1 text-sm', resolved ? 'line-through text-gray-500 dark:text-gray-400' : 'text-gray-800 dark:text-gray-100')}>
            {obs.message}
          </p>
          {obs.suggestedAction && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              <span className="font-semibold">Action:</span> {obs.suggestedAction}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onToggleStatus(obs)}
          className={cn(
            'shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border transition-colors',
            resolved
              ? 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              : 'border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20',
          )}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          {resolved ? 'Reopen' : 'Mark resolved'}
        </button>
      </div>
    </li>
  );
}

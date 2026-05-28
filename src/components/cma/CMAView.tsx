/**
 * CMA wizard entry point. Mirrors PartnershipDeedView's step-rail
 * layout: left rail with step navigation, right pane with the
 * current step's body, bottom nav with Back/Next.
 *
 * Phase 1 ships the scaffolding only — each step renders a
 * placeholder card. Phases 2-6 fill in the actual upload, mapping,
 * assumptions, projections, ratios, stress test, and Excel export.
 */
import { useCallback, useEffect, useState } from 'react';
import { LineChart, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { CMAManager } from '../../hooks/useCMAManager';
import {
  STEP_ORDER,
  STEP_LABELS,
  STEP_DESCRIPTIONS,
  emptyDraft,
  type CmaStepId,
  type CmaDraft,
} from './lib/uiModel';
import { UploadStep } from './steps/UploadStep';
import { FirmInfoStep } from './steps/FirmInfoStep';
import { MappingStep } from './steps/MappingStep';
import { HorizonStep } from './steps/HorizonStep';
import { AssumptionsStep } from './steps/AssumptionsStep';
import { WorkingCapitalStep } from './steps/WorkingCapitalStep';
import { TermLoansStep } from './steps/TermLoansStep';
import { StressStep } from './steps/StressStep';
import { ReviewStep } from './steps/ReviewStep';

interface Props {
  manager: CMAManager;
}

export function CMAView({ manager }: Props) {
  const [step, setStep] = useState<CmaStepId>('upload');

  // Reset to the first step whenever the open draft changes (load
  // from list, create a new one). Matches partnership-deeds UX.
  useEffect(() => {
    if (manager.currentDraft) {
      setStep('upload');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager.currentDraft?.id]);

  const updateDraft = useCallback(
    (patch: Partial<CmaDraft>) => {
      if (manager.currentId) manager.updatePayload(patch);
    },
    [manager],
  );

  const stepIndex = STEP_ORDER.indexOf(step);
  const canGoPrev = stepIndex > 0;
  const canGoNext = stepIndex < STEP_ORDER.length - 1;
  const goPrev = () => { if (canGoPrev) setStep(STEP_ORDER[stepIndex - 1]); };
  const goNext = () => { if (canGoNext) setStep(STEP_ORDER[stepIndex + 1]); };

  if (!manager.currentDraft) {
    return <NoDraftSelected manager={manager} />;
  }

  const draft = manager.currentDraft.ui_payload ?? emptyDraft();

  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-gray-50 dark:bg-[#0E0C0A]">
      {/* Left rail — step navigation */}
      <aside className="hidden md:flex w-64 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-[#151210] p-4 flex-col shrink-0">
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <LineChart className="w-4 h-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">CMA Report</h2>
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-500 truncate">{manager.currentDraft.name}</p>
        </div>
        <nav className="space-y-0.5 flex-1 overflow-y-auto">
          {STEP_ORDER.map((id, i) => {
            const isActive = id === step;
            const isDone = stepIndex > i;
            return (
              <button
                key={id}
                onClick={() => setStep(id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors text-sm',
                  isActive
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/60',
                )}
              >
                <span
                  className={cn(
                    'w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0',
                    isActive
                      ? 'bg-emerald-500 text-white'
                      : isDone
                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-400',
                  )}
                >
                  {i + 1}
                </span>
                <span className="flex-1 truncate">{STEP_LABELS[id]}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Right pane — current step */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="max-w-3xl mx-auto w-full">
            <div className="mb-4 md:hidden">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Step {stepIndex + 1} of {STEP_ORDER.length}
              </p>
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{STEP_LABELS[step]}</h2>
            </div>
            <div className="hidden md:block mb-5">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{STEP_LABELS[step]}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-500 mt-0.5">{STEP_DESCRIPTIONS[step]}</p>
            </div>
            <StepBody step={step} draft={draft} draftId={manager.currentId} onChange={updateDraft} />
          </div>
        </div>
        {/* Bottom nav */}
        <div className="shrink-0 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-[#151210] p-3 flex items-center justify-between gap-2">
          <button
            onClick={goPrev}
            disabled={!canGoPrev}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl transition-colors',
              canGoPrev
                ? 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                : 'text-gray-300 dark:text-gray-600 cursor-not-allowed',
            )}
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <div className="hidden md:flex text-[11px] text-gray-400 dark:text-gray-500">Auto-saved</div>
          <button
            onClick={goNext}
            disabled={!canGoNext}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl transition-colors',
              canGoNext
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/20'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-300 dark:text-gray-600 cursor-not-allowed',
            )}
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Step body dispatcher ────────────────────────────────────────

interface StepBodyProps {
  step: CmaStepId;
  draft: CmaDraft;
  draftId: string | null;
  onChange: (patch: Partial<CmaDraft>) => void;
}

function StepBody({ step, draft, draftId, onChange }: StepBodyProps) {
  switch (step) {
    case 'upload':         return <UploadStep draft={draft} onChange={onChange} />;
    case 'firmInfo':       return <FirmInfoStep draft={draft} onChange={onChange} />;
    case 'mapping':        return <MappingStep draft={draft} draftId={draftId} onChange={onChange} />;
    case 'horizon':        return <HorizonStep draft={draft} onChange={onChange} />;
    case 'assumptions':    return <AssumptionsStep draft={draft} onChange={onChange} />;
    case 'workingCapital': return <WorkingCapitalStep draft={draft} onChange={onChange} />;
    case 'termLoans':      return <TermLoansStep draft={draft} onChange={onChange} />;
    case 'stress':         return <StressStep draft={draft} onChange={onChange} />;
    case 'review':         return <ReviewStep draft={draft} draftId={draftId} onChange={onChange} />;
  }
}

// ── Empty-state landing ─────────────────────────────────────────
// Shown when no draft is currently open. Mirrors the partnership-
// deeds and ledger-compare landing pages so the user has a
// consistent "create / pick" gesture across modules.

function NoDraftSelected({ manager }: { manager: CMAManager }) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onCreate = async () => {
    if (!name.trim()) {
      setErr('Please give this CMA a name');
      return;
    }
    setErr(null);
    setCreating(true);
    try {
      await manager.createDraft({ name: name.trim() });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create CMA draft');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-4 md:p-6">
      <div className="max-w-2xl mx-auto w-full">
        <div className="text-center mb-8 mt-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 mb-4">
            <LineChart className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">CMA Reports</h1>
          <p className="text-sm text-gray-500 dark:text-gray-500 max-w-md mx-auto">
            Generate bank-ready Credit Monitoring Arrangement reports from your client's
            audited financials. Excel output with live formulas — every figure traceable.
          </p>
        </div>

        <div className="bg-white dark:bg-[#1a1714] border border-gray-200 dark:border-gray-800 rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
              Draft name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Industries — WC + Term Loan FY 25-26"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-gray-900 dark:text-gray-100"
            />
          </div>

          {err && <p className="text-sm text-red-500">{err}</p>}

          <button
            onClick={onCreate}
            disabled={creating || !name.trim()}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:text-gray-400 text-white font-medium py-2.5 rounded-xl transition-colors text-sm"
          >
            {creating ? 'Creating…' : 'Start wizard'}
          </button>
        </div>

        {manager.drafts.length > 0 && (
          <div className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Recent</h3>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40">
              {manager.drafts.slice(0, 10).map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => void manager.load(d.id)}
                    className="w-full py-3 px-4 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors"
                  >
                    <span className="text-sm text-gray-800 dark:text-gray-200 truncate">{d.name}</span>
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0 ml-3">
                      {d.exported_at ? 'Exported' : 'Draft'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gavel, ChevronRight, ChevronLeft } from 'lucide-react';
import { cn } from '../../lib/utils';
import { BoardResolutionManager } from '../../hooks/useBoardResolutionManager';
import {
  BoardResolutionDraft,
  StepId,
  STEP_LABELS,
  STEP_DESCRIPTIONS,
  TEMPLATE_TITLES,
  TemplateId,
  emptyDraft,
  getStepOrder,
} from './lib/uiModel';
import { TEMPLATE_LIST } from './lib/resolutionTemplates';
import { TemplatePickerStep } from './steps/TemplatePickerStep';
import { CompanyInfoStep } from './steps/CompanyInfoStep';
import { MeetingInfoStep } from './steps/MeetingInfoStep';
import { ResolutionBodyStep } from './steps/ResolutionBodyStep';
import { SignatoriesStep } from './steps/SignatoriesStep';
import { ReviewStep } from './steps/ReviewStep';

interface Props {
  manager: BoardResolutionManager;
}

export function BoardResolutionView({ manager }: Props) {
  const [step, setStep] = useState<StepId>('templatePicker');
  const [localDraft, setLocalDraft] = useState<BoardResolutionDraft>(() => emptyDraft('appointment_of_director'));
  const stepOrder = useMemo(() => getStepOrder(localDraft.templateId), [localDraft.templateId]);

  // Sync when selected draft changes
  useEffect(() => {
    if (manager.currentDraft) {
      const payload = manager.currentDraft.ui_payload as Partial<BoardResolutionDraft>;
      setLocalDraft({
        ...emptyDraft(manager.currentDraft.template_id),
        ...payload,
        templateId: manager.currentDraft.template_id,
      });
      setStep('company');
    } else {
      setLocalDraft(emptyDraft('appointment_of_director'));
      setStep('templatePicker');
    }
  }, [manager.currentDraft?.id, manager.currentDraft?.template_id]);

  const updateDraft = useCallback(
    (patch: Partial<BoardResolutionDraft> | ((prev: BoardResolutionDraft) => BoardResolutionDraft)) => {
      setLocalDraft((prev) => {
        const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
        // Defer the manager state update to a microtask so we don't trigger
        // a parent re-render while this component is still committing.
        if (manager.currentDraftId) {
          Promise.resolve().then(() => {
            manager.updatePayload(next as unknown as Record<string, unknown>);
          });
        }
        return next;
      });
    },
    [manager],
  );

  const stepIndex = stepOrder.indexOf(step);
  const canGoPrev = stepIndex > 0;
  const canGoNext = stepIndex < stepOrder.length - 1;

  const goPrev = () => { if (canGoPrev) setStep(stepOrder[stepIndex - 1]); };
  const goNext = () => { if (canGoNext) setStep(stepOrder[stepIndex + 1]); };

  if (!manager.currentDraft) {
    return <NoDraftSelected manager={manager} />;
  }

  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-gray-50 dark:bg-[#0E0C0A]">
      {/* Progress rail (desktop) */}
      <aside className="hidden md:flex w-64 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-[#151210] p-4 flex-col shrink-0">
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <Gavel className="w-4 h-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {TEMPLATE_TITLES[manager.currentDraft.template_id]}
            </h2>
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-500 truncate">{manager.currentDraft.name}</p>
        </div>
        <nav className="space-y-0.5 flex-1 overflow-y-auto">
          {stepOrder.map((id, i) => {
            const isActive = id === step;
            const isDone = stepOrder.indexOf(step) > i;
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

      {/* Step content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="max-w-3xl mx-auto w-full">
            <div className="mb-4 md:hidden">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Step {stepIndex + 1} of {stepOrder.length}
              </p>
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{STEP_LABELS[step]}</h2>
            </div>
            <div className="hidden md:block mb-5">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{STEP_LABELS[step]}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-500 mt-0.5">
                {STEP_DESCRIPTIONS[step]}
              </p>
            </div>
            <StepBody step={step} draft={localDraft} onChange={updateDraft} />
          </div>
        </div>
        {/* Step nav */}
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
          <div className="hidden md:flex text-[11px] text-gray-400 dark:text-gray-500">
            Auto-saved
          </div>
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

function StepBody({
  step,
  draft,
  onChange,
}: {
  step: StepId;
  draft: BoardResolutionDraft;
  onChange: (patch: Partial<BoardResolutionDraft> | ((p: BoardResolutionDraft) => BoardResolutionDraft)) => void;
}) {
  switch (step) {
    case 'templatePicker':
      return <TemplatePickerStep draft={draft} onChange={onChange} />;
    case 'company':
      return <CompanyInfoStep draft={draft} onChange={onChange} />;
    case 'meeting':
      return <MeetingInfoStep draft={draft} onChange={onChange} />;
    case 'body':
      return <ResolutionBodyStep draft={draft} onChange={onChange} />;
    case 'signatories':
      return <SignatoriesStep draft={draft} onChange={onChange} />;
    case 'review':
      return <ReviewStep draft={draft} onChange={onChange} />;
    default:
      return null;
  }
}

function NoDraftSelected({ manager }: { manager: BoardResolutionManager }) {
  const [templateId, setTemplateId] = useState<TemplateId>('appointment_of_director');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onCreate = async () => {
    if (!name.trim()) {
      setErr('Please give this draft a name');
      return;
    }
    setErr(null);
    setCreating(true);
    try {
      await manager.createDraft({
        template_id: templateId,
        name: name.trim(),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create draft');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-4 md:p-6">
      <div className="max-w-2xl mx-auto w-full">
        <div className="text-center mb-8 mt-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 mb-4">
            <Gavel className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
            Board Resolutions
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-500 max-w-md mx-auto">
            Generate Companies Act 2013 board resolution PDFs from standard templates. Admin-only feature.
          </p>
        </div>

        <div className="bg-white dark:bg-[#1a1714] border border-gray-200 dark:border-gray-800 rounded-2xl p-6 space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Pick a template</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {TEMPLATE_LIST.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => setTemplateId(tpl.id)}
                  className={cn(
                    'text-left p-4 rounded-xl border transition-all',
                    templateId === tpl.id
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 ring-2 ring-emerald-500/30'
                      : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700',
                  )}
                >
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{tpl.title}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-500">{tpl.subtitle}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
              Draft name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme — Appointment of Director"
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
          <div className="mt-6 text-center text-xs text-gray-400 dark:text-gray-500">
            Or pick an existing draft from the sidebar.
          </div>
        )}
      </div>
    </div>
  );
}

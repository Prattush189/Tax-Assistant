import { PartnershipDeedDraft, PartnershipDeedTemplateId } from '../lib/uiModel';
import { TEMPLATE_LIST } from '../lib/templates';
import { cn } from '../../../lib/utils';

interface Props {
  draft: PartnershipDeedDraft;
  onChange: (
    patch: Partial<PartnershipDeedDraft> | ((p: PartnershipDeedDraft) => PartnershipDeedDraft),
  ) => void;
  /** Locked once a draft has been created — switching template would orphan template-specific data. */
  locked?: boolean;
}

export function TemplatePickerStep({ draft, onChange, locked }: Props) {
  const pick = (id: PartnershipDeedTemplateId) => {
    if (locked) return;
    onChange((prev) => ({ ...prev, templateId: id }));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {locked
          ? 'Template is locked for this draft. Create a new draft to switch templates.'
          : 'Pick the deed template. The wizard adapts its later steps to match.'}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {TEMPLATE_LIST.map((tpl) => {
          const selected = draft.templateId === tpl.id;
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => pick(tpl.id)}
              disabled={locked}
              className={cn(
                'text-left p-4 rounded-xl border transition-all',
                selected
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 ring-2 ring-emerald-500/30'
                  : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700',
                locked && !selected && 'opacity-50 cursor-not-allowed',
              )}
            >
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{tpl.title}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-500 mb-2">{tpl.subtitle}</p>
              <p className="text-[10px] font-medium uppercase tracking-wider text-emerald-600/70 dark:text-emerald-400/70">
                {tpl.governingAct}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { BoardResolutionDraft, TemplateId } from '../lib/uiModel';
import { TEMPLATE_LIST } from '../lib/resolutionTemplates';
import { cn } from '../../../lib/utils';

interface Props {
  draft: BoardResolutionDraft;
  onChange: (patch: Partial<BoardResolutionDraft> | ((p: BoardResolutionDraft) => BoardResolutionDraft)) => void;
}

export function TemplatePickerStep({ draft, onChange }: Props) {
  const pickTemplate = (id: TemplateId) => {
    onChange((prev) => ({ ...prev, templateId: id }));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Pick the resolution you want to draft. You can change templates later, but the template-specific
        fields will reset.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {TEMPLATE_LIST.map((tpl) => {
          const selected = draft.templateId === tpl.id;
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => pickTemplate(tpl.id)}
              className={cn(
                'text-left p-4 rounded-xl border transition-all',
                selected
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 ring-2 ring-emerald-500/30'
                  : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700',
              )}
            >
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{tpl.title}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-500">{tpl.subtitle}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

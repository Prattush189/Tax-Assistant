import { ItrWizardDraft, emptyDraft } from '../lib/uiModel';
import { Card } from '../shared/Inputs';
import { cn } from '../../../lib/utils';

interface Props {
  draft: ItrWizardDraft;
  onChange: (patch: Partial<ItrWizardDraft> | ((p: ItrWizardDraft) => ItrWizardDraft)) => void;
}

/**
 * Form-picker step is a read-only confirmation of the chosen form after the
 * initial "New draft" flow. A user CAN switch between ITR-1 and ITR-4 here —
 * it resets the wizard to defaults for the new form.
 */
export function FormPickerStep({ draft, onChange }: Props) {
  const setForm = (formType: 'ITR1' | 'ITR4') => {
    if (formType === draft.formType) return;
    if (!window.confirm('Switching form type will reset wizard defaults. Your filled-in fields will be preserved where shared. Continue?')) return;
    onChange({ ...emptyDraft(formType), ...draft, formType });
  };

  return (
    <div className="space-y-4">
      <Card title="Selected form">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormCard
            selected={draft.formType === 'ITR1'}
            onClick={() => setForm('ITR1')}
            title="ITR-1 Sahaj"
            points={[
              'Salaried individuals',
              'One house property (self-occupied or let-out)',
              'Other sources (interest, dividends ≤ limits)',
              'LTCG u/s 112A up to ₹1.25L permitted',
              'Total income ≤ ₹50L',
            ]}
            warnings={[
              'Not for: business income, capital gains > 1.25L, foreign income',
              'Not for: more than one house property, director, unlisted shares',
            ]}
          />
          <FormCard
            selected={draft.formType === 'ITR4'}
            onClick={() => setForm('ITR4')}
            title="ITR-4 Sugam"
            points={[
              'Presumptive business (44AD) or profession (44ADA)',
              'Presumptive goods transport (44AE)',
              'Salary + one house property + other sources OK',
              'Total income ≤ ₹50L',
            ]}
            warnings={[
              'Not for: ITR-3 business with books of accounts',
              'Not for: capital gains, foreign assets',
            ]}
          />
        </div>
      </Card>
      <p className="text-[11px] text-gray-500 dark:text-gray-500 text-center">
        AY 2025-26 schemas only. ITR-2/3/5/6/7 not supported in this release.
      </p>
    </div>
  );
}

function FormCard({
  selected,
  onClick,
  title,
  points,
  warnings,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  points: string[];
  warnings: string[];
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-left p-4 rounded-xl border transition-all',
        selected
          ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/10 ring-2 ring-emerald-500/20'
          : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700',
      )}
    >
      <p className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">{title}</p>
      <ul className="space-y-1 mb-3">
        {points.map((p) => (
          <li key={p} className="text-[11px] text-gray-600 dark:text-gray-400 flex gap-1.5">
            <span className="text-emerald-500">✓</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <ul className="space-y-1 border-t border-gray-200 dark:border-gray-800 pt-2">
        {warnings.map((w) => (
          <li key={w} className="text-[11px] text-gray-500 dark:text-gray-500 flex gap-1.5">
            <span className="text-amber-500">!</span>
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </button>
  );
}

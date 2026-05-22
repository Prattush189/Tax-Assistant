import { Card, Field } from '../../itr/shared/Inputs';
import { MPBF_METHOD_LABELS, type CmaDraft, type MpbfMethod, type ProjectionHorizon } from '../lib/uiModel';
import { cn } from '../../../lib/utils';

interface Props {
  draft: CmaDraft;
  onChange: (patch: Partial<CmaDraft>) => void;
}

const MPBF_DESCRIPTIONS: Record<MpbfMethod, string> = {
  tandon_i: 'Conservative — 25% margin on (CA − stock). Used by banks for higher-risk borrowers.',
  tandon_ii: 'Standard — 25% margin on the WC gap (CA − OCL). Most common for WC limits > ₹2 cr.',
  nayak: 'SME-focused — bank funds 20% of projected turnover; promoter contributes 5%. Used for loans under ₹5 cr.',
};

export function HorizonStep({ draft, onChange }: Props) {
  return (
    <div className="space-y-4">
      <Card title="Projection horizon">
        <Field label="How many years to project forward?" required hint="Term loans usually need 5 years; pure WC limits get away with 3.">
          <div className="flex gap-2">
            {([3, 5] as ProjectionHorizon[]).map((years) => (
              <button
                key={years}
                type="button"
                onClick={() => onChange({ projectionHorizon: years })}
                className={cn(
                  'flex-1 px-4 py-3 rounded-lg border text-sm font-medium',
                  draft.projectionHorizon === years
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-500/30'
                    : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600',
                )}
              >
                {years} years
              </button>
            ))}
          </div>
        </Field>
      </Card>

      <Card title="MPBF method">
        <Field label="Which Maximum Permissible Bank Finance method does the bank prefer?" required>
          <div className="space-y-2">
            {(Object.keys(MPBF_METHOD_LABELS) as MpbfMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ mpbfMethod: m })}
                className={cn(
                  'w-full text-left px-4 py-3 rounded-lg border',
                  draft.mpbfMethod === m
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 ring-2 ring-emerald-500/30'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
                )}
              >
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{MPBF_METHOD_LABELS[m]}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{MPBF_DESCRIPTIONS[m]}</p>
              </button>
            ))}
          </div>
        </Field>
      </Card>
    </div>
  );
}

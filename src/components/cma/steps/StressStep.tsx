import { Card, Field, NumberInput } from '../../itr/shared/Inputs';
import type { CmaDraft, StressTest } from '../lib/uiModel';
import { cn } from '../../../lib/utils';

interface Props {
  draft: CmaDraft;
  onChange: (patch: Partial<CmaDraft>) => void;
}

export function StressStep({ draft, onChange }: Props) {
  const stress = draft.stress ?? { enabled: false, salesMissPct: 10 };
  const patch = (p: Partial<StressTest>) => onChange({ stress: { ...stress, ...p } });

  return (
    <Card title="Stress test">
      <Field
        label="Include stress-test scenario in the report?"
        hint="The bank's risk team uses this to assess DSCR resilience under a downside case. ~3 extra seconds to compute, surfaced as a separate sheet in the Excel export."
      >
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => patch({ enabled: true })}
            className={cn(
              'flex-1 px-4 py-3 rounded-lg border text-sm font-medium',
              stress.enabled
                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 ring-2 ring-emerald-500/30'
                : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300',
            )}
          >
            Enabled
          </button>
          <button
            type="button"
            onClick={() => patch({ enabled: false })}
            className={cn(
              'flex-1 px-4 py-3 rounded-lg border text-sm font-medium',
              !stress.enabled
                ? 'border-gray-400 bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 ring-2 ring-gray-400/30'
                : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300',
            )}
          >
            Disabled
          </button>
        </div>
      </Field>
      {stress.enabled && (
        <Field
          label="Sales miss %"
          hint="How much projected revenue should we stress downward? COGS scales proportionally on its variable component (80%); fixed costs stay flat."
        >
          <NumberInput
            value={stress.salesMissPct}
            onChange={(v) => patch({ salesMissPct: v ?? undefined })}
            placeholder="10"
            min={0}
            max={50}
          />
        </Field>
      )}
    </Card>
  );
}

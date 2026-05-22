import { Card, Field, Grid2, NumberInput } from '../../itr/shared/Inputs';
import type { CmaDraft, WorkingCapitalAssumption, WorkingCapitalModel } from '../lib/uiModel';
import { cn } from '../../../lib/utils';

interface Props {
  draft: CmaDraft;
  onChange: (patch: Partial<CmaDraft>) => void;
}

export function WorkingCapitalStep({ draft, onChange }: Props) {
  // WorkingCapitalAssumption requires `model` so we can't default
  // to an empty object — initialise with the cycle_days default.
  const wc: WorkingCapitalAssumption = draft.workingCapital ?? { model: 'cycle_days' };
  const setModel = (model: WorkingCapitalModel) => {
    onChange({ workingCapital: { ...wc, model } });
  };
  const patch = (p: Partial<WorkingCapitalAssumption>) => {
    onChange({ workingCapital: { ...wc, ...p, model: wc.model } });
  };

  return (
    <div className="space-y-4">
      <Card title="Working-capital model">
        <Field label="How should WC scale in projected years?" required>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setModel('cycle_days')}
              className={cn(
                'p-3 rounded-lg border text-left',
                wc.model === 'cycle_days'
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 ring-2 ring-emerald-500/30'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300',
              )}
            >
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Cycle days</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Inventory days, debtor days, creditor days</p>
            </button>
            <button
              type="button"
              onClick={() => setModel('percent_of_sales')}
              className={cn(
                'p-3 rounded-lg border text-left',
                wc.model === 'percent_of_sales'
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 ring-2 ring-emerald-500/30'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300',
              )}
            >
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">% of sales</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Single figure — typical for service businesses</p>
            </button>
          </div>
        </Field>
      </Card>

      {wc.model === 'cycle_days' && (
        <Card title="Cycle days">
          <Grid2>
            <Field label="Inventory days" hint="Closing inventory ÷ COGS × 365">
              <NumberInput value={wc.inventoryDays} onChange={(v) => patch({ inventoryDays: v })} placeholder="60" />
            </Field>
            <Field label="Debtor days" hint="Receivables ÷ revenue × 365">
              <NumberInput value={wc.debtorDays} onChange={(v) => patch({ debtorDays: v })} placeholder="45" />
            </Field>
            <Field label="Creditor days" hint="Creditors ÷ COGS × 365 (longer = more vendor funding)">
              <NumberInput value={wc.creditorDays} onChange={(v) => patch({ creditorDays: v })} placeholder="30" />
            </Field>
          </Grid2>
        </Card>
      )}

      {wc.model === 'percent_of_sales' && (
        <Card title="Working capital as % of sales">
          <Field label="WC as % of projected sales" hint="A typical SME WC need is 20–30% of annual sales">
            <NumberInput value={wc.wcAsPctOfSales} onChange={(v) => patch({ wcAsPctOfSales: v })} placeholder="25" />
          </Field>
        </Card>
      )}
    </div>
  );
}

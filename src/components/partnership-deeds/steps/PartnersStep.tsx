import { Plus, Trash2 } from 'lucide-react';
import { PartnershipDeedDraft, PartnerBlock } from '../lib/uiModel';
import { sumProfitShares } from '../lib/validation';
import { Card, Field, Grid2, NumberInput, PanInput, RupeeInput, TextInput } from '../../itr/shared/Inputs';
import { cn } from '../../../lib/utils';

interface Props {
  draft: PartnershipDeedDraft;
  onChange: (
    patch: Partial<PartnershipDeedDraft> | ((p: PartnershipDeedDraft) => PartnershipDeedDraft),
  ) => void;
}

const BLANK_PARTNER: PartnerBlock = {};

export function PartnersStep({ draft, onChange }: Props) {
  const partners = draft.partners ?? [];

  const setPartners = (next: PartnerBlock[]) => {
    onChange((prev) => ({ ...prev, partners: next }));
  };
  const patchPartner = (idx: number, patch: Partial<PartnerBlock>) => {
    setPartners(partners.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };
  const addPartner = () => setPartners([...partners, { ...BLANK_PARTNER }]);
  const removePartner = (idx: number) => setPartners(partners.filter((_, i) => i !== idx));

  const total = sumProfitShares(partners);
  const totalOk = Math.abs(total - 100) < 0.01;

  return (
    <div className="space-y-4">
      <Card
        title={`Partners (${partners.length})`}
        action={
          <button
            type="button"
            onClick={addPartner}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add partner
          </button>
        }
      >
        {partners.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
            No partners added yet. A partnership requires at least 2 partners.
          </p>
        )}
        <div className="space-y-4">
          {partners.map((p, idx) => (
            <div
              key={idx}
              className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 bg-gray-50/30 dark:bg-gray-900/30 space-y-3"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                  Partner #{idx + 1}
                </p>
                <button
                  type="button"
                  onClick={() => removePartner(idx)}
                  className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  title="Remove partner"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <Grid2>
                <Field label="Full name" required>
                  <TextInput
                    value={p.name}
                    onChange={(v) => patchPartner(idx, { name: v })}
                    placeholder="Mr / Ms / Mrs / Shri Ramesh Kumar"
                  />
                </Field>
                <Field label="PAN" required>
                  <PanInput
                    value={p.pan}
                    onChange={(v) => patchPartner(idx, { pan: v })}
                  />
                </Field>
              </Grid2>
              <Field label="Address" required>
                <TextInput
                  value={p.address}
                  onChange={(v) => patchPartner(idx, { address: v })}
                  placeholder="Full residential address with PIN"
                />
              </Field>
              <Grid2>
                <Field label="Age (years)" required>
                  <NumberInput
                    value={p.age}
                    onChange={(v) => patchPartner(idx, { age: v })}
                    placeholder="35"
                    min={18}
                  />
                </Field>
                <Field label="Capital contribution (Rs.)" required>
                  <RupeeInput
                    value={p.capitalContribution}
                    onChange={(v) => patchPartner(idx, { capitalContribution: v })}
                    placeholder="500000"
                  />
                </Field>
              </Grid2>
              <Field label="Profit share %" required hint="Across all partners must total 100%">
                <NumberInput
                  value={p.profitSharePct}
                  onChange={(v) => patchPartner(idx, { profitSharePct: v })}
                  placeholder="50"
                  min={0}
                  max={100}
                />
              </Field>
            </div>
          ))}
        </div>

        {partners.length > 0 && (
          <div
            className={cn(
              'mt-4 px-3 py-2 rounded-lg text-sm flex items-center justify-between',
              totalOk
                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300',
            )}
          >
            <span className="font-medium">Total profit share</span>
            <span className="font-semibold">{total.toFixed(2)}%</span>
          </div>
        )}
      </Card>
    </div>
  );
}

import { Plus, Trash2 } from 'lucide-react';
import { PartnershipDeedDraft, DissolutionBlock } from '../lib/uiModel';
import { Card, Field, Grid2, RupeeInput, TextInput } from '../../itr/shared/Inputs';

interface Props {
  draft: PartnershipDeedDraft;
  onChange: (
    patch: Partial<PartnershipDeedDraft> | ((p: PartnershipDeedDraft) => PartnershipDeedDraft),
  ) => void;
}

export function DissolutionStep({ draft, onChange }: Props) {
  const d = draft.dissolution ?? {};
  const dist = d.assetDistribution ?? [];

  const patch = (p: Partial<DissolutionBlock>) => {
    onChange((prev) => ({ ...prev, dissolution: { ...(prev.dissolution ?? {}), ...p } }));
  };
  const setDist = (next: NonNullable<DissolutionBlock['assetDistribution']>) =>
    patch({ assetDistribution: next });

  return (
    <div className="space-y-4">
      <Card title="Dissolution">
        <Field label="Dissolution effective date" required>
          <input
            type="date"
            value={d.dissolutionDate ?? ''}
            onChange={(e) => patch({ dissolutionDate: e.target.value })}
            className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-gray-900 dark:text-gray-100"
          />
        </Field>
        <Field label="Settlement plan summary" required hint="How accounts are settled per Section 48 IPA 1932">
          <textarea
            value={d.settlementPlan ?? ''}
            onChange={(e) => patch({ settlementPlan: e.target.value })}
            placeholder="The firm's assets shall first discharge external debts, then partner advances, then capital, with the residue divided in profit-sharing ratio."
            rows={4}
            className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-gray-900 dark:text-gray-100 placeholder-gray-400 resize-y"
          />
        </Field>
        <Field label="Liability discharge plan" required>
          <textarea
            value={d.liabilityDischargePlan ?? ''}
            onChange={(e) => patch({ liabilityDischargePlan: e.target.value })}
            placeholder="All outstanding statutory dues (GST, TDS, EPF, ESI) shall be cleared by 30 days from the dissolution date. External creditors shall be paid in full from realisations."
            rows={4}
            className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-gray-900 dark:text-gray-100 placeholder-gray-400 resize-y"
          />
        </Field>
      </Card>

      <Card
        title={`Asset distribution (${dist.length})`}
        action={
          <button
            type="button"
            onClick={() => setDist([...dist, { partnerName: '', assetDescription: '' }])}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add allocation
          </button>
        }
      >
        {dist.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-2">
            Optional — only required if specific assets are being allocated to specific partners.
          </p>
        )}
        <div className="space-y-3">
          {dist.map((row, idx) => (
            <div
              key={idx}
              className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 bg-gray-50/30 dark:bg-gray-900/30 space-y-3"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                  Allocation #{idx + 1}
                </p>
                <button
                  type="button"
                  onClick={() => setDist(dist.filter((_, i) => i !== idx))}
                  className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <Grid2>
                <Field label="Partner name">
                  <TextInput
                    value={row.partnerName}
                    onChange={(v) =>
                      setDist(dist.map((r, i) => (i === idx ? { ...r, partnerName: v } : r)))
                    }
                    placeholder="Existing partner from the list"
                  />
                </Field>
                <Field label="Settled value (Rs.)" hint="Optional book value">
                  <RupeeInput
                    value={row.amount}
                    onChange={(v) =>
                      setDist(dist.map((r, i) => (i === idx ? { ...r, amount: v } : r)))
                    }
                    placeholder="0"
                  />
                </Field>
              </Grid2>
              <Field label="Asset description" required>
                <TextInput
                  value={row.assetDescription}
                  onChange={(v) =>
                    setDist(dist.map((r, i) => (i === idx ? { ...r, assetDescription: v } : r)))
                  }
                  placeholder="e.g. delivery van bearing registration MH-12-AB-1234"
                />
              </Field>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

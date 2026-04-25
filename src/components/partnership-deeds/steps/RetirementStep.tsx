import { PartnershipDeedDraft, RetirementBlock } from '../lib/uiModel';
import { Card, Field, Grid2, RupeeInput } from '../../itr/shared/Inputs';
import { cn } from '../../../lib/utils';

interface Props {
  draft: PartnershipDeedDraft;
  onChange: (
    patch: Partial<PartnershipDeedDraft> | ((p: PartnershipDeedDraft) => PartnershipDeedDraft),
  ) => void;
}

export function RetirementStep({ draft, onChange }: Props) {
  const r = draft.retirement ?? {};
  const partners = draft.partners ?? [];

  const patch = (p: Partial<RetirementBlock>) => {
    onChange((prev) => ({ ...prev, retirement: { ...(prev.retirement ?? {}), ...p } }));
  };

  return (
    <div className="space-y-4">
      <Card title="Retiring partner">
        <div>
          <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
            Select the retiring partner <span className="text-red-500">*</span>
          </p>
          {partners.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">
              Add partners in the Partners step first.
            </p>
          ) : (
            <div className="space-y-2">
              {partners.map((p, idx) => {
                const name = p.name?.trim() ?? `Partner #${idx + 1}`;
                const isSelected = r.outgoingPartnerName === p.name && !!p.name;
                const disabled = !p.name?.trim();
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => p.name && patch({ outgoingPartnerName: p.name })}
                    disabled={disabled}
                    className={cn(
                      'w-full text-left p-3 rounded-xl border transition-colors',
                      isSelected
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 ring-2 ring-emerald-500/30'
                        : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700',
                      disabled && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{name}</p>
                    {p.profitSharePct !== undefined && (
                      <p className="text-[11px] text-gray-500 dark:text-gray-500">
                        Current share: {p.profitSharePct}%
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Card title="Settlement">
        <Field label="Effective date of retirement" required>
          <input
            type="date"
            value={r.effectiveDate ?? ''}
            onChange={(e) => patch({ effectiveDate: e.target.value })}
            className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-gray-900 dark:text-gray-100"
          />
        </Field>
        <Grid2>
          <Field label="Settlement amount (Rs.)" required>
            <RupeeInput
              value={r.settlementAmount}
              onChange={(v) => patch({ settlementAmount: v })}
              placeholder="500000"
            />
          </Field>
          <Field label="Settlement mode" required hint="Lump-sum, installments, etc.">
            <input
              type="text"
              value={r.settlementMode ?? ''}
              onChange={(e) => patch({ settlementMode: e.target.value })}
              placeholder="Lump-sum on the effective date"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-gray-900 dark:text-gray-100"
            />
          </Field>
        </Grid2>
      </Card>
    </div>
  );
}

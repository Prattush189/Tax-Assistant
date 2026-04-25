import { Plus, Trash2 } from 'lucide-react';
import { PartnershipDeedDraft, PartnerBlock, ReconstitutionBlock } from '../lib/uiModel';
import { Card, Field, Grid2, NumberInput, PanInput, RupeeInput, TextInput } from '../../itr/shared/Inputs';
import { cn } from '../../../lib/utils';

interface Props {
  draft: PartnershipDeedDraft;
  onChange: (
    patch: Partial<PartnershipDeedDraft> | ((p: PartnershipDeedDraft) => PartnershipDeedDraft),
  ) => void;
}

export function ReconstitutionStep({ draft, onChange }: Props) {
  const r = draft.reconstitution ?? {};
  const incoming = r.incomingPartners ?? [];
  const existing = draft.partners ?? [];

  const patchR = (p: Partial<ReconstitutionBlock>) => {
    onChange((prev) => ({ ...prev, reconstitution: { ...(prev.reconstitution ?? {}), ...p } }));
  };
  const setIncoming = (next: PartnerBlock[]) => patchR({ incomingPartners: next });
  const patchIncoming = (idx: number, p: Partial<PartnerBlock>) => {
    setIncoming(incoming.map((x, i) => (i === idx ? { ...x, ...p } : x)));
  };

  // Combined list for revised-shares editor: existing + incoming partners.
  const combinedNames = [
    ...existing.map((p, i) => p.name?.trim() || `Partner #${i + 1}`),
    ...incoming.map((p, i) => p.name?.trim() || `Incoming #${i + 1}`),
  ];
  const revised = r.revisedProfitShares ?? combinedNames.map((n) => ({ partnerName: n, sharePct: 0 }));

  const setShares = (next: { partnerName: string; sharePct: number }[]) => {
    patchR({ revisedProfitShares: next });
  };

  const totalShare = revised.reduce((acc, s) => acc + (s.sharePct ?? 0), 0);
  const totalOk = Math.abs(totalShare - 100) < 0.01;

  return (
    <div className="space-y-4">
      <Card
        title={`Incoming partners (${incoming.length})`}
        action={
          <button
            type="button"
            onClick={() => setIncoming([...incoming, {}])}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add incoming partner
          </button>
        }
      >
        {incoming.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
            Add at least one incoming partner.
          </p>
        )}
        <div className="space-y-3">
          {incoming.map((p, idx) => (
            <div
              key={idx}
              className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 bg-gray-50/30 dark:bg-gray-900/30 space-y-3"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                  Incoming #{idx + 1}
                </p>
                <button
                  type="button"
                  onClick={() => setIncoming(incoming.filter((_, i) => i !== idx))}
                  className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <Grid2>
                <Field label="Full name" required>
                  <TextInput
                    value={p.name}
                    onChange={(v) => patchIncoming(idx, { name: v })}
                    placeholder="Mr / Ms / Mrs / Shri Ramesh Kumar"
                  />
                </Field>
                <Field label="PAN" required>
                  <PanInput value={p.pan} onChange={(v) => patchIncoming(idx, { pan: v })} />
                </Field>
              </Grid2>
              <Field label="Address" required>
                <TextInput
                  value={p.address}
                  onChange={(v) => patchIncoming(idx, { address: v })}
                  placeholder="Full residential address"
                />
              </Field>
              <Grid2>
                <Field label="Age" required>
                  <NumberInput
                    value={p.age}
                    onChange={(v) => patchIncoming(idx, { age: v })}
                    placeholder="30"
                    min={18}
                  />
                </Field>
                <Field label="Capital contribution (Rs.)" required>
                  <RupeeInput
                    value={p.capitalContribution}
                    onChange={(v) => patchIncoming(idx, { capitalContribution: v })}
                    placeholder="200000"
                  />
                </Field>
              </Grid2>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Effective date & revised profit shares">
        <Field label="Effective date of reconstitution" required>
          <input
            type="date"
            value={r.effectiveDate ?? ''}
            onChange={(e) => patchR({ effectiveDate: e.target.value })}
            className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-gray-900 dark:text-gray-100"
          />
        </Field>

        <div>
          <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
            Revised profit shares (after reconstitution)
          </p>
          <div className="space-y-2">
            {combinedNames.map((name, idx) => {
              const row = revised.find((r) => r.partnerName === name) ?? { partnerName: name, sharePct: 0 };
              return (
                <div key={idx} className="flex items-center gap-3">
                  <span className="flex-1 text-sm text-gray-800 dark:text-gray-200 truncate">{name}</span>
                  <div className="w-32">
                    <NumberInput
                      value={row.sharePct}
                      onChange={(v) => {
                        const next = [...revised];
                        const i = next.findIndex((r) => r.partnerName === name);
                        if (i >= 0) next[i] = { partnerName: name, sharePct: v };
                        else next.push({ partnerName: name, sharePct: v });
                        setShares(next);
                      }}
                      placeholder="0"
                      min={0}
                      max={100}
                    />
                  </div>
                  <span className="text-xs text-gray-400 dark:text-gray-500">%</span>
                </div>
              );
            })}
          </div>
          <div
            className={cn(
              'mt-3 px-3 py-2 rounded-lg text-sm flex items-center justify-between',
              totalOk
                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300',
            )}
          >
            <span className="font-medium">Total</span>
            <span className="font-semibold">{totalShare.toFixed(2)}%</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

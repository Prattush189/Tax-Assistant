import { PartnershipDeedDraft, BankingAuthority } from '../lib/uiModel';
import { Card, Field, TextInput } from '../../itr/shared/Inputs';
import { cn } from '../../../lib/utils';

interface Props {
  draft: PartnershipDeedDraft;
  onChange: (
    patch: Partial<PartnershipDeedDraft> | ((p: PartnershipDeedDraft) => PartnershipDeedDraft),
  ) => void;
}

export function BankingStep({ draft, onChange }: Props) {
  const banking = draft.banking ?? {};
  const partners = draft.partners ?? [];
  const selected = new Set(banking.operatingPartnerNames ?? []);

  const patch = (p: Partial<BankingAuthority>) => {
    onChange((prev) => ({ ...prev, banking: { ...(prev.banking ?? {}), ...p } }));
  };

  const togglePartner = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    patch({ operatingPartnerNames: Array.from(next) });
  };

  return (
    <div className="space-y-4">
      <Card title="Banking authority">
        <Field label="Bank name" hint="Optional — many deeds keep this open">
          <TextInput
            value={banking.bankName}
            onChange={(v) => patch({ bankName: v })}
            placeholder="State Bank of India, MG Road branch"
          />
        </Field>

        <div>
          <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
            Account-operating partners <span className="text-red-500">*</span>
          </p>
          {partners.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">
              Add partners in the previous step first.
            </p>
          ) : (
            <div className="space-y-2">
              {partners.map((p, idx) => {
                const name = p.name?.trim() ?? `Partner #${idx + 1}`;
                const isSelected = p.name ? selected.has(p.name) : false;
                const disabled = !p.name?.trim();
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => p.name && togglePartner(p.name)}
                    disabled={disabled}
                    className={cn(
                      'w-full text-left p-3 rounded-xl border transition-colors flex items-center gap-3',
                      isSelected
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                        : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700',
                      disabled && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    <span
                      className={cn(
                        'w-5 h-5 rounded border-2 flex items-center justify-center shrink-0',
                        isSelected
                          ? 'border-emerald-500 bg-emerald-500'
                          : 'border-gray-300 dark:border-gray-600',
                      )}
                    >
                      {isSelected && <span className="text-white text-xs leading-none">✓</span>}
                    </span>
                    <span className="text-sm text-gray-800 dark:text-gray-200">{name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
            Signing mode <span className="text-red-500">*</span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => patch({ mode: 'singly' })}
              className={cn(
                'flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors',
                banking.mode === 'singly'
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                  : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400',
              )}
            >
              Singly (any one partner)
            </button>
            <button
              type="button"
              onClick={() => patch({ mode: 'jointly' })}
              className={cn(
                'flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors',
                banking.mode === 'jointly'
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                  : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400',
              )}
            >
              Jointly (all selected partners)
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

import { PartnershipDeedDraft, RemunerationBlock } from '../lib/uiModel';
import { Card, Field, NumberInput, RupeeInput, Select, Toggle } from '../../itr/shared/Inputs';
import { cn } from '../../../lib/utils';

interface Props {
  draft: PartnershipDeedDraft;
  onChange: (
    patch: Partial<PartnershipDeedDraft> | ((p: PartnershipDeedDraft) => PartnershipDeedDraft),
  ) => void;
}

export function RemunerationStep({ draft, onChange }: Props) {
  const rem = draft.remuneration ?? {};
  const partners = draft.partners ?? [];
  const partnerNames = partners
    .map((p) => p.name?.trim())
    .filter((n): n is string => !!n);

  const patch = (p: Partial<RemunerationBlock>) => {
    onChange((prev) => ({ ...prev, remuneration: { ...(prev.remuneration ?? {}), ...p } }));
  };

  const working = rem.workingPartnerNames ?? [];
  const toggleWorking = (name: string) => {
    const next = working.includes(name)
      ? working.filter((n) => n !== name)
      : [...working, name];
    patch({ workingPartnerNames: next });
  };

  const fixed = rem.fixedRemuneration ?? [];
  const fixedFor = (name: string) =>
    fixed.find((f) => f.partnerName === name)?.annualAmount;
  const setFixedFor = (name: string, amount: number | undefined) => {
    const others = fixed.filter((f) => f.partnerName !== name);
    const next = amount && amount > 0
      ? [...others, { partnerName: name, annualAmount: amount }]
      : others;
    patch({ fixedRemuneration: next });
  };

  return (
    <div className="space-y-4">
      {partnerNames.length === 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-700 dark:text-amber-300">
          Add partners on the Partners step first — working-partner remuneration is selected from the partner list.
        </div>
      )}

      {/* Interest on capital */}
      <Card title="Interest on partners' capital">
        <Toggle
          checked={!!rem.interestOnCapital}
          onChange={(v) => patch({ interestOnCapital: v })}
          label="Pay interest on partners' capital balances"
        />
        {rem.interestOnCapital && (
          <Field
            label="Interest rate (% per annum)"
            required
            hint="Section 40(b)(iv): deductible only up to 12% p.a. simple interest. Capped at 12%."
          >
            <NumberInput
              value={rem.interestRatePct}
              onChange={(v) => patch({ interestRatePct: v != null ? Math.min(12, Math.max(0, v)) : v })}
              placeholder="12"
              min={0}
              max={12}
            />
          </Field>
        )}
      </Card>

      {/* Partner remuneration / salary */}
      <Card title="Partner remuneration (salary)">
        <Toggle
          checked={!!rem.partnerSalary}
          onChange={(v) => patch({ partnerSalary: v, salaryMode: rem.salaryMode ?? 'as_per_40b' })}
          label="Pay remuneration to working partners"
        />
        {rem.partnerSalary && (
          <>
            <Field
              label="How is remuneration fixed?"
              hint="Only working partners may be paid under Section 40(b)(v); the firm-level deduction is capped by the statutory slab on book profit."
            >
              <Select
                value={rem.salaryMode ?? 'as_per_40b'}
                onChange={(v) => patch({ salaryMode: v })}
                options={[
                  { code: 'as_per_40b', label: 'As per Section 40(b) maximum slab' },
                  { code: 'fixed', label: 'Fixed annual amount per working partner' },
                ]}
              />
            </Field>

            <div>
              <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                Working partners {rem.salaryMode === 'fixed' ? '& their annual remuneration' : ''}
              </p>
              {partnerNames.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">No named partners yet.</p>
              ) : (
                <div className="space-y-2">
                  {partnerNames.map((name) => {
                    const selected = working.includes(name);
                    return (
                      <div
                        key={name}
                        className={cn(
                          'flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors',
                          selected
                            ? 'border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/60 dark:bg-emerald-900/15'
                            : 'border-gray-200 dark:border-gray-800',
                        )}
                      >
                        <label className="flex items-center gap-2 flex-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleWorking(name)}
                            className="w-4 h-4 accent-emerald-600"
                          />
                          <span className="text-sm text-gray-800 dark:text-gray-200">{name}</span>
                        </label>
                        {selected && rem.salaryMode === 'fixed' && (
                          <div className="w-44">
                            <RupeeInput
                              value={fixedFor(name)}
                              onChange={(v) => setFixedFor(name, v)}
                              placeholder="Annual amount"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </Card>

      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/30 p-4 text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
        <p className="font-semibold text-gray-700 dark:text-gray-300 mb-1">How these are used</p>
        <p>
          These figures drive <strong>Clause 9 — Drawings, Salary &amp; Interest on Capital</strong> of the
          generated deed. The deed authorises remuneration and interest within the Section 40(b) limits so the
          firm can claim the deduction. The generator also verifies the current statutory slab before drafting.
        </p>
      </div>
    </div>
  );
}

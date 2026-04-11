import { ItrWizardDraft, UiIncomeDeductionsITR1, UiSalaryEmployer, UiLTCG112A } from '../lib/uiModel';
import { Card, Field, Grid2, Grid3, TextInput, RupeeInput, Select, Accordion } from '../shared/Inputs';
import { Plus, Trash2 } from 'lucide-react';
import { LoadFromProfile } from '../../profile/shared/LoadFromProfile';
import { profileToItrIncome } from '../../profile/lib/prefillAdapters';

interface Props {
  draft: ItrWizardDraft;
  onChange: (patch: Partial<ItrWizardDraft> | ((p: ItrWizardDraft) => ItrWizardDraft)) => void;
}

const HP_TYPES: ReadonlyArray<{ code: 'S' | 'L' | 'D'; label: string }> = [
  { code: 'S', label: 'Self-occupied' },
  { code: 'L', label: 'Let-out' },
  { code: 'D', label: 'Deemed let-out' },
];

export function IncomeStep({ draft, onChange }: Props) {
  const inc: UiIncomeDeductionsITR1 = draft.ITR1_IncomeDeductions ?? {};
  const employers: UiSalaryEmployer[] = draft._salaryEmployers ?? [];
  const ltcg: UiLTCG112A = draft.LTCG112A ?? {};

  const patchInc = (patch: Partial<UiIncomeDeductionsITR1>) => {
    onChange((prev) => ({
      ...prev,
      ITR1_IncomeDeductions: { ...(prev.ITR1_IncomeDeductions ?? {}), ...patch },
    }));
  };
  const patchLtcg = (patch: Partial<UiLTCG112A>) => {
    onChange((prev) => ({
      ...prev,
      LTCG112A: { ...(prev.LTCG112A ?? {}), ...patch },
    }));
  };

  const addEmployer = () => {
    onChange((prev) => ({
      ...prev,
      _salaryEmployers: [
        ...(prev._salaryEmployers ?? []),
        { _uid: crypto.randomUUID(), employerName: '', tan: '', grossSalary: 0, tdsOnSalary: 0 },
      ],
    }));
  };
  const updateEmployer = (uid: string, patch: Partial<UiSalaryEmployer>) => {
    onChange((prev) => ({
      ...prev,
      _salaryEmployers: (prev._salaryEmployers ?? []).map((e) => (e._uid === uid ? { ...e, ...patch } : e)),
    }));
  };
  const removeEmployer = (uid: string) => {
    onChange((prev) => ({
      ...prev,
      _salaryEmployers: (prev._salaryEmployers ?? []).filter((e) => e._uid !== uid),
    }));
  };

  const ltcgOverLimit = (ltcg.LongCap112A ?? 0) > 125000;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <LoadFromProfile
          onPick={(profile) =>
            onChange((prev) => profileToItrIncome(profile, prev, prev.assessmentYear))
          }
          label="Load salary for this AY"
        />
      </div>
      {/* Salary */}
      <Card
        title="Salary income"
        action={
          <button
            onClick={addEmployer}
            className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add employer
          </button>
        }
      >
        {employers.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center">
            No employers yet. Click "Add employer" to add one.
          </p>
        ) : (
          <div className="space-y-3">
            {employers.map((e, i) => (
              <div key={e._uid} className="p-3 border border-gray-200 dark:border-gray-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">
                    Employer {i + 1}
                  </p>
                  <button
                    onClick={() => removeEmployer(e._uid)}
                    className="text-red-500 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Grid2>
                  <Field label="Employer name">
                    <TextInput
                      value={e.employerName}
                      onChange={(v) => updateEmployer(e._uid, { employerName: v })}
                      maxLength={75}
                    />
                  </Field>
                  <Field label="TAN">
                    <TextInput
                      value={e.tan}
                      onChange={(v) => updateEmployer(e._uid, { tan: v })}
                      maxLength={10}
                      uppercase
                    />
                  </Field>
                </Grid2>
                <Grid2>
                  <Field label="Gross salary">
                    <RupeeInput
                      value={e.grossSalary}
                      onChange={(v) => updateEmployer(e._uid, { grossSalary: v })}
                    />
                  </Field>
                  <Field label="TDS on salary">
                    <RupeeInput
                      value={e.tdsOnSalary}
                      onChange={(v) => updateEmployer(e._uid, { tdsOnSalary: v })}
                    />
                  </Field>
                </Grid2>
              </div>
            ))}
          </div>
        )}

        <Accordion title="Additional salary fields" subtitle="Perquisites · Profits in lieu · Standard deduction">
          <Grid2>
            <Field label="Perquisites (17(2))">
              <RupeeInput
                value={inc.PerquisitesValue}
                onChange={(v) => patchInc({ PerquisitesValue: v })}
              />
            </Field>
            <Field label="Profits in lieu (17(3))">
              <RupeeInput value={inc.ProfitsInSalary} onChange={(v) => patchInc({ ProfitsInSalary: v })} />
            </Field>
          </Grid2>
          <Grid2>
            <Field label="Standard deduction u/s 16(ia)" hint="New regime: ₹75,000 · Old: ₹50,000">
              <RupeeInput value={inc.DeductionUs16ia} onChange={(v) => patchInc({ DeductionUs16ia: v })} />
            </Field>
            <Field label="Professional tax u/s 16(iii)">
              <RupeeInput
                value={inc.ProfessionalTaxUs16iii}
                onChange={(v) => patchInc({ ProfessionalTaxUs16iii: v })}
              />
            </Field>
          </Grid2>
        </Accordion>
      </Card>

      {/* House Property */}
      <Card title="House property">
        <Grid3>
          <Field label="Type">
            <Select
              value={inc.TypeOfHP}
              onChange={(v) => patchInc({ TypeOfHP: v })}
              options={HP_TYPES}
              placeholder="Not applicable"
            />
          </Field>
          <Field label="Annual value / rent" hint="0 for self-occupied">
            <RupeeInput value={inc.AnnualValue} onChange={(v) => patchInc({ AnnualValue: v })} />
          </Field>
          <Field label="Interest on housing loan (24(b))" hint="Max ₹2L for self-occupied">
            <RupeeInput value={inc.InterestPayable} onChange={(v) => patchInc({ InterestPayable: v })} />
          </Field>
        </Grid3>
      </Card>

      {/* Other sources */}
      <Card title="Income from other sources">
        <Field label="Total income from other sources" hint="Savings interest, FD, dividends, family pension…">
          <RupeeInput value={inc.IncomeOthSrc} onChange={(v) => patchInc({ IncomeOthSrc: v })} />
        </Field>
      </Card>

      {/* LTCG 112A (optional) */}
      <Card title="LTCG u/s 112A (optional)">
        <p className="text-[11px] text-gray-500 dark:text-gray-500 mb-2">
          Long-term capital gains on listed equity shares/MF. ITR-1 allows up to ₹1.25L. Above that → use ITR-2.
        </p>
        <Grid3>
          <Field label="Sale consideration">
            <RupeeInput value={ltcg.TotSaleCnsdrn} onChange={(v) => patchLtcg({ TotSaleCnsdrn: v })} />
          </Field>
          <Field label="Cost of acquisition">
            <RupeeInput value={ltcg.TotCstAcqisn} onChange={(v) => patchLtcg({ TotCstAcqisn: v })} />
          </Field>
          <Field label="LTCG amount" error={ltcgOverLimit ? 'Exceeds ₹1.25L — use ITR-2' : undefined}>
            <RupeeInput value={ltcg.LongCap112A} onChange={(v) => patchLtcg({ LongCap112A: v })} />
          </Field>
        </Grid3>
      </Card>
    </div>
  );
}

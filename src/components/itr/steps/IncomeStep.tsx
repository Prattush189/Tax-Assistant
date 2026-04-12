import { useMemo } from 'react';
import { ItrWizardDraft, UiIncomeDeductionsITR1, UiSalaryEmployer, UiLTCG112A } from '../lib/uiModel';
import { Card, Field, Grid2, Grid3, TextInput, RupeeInput, Select, Accordion } from '../shared/Inputs';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
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
  const isNewRegime = draft.FilingStatus?.OptOutNewTaxRegime === 'N';

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

  // Auto-calculations
  const totalGrossSalary = useMemo(
    () => employers.reduce((acc, e) => acc + (Number(e.grossSalary) || 0), 0),
    [employers],
  );
  const totalTds = useMemo(
    () => employers.reduce((acc, e) => acc + (Number(e.tdsOnSalary) || 0), 0),
    [employers],
  );
  const stdDeductionLimit = isNewRegime ? 75000 : 50000;
  const autoStdDeduction = Math.min(stdDeductionLimit, totalGrossSalary + (inc.PerquisitesValue ?? 0) + (inc.ProfitsInSalary ?? 0));

  // HP auto: 30% std deduction for let-out/deemed
  const hpAnnual = inc.AnnualValue ?? 0;
  const hpIsLetOut = inc.TypeOfHP === 'L' || inc.TypeOfHP === 'D';
  const hpStdDed = hpIsLetOut ? Math.round(hpAnnual * 0.3) : 0;
  const hpIncome = hpAnnual - hpStdDed - (inc.InterestPayable ?? 0) + (inc.ArrearsUnrealizedRentRcvd ?? 0);

  // Family pension std deduction (u/s 57(iia)) — auto = min(15000, 1/3 of pension)
  const familyPension = inc.DeductionUs57iia ?? 0;

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

      {/* ── Salary ───────────────────────────────────────────────────────── */}
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
                    <TextInput value={e.employerName} onChange={(v) => updateEmployer(e._uid, { employerName: v })} maxLength={75} />
                  </Field>
                  <Field label="TAN">
                    <TextInput value={e.tan} onChange={(v) => updateEmployer(e._uid, { tan: v })} maxLength={10} uppercase />
                  </Field>
                </Grid2>
                <Grid2>
                  <Field label="Gross salary">
                    <RupeeInput value={e.grossSalary} onChange={(v) => updateEmployer(e._uid, { grossSalary: v })} />
                  </Field>
                  <Field label="TDS on salary">
                    <RupeeInput value={e.tdsOnSalary} onChange={(v) => updateEmployer(e._uid, { tdsOnSalary: v })} />
                  </Field>
                </Grid2>
              </div>
            ))}
            {employers.length > 0 && (
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 px-1">
                <span>Total gross: <strong className="text-gray-700 dark:text-gray-200">₹{totalGrossSalary.toLocaleString('en-IN')}</strong></span>
                <span>Total TDS: <strong className="text-gray-700 dark:text-gray-200">₹{totalTds.toLocaleString('en-IN')}</strong></span>
              </div>
            )}
          </div>
        )}

        <Accordion title="Additional salary fields" subtitle="Perquisites · Profits in lieu · Standard deduction">
          <Grid2>
            <Field label="Perquisites (17(2))">
              <RupeeInput value={inc.PerquisitesValue} onChange={(v) => patchInc({ PerquisitesValue: v })} />
            </Field>
            <Field label="Profits in lieu (17(3))">
              <RupeeInput value={inc.ProfitsInSalary} onChange={(v) => patchInc({ ProfitsInSalary: v })} />
            </Field>
          </Grid2>
          <Grid2>
            <Field label="Standard deduction u/s 16(ia)" hint={`${isNewRegime ? 'New' : 'Old'} regime: ₹${stdDeductionLimit.toLocaleString('en-IN')} (auto: ₹${autoStdDeduction.toLocaleString('en-IN')})`}>
              <RupeeInput value={inc.DeductionUs16ia} onChange={(v) => patchInc({ DeductionUs16ia: v })} />
            </Field>
            <Field label="Professional tax u/s 16(iii)" hint="Max ₹5,000">
              <RupeeInput value={inc.ProfessionalTaxUs16iii} onChange={(v) => patchInc({ ProfessionalTaxUs16iii: v })} />
            </Field>
          </Grid2>
          <Grid2>
            <Field label="Entertainment allowance u/s 16(ii)" hint="Max ₹5,000 (govt employees only)">
              <RupeeInput value={inc.EntertainmentAlw16ii} onChange={(v) => patchInc({ EntertainmentAlw16ii: v })} />
            </Field>
            <Field label="Income notified u/s 89A">
              <RupeeInput value={inc.IncomeNotified89A} onChange={(v) => patchInc({ IncomeNotified89A: v })} />
            </Field>
          </Grid2>
          {!inc.DeductionUs16ia && totalGrossSalary > 0 && (
            <button
              onClick={() => patchInc({ DeductionUs16ia: autoStdDeduction })}
              className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline mt-1"
            >
              Auto-fill standard deduction: ₹{autoStdDeduction.toLocaleString('en-IN')}
            </button>
          )}
        </Accordion>
      </Card>

      {/* ── House Property ────────────────────────────────────────────────── */}
      <Card title="House property">
        <Grid2>
          <Field label="Type">
            <Select value={inc.TypeOfHP} onChange={(v) => patchInc({ TypeOfHP: v })} options={HP_TYPES} placeholder="Not applicable" />
          </Field>
          {hpIsLetOut && (
            <Field label="Gross rent received">
              <RupeeInput value={inc.GrossRentReceived} onChange={(v) => patchInc({ GrossRentReceived: v })} />
            </Field>
          )}
        </Grid2>
        {inc.TypeOfHP && (
          <>
            <Grid3>
              {hpIsLetOut && (
                <Field label="Municipal taxes paid">
                  <RupeeInput value={inc.TaxPaidlocalAuth} onChange={(v) => patchInc({ TaxPaidlocalAuth: v })} />
                </Field>
              )}
              <Field label="Annual value" hint={hpIsLetOut ? 'Gross rent - municipal taxes' : '0 for self-occupied'}>
                <RupeeInput value={inc.AnnualValue} onChange={(v) => patchInc({ AnnualValue: v })} />
              </Field>
              <Field label="Interest on housing loan (24(b))" hint={inc.TypeOfHP === 'S' ? 'Max ₹2L for self-occupied' : 'No limit for let-out'}>
                <RupeeInput value={inc.InterestPayable} onChange={(v) => patchInc({ InterestPayable: v })} />
              </Field>
            </Grid3>
            {hpIsLetOut && (
              <Field label="Arrears / unrealized rent received">
                <RupeeInput value={inc.ArrearsUnrealizedRentRcvd} onChange={(v) => patchInc({ ArrearsUnrealizedRentRcvd: v })} />
              </Field>
            )}
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 px-1 pt-2 border-t border-gray-100 dark:border-gray-800">
              {hpIsLetOut && <span>30% std deduction: ₹{hpStdDed.toLocaleString('en-IN')}</span>}
              <span className="ml-auto">
                Income from HP: <strong className={hpIncome < 0 ? 'text-red-500' : 'text-gray-700 dark:text-gray-200'}>
                  {hpIncome < 0 ? '-' : ''}₹{Math.abs(hpIncome).toLocaleString('en-IN')}
                </strong>
              </span>
            </div>
          </>
        )}
      </Card>

      {/* ── Other Sources ─────────────────────────────────────────────────── */}
      <Card title="Income from other sources">
        <Grid2>
          <Field label="Savings bank interest" hint="Auto-populates 80TTA deduction">
            <RupeeInput value={inc.IncomeOthSrc} onChange={(v) => patchInc({ IncomeOthSrc: v })} />
          </Field>
          <Field label="Family pension std deduction (57(iia))" hint="Auto: min(₹15,000, 1/3 of pension). Max ₹25,000">
            <RupeeInput value={inc.DeductionUs57iia} onChange={(v) => patchInc({ DeductionUs57iia: v })} />
          </Field>
        </Grid2>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2 leading-relaxed">
          Enter total income from other sources (savings interest, FD interest, dividends, family pension, etc.)
          in the first field. If you receive family pension, enter the standard deduction (max ₹25,000) in the second field.
        </p>
      </Card>

      {/* ── LTCG 112A ─────────────────────────────────────────────────────── */}
      <Card title="LTCG u/s 112A (optional)">
        <p className="text-[11px] text-gray-500 dark:text-gray-500 mb-2">
          Long-term capital gains on listed equity shares/MF. ITR-1 allows up to ₹1.25L. Above that, use ITR-2.
        </p>
        {ltcgOverLimit && (
          <div className="flex items-start gap-2 p-2 mb-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-700 dark:text-red-300">
              LTCG exceeds ₹1,25,000. You must file ITR-2 instead of ITR-1.
            </p>
          </div>
        )}
        <Grid3>
          <Field label="Sale consideration">
            <RupeeInput value={ltcg.TotSaleCnsdrn} onChange={(v) => patchLtcg({ TotSaleCnsdrn: v })} />
          </Field>
          <Field label="Cost of acquisition">
            <RupeeInput value={ltcg.TotCstAcqisn} onChange={(v) => patchLtcg({ TotCstAcqisn: v })} />
          </Field>
          <Field label="LTCG amount">
            <RupeeInput value={ltcg.LongCap112A} onChange={(v) => patchLtcg({ LongCap112A: v })} />
          </Field>
        </Grid3>
        {(ltcg.TotSaleCnsdrn ?? 0) > 0 && (ltcg.TotCstAcqisn ?? 0) > 0 && !ltcg.LongCap112A && (
          <button
            onClick={() => patchLtcg({ LongCap112A: Math.max(0, (ltcg.TotSaleCnsdrn ?? 0) - (ltcg.TotCstAcqisn ?? 0)) })}
            className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline mt-1"
          >
            Auto-calculate LTCG: ₹{Math.max(0, (ltcg.TotSaleCnsdrn ?? 0) - (ltcg.TotCstAcqisn ?? 0)).toLocaleString('en-IN')}
          </button>
        )}
      </Card>
    </div>
  );
}

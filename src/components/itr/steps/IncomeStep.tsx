import { useMemo, useState } from 'react';
import {
  ItrWizardDraft, UiIncomeDeductionsITR1, UiSalaryEmployer, UiLTCG112A,
  UiAllwncExemptUs10Entry, EXEMPT_ALLOWANCE_NATURES,
  UiOtherSourceEntry, OTHER_SOURCE_NATURES,
  UiExemptIncomeEntry, EXEMPT_INCOME_NATURES,
} from '../lib/uiModel';
import { Card, Field, Grid2, Grid3, TextInput, RupeeInput, Select, Accordion } from '../shared/Inputs';
import { Plus, Trash2, AlertTriangle, FileUp } from 'lucide-react';
import { LoadFromProfile } from '../../profile/shared/LoadFromProfile';
import { profileToItrIncome } from '../../profile/lib/prefillAdapters';
import { Form16ImportDialog } from './Form16ImportDialog';
import { Form16ExtractedData } from '../../../services/api';

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

  // ── Exempt allowances u/s 10 ──────────────────────────────────────────
  const exemptAllowances: UiAllwncExemptUs10Entry[] = draft.AllwncExemptUs10?.AllwncExemptUs10Dtls ?? [];
  const patchExemptAllowances = (items: UiAllwncExemptUs10Entry[]) => {
    const total = items.reduce((a, e) => a + (e.SalOthAmount ?? 0), 0);
    onChange((prev) => ({ ...prev, AllwncExemptUs10: { AllwncExemptUs10Dtls: items, TotalAllwncExemptUs10: total } }));
  };

  // ── Other sources breakup ────────────────────────────────────────────
  const othSrcEntries: UiOtherSourceEntry[] = draft.OthersInc?.OthersIncDtlsOthSrc ?? [];
  const patchOthSrcEntries = (items: UiOtherSourceEntry[]) => {
    onChange((prev) => ({ ...prev, OthersInc: { OthersIncDtlsOthSrc: items } }));
  };

  // ── Exempt income reporting ──────────────────────────────────────────
  const exemptIncEntries: UiExemptIncomeEntry[] = draft.ExemptIncAgriOthUs10?.ExemptIncAgriOthUs10Dtls ?? [];
  const patchExemptInc = (items: UiExemptIncomeEntry[]) => {
    onChange((prev) => ({ ...prev, ExemptIncAgriOthUs10: { ExemptIncAgriOthUs10Dtls: items } }));
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

  const totalExemptAllowances = useMemo(
    () => exemptAllowances.reduce((a, e) => a + (e.SalOthAmount ?? 0), 0),
    [exemptAllowances],
  );
  const totalOthSrcBreakup = useMemo(
    () => othSrcEntries.reduce((a, e) => a + (e.OthSrcOthAmount ?? 0), 0),
    [othSrcEntries],
  );
  const totalExemptIncome = useMemo(
    () => exemptIncEntries.reduce((a, e) => a + (e.OthAmount ?? 0), 0),
    [exemptIncEntries],
  );

  // HP auto: 30% std deduction for let-out/deemed
  const hpAnnual = inc.AnnualValue ?? 0;
  const hpIsLetOut = inc.TypeOfHP === 'L' || inc.TypeOfHP === 'D';
  const hpStdDed = hpIsLetOut ? Math.round(hpAnnual * 0.3) : 0;
  const hpIncome = hpAnnual - hpStdDed - (inc.InterestPayable ?? 0) + (inc.ArrearsUnrealizedRentRcvd ?? 0);

  // Family pension std deduction (u/s 57(iia)) — auto = min(15000, 1/3 of pension)
  const familyPension = inc.DeductionUs57iia ?? 0;

  const ltcgOverLimit = (ltcg.LongCap112A ?? 0) > 125000;

  const [form16Open, setForm16Open] = useState(false);

  const handleForm16Import = (data: Form16ExtractedData) => {
    onChange((prev) => {
      const newEmployers: UiSalaryEmployer[] = [
        ...(prev._salaryEmployers ?? []),
      ];
      // Add an employer entry from Form 16 data
      if (data.grossSalary != null || data.employerName) {
        newEmployers.push({
          _uid: crypto.randomUUID(),
          employerName: data.employerName ?? '',
          tan: data.employerTAN ?? '',
          grossSalary: data.grossSalary ?? 0,
          tdsOnSalary: data.tdsOnSalary ?? 0,
        });
      }

      const incPatch: Partial<UiIncomeDeductionsITR1> = {
        ...(prev.ITR1_IncomeDeductions ?? {}),
      };
      if (data.perquisites17_2 != null) incPatch.PerquisitesValue = data.perquisites17_2;
      if (data.profitsInLieu17_3 != null) incPatch.ProfitsInSalary = data.profitsInLieu17_3;
      if (data.standardDeduction16ia != null) incPatch.DeductionUs16ia = data.standardDeduction16ia;
      if (data.professionalTax16iii != null) incPatch.ProfessionalTaxUs16iii = data.professionalTax16iii;

      // Deductions — patch into UsrDeductUndChapVIA within ITR1_IncomeDeductions
      const existingChapVIA = prev.ITR1_IncomeDeductions?.UsrDeductUndChapVIA ?? {};
      const chapViaPatch = { ...existingChapVIA };
      if (data.section80C != null) chapViaPatch.Section80C = data.section80C;
      if (data.section80D != null) chapViaPatch.Section80D = data.section80D;
      if (data.section80CCD1B != null) chapViaPatch.Section80CCD1B = data.section80CCD1B;
      if (data.section80E != null) chapViaPatch.Section80E = data.section80E;
      if (data.section80G != null) chapViaPatch.Section80G = data.section80G;
      if (data.section80TTA != null) chapViaPatch.Section80TTA = data.section80TTA;
      incPatch.UsrDeductUndChapVIA = chapViaPatch;

      return {
        ...prev,
        _salaryEmployers: newEmployers,
        ITR1_IncomeDeductions: incPatch as UiIncomeDeductionsITR1,
      };
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setForm16Open(true)}
          className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 px-3 py-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 transition-colors"
        >
          <FileUp className="w-3.5 h-3.5" />
          Import from Form 16
        </button>
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

        <Accordion
          title="Exempt allowances u/s 10"
          subtitle={totalExemptAllowances > 0 ? `Total: ₹${totalExemptAllowances.toLocaleString('en-IN')}` : 'HRA, LTA, gratuity, etc.'}
        >
          {exemptAllowances.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center">
              No exempt allowances added yet.
            </p>
          ) : (
            <div className="space-y-3">
              {exemptAllowances.map((entry, i) => (
                <div key={i} className="p-3 border border-gray-200 dark:border-gray-800 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">
                      Allowance {i + 1}
                    </p>
                    <button
                      onClick={() => patchExemptAllowances(exemptAllowances.filter((_, j) => j !== i))}
                      className="text-red-500 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <Grid2>
                    <Field label="Nature">
                      <Select
                        value={entry.SalNatureDesc}
                        onChange={(v) => {
                          const updated = [...exemptAllowances];
                          updated[i] = { ...entry, SalNatureDesc: v };
                          patchExemptAllowances(updated);
                        }}
                        options={EXEMPT_ALLOWANCE_NATURES}
                        placeholder="Select nature"
                      />
                    </Field>
                    <Field label="Amount">
                      <RupeeInput
                        value={entry.SalOthAmount}
                        onChange={(v) => {
                          const updated = [...exemptAllowances];
                          updated[i] = { ...entry, SalOthAmount: v };
                          patchExemptAllowances(updated);
                        }}
                      />
                    </Field>
                  </Grid2>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => patchExemptAllowances([...exemptAllowances, { SalNatureDesc: '', SalOthAmount: 0 }])}
            className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors mt-2"
          >
            <Plus className="w-3.5 h-3.5" />
            Add allowance
          </button>
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

        <Accordion
          title="Income breakup by nature (optional)"
          subtitle={totalOthSrcBreakup > 0 ? `Total: ₹${totalOthSrcBreakup.toLocaleString('en-IN')}` : 'Savings, FD, dividends, etc.'}
        >
          {othSrcEntries.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center">
              No breakup entries added yet.
            </p>
          ) : (
            <div className="space-y-3">
              {othSrcEntries.map((entry, i) => (
                <div key={i} className="p-3 border border-gray-200 dark:border-gray-800 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">
                      Source {i + 1}
                    </p>
                    <button
                      onClick={() => patchOthSrcEntries(othSrcEntries.filter((_, j) => j !== i))}
                      className="text-red-500 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <Grid2>
                    <Field label="Nature">
                      <Select
                        value={entry.OthSrcNatureDesc}
                        onChange={(v) => {
                          const updated = [...othSrcEntries];
                          updated[i] = { ...entry, OthSrcNatureDesc: v };
                          patchOthSrcEntries(updated);
                        }}
                        options={OTHER_SOURCE_NATURES}
                        placeholder="Select nature"
                      />
                    </Field>
                    <Field label="Amount">
                      <RupeeInput
                        value={entry.OthSrcOthAmount}
                        onChange={(v) => {
                          const updated = [...othSrcEntries];
                          updated[i] = { ...entry, OthSrcOthAmount: v };
                          patchOthSrcEntries(updated);
                        }}
                      />
                    </Field>
                  </Grid2>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => patchOthSrcEntries([...othSrcEntries, { OthSrcNatureDesc: '', OthSrcOthAmount: 0 }])}
            className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors mt-2"
          >
            <Plus className="w-3.5 h-3.5" />
            Add source
          </button>
        </Accordion>
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

      {/* ── Exempt Income ─────────────────────────────────────────────────── */}
      <Card title="Exempt income (for reporting only)">
        <p className="text-[11px] text-gray-500 dark:text-gray-500 mb-2">
          Reporting only — does not affect tax calculation. Agricultural income, insurance maturity, PF withdrawals, etc.
        </p>
        {exemptIncEntries.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center">
            No exempt income entries yet. Click "Add entry" to add one.
          </p>
        ) : (
          <div className="space-y-3">
            {exemptIncEntries.map((entry, i) => (
              <div key={i} className="p-3 border border-gray-200 dark:border-gray-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">
                    Entry {i + 1}
                  </p>
                  <button
                    onClick={() => patchExemptInc(exemptIncEntries.filter((_, j) => j !== i))}
                    className="text-red-500 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Grid2>
                  <Field label="Nature">
                    <Select
                      value={entry.NatureDesc}
                      onChange={(v) => {
                        const updated = [...exemptIncEntries];
                        updated[i] = { ...entry, NatureDesc: v };
                        patchExemptInc(updated);
                      }}
                      options={EXEMPT_INCOME_NATURES}
                      placeholder="Select nature"
                    />
                  </Field>
                  <Field label="Amount">
                    <RupeeInput
                      value={entry.OthAmount}
                      onChange={(v) => {
                        const updated = [...exemptIncEntries];
                        updated[i] = { ...entry, OthAmount: v };
                        patchExemptInc(updated);
                      }}
                    />
                  </Field>
                </Grid2>
              </div>
            ))}
            {exemptIncEntries.length > 0 && (
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 px-1">
                <span>Total exempt income: <strong className="text-gray-700 dark:text-gray-200">₹{totalExemptIncome.toLocaleString('en-IN')}</strong></span>
              </div>
            )}
          </div>
        )}
        <button
          onClick={() => patchExemptInc([...exemptIncEntries, { NatureDesc: '', OthAmount: 0 }])}
          className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors mt-2"
        >
          <Plus className="w-3.5 h-3.5" />
          Add entry
        </button>
      </Card>

      <Form16ImportDialog
        open={form16Open}
        onClose={() => setForm16Open(false)}
        onImported={handleForm16Import}
      />
    </div>
  );
}

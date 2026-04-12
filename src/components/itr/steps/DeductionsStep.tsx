import { useMemo, useCallback } from 'react';
import {
  ItrWizardDraft, UiChapVIA, sumChapVIAForRegime,
  UiSchedule80D, UiDonationEntry, UiSchedule80G,
  UiSchedule80CEntry, UiLoanEntry24B,
  UiSchedule80DD, UiSchedule80U,
} from '../lib/uiModel';
import { Card, Field, Grid2, RupeeInput, TextInput, PanInput, AadhaarInput, Select, Toggle, Accordion } from '../shared/Inputs';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { LoadFromProfile } from '../../profile/shared/LoadFromProfile';
import { profileToItrDeductions } from '../../profile/lib/prefillAdapters';

interface Props {
  draft: ItrWizardDraft;
  onChange: (patch: Partial<ItrWizardDraft> | ((p: ItrWizardDraft) => ItrWizardDraft)) => void;
}

const SECTION_LABELS: Array<{ key: keyof UiChapVIA; label: string; hint?: string; cap?: number }> = [
  { key: 'Section80C', label: '80C — LIC, PPF, ELSS, etc.', cap: 150000 },
  { key: 'Section80CCC', label: '80CCC — Pension fund' },
  { key: 'Section80CCDEmployeeOrSE', label: '80CCD(1) — NPS (self)' },
  { key: 'Section80CCD1B', label: '80CCD(1B) — NPS additional ₹50k', cap: 50000 },
  { key: 'Section80CCDEmployer', label: '80CCD(2) — NPS (employer)' },
  { key: 'Section80D', label: '80D — Health insurance' },
  { key: 'Section80DD', label: '80DD — Dependent disability' },
  { key: 'Section80DDB', label: '80DDB — Critical illness' },
  { key: 'Section80E', label: '80E — Education loan interest' },
  { key: 'Section80EE', label: '80EE — Home loan (first-time)' },
  { key: 'Section80EEA', label: '80EEA — Affordable housing' },
  { key: 'Section80EEB', label: '80EEB — EV loan interest' },
  { key: 'Section80G', label: '80G — Donations' },
  { key: 'Section80GG', label: '80GG — Rent paid (no HRA)' },
  { key: 'Section80GGA', label: '80GGA — Research donations' },
  { key: 'Section80GGC', label: '80GGC — Political party donations' },
  { key: 'Section80U', label: '80U — Self disability' },
  { key: 'Section80TTA', label: '80TTA — Savings interest', cap: 10000 },
  { key: 'Section80TTB', label: '80TTB — Senior citizen interest', cap: 50000 },
  { key: 'AnyOthSec80CCH', label: '80CCH — Agniveer Corpus Fund' },
];

/* ── Donation list helpers ──────────────────────────────────────────────── */

function emptyDonation(): UiDonationEntry {
  return { DoneeWithPanName: '', DoneePAN: '', ArnNbr: '', DonationAmtCash: 0, DonationAmtOtherMode: 0 };
}

function empty80CEntry(): UiSchedule80CEntry {
  return { IdentificationNo: '', Amount: 0 };
}

function emptyLoan24B(): UiLoanEntry24B {
  return { LoanTknFrom: 'B', BankOrInstnName: '', LoanAccNoOfBankOrInstnRefNo: '', InterestPayable: 0 };
}

const DEPENDENT_TYPES: ReadonlyArray<{ code: string; label: string }> = [
  { code: '1', label: 'Spouse' },
  { code: '2', label: 'Son' },
  { code: '3', label: 'Daughter' },
  { code: '4', label: 'Father' },
  { code: '5', label: 'Mother' },
  { code: '6', label: 'Brother' },
  { code: '7', label: 'Sister' },
];

const DISABILITY_NATURE: ReadonlyArray<{ code: string; label: string }> = [
  { code: '1', label: '40% to 80%' },
  { code: '2', label: 'More than 80%' },
];

const DISABILITY_TYPE: ReadonlyArray<{ code: string; label: string }> = [
  { code: '1', label: 'Disability' },
  { code: '2', label: 'Severe disability' },
];

const LOAN_FROM: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'B', label: 'Bank / Financial Institution' },
  { code: 'I', label: 'Other' },
];

/* ── Component ──────────────────────────────────────────────────────────── */

export function DeductionsStep({ draft, onChange }: Props) {
  const isNewRegime = draft.FilingStatus?.OptOutNewTaxRegime === 'N';
  const regime: 'new' | 'old' = isNewRegime ? 'new' : 'old';
  const chap = draft.ITR1_IncomeDeductions?.UsrDeductUndChapVIA ?? {};

  // Regime-aware total so stale old-regime values (hidden under new regime)
  // don't inflate the badge. Matches what computeDerivedTotals will compute.
  const total = useMemo(
    () => sumChapVIAForRegime(chap as UiChapVIA, regime),
    [chap, regime],
  );

  const patchChap = (patch: Partial<UiChapVIA>) => {
    onChange((prev) => {
      const inc = prev.ITR1_IncomeDeductions ?? {};
      const base = inc.UsrDeductUndChapVIA ?? {};
      const nextUsr: UiChapVIA = { ...base, ...patch };
      nextUsr.TotalChapVIADeductions = sumChapVIAForRegime(nextUsr, regime);
      return {
        ...prev,
        ITR1_IncomeDeductions: {
          ...inc,
          UsrDeductUndChapVIA: nextUsr,
          DeductUndChapVIA: { ...(inc.DeductUndChapVIA ?? {}), ...nextUsr },
        },
      };
    });
  };

  /* ── Schedule 80D helpers ─────────────────────────────────────────────── */

  const sch80D = draft.Schedule80D ?? {};

  const patch80D = useCallback((patch: Partial<UiSchedule80D>) => {
    onChange((prev) => ({ ...prev, Schedule80D: { ...(prev.Schedule80D ?? {}), ...patch } }));
  }, [onChange]);

  /* ── Schedule 80G helpers ─────────────────────────────────────────────── */

  const sch80G = draft.Schedule80G ?? {};

  const patch80GList = useCallback((
    field: keyof UiSchedule80G,
    updater: (arr: UiDonationEntry[]) => UiDonationEntry[],
  ) => {
    onChange((prev) => {
      const g = prev.Schedule80G ?? {};
      return { ...prev, Schedule80G: { ...g, [field]: updater([...(g[field] ?? [])]) } };
    });
  }, [onChange]);

  /* ── Schedule 80C helpers ─────────────────────────────────────────────── */

  const sch80C = draft.Schedule80C ?? {};
  const entries80C = sch80C.Schedule80CDtls ?? [];
  const total80C = entries80C.reduce((s, e) => s + (e.Amount ?? 0), 0);

  const patch80CList = useCallback((updater: (arr: UiSchedule80CEntry[]) => UiSchedule80CEntry[]) => {
    onChange((prev) => {
      const c = prev.Schedule80C ?? {};
      const next = updater([...(c.Schedule80CDtls ?? [])]);
      return { ...prev, Schedule80C: { ...c, Schedule80CDtls: next, TotalAmt: next.reduce((s, e) => s + (e.Amount ?? 0), 0) } };
    });
  }, [onChange]);

  /* ── Schedule Us24B helpers ───────────────────────────────────────────── */

  const schUs24B = draft.ScheduleUs24B ?? {};
  const entries24B = schUs24B.ScheduleUs24BDtls ?? [];

  const patch24BList = useCallback((updater: (arr: UiLoanEntry24B[]) => UiLoanEntry24B[]) => {
    onChange((prev) => {
      const u = prev.ScheduleUs24B ?? {};
      const next = updater([...(u.ScheduleUs24BDtls ?? [])]);
      return { ...prev, ScheduleUs24B: { ...u, ScheduleUs24BDtls: next, TotalInterestUs24B: next.reduce((s, e) => s + (e.InterestPayable ?? 0), 0) } };
    });
  }, [onChange]);

  /* ── Schedule 80DD / 80U helpers ──────────────────────────────────────── */

  const sch80DD = draft.Schedule80DD ?? {};
  const sch80U = draft.Schedule80U ?? {};

  const patch80DD = useCallback((patch: Partial<UiSchedule80DD>) => {
    onChange((prev) => ({ ...prev, Schedule80DD: { ...(prev.Schedule80DD ?? {}), ...patch } }));
  }, [onChange]);

  const patch80U = useCallback((patch: Partial<UiSchedule80U>) => {
    onChange((prev) => ({ ...prev, Schedule80U: { ...(prev.Schedule80U ?? {}), ...patch } }));
  }, [onChange]);

  const prefillButton = (
    <div className="flex justify-end">
      <LoadFromProfile
        onPick={(profile) =>
          onChange((prev) => profileToItrDeductions(profile, prev, prev.assessmentYear))
        }
        label="Load deductions for this AY"
      />
    </div>
  );

  if (isNewRegime) {
    return (
      <div className="space-y-4">
        {prefillButton}
        <Card title="Deductions locked — new regime">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Chapter VI-A deductions are disabled under the new tax regime.
              </p>
              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1 leading-relaxed">
                Only 80CCD(2) (NPS — employer), 80CCH (Agniveer Corpus), and 80JJAA are allowed.
                To claim broader deductions, switch to the old regime in the Filing Status step.
              </p>
            </div>
          </div>
          <Grid2>
            <Field label="80CCD(2) — NPS (employer)">
              <RupeeInput
                value={chap.Section80CCDEmployer}
                onChange={(v) => patchChap({ Section80CCDEmployer: v })}
              />
            </Field>
            <Field label="80CCH — Agniveer Corpus">
              <RupeeInput value={chap.AnyOthSec80CCH} onChange={(v) => patchChap({ AnyOthSec80CCH: v })} />
            </Field>
          </Grid2>
          <div className="pt-3 border-t border-gray-200 dark:border-gray-800 flex justify-between items-center">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Total VI-A</p>
            <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">₹{total.toLocaleString('en-IN')}</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {prefillButton}
      <Card title="Chapter VI-A — deductions">
        <Accordion title="80C — Investments & savings" subtitle={`Current: ₹${(chap.Section80C ?? 0).toLocaleString('en-IN')} · cap ₹1,50,000`} defaultOpen>
          <Field label="80C total" hint="Cap ₹1,50,000">
            <RupeeInput value={chap.Section80C} onChange={(v) => patchChap({ Section80C: v })} />
          </Field>

          {/* ── Schedule 80C — Investment breakup ──────────────────────── */}
          <Accordion title="Investment breakup" subtitle={`${entries80C.length} entries · ₹${total80C.toLocaleString('en-IN')} of ₹1,50,000`}>
            {/* Progress bar for 1.5L cap */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-gray-500">
                <span>Used: ₹{total80C.toLocaleString('en-IN')}</span>
                <span>Cap: ₹1,50,000</span>
              </div>
              <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${total80C > 150000 ? 'bg-red-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min((total80C / 150000) * 100, 100)}%` }}
                />
              </div>
            </div>

            {entries80C.length === 0 && (
              <p className="text-sm text-gray-400 dark:text-gray-500 py-2 text-center">
                No investment entries yet.
              </p>
            )}

            {entries80C.map((entry, i) => (
              <div key={i} className="p-3 border border-gray-200 dark:border-gray-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">Entry {i + 1}</p>
                  <button
                    onClick={() => patch80CList((arr) => { arr.splice(i, 1); return arr; })}
                    className="text-red-500 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Grid2>
                  <Field label="Identification number" hint="Policy / account number">
                    <TextInput
                      value={entry.IdentificationNo}
                      onChange={(v) => patch80CList((arr) => { arr[i] = { ...arr[i], IdentificationNo: v }; return arr; })}
                    />
                  </Field>
                  <Field label="Amount">
                    <RupeeInput
                      value={entry.Amount}
                      onChange={(v) => patch80CList((arr) => { arr[i] = { ...arr[i], Amount: v }; return arr; })}
                    />
                  </Field>
                </Grid2>
              </div>
            ))}

            <button
              onClick={() => patch80CList((arr) => [...arr, empty80CEntry()])}
              className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add investment entry
            </button>
          </Accordion>
        </Accordion>

        <Accordion title="80CCD — NPS" subtitle="Section 80CCD(1), 80CCD(1B), 80CCD(2)">
          <Grid2>
            <Field label="80CCD(1) — Self NPS">
              <RupeeInput
                value={chap.Section80CCDEmployeeOrSE}
                onChange={(v) => patchChap({ Section80CCDEmployeeOrSE: v })}
              />
            </Field>
            <Field label="80CCD(1B) — Additional ₹50k" hint="Over and above 80C">
              <RupeeInput value={chap.Section80CCD1B} onChange={(v) => patchChap({ Section80CCD1B: v })} />
            </Field>
          </Grid2>
          <Field label="80CCD(2) — Employer NPS">
            <RupeeInput
              value={chap.Section80CCDEmployer}
              onChange={(v) => patchChap({ Section80CCDEmployer: v })}
            />
          </Field>
        </Accordion>

        <Accordion title="80D / 80DD / 80U — Health & disability">
          <Grid2>
            <Field label="80D — Health insurance">
              <RupeeInput value={chap.Section80D} onChange={(v) => patchChap({ Section80D: v })} />
            </Field>
            <Field label="80DDB — Critical illness">
              <RupeeInput value={chap.Section80DDB} onChange={(v) => patchChap({ Section80DDB: v })} />
            </Field>
            <Field label="80DD — Dependent disability">
              <RupeeInput value={chap.Section80DD} onChange={(v) => patchChap({ Section80DD: v })} />
            </Field>
            <Field label="80U — Self disability">
              <RupeeInput value={chap.Section80U} onChange={(v) => patchChap({ Section80U: v })} />
            </Field>
          </Grid2>

          {/* ── Schedule 80D — Health insurance breakup ─────────────────── */}
          <Accordion title="Health insurance breakup" subtitle="Premium details for self/family and parents">
            <div className="space-y-4">
              <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Self / Family</p>
              <Toggle
                checked={sch80D.SeniorCitizenFlag === 'Y'}
                onChange={(v) => patch80D({ SeniorCitizenFlag: v ? 'Y' : 'N' })}
                label="Self is senior citizen (60+)"
              />
              <Grid2>
                <Field label="Health insurance premium" hint={`Max ₹${sch80D.SeniorCitizenFlag === 'Y' ? '50,000' : '25,000'}`}>
                  <RupeeInput
                    value={sch80D.HealthInsPremSlfFam}
                    onChange={(v) => patch80D({ HealthInsPremSlfFam: v })}
                  />
                </Field>
                <Field label="Preventive health check-up" hint="Max ₹5,000">
                  <RupeeInput
                    value={sch80D.PrevHlthChckUpSlfFam}
                    onChange={(v) => patch80D({ PrevHlthChckUpSlfFam: v })}
                  />
                </Field>
              </Grid2>
            </div>

            <div className="space-y-4 pt-3 border-t border-gray-200 dark:border-gray-800">
              <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Parents</p>
              <Toggle
                checked={sch80D.ParentsSeniorCitizenFlag === 'Y'}
                onChange={(v) => patch80D({ ParentsSeniorCitizenFlag: v ? 'Y' : 'N' })}
                label="Parent is senior citizen (60+)"
              />
              <Grid2>
                <Field label="Health insurance premium" hint={`Max ₹${sch80D.ParentsSeniorCitizenFlag === 'Y' ? '50,000' : '25,000'}`}>
                  <RupeeInput
                    value={sch80D.HlthInsPremParents}
                    onChange={(v) => patch80D({ HlthInsPremParents: v })}
                  />
                </Field>
                <Field label="Preventive health check-up" hint="Max ₹5,000">
                  <RupeeInput
                    value={sch80D.PrevHlthChckUpParents}
                    onChange={(v) => patch80D({ PrevHlthChckUpParents: v })}
                  />
                </Field>
              </Grid2>
            </div>
          </Accordion>

          {/* ── Schedule 80DD / 80U — Disability details ────────────────── */}
          <Accordion title="Disability details" subtitle="80DD dependent / 80U self disability schedule">
            <div className="space-y-4">
              <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">80DD — Dependent disability</p>
              <Grid2>
                <Field label="Nature of disability">
                  <Select
                    value={sch80DD.NatureOfDisability}
                    onChange={(v) => patch80DD({ NatureOfDisability: v as UiSchedule80DD['NatureOfDisability'] })}
                    options={DISABILITY_NATURE}
                    placeholder="Select severity..."
                  />
                </Field>
                <Field label="Type of disability">
                  <Select
                    value={sch80DD.TypeOfDisability}
                    onChange={(v) => patch80DD({ TypeOfDisability: v as UiSchedule80DD['TypeOfDisability'] })}
                    options={DISABILITY_TYPE}
                    placeholder="Select type..."
                  />
                </Field>
              </Grid2>
              <Grid2>
                <Field label="Dependent type">
                  <Select
                    value={sch80DD.DependentType}
                    onChange={(v) => patch80DD({ DependentType: v as UiSchedule80DD['DependentType'] })}
                    options={DEPENDENT_TYPES}
                    placeholder="Select relation..."
                  />
                </Field>
                <Field label="Dependent PAN">
                  <PanInput value={sch80DD.DependentPan} onChange={(v) => patch80DD({ DependentPan: v })} />
                </Field>
              </Grid2>
              <Grid2>
                <Field label="Dependent Aadhaar">
                  <AadhaarInput value={sch80DD.DependentAadhaar} onChange={(v) => patch80DD({ DependentAadhaar: v })} />
                </Field>
                <Field label="UDID number">
                  <TextInput value={sch80DD.UDIDNum} onChange={(v) => patch80DD({ UDIDNum: v })} placeholder="UDID..." />
                </Field>
              </Grid2>
            </div>

            <div className="space-y-4 pt-3 border-t border-gray-200 dark:border-gray-800">
              <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">80U — Self disability</p>
              <Grid2>
                <Field label="Nature of disability">
                  <Select
                    value={sch80U.NatureOfDisability}
                    onChange={(v) => patch80U({ NatureOfDisability: v as UiSchedule80U['NatureOfDisability'] })}
                    options={DISABILITY_NATURE}
                    placeholder="Select severity..."
                  />
                </Field>
                <Field label="Type of disability">
                  <Select
                    value={sch80U.TypeOfDisability}
                    onChange={(v) => patch80U({ TypeOfDisability: v as UiSchedule80U['TypeOfDisability'] })}
                    options={DISABILITY_TYPE}
                    placeholder="Select type..."
                  />
                </Field>
              </Grid2>
              <Grid2>
                <Field label="Form 10-IA acknowledgement number">
                  <TextInput value={sch80U.Form10IAAckNum} onChange={(v) => patch80U({ Form10IAAckNum: v })} placeholder="Form 10-IA ack..." />
                </Field>
                <Field label="UDID number">
                  <TextInput value={sch80U.UDIDNum} onChange={(v) => patch80U({ UDIDNum: v })} placeholder="UDID..." />
                </Field>
              </Grid2>
            </div>
          </Accordion>
        </Accordion>

        <Accordion title="80E / 80EE / 80EEA / 80EEB — Loan interest">
          <Grid2>
            <Field label="80E — Education loan">
              <RupeeInput value={chap.Section80E} onChange={(v) => patchChap({ Section80E: v })} />
            </Field>
            <Field label="80EE — Home loan (first-time)">
              <RupeeInput value={chap.Section80EE} onChange={(v) => patchChap({ Section80EE: v })} />
            </Field>
            <Field label="80EEA — Affordable housing">
              <RupeeInput value={chap.Section80EEA} onChange={(v) => patchChap({ Section80EEA: v })} />
            </Field>
            <Field label="80EEB — EV loan">
              <RupeeInput value={chap.Section80EEB} onChange={(v) => patchChap({ Section80EEB: v })} />
            </Field>
          </Grid2>

          {/* ── Schedule Us24B — Housing loan lender details ────────────── */}
          <Accordion title="Housing loan lender details" subtitle={`${entries24B.length} lender${entries24B.length !== 1 ? 's' : ''}`}>
            {entries24B.length === 0 && (
              <p className="text-sm text-gray-400 dark:text-gray-500 py-2 text-center">
                No lender entries yet.
              </p>
            )}

            {entries24B.map((entry, i) => (
              <div key={i} className="p-3 border border-gray-200 dark:border-gray-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">Lender {i + 1}</p>
                  <button
                    onClick={() => patch24BList((arr) => { arr.splice(i, 1); return arr; })}
                    className="text-red-500 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Grid2>
                  <Field label="Loan from">
                    <Select
                      value={entry.LoanTknFrom}
                      onChange={(v) => patch24BList((arr) => { arr[i] = { ...arr[i], LoanTknFrom: v as UiLoanEntry24B['LoanTknFrom'] }; return arr; })}
                      options={LOAN_FROM}
                      placeholder="Select..."
                    />
                  </Field>
                  <Field label="Lender name">
                    <TextInput
                      value={entry.BankOrInstnName}
                      onChange={(v) => patch24BList((arr) => { arr[i] = { ...arr[i], BankOrInstnName: v }; return arr; })}
                    />
                  </Field>
                </Grid2>
                <Grid2>
                  <Field label="Loan account number">
                    <TextInput
                      value={entry.LoanAccNoOfBankOrInstnRefNo}
                      onChange={(v) => patch24BList((arr) => { arr[i] = { ...arr[i], LoanAccNoOfBankOrInstnRefNo: v }; return arr; })}
                    />
                  </Field>
                  <Field label="Interest payable">
                    <RupeeInput
                      value={entry.InterestPayable}
                      onChange={(v) => patch24BList((arr) => { arr[i] = { ...arr[i], InterestPayable: v }; return arr; })}
                    />
                  </Field>
                </Grid2>
              </div>
            ))}

            <button
              onClick={() => patch24BList((arr) => [...arr, emptyLoan24B()])}
              className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add lender
            </button>
          </Accordion>
        </Accordion>

        <Accordion title="80G / 80GG / 80GGC — Donations & rent">
          <Grid2>
            <Field label="80G — Donations">
              <RupeeInput value={chap.Section80G} onChange={(v) => patchChap({ Section80G: v })} />
            </Field>
            <Field label="80GG — Rent paid (no HRA)">
              <RupeeInput value={chap.Section80GG} onChange={(v) => patchChap({ Section80GG: v })} />
            </Field>
            <Field label="80GGA — Research donations">
              <RupeeInput value={chap.Section80GGA} onChange={(v) => patchChap({ Section80GGA: v })} />
            </Field>
            <Field label="80GGC — Political party">
              <RupeeInput value={chap.Section80GGC} onChange={(v) => patchChap({ Section80GGC: v })} />
            </Field>
          </Grid2>

          {/* ── Schedule 80G — Donation details ─────────────────────────── */}
          <Accordion title="Donation details" subtitle="Line-item donation breakup for 80G">
            {renderDonationSection('100% deduction (PM Relief, National Defence, etc.)', 'Don100Percent', sch80G, patch80GList)}
            {renderDonationSection('50% deduction (no approval required)', 'Don50PercentNoApprReqd', sch80G, patch80GList)}
            {renderDonationSection('100% deduction (with approval)', 'Don100PercentApprReqd', sch80G, patch80GList)}
            {renderDonationSection('50% deduction (with approval)', 'Don50PercentApprReqd', sch80G, patch80GList)}
          </Accordion>
        </Accordion>

        <Accordion title="80TTA / 80TTB — Interest income">
          <Grid2>
            <Field label="80TTA — Savings interest" hint="Cap ₹10,000">
              <RupeeInput value={chap.Section80TTA} onChange={(v) => patchChap({ Section80TTA: v })} />
            </Field>
            <Field label="80TTB — Senior citizen" hint="Cap ₹50,000">
              <RupeeInput value={chap.Section80TTB} onChange={(v) => patchChap({ Section80TTB: v })} />
            </Field>
          </Grid2>
        </Accordion>

        <div className="pt-3 border-t border-gray-200 dark:border-gray-800 flex justify-between items-center">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Total VI-A</p>
          <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">₹{total.toLocaleString('en-IN')}</p>
        </div>
      </Card>
    </div>
  );
}

/* ── Donation section renderer ──────────────────────────────────────────── */

function renderDonationSection(
  label: string,
  field: keyof UiSchedule80G,
  sch80G: Partial<UiSchedule80G>,
  patch80GList: (field: keyof UiSchedule80G, updater: (arr: UiDonationEntry[]) => UiDonationEntry[]) => void,
) {
  const entries = sch80G[field] ?? [];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p>
        <button
          onClick={() => patch80GList(field, (arr) => [...arr, emptyDonation()])}
          className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {entries.length === 0 && (
        <p className="text-sm text-gray-400 dark:text-gray-500 py-1 text-center">No entries.</p>
      )}

      {entries.map((entry, i) => (
        <div key={i} className="p-3 border border-gray-200 dark:border-gray-800 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">Donation {i + 1}</p>
            <button
              onClick={() => patch80GList(field, (arr) => { arr.splice(i, 1); return arr; })}
              className="text-red-500 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <Grid2>
            <Field label="Donee name">
              <TextInput
                value={entry.DoneeWithPanName}
                onChange={(v) => patch80GList(field, (arr) => { arr[i] = { ...arr[i], DoneeWithPanName: v }; return arr; })}
              />
            </Field>
            <Field label="Donee PAN">
              <PanInput
                value={entry.DoneePAN}
                onChange={(v) => patch80GList(field, (arr) => { arr[i] = { ...arr[i], DoneePAN: v }; return arr; })}
              />
            </Field>
          </Grid2>
          <Grid2>
            <Field label="ARN">
              <TextInput
                value={entry.ArnNbr}
                onChange={(v) => patch80GList(field, (arr) => { arr[i] = { ...arr[i], ArnNbr: v }; return arr; })}
              />
            </Field>
            <Field label="Cash amount">
              <RupeeInput
                value={entry.DonationAmtCash}
                onChange={(v) => patch80GList(field, (arr) => { arr[i] = { ...arr[i], DonationAmtCash: v }; return arr; })}
              />
            </Field>
          </Grid2>
          <Field label="Other mode amount">
            <RupeeInput
              value={entry.DonationAmtOtherMode}
              onChange={(v) => patch80GList(field, (arr) => { arr[i] = { ...arr[i], DonationAmtOtherMode: v }; return arr; })}
            />
          </Field>
        </div>
      ))}
    </div>
  );
}

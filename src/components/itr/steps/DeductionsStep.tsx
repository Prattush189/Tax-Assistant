import { useMemo } from 'react';
import { ItrWizardDraft, UiChapVIA, sumChapVIAForRegime } from '../lib/uiModel';
import { Card, Field, Grid2, RupeeInput, Accordion } from '../shared/Inputs';
import { AlertTriangle } from 'lucide-react';
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

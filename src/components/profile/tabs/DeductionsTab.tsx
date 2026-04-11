import { ProfileManager } from '../../../hooks/useProfileManager';
import { PerAySlice, DeductionsSlice, ensureAySlice, emptyPerAy } from '../lib/profileModel';
import { Card, Field, Grid2, RupeeInput, Accordion } from '../../itr/shared/Inputs';

interface Props {
  manager: ProfileManager;
}

export function DeductionsTab({ manager }: Props) {
  const perAy = manager.currentProfile?.perAy ?? {};
  const slice: PerAySlice = ensureAySlice(perAy, manager.selectedAy);
  const d = slice.deductions ?? {};

  const patch = (p: Partial<DeductionsSlice>) => {
    const next: PerAySlice = { ...(slice ?? emptyPerAy()), deductions: { ...d, ...p } };
    manager.updatePerAy(next as unknown as Record<string, unknown>);
  };

  const total = (Object.values(d) as Array<number | undefined>)
    .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v))
    .reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <Card title={`Chapter VI-A deductions · AY ${manager.selectedAy}`}>
        <Accordion title="80C — Investments & savings" subtitle={`₹${(d.section80C ?? 0).toLocaleString('en-IN')} · cap ₹1,50,000`} defaultOpen>
          <Field label="80C total" hint="Cap ₹1,50,000">
            <RupeeInput value={d.section80C} onChange={(v) => patch({ section80C: v })} />
          </Field>
        </Accordion>
        <Accordion title="80CCD — NPS">
          <Grid2>
            <Field label="80CCD(1) — Self NPS">
              <RupeeInput
                value={d.section80CCDEmployeeOrSE}
                onChange={(v) => patch({ section80CCDEmployeeOrSE: v })}
              />
            </Field>
            <Field label="80CCD(1B) — Additional ₹50k">
              <RupeeInput
                value={d.section80CCD1B}
                onChange={(v) => patch({ section80CCD1B: v })}
              />
            </Field>
          </Grid2>
          <Field label="80CCD(2) — Employer NPS">
            <RupeeInput
              value={d.section80CCDEmployer}
              onChange={(v) => patch({ section80CCDEmployer: v })}
            />
          </Field>
        </Accordion>
        <Accordion title="80D / 80DD / 80U — Health & disability">
          <Grid2>
            <Field label="80D — Health insurance">
              <RupeeInput value={d.section80D} onChange={(v) => patch({ section80D: v })} />
            </Field>
            <Field label="80DDB — Critical illness">
              <RupeeInput value={d.section80DDB} onChange={(v) => patch({ section80DDB: v })} />
            </Field>
            <Field label="80DD — Dependent disability">
              <RupeeInput value={d.section80DD} onChange={(v) => patch({ section80DD: v })} />
            </Field>
            <Field label="80U — Self disability">
              <RupeeInput value={d.section80U} onChange={(v) => patch({ section80U: v })} />
            </Field>
          </Grid2>
        </Accordion>
        <Accordion title="80E / 80EE / 80EEA / 80EEB — Loan interest">
          <Grid2>
            <Field label="80E — Education loan">
              <RupeeInput value={d.section80E} onChange={(v) => patch({ section80E: v })} />
            </Field>
            <Field label="80EE — Home loan (first-time)">
              <RupeeInput value={d.section80EE} onChange={(v) => patch({ section80EE: v })} />
            </Field>
            <Field label="80EEA — Affordable housing">
              <RupeeInput value={d.section80EEA} onChange={(v) => patch({ section80EEA: v })} />
            </Field>
            <Field label="80EEB — EV loan">
              <RupeeInput value={d.section80EEB} onChange={(v) => patch({ section80EEB: v })} />
            </Field>
          </Grid2>
        </Accordion>
        <Accordion title="80G / 80GG / 80GGC — Donations & rent">
          <Grid2>
            <Field label="80G — Donations">
              <RupeeInput value={d.section80G} onChange={(v) => patch({ section80G: v })} />
            </Field>
            <Field label="80GG — Rent paid (no HRA)">
              <RupeeInput value={d.section80GG} onChange={(v) => patch({ section80GG: v })} />
            </Field>
            <Field label="80GGA — Research donations">
              <RupeeInput value={d.section80GGA} onChange={(v) => patch({ section80GGA: v })} />
            </Field>
            <Field label="80GGC — Political party">
              <RupeeInput value={d.section80GGC} onChange={(v) => patch({ section80GGC: v })} />
            </Field>
          </Grid2>
        </Accordion>
        <Accordion title="80TTA / 80TTB — Interest income">
          <Grid2>
            <Field label="80TTA — Savings interest" hint="Cap ₹10,000">
              <RupeeInput value={d.section80TTA} onChange={(v) => patch({ section80TTA: v })} />
            </Field>
            <Field label="80TTB — Senior citizen" hint="Cap ₹50,000">
              <RupeeInput value={d.section80TTB} onChange={(v) => patch({ section80TTB: v })} />
            </Field>
          </Grid2>
        </Accordion>
        <div className="pt-3 border-t border-gray-200 dark:border-gray-800 flex justify-between items-center">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Total VI-A</p>
          <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
            ₹{total.toLocaleString('en-IN')}
          </p>
        </div>
      </Card>
    </div>
  );
}

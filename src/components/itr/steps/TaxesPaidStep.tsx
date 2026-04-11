import { ItrWizardDraft, UiTaxesPaid } from '../lib/uiModel';
import { Card, Field, Grid2, RupeeInput } from '../shared/Inputs';

interface Props {
  draft: ItrWizardDraft;
  onChange: (patch: Partial<ItrWizardDraft> | ((p: ItrWizardDraft) => ItrWizardDraft)) => void;
}

export function TaxesPaidStep({ draft, onChange }: Props) {
  const taxes: UiTaxesPaid = draft.TaxPaid?.TaxesPaid ?? {};

  const patchTaxes = (patch: Partial<UiTaxesPaid>) => {
    onChange((prev) => {
      const tp = prev.TaxPaid ?? {};
      const base = tp.TaxesPaid ?? {};
      const next = { ...base, ...patch };
      next.TotalTaxesPaid =
        (Number(next.AdvanceTax) || 0) +
        (Number(next.TDS) || 0) +
        (Number(next.TCS) || 0) +
        (Number(next.SelfAssessmentTax) || 0);
      return {
        ...prev,
        TaxPaid: { ...tp, TaxesPaid: next, BalTaxPayable: tp.BalTaxPayable ?? 0 },
      };
    });
  };

  const total = (Number(taxes.AdvanceTax) || 0) + (Number(taxes.TDS) || 0) + (Number(taxes.TCS) || 0) + (Number(taxes.SelfAssessmentTax) || 0);

  return (
    <div className="space-y-4">
      <Card title="Taxes paid summary">
        <p className="text-[11px] text-gray-500 dark:text-gray-500 mb-3 leading-relaxed">
          TDS on salary is auto-filled from the employers you added in the Income step. You can override the
          total here if needed. For the full TDS/TCS/advance-tax schedule, use the Common Utility after
          export — we only capture the aggregate in this step.
        </p>
        <Grid2>
          <Field label="TDS (salary + other)" hint="Sum of TDS from salary + TDSonOthThanSals">
            <RupeeInput value={taxes.TDS} onChange={(v) => patchTaxes({ TDS: v })} />
          </Field>
          <Field label="TCS">
            <RupeeInput value={taxes.TCS} onChange={(v) => patchTaxes({ TCS: v })} />
          </Field>
          <Field label="Advance tax">
            <RupeeInput value={taxes.AdvanceTax} onChange={(v) => patchTaxes({ AdvanceTax: v })} />
          </Field>
          <Field label="Self-assessment tax">
            <RupeeInput
              value={taxes.SelfAssessmentTax}
              onChange={(v) => patchTaxes({ SelfAssessmentTax: v })}
            />
          </Field>
        </Grid2>
        <div className="pt-3 border-t border-gray-200 dark:border-gray-800 flex justify-between items-center">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Total taxes paid</p>
          <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">₹{total.toLocaleString('en-IN')}</p>
        </div>
      </Card>
    </div>
  );
}

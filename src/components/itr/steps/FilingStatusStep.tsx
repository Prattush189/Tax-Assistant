import { ItrWizardDraft, UiFilingStatus } from '../lib/uiModel';
import { Card, Field, Grid2, Grid3, TextInput, Select, Toggle } from '../shared/Inputs';

interface Props {
  draft: ItrWizardDraft;
  onChange: (patch: Partial<ItrWizardDraft> | ((p: ItrWizardDraft) => ItrWizardDraft)) => void;
}

// CBDT ReturnFileSec codes
const RETURN_SECTIONS: ReadonlyArray<{
  code: string;
  label: string;
  numericCode: UiFilingStatus['ReturnFileSec'];
}> = [
  { code: '11', label: '139(1) — On or before due date', numericCode: 11 },
  { code: '12', label: '139(4) — Belated (after due date)', numericCode: 12 },
  { code: '17', label: '139(5) — Revised return', numericCode: 17 },
  { code: '13', label: '142(1)', numericCode: 13 },
  { code: '14', label: '148', numericCode: 14 },
  { code: '16', label: '153C', numericCode: 16 },
  { code: '18', label: '139(9) — Defective', numericCode: 18 },
  { code: '20', label: '119(2)(b) — Condonation', numericCode: 20 },
];

export function FilingStatusStep({ draft, onChange }: Props) {
  const fs = draft.FilingStatus ?? {};

  const patchFiling = (patch: Partial<UiFilingStatus>) => {
    onChange((prev) => ({
      ...prev,
      FilingStatus: { ...(prev.FilingStatus ?? {}), ...patch },
    }));
  };

  const isNewRegime = fs.OptOutNewTaxRegime === 'N';
  const isRevisedOrBelated = fs.ReturnFileSec === 12 || fs.ReturnFileSec === 17;

  return (
    <div className="space-y-4">
      <Card title="Return type">
        <Grid2>
          <Field label="Section filed under" required>
            <Select
              value={fs.ReturnFileSec ? String(fs.ReturnFileSec) : undefined}
              onChange={(v) =>
                patchFiling({ ReturnFileSec: Number(v) as UiFilingStatus['ReturnFileSec'] })
              }
              options={RETURN_SECTIONS.map((r) => ({ code: r.code, label: r.label }))}
            />
          </Field>
          <Field label="Filing due date" required hint="YYYY-MM-DD · default 2025-07-31 for AY 2025-26">
            <TextInput
              value={fs.ItrFilingDueDate}
              onChange={(v) => patchFiling({ ItrFilingDueDate: v })}
              placeholder="2025-07-31"
            />
          </Field>
        </Grid2>
        {isRevisedOrBelated && (
          <Grid2>
            <Field label="Original ack no" hint="Required for revised/belated">
              <TextInput value={fs.ReceiptNo} onChange={(v) => patchFiling({ ReceiptNo: v })} />
            </Field>
            <Field label="Original filing date" hint="YYYY-MM-DD">
              <TextInput
                value={fs.OrigRetFiledDate}
                onChange={(v) => patchFiling({ OrigRetFiledDate: v })}
                placeholder="2025-07-15"
              />
            </Field>
          </Grid2>
        )}
      </Card>

      <Card title="Tax regime">
        <div className="p-3 rounded-xl bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-900/40">
          <Toggle
            checked={isNewRegime}
            onChange={(checked) => patchFiling({ OptOutNewTaxRegime: checked ? 'N' : 'Y' })}
            label={isNewRegime ? 'New regime (default)' : 'Old regime (opting out of new)'}
          />
          <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-2 leading-relaxed">
            {isNewRegime
              ? 'New regime: most Chapter VI-A deductions are disabled. Standard deduction ₹75,000.'
              : 'Old regime: full Chapter VI-A deductions available. Standard deduction ₹50,000.'}
          </p>
        </div>
      </Card>
    </div>
  );
}

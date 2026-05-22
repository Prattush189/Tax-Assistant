import { Card, Field, Grid2, TextInput } from '../../itr/shared/Inputs';
import type { CmaDraft, FirmInfo } from '../lib/uiModel';

interface Props {
  draft: CmaDraft;
  onChange: (patch: Partial<CmaDraft>) => void;
}

const STATE_OPTIONS = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Chandigarh', 'Jammu and Kashmir', 'Ladakh', 'Puducherry',
];

export function FirmInfoStep({ draft, onChange }: Props) {
  const firm = draft.firm ?? {};
  const patch = (p: Partial<FirmInfo>) => onChange({ firm: { ...firm, ...p } });

  return (
    <Card title="About the firm">
      <Grid2>
        <Field label="Firm name" required>
          <TextInput
            value={firm.firmName}
            onChange={(v) => patch({ firmName: v })}
            placeholder="Acme Industries Pvt Ltd"
          />
        </Field>
        <Field label="GSTIN" hint="Optional — printed on the cover sheet">
          <TextInput
            value={firm.gstin}
            onChange={(v) => patch({ gstin: v?.toUpperCase() })}
            placeholder="27AAAAA0000A1Z5"
          />
        </Field>
      </Grid2>
      <Field label="Nature of business" required hint="One-line description for the bank">
        <TextInput
          value={firm.businessNature}
          onChange={(v) => patch({ businessNature: v })}
          placeholder="Manufacturing of auto components"
        />
      </Field>
      <Grid2>
        <Field label="State" required>
          <select
            value={firm.state ?? ''}
            onChange={(e) => patch({ state: e.target.value })}
            className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 text-gray-900 dark:text-gray-100"
          >
            <option value="">— Select state —</option>
            {STATE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Application context" hint="What is this CMA for?">
          <TextInput
            value={firm.applicationContext}
            onChange={(v) => patch({ applicationContext: v })}
            placeholder="WC limit enhancement + new term loan"
          />
        </Field>
      </Grid2>
    </Card>
  );
}

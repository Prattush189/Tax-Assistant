import { PartnershipDeedDraft, RentAgreementBlock } from '../lib/uiModel';
import { INDIAN_STATES } from '../lib/states';
import { Card, Field, Grid2, NumberInput, PanInput, RupeeInput, Select, TextInput } from '../../itr/shared/Inputs';

interface Props {
  draft: PartnershipDeedDraft;
  onChange: (
    patch: Partial<PartnershipDeedDraft> | ((p: PartnershipDeedDraft) => PartnershipDeedDraft),
  ) => void;
}

const stateInputCls =
  'w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-gray-900 dark:text-gray-100';

export function RentAgreementStep({ draft, onChange }: Props) {
  const r = draft.rentAgreement ?? {};
  const patch = (p: Partial<RentAgreementBlock>) => {
    onChange((prev) => ({ ...prev, rentAgreement: { ...(prev.rentAgreement ?? {}), ...p } }));
  };

  return (
    <div className="space-y-4">
      <Card title="Landlord (Lessor)">
        <Field label="Landlord name" required>
          <TextInput value={r.landlordName} onChange={(v) => patch({ landlordName: v })} placeholder="Mr / Ms / Mrs / Shri full name" />
        </Field>
        <Field label="Landlord address" hint="Full residential / registered address with PIN">
          <TextInput value={r.landlordAddress} onChange={(v) => patch({ landlordAddress: v })} placeholder="Address with PIN" />
        </Field>
        <Field label="Landlord PAN" hint="Recommended where annual rent exceeds Rs. 1,00,000">
          <PanInput value={r.landlordPan} onChange={(v) => patch({ landlordPan: v })} />
        </Field>
      </Card>

      <Card title="Tenant (Lessee)">
        <Field label="Tenant name" required>
          <TextInput value={r.tenantName} onChange={(v) => patch({ tenantName: v })} placeholder="Mr / Ms / Mrs / Shri full name" />
        </Field>
        <Field label="Tenant address" hint="Permanent / current address with PIN">
          <TextInput value={r.tenantAddress} onChange={(v) => patch({ tenantAddress: v })} placeholder="Address with PIN" />
        </Field>
        <Field label="Tenant PAN">
          <PanInput value={r.tenantPan} onChange={(v) => patch({ tenantPan: v })} />
        </Field>
      </Card>

      <Card title="Property & terms">
        <Field label="Property address (let premises)" required>
          <TextInput value={r.propertyAddress} onChange={(v) => patch({ propertyAddress: v })} placeholder="Flat 4B, Sunrise Heights, MG Road, Mumbai 400076" />
        </Field>
        <Grid2>
          <Field label="State" required hint="Stamp duty + jurisdiction are looked up from this">
            <select value={r.state ?? ''} onChange={(e) => patch({ state: e.target.value })} className={stateInputCls}>
              <option value="">Select state…</option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Purpose">
            <Select
              value={r.purpose}
              onChange={(v) => patch({ purpose: v })}
              options={[
                { code: 'residential', label: 'Residential' },
                { code: 'commercial', label: 'Commercial' },
              ]}
              placeholder="Select purpose…"
            />
          </Field>
        </Grid2>
        <Grid2>
          <Field label="Monthly rent (Rs.)" required>
            <RupeeInput value={r.monthlyRent} onChange={(v) => patch({ monthlyRent: v })} placeholder="25000" />
          </Field>
          <Field label="Security deposit (Rs.)">
            <RupeeInput value={r.securityDeposit} onChange={(v) => patch({ securityDeposit: v })} placeholder="100000" />
          </Field>
        </Grid2>
        <Grid2>
          <Field label="Lease start date" required>
            <input
              type="date"
              value={r.startDate ?? ''}
              onChange={(e) => patch({ startDate: e.target.value })}
              className={stateInputCls}
            />
          </Field>
          <Field label="Duration (months)" required hint="Often 11 months to avoid compulsory registration">
            <NumberInput value={r.durationMonths} onChange={(v) => patch({ durationMonths: v })} placeholder="11" min={1} />
          </Field>
        </Grid2>
        <Grid2>
          <Field label="Rent due day of month" hint="e.g. 5 = rent payable by the 5th">
            <NumberInput value={r.rentDueDay} onChange={(v) => patch({ rentDueDay: v })} placeholder="5" min={1} max={31} />
          </Field>
          <Field label="Annual rent escalation (%)" hint="Typical 5–10% per renewal year">
            <NumberInput value={r.escalationPct} onChange={(v) => patch({ escalationPct: v })} placeholder="10" min={0} max={100} />
          </Field>
        </Grid2>
        <Grid2>
          <Field label="Notice period (months)" hint="For early termination by either party">
            <NumberInput value={r.noticePeriodMonths} onChange={(v) => patch({ noticePeriodMonths: v })} placeholder="1" min={0} />
          </Field>
          <Field label="Maintenance & minor repairs by">
            <Select
              value={r.maintenanceBy}
              onChange={(v) => patch({ maintenanceBy: v })}
              options={[
                { code: 'tenant', label: 'Tenant' },
                { code: 'landlord', label: 'Landlord' },
              ]}
              placeholder="Select…"
            />
          </Field>
        </Grid2>
        <Field label="Furnishing / fixtures" hint="Furnished / semi-furnished / unfurnished and any inventory notes">
          <TextInput value={r.furnishing} onChange={(v) => patch({ furnishing: v })} placeholder="Semi-furnished: 2 ACs, modular kitchen, wardrobes" />
        </Field>
      </Card>
    </div>
  );
}

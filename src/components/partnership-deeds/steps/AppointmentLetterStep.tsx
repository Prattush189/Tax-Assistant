import { PartnershipDeedDraft, AppointmentBlock } from '../lib/uiModel';
import { INDIAN_STATES } from '../lib/states';
import { Card, Field, Grid2, NumberInput, RupeeInput, TextInput } from '../../itr/shared/Inputs';

interface Props {
  draft: PartnershipDeedDraft;
  onChange: (
    patch: Partial<PartnershipDeedDraft> | ((p: PartnershipDeedDraft) => PartnershipDeedDraft),
  ) => void;
}

const stateInputCls =
  'w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-gray-900 dark:text-gray-100';

export function AppointmentLetterStep({ draft, onChange }: Props) {
  const a = draft.appointment ?? {};
  const patch = (p: Partial<AppointmentBlock>) => {
    onChange((prev) => ({ ...prev, appointment: { ...(prev.appointment ?? {}), ...p } }));
  };

  return (
    <div className="space-y-4">
      <Card title="Employer">
        <Field label="Employer name" required hint="Appears on the letterhead line">
          <TextInput value={a.employerName} onChange={(v) => patch({ employerName: v })} placeholder="M/s Acme Industries Pvt Ltd" />
        </Field>
        <Field label="Employer address">
          <TextInput value={a.employerAddress} onChange={(v) => patch({ employerAddress: v })} placeholder="Registered office address with PIN" />
        </Field>
        <Grid2>
          <Field label="Signatory name" hint="Who signs the letter for the employer">
            <TextInput value={a.signatoryName} onChange={(v) => patch({ signatoryName: v })} placeholder="Rajesh Kumar" />
          </Field>
          <Field label="Signatory designation">
            <TextInput value={a.signatoryDesignation} onChange={(v) => patch({ signatoryDesignation: v })} placeholder="Director / HR Manager" />
          </Field>
        </Grid2>
      </Card>

      <Card title="Candidate">
        <Field label="Candidate name" required>
          <TextInput value={a.employeeName} onChange={(v) => patch({ employeeName: v })} placeholder="Mr / Ms / Mrs full name" />
        </Field>
        <Field label="Candidate address" hint="The letter is addressed here">
          <TextInput value={a.employeeAddress} onChange={(v) => patch({ employeeAddress: v })} placeholder="Address with PIN" />
        </Field>
      </Card>

      <Card title="Role & joining">
        <Grid2>
          <Field label="Designation" required>
            <TextInput value={a.designation} onChange={(v) => patch({ designation: v })} placeholder="Senior Accountant" />
          </Field>
          <Field label="Department">
            <TextInput value={a.department} onChange={(v) => patch({ department: v })} placeholder="Finance & Accounts" />
          </Field>
        </Grid2>
        <Grid2>
          <Field label="Reports to">
            <TextInput value={a.reportingTo} onChange={(v) => patch({ reportingTo: v })} placeholder="Finance Controller" />
          </Field>
          <Field label="Place of posting">
            <TextInput value={a.workLocation} onChange={(v) => patch({ workLocation: v })} placeholder="Ludhiana, Punjab" />
          </Field>
        </Grid2>
        <Grid2>
          <Field label="Date of joining" required>
            <input
              type="date"
              value={a.startDate ?? ''}
              onChange={(ev) => patch({ startDate: ev.target.value })}
              className={stateInputCls}
            />
          </Field>
          <Field label="State (jurisdiction)">
            <select value={a.state ?? ''} onChange={(ev) => patch({ state: ev.target.value })} className={stateInputCls}>
              <option value="">Select state…</option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
        </Grid2>
        <Grid2>
          <Field label="Probation (months)" hint="0 = no probation">
            <NumberInput value={a.probationMonths} onChange={(v) => patch({ probationMonths: v })} placeholder="6" min={0} />
          </Field>
          <Field label="Notice period (months)">
            <NumberInput value={a.noticePeriodMonths} onChange={(v) => patch({ noticePeriodMonths: v })} placeholder="1" min={0} />
          </Field>
        </Grid2>
      </Card>

      <Card title="Compensation">
        <Field label="Annual CTC (Rs.)" required>
          <RupeeInput value={a.annualCtc} onChange={(v) => patch({ annualCtc: v })} placeholder="600000" />
        </Field>
        <Field label="Salary structure" hint="Optional breakdown — basic, HRA, allowances">
          <TextInput value={a.salaryStructure} onChange={(v) => patch({ salaryStructure: v })} placeholder="Basic 50%, HRA 25%, special allowance 25%" />
        </Field>
        <Grid2>
          <Field label="Working hours">
            <TextInput value={a.workingHours} onChange={(v) => patch({ workingHours: v })} placeholder="9:30 AM – 6:30 PM, Monday to Saturday" />
          </Field>
          <Field label="Benefits" hint="PF, ESI, insurance, bonus — as applicable">
            <TextInput value={a.benefits} onChange={(v) => patch({ benefits: v })} placeholder="PF + ESI as per statute; annual bonus per Payment of Bonus Act" />
          </Field>
        </Grid2>
      </Card>
    </div>
  );
}

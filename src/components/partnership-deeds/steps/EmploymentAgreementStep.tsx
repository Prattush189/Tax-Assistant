import { PartnershipDeedDraft, EmploymentBlock } from '../lib/uiModel';
import { INDIAN_STATES } from '../lib/states';
import { Card, Field, Grid2, NumberInput, PanInput, RupeeInput, TextInput } from '../../itr/shared/Inputs';

interface Props {
  draft: PartnershipDeedDraft;
  onChange: (
    patch: Partial<PartnershipDeedDraft> | ((p: PartnershipDeedDraft) => PartnershipDeedDraft),
  ) => void;
}

const stateInputCls =
  'w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-gray-900 dark:text-gray-100';

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer py-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 accent-emerald-600"
      />
      <span>
        <span className="block text-sm text-gray-800 dark:text-gray-200">{label}</span>
        {hint && <span className="block text-[11px] text-gray-500 dark:text-gray-400">{hint}</span>}
      </span>
    </label>
  );
}

export function EmploymentAgreementStep({ draft, onChange }: Props) {
  const e = draft.employment ?? {};
  const patch = (p: Partial<EmploymentBlock>) => {
    onChange((prev) => ({ ...prev, employment: { ...(prev.employment ?? {}), ...p } }));
  };

  return (
    <div className="space-y-4">
      <Card title="Employer">
        <Field label="Employer name" required hint="Company / firm / proprietorship name">
          <TextInput value={e.employerName} onChange={(v) => patch({ employerName: v })} placeholder="M/s Acme Industries Pvt Ltd" />
        </Field>
        <Field label="Employer address">
          <TextInput value={e.employerAddress} onChange={(v) => patch({ employerAddress: v })} placeholder="Registered office address with PIN" />
        </Field>
      </Card>

      <Card title="Employee">
        <Field label="Employee name" required>
          <TextInput value={e.employeeName} onChange={(v) => patch({ employeeName: v })} placeholder="Mr / Ms / Mrs full name" />
        </Field>
        <Field label="Employee address">
          <TextInput value={e.employeeAddress} onChange={(v) => patch({ employeeAddress: v })} placeholder="Address with PIN" />
        </Field>
        <Field label="Employee PAN">
          <PanInput value={e.employeePan} onChange={(v) => patch({ employeePan: v })} />
        </Field>
      </Card>

      <Card title="Role & term">
        <Grid2>
          <Field label="Designation" required>
            <TextInput value={e.designation} onChange={(v) => patch({ designation: v })} placeholder="Senior Accountant" />
          </Field>
          <Field label="Department">
            <TextInput value={e.department} onChange={(v) => patch({ department: v })} placeholder="Finance & Accounts" />
          </Field>
        </Grid2>
        <Grid2>
          <Field label="Reports to" hint="Designation of the reporting manager">
            <TextInput value={e.reportingTo} onChange={(v) => patch({ reportingTo: v })} placeholder="Finance Controller" />
          </Field>
          <Field label="Work location">
            <TextInput value={e.workLocation} onChange={(v) => patch({ workLocation: v })} placeholder="Ludhiana, Punjab" />
          </Field>
        </Grid2>
        <Grid2>
          <Field label="Start date" required>
            <input
              type="date"
              value={e.startDate ?? ''}
              onChange={(ev) => patch({ startDate: ev.target.value })}
              className={stateInputCls}
            />
          </Field>
          <Field label="State (jurisdiction)" hint="Drives the Shops & Establishments Act reference">
            <select value={e.state ?? ''} onChange={(ev) => patch({ state: ev.target.value })} className={stateInputCls}>
              <option value="">Select state…</option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
        </Grid2>
        <Grid2>
          <Field label="Probation (months)" hint="0 = no probation">
            <NumberInput value={e.probationMonths} onChange={(v) => patch({ probationMonths: v })} placeholder="6" min={0} />
          </Field>
          <Field label="Notice period (months)">
            <NumberInput value={e.noticePeriodMonths} onChange={(v) => patch({ noticePeriodMonths: v })} placeholder="2" min={0} />
          </Field>
        </Grid2>
      </Card>

      <Card title="Compensation & conditions">
        <Field label="Annual CTC (Rs.)" required>
          <RupeeInput value={e.annualCtc} onChange={(v) => patch({ annualCtc: v })} placeholder="900000" />
        </Field>
        <Field label="Salary structure" hint="Optional breakdown — basic, HRA, allowances, variable">
          <TextInput value={e.salaryStructure} onChange={(v) => patch({ salaryStructure: v })} placeholder="Basic 50%, HRA 25%, special allowance 25%" />
        </Field>
        <Grid2>
          <Field label="Working hours">
            <TextInput value={e.workingHours} onChange={(v) => patch({ workingHours: v })} placeholder="9:30 AM – 6:30 PM, Monday to Saturday" />
          </Field>
          <Field label="Leave policy">
            <TextInput value={e.leavePolicy} onChange={(v) => patch({ leavePolicy: v })} placeholder="18 EL + 12 CL/SL per year, as per company policy" />
          </Field>
        </Grid2>
        <div className="pt-1 space-y-0.5">
          <Toggle
            label="Confidentiality & IP assignment"
            hint="Employee keeps company information confidential; work product belongs to the employer"
            checked={e.confidentiality ?? true}
            onChange={(v) => patch({ confidentiality: v })}
          />
          <Toggle
            label="Non-solicitation"
            hint="No poaching of employees / clients for a period after leaving"
            checked={e.nonSolicit ?? false}
            onChange={(v) => patch({ nonSolicit: v })}
          />
          <Toggle
            label="Non-compete"
            hint="Post-employment non-compete — note: Indian courts rarely enforce these beyond the employment term"
            checked={e.nonCompete ?? false}
            onChange={(v) => patch({ nonCompete: v })}
          />
        </div>
        <Field label="Special terms" hint="Anything specific — bond, relocation, ESOPs, travel">
          <TextInput value={e.specialTerms} onChange={(v) => patch({ specialTerms: v })} placeholder="Retention bonus of Rs. 50,000 payable after 12 months" />
        </Field>
      </Card>
    </div>
  );
}

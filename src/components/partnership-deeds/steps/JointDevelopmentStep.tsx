import { PartnershipDeedDraft, JdaBlock } from '../lib/uiModel';
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

export function JointDevelopmentStep({ draft, onChange }: Props) {
  const j = draft.jda ?? {};
  const patch = (p: Partial<JdaBlock>) => {
    onChange((prev) => ({ ...prev, jda: { ...(prev.jda ?? {}), ...p } }));
  };

  return (
    <div className="space-y-4">
      <Card title="Landowner (Owner)">
        <Field label="Landowner name" required>
          <TextInput value={j.landownerName} onChange={(v) => patch({ landownerName: v })} placeholder="Mr / Ms / Mrs / Shri full name" />
        </Field>
        <Field label="Landowner address">
          <TextInput value={j.landownerAddress} onChange={(v) => patch({ landownerAddress: v })} placeholder="Address with PIN" />
        </Field>
        <Field label="Landowner PAN" hint="Needed for the Section 45(5A) capital-gains position">
          <PanInput value={j.landownerPan} onChange={(v) => patch({ landownerPan: v })} />
        </Field>
      </Card>

      <Card title="Developer">
        <Field label="Developer name" required hint="Firm / company undertaking the development">
          <TextInput value={j.developerName} onChange={(v) => patch({ developerName: v })} placeholder="M/s Builder Pvt Ltd" />
        </Field>
        <Field label="Developer address">
          <TextInput value={j.developerAddress} onChange={(v) => patch({ developerAddress: v })} placeholder="Registered office address with PIN" />
        </Field>
        <Field label="Developer PAN">
          <PanInput value={j.developerPan} onChange={(v) => patch({ developerPan: v })} />
        </Field>
      </Card>

      <Card title="Land">
        <Field label="Land / property address" required>
          <TextInput value={j.landAddress} onChange={(v) => patch({ landAddress: v })} placeholder="Plot at Village X, Tehsil Y, District Z" />
        </Field>
        <Grid2>
          <Field label="Land area" hint="e.g. 500 sq. yd. / 2 acres / 1,200 sq. m.">
            <TextInput value={j.landArea} onChange={(v) => patch({ landArea: v })} placeholder="500 sq. yd." />
          </Field>
          <Field label="Survey / khasra / CTS number">
            <TextInput value={j.surveyNumber} onChange={(v) => patch({ surveyNumber: v })} placeholder="Survey No. 123/4" />
          </Field>
        </Grid2>
        <Field label="State" required hint="Stamp duty + jurisdiction are looked up from this">
          <select value={j.state ?? ''} onChange={(e) => patch({ state: e.target.value })} className={stateInputCls}>
            <option value="">Select state…</option>
            {INDIAN_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </Field>
      </Card>

      <Card title="Development terms">
        <Grid2>
          <Field label="Landowner's share (%)" required hint="The developer gets the balance">
            <NumberInput value={j.ownerSharePct} onChange={(v) => patch({ ownerSharePct: v })} placeholder="40" min={0} max={100} />
          </Field>
          <Field label="Share basis">
            <Select
              value={j.shareBasis}
              onChange={(v) => patch({ shareBasis: v })}
              options={[
                { code: 'builtup_area', label: 'Built-up area sharing' },
                { code: 'revenue', label: 'Revenue sharing' },
              ]}
              placeholder="Select basis…"
            />
          </Field>
        </Grid2>
        <Grid2>
          <Field label="Refundable security deposit (Rs.)" hint="Paid by developer to owner, adjustable / refundable">
            <RupeeInput value={j.refundableDeposit} onChange={(v) => patch({ refundableDeposit: v })} placeholder="2500000" />
          </Field>
          <Field label="Non-refundable consideration (Rs.)" hint="Upfront amount, if any">
            <RupeeInput value={j.nonRefundableConsideration} onChange={(v) => patch({ nonRefundableConsideration: v })} placeholder="0" />
          </Field>
        </Grid2>
        <Grid2>
          <Field label="Possession / handover date" hint="When the land is handed to the developer">
            <input
              type="date"
              value={j.possessionDate ?? ''}
              onChange={(e) => patch({ possessionDate: e.target.value })}
              className={stateInputCls}
            />
          </Field>
          <Field label="Construction timeline (months)" required>
            <NumberInput value={j.constructionMonths} onChange={(v) => patch({ constructionMonths: v })} placeholder="36" min={1} />
          </Field>
        </Grid2>
        <Field label="Special terms" hint="Anything specific — grace period, penalty, corpus, alternate accommodation">
          <TextInput value={j.specialTerms} onChange={(v) => patch({ specialTerms: v })} placeholder="6-month grace period; Rs. 25,000/month rent to owner during construction" />
        </Field>
      </Card>
    </div>
  );
}

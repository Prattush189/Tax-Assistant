import { PartnershipDeedDraft, ClausesBlock } from '../lib/uiModel';
import { Card, Field, Toggle } from '../../itr/shared/Inputs';

interface Props {
  draft: PartnershipDeedDraft;
  onChange: (
    patch: Partial<PartnershipDeedDraft> | ((p: PartnershipDeedDraft) => PartnershipDeedDraft),
  ) => void;
}

export function ClausesStep({ draft, onChange }: Props) {
  const c = draft.clauses ?? {};

  const patch = (p: Partial<ClausesBlock>) => {
    onChange((prev) => ({ ...prev, clauses: { ...(prev.clauses ?? {}), ...p } }));
  };

  return (
    <div className="space-y-4">
      <Card title="Standard clauses">
        <Toggle
          checked={!!c.arbitration}
          onChange={(v) => patch({ arbitration: v })}
          label="Include arbitration clause (Arbitration & Conciliation Act, 1996)"
        />
      </Card>

      <Card title="Special clauses">
        <Field
          label="Anything else the deed should mention"
          hint="Free-form. The AI will draft clauses for what you describe (e.g. non-compete, IP ownership, insurance, audit, dispute resolution preferences)."
        >
          <textarea
            value={c.specialClauses ?? ''}
            onChange={(e) => patch({ specialClauses: e.target.value })}
            placeholder="e.g. Each partner shall maintain confidentiality of trade secrets. The firm shall maintain general liability insurance of at least Rs. 50,00,000."
            rows={6}
            className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-gray-900 dark:text-gray-100 placeholder-gray-400 resize-y"
          />
        </Field>
      </Card>
    </div>
  );
}

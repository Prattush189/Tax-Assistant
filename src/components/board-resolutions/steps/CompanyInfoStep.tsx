import { BoardResolutionDraft, CompanyBlock } from '../lib/uiModel';
import { Card, Field, Grid2, TextInput } from '../../itr/shared/Inputs';

interface Props {
  draft: BoardResolutionDraft;
  onChange: (patch: Partial<BoardResolutionDraft> | ((p: BoardResolutionDraft) => BoardResolutionDraft)) => void;
}

export function CompanyInfoStep({ draft, onChange }: Props) {
  const c = draft.company ?? {};

  const patchCompany = (patch: Partial<CompanyBlock>) => {
    onChange((prev) => ({ ...prev, company: { ...(prev.company ?? {}), ...patch } }));
  };

  return (
    <div className="space-y-4">
      <Card title="Company details">
        <Field label="Company name" required>
          <TextInput
            value={c.name}
            onChange={(v) => patchCompany({ name: v })}
            placeholder="Acme Private Limited"
          />
        </Field>
        <Grid2>
          <Field label="CIN" hint="21-character corporate identity number">
            <TextInput
              value={c.cin}
              onChange={(v) => patchCompany({ cin: v })}
              placeholder="U12345MH2020PTC123456"
              uppercase
              maxLength={21}
            />
          </Field>
          <Field label="Email">
            <TextInput
              value={c.email}
              onChange={(v) => patchCompany({ email: v })}
              placeholder="contact@company.com"
            />
          </Field>
        </Grid2>
        <Field label="Registered office address" required>
          <TextInput
            value={c.registeredOffice}
            onChange={(v) => patchCompany({ registeredOffice: v })}
            placeholder="123, MG Road, Mumbai 400001"
          />
        </Field>
        <Field label="Phone">
          <TextInput
            value={c.phone}
            onChange={(v) => patchCompany({ phone: v })}
            placeholder="+91 98765 43210"
          />
        </Field>
      </Card>
    </div>
  );
}

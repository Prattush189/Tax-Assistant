import { Card, Field, Grid2, TextInput } from '../../itr/shared/Inputs';
import type { TbBsDraft, TbBsFirmInfo } from '../lib/uiModel';

interface Props {
  draft: TbBsDraft;
  onChange: (patch: Partial<TbBsDraft>) => void;
}

export function TbBsFirmInfoStep({ draft, onChange }: Props) {
  const firm = draft.firm ?? {};
  const patch = (p: Partial<TbBsFirmInfo>) => onChange({ firm: { ...firm, ...p } });

  return (
    <Card title="Schedule III header info">
      <Field label="Firm / company name" required>
        <TextInput value={firm.firmName} onChange={(v) => patch({ firmName: v })} placeholder="Acme Industries Pvt Ltd" />
      </Field>
      <Grid2>
        <Field label="CIN" hint="Corporate Identification Number, if registered as a company">
          <TextInput value={firm.cin} onChange={(v) => patch({ cin: v?.toUpperCase() })} placeholder="U72200MH2018PTC123456" />
        </Field>
        <Field label="GSTIN">
          <TextInput value={firm.gstin} onChange={(v) => patch({ gstin: v?.toUpperCase() })} placeholder="27AAAAA0000A1Z5" />
        </Field>
      </Grid2>
      <Field label="Registered office / address">
        <TextInput value={firm.registeredOffice} onChange={(v) => patch({ registeredOffice: v })} placeholder="48, Chaturbhuj Road, Amritsar 143001" />
      </Field>
    </Card>
  );
}

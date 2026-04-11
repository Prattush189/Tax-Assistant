import { ProfileManager } from '../../../hooks/useProfileManager';
import { NoticeDefaultsSlice } from '../lib/profileModel';
import { Card, Field, Grid2, TextInput, PanInput } from '../../itr/shared/Inputs';

interface Props {
  manager: ProfileManager;
}

export function NoticeDefaultsTab({ manager }: Props) {
  const n = (manager.currentProfile?.noticeDefaults as NoticeDefaultsSlice) ?? {};
  const patch = (p: Partial<NoticeDefaultsSlice>) => manager.updateNoticeDefaults({ ...n, ...p });

  return (
    <div className="space-y-4">
      <Card title="Sender defaults">
        <p className="text-[11px] text-gray-500 dark:text-gray-500 mb-2">
          These prefill the "From" side of the Notice drafter. Leave blank to fall back
          to identity + address data from other tabs.
        </p>
        <Grid2>
          <Field label="Sender name (override)">
            <TextInput value={n.senderName} onChange={(v) => patch({ senderName: v })} maxLength={100} />
          </Field>
          <Field label="Sender PAN">
            <PanInput value={n.senderPan} onChange={(v) => patch({ senderPan: v })} />
          </Field>
        </Grid2>
        <Grid2>
          <Field label="Sender GSTIN">
            <TextInput
              value={n.senderGstin}
              onChange={(v) => patch({ senderGstin: v })}
              maxLength={15}
              uppercase
            />
          </Field>
          <Field label="Sender address (override)">
            <TextInput
              value={n.senderAddress}
              onChange={(v) => patch({ senderAddress: v })}
              maxLength={200}
            />
          </Field>
        </Grid2>
      </Card>

      <Card title="Recipient defaults">
        <p className="text-[11px] text-gray-500 dark:text-gray-500 mb-2">
          Common recipient (e.g. usual jurisdictional AO). Prefilled into Notice drafts as a starting point.
        </p>
        <Grid2>
          <Field label="Officer (name / designation)">
            <TextInput
              value={n.recipientOfficer}
              onChange={(v) => patch({ recipientOfficer: v })}
              maxLength={100}
            />
          </Field>
          <Field label="Office">
            <TextInput
              value={n.recipientOffice}
              onChange={(v) => patch({ recipientOffice: v })}
              maxLength={100}
            />
          </Field>
        </Grid2>
        <Field label="Recipient address">
          <TextInput
            value={n.recipientAddress}
            onChange={(v) => patch({ recipientAddress: v })}
            maxLength={200}
          />
        </Field>
      </Card>
    </div>
  );
}

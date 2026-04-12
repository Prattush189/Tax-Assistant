import { BoardResolutionDraft, MeetingBlock } from '../lib/uiModel';
import { Card, Field, Grid2, TextInput, NumberInput, Toggle } from '../../itr/shared/Inputs';

interface Props {
  draft: BoardResolutionDraft;
  onChange: (patch: Partial<BoardResolutionDraft> | ((p: BoardResolutionDraft) => BoardResolutionDraft)) => void;
}

export function MeetingInfoStep({ draft, onChange }: Props) {
  const m = draft.meeting ?? {};

  const patchMeeting = (patch: Partial<MeetingBlock>) => {
    onChange((prev) => ({ ...prev, meeting: { ...(prev.meeting ?? {}), ...patch } }));
  };

  return (
    <div className="space-y-4">
      <Card title="Board meeting">
        <Grid2>
          <Field label="Meeting date" required hint="DD/MM/YYYY">
            <TextInput
              value={m.date}
              onChange={(v) => patchMeeting({ date: v })}
              placeholder="01/04/2026"
            />
          </Field>
          <Field label="Meeting time" hint="HH:MM (24-hour)">
            <TextInput
              value={m.time}
              onChange={(v) => patchMeeting({ time: v })}
              placeholder="11:00"
            />
          </Field>
        </Grid2>
        <Field label="Meeting place" required>
          <TextInput
            value={m.place}
            onChange={(v) => patchMeeting({ place: v })}
            placeholder="Registered office"
          />
        </Field>
        <Grid2>
          <Field label="Directors present" hint="Count of directors attending">
            <NumberInput
              value={m.directorsPresent}
              onChange={(v) => patchMeeting({ directorsPresent: v })}
              placeholder="3"
              min={1}
            />
          </Field>
          <div className="flex items-end pb-2">
            <Toggle
              checked={m.quorumMet ?? false}
              onChange={(v) => patchMeeting({ quorumMet: v })}
              label="Quorum met"
            />
          </div>
        </Grid2>
      </Card>
    </div>
  );
}

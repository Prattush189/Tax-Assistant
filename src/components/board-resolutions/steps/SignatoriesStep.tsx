import { BoardResolutionDraft, SignatoryBlock, DirectorPresent } from '../lib/uiModel';
import { Card, Field, Grid2, TextInput } from '../../itr/shared/Inputs';
import { Plus, X } from 'lucide-react';

interface Props {
  draft: BoardResolutionDraft;
  onChange: (patch: Partial<BoardResolutionDraft> | ((p: BoardResolutionDraft) => BoardResolutionDraft)) => void;
}

export function SignatoriesStep({ draft, onChange }: Props) {
  const s = draft.signatories ?? {};

  const patch = (p: Partial<SignatoryBlock>) => {
    onChange((prev) => ({ ...prev, signatories: { ...(prev.signatories ?? {}), ...p } }));
  };
  const patchCertBy = (p: Partial<NonNullable<SignatoryBlock['certifiedBy']>>) => {
    patch({ certifiedBy: { ...(s.certifiedBy ?? {}), ...p } });
  };

  const directors = s.directorsPresent ?? [];
  const addDirector = () => patch({ directorsPresent: [...directors, {}] });
  const updateDirector = (i: number, p: Partial<DirectorPresent>) => {
    const next = directors.map((d, idx) => (idx === i ? { ...d, ...p } : d));
    patch({ directorsPresent: next });
  };
  const removeDirector = (i: number) => {
    patch({ directorsPresent: directors.filter((_, idx) => idx !== i) });
  };

  return (
    <div className="space-y-4">
      <Card title="Chairperson">
        <Field label="Chairperson name" hint="Person who chaired the meeting">
          <TextInput
            value={s.chairpersonName}
            onChange={(v) => patch({ chairpersonName: v })}
            placeholder="Jane Smith"
          />
        </Field>
      </Card>

      <Card title="Certifying director">
        <p className="text-[11px] text-gray-500 dark:text-gray-500 -mt-2">
          Director who will sign the certified true copy on the PDF.
        </p>
        <Grid2>
          <Field label="Name" required>
            <TextInput
              value={s.certifiedBy?.name}
              onChange={(v) => patchCertBy({ name: v })}
              placeholder="Jane Smith"
            />
          </Field>
          <Field label="Designation" required>
            <TextInput
              value={s.certifiedBy?.designation}
              onChange={(v) => patchCertBy({ designation: v })}
              placeholder="Director"
            />
          </Field>
        </Grid2>
        <Field label="DIN" hint="8-digit Director Identification Number">
          <TextInput
            value={s.certifiedBy?.din}
            onChange={(v) => patchCertBy({ din: v.replace(/\D/g, '') })}
            placeholder="09876543"
            maxLength={8}
          />
        </Field>
      </Card>

      <Card
        title={`Directors present at meeting (${directors.length})`}
        action={
          <button
            type="button"
            onClick={addDirector}
            className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
          >
            <Plus className="w-3.5 h-3.5" />
            Add director
          </button>
        }
      >
        {directors.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">Optional. Add directors who attended the meeting.</p>
        ) : (
          <div className="space-y-3">
            {directors.map((d, i) => (
              <div key={i} className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Director {i + 1}</p>
                  <button
                    type="button"
                    onClick={() => removeDirector(i)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <Grid2>
                  <Field label="Name">
                    <TextInput value={d.name} onChange={(v) => updateDirector(i, { name: v })} placeholder="Director name" />
                  </Field>
                  <Field label="DIN">
                    <TextInput
                      value={d.din}
                      onChange={(v) => updateDirector(i, { din: v.replace(/\D/g, '') })}
                      placeholder="01234567"
                      maxLength={8}
                    />
                  </Field>
                </Grid2>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

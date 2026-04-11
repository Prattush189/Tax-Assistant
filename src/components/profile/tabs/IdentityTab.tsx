import { ProfileManager } from '../../../hooks/useProfileManager';
import { IdentitySlice, EmployerCategory } from '../lib/profileModel';
import {
  Card,
  Field,
  Grid2,
  Grid3,
  TextInput,
  PanInput,
  AadhaarInput,
  Select,
} from '../../itr/shared/Inputs';

const EMPLOYER_CATEGORIES: ReadonlyArray<{ code: EmployerCategory; label: string }> = [
  { code: 'CGOV', label: 'Central Government' },
  { code: 'SGOV', label: 'State Government' },
  { code: 'PSU', label: 'Public Sector Unit' },
  { code: 'PE', label: 'Pensioner — Central Govt' },
  { code: 'PESG', label: 'Pensioner — State Govt' },
  { code: 'PEPS', label: 'Pensioner — PSU' },
  { code: 'PEO', label: 'Pensioner — Others' },
  { code: 'OTH', label: 'Others (Private / Self-employed)' },
  { code: 'NA', label: 'Not Applicable' },
];

interface Props {
  manager: ProfileManager;
}

export function IdentityTab({ manager }: Props) {
  const id = (manager.currentProfile?.identity as IdentitySlice) ?? {};

  const patch = (p: Partial<IdentitySlice>) => {
    manager.updateIdentity({ ...id, ...p });
  };

  return (
    <div className="space-y-4">
      <Card title="Name">
        <Grid3>
          <Field label="First name">
            <TextInput value={id.firstName} onChange={(v) => patch({ firstName: v })} maxLength={25} />
          </Field>
          <Field label="Middle name">
            <TextInput value={id.middleName} onChange={(v) => patch({ middleName: v })} maxLength={25} />
          </Field>
          <Field label="Surname">
            <TextInput value={id.lastName} onChange={(v) => patch({ lastName: v })} maxLength={25} />
          </Field>
        </Grid3>
        <Field label="Father's name" hint="Used in ITR verification declaration">
          <TextInput value={id.fatherName} onChange={(v) => patch({ fatherName: v })} maxLength={50} />
        </Field>
      </Card>

      <Card title="Tax IDs">
        <Grid2>
          <Field label="PAN">
            <PanInput value={id.pan} onChange={(v) => patch({ pan: v })} />
          </Field>
          <Field label="Aadhaar">
            <AadhaarInput value={id.aadhaar} onChange={(v) => patch({ aadhaar: v })} />
          </Field>
        </Grid2>
        <Grid2>
          <Field label="Date of birth" hint="YYYY-MM-DD">
            <TextInput value={id.dob} onChange={(v) => patch({ dob: v })} placeholder="1990-05-15" />
          </Field>
          <Field label="Employer category">
            <Select
              value={id.employerCategory}
              onChange={(v) => patch({ employerCategory: v })}
              options={EMPLOYER_CATEGORIES}
            />
          </Field>
        </Grid2>
      </Card>
    </div>
  );
}

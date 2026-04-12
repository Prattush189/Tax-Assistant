import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { ItrWizardDraft, UiPersonalInfo, UiAddress } from '../lib/uiModel';
import { fetchItrEnum, ItrEnumOption } from '../../../services/api';
import { Card, Field, Grid2, Grid3, TextInput, PanInput, AadhaarInput, NumberInput, Select } from '../shared/Inputs';
import { LoadFromProfile } from '../../profile/shared/LoadFromProfile';
import { profileToItrPersonal } from '../../profile/lib/prefillAdapters';
import { PortalImportDialog } from '../../portal-import/PortalImportDialog';
import type { ItrManager } from '../../../hooks/useItrManager';

interface Props {
  draft: ItrWizardDraft;
  onChange: (patch: Partial<ItrWizardDraft> | ((p: ItrWizardDraft) => ItrWizardDraft)) => void;
  manager?: ItrManager;
}

const EMPLOYER_CATEGORIES: ReadonlyArray<{ code: NonNullable<UiPersonalInfo['EmployerCategory']>; label: string }> = [
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

export function PersonalInfoStep({ draft, onChange, manager }: Props) {
  const p = draft.PersonalInfo ?? {};
  const a = p.Address ?? {};

  const [states, setStates] = useState<ItrEnumOption[]>([]);
  const [countries, setCountries] = useState<ItrEnumOption[]>([]);
  const [showImport, setShowImport] = useState(false);
  useEffect(() => {
    fetchItrEnum('states').then(setStates).catch(() => undefined);
    fetchItrEnum('countries').then(setCountries).catch(() => undefined);
  }, []);

  const patchPersonal = (patch: Partial<UiPersonalInfo>) => {
    onChange((prev) => ({
      ...prev,
      PersonalInfo: { ...(prev.PersonalInfo ?? {}), ...patch },
    }));
  };
  const patchAddress = (patch: Partial<UiAddress>) => {
    onChange((prev) => ({
      ...prev,
      PersonalInfo: {
        ...(prev.PersonalInfo ?? {}),
        Address: { ...(prev.PersonalInfo?.Address ?? {}), ...patch },
      },
    }));
  };
  const patchName = (patch: Partial<NonNullable<UiPersonalInfo['AssesseeName']>>) => {
    onChange((prev) => ({
      ...prev,
      PersonalInfo: {
        ...(prev.PersonalInfo ?? {}),
        AssesseeName: { ...(prev.PersonalInfo?.AssesseeName ?? {}), ...patch },
      },
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setShowImport(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-900/40 rounded-lg transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Import from IT portal
        </button>
        <LoadFromProfile
          onPick={(profile) => onChange((prev) => profileToItrPersonal(profile, prev))}
          label="Load identity + address"
        />
      </div>

      <PortalImportDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        itrDraftId={manager?.currentDraftId ?? undefined}
        onImported={async () => {
          // The server has already patched the ITR draft's PersonalInfo +
          // Banks. Re-fetch the draft so the wizard's local state picks up
          // the server-side changes.
          if (manager?.currentDraftId) {
            await manager.loadDraft(manager.currentDraftId);
          }
        }}
      />
      <Card title="Identity">
        <Grid2>
          <Field label="PAN" required>
            <PanInput value={p.PAN} onChange={(v) => patchPersonal({ PAN: v })} />
          </Field>
          <Field label="Aadhaar">
            <AadhaarInput value={p.AadhaarCardNo} onChange={(v) => patchPersonal({ AadhaarCardNo: v })} />
          </Field>
        </Grid2>
        <Grid3>
          <Field label="First name">
            <TextInput value={p.AssesseeName?.FirstName} onChange={(v) => patchName({ FirstName: v })} maxLength={25} />
          </Field>
          <Field label="Middle name">
            <TextInput value={p.AssesseeName?.MiddleName} onChange={(v) => patchName({ MiddleName: v })} maxLength={25} />
          </Field>
          <Field label="Surname" required>
            <TextInput value={p.AssesseeName?.SurNameOrOrgName} onChange={(v) => patchName({ SurNameOrOrgName: v })} maxLength={25} />
          </Field>
        </Grid3>
        <Grid2>
          <Field label="Date of birth" required hint="DD/MM/YYYY · must be ≤ 31/03/2025">
            <TextInput value={p.DOB} onChange={(v) => patchPersonal({ DOB: v })} placeholder="15/05/1990" />
          </Field>
          <Field label="Employer category" required>
            <Select
              value={p.EmployerCategory}
              onChange={(v) => patchPersonal({ EmployerCategory: v })}
              options={EMPLOYER_CATEGORIES}
            />
          </Field>
        </Grid2>
      </Card>

      <Card title="Address">
        <Grid3>
          <Field label="Flat / Door #" required>
            <TextInput value={a.ResidenceNo} onChange={(v) => patchAddress({ ResidenceNo: v })} maxLength={50} />
          </Field>
          <Field label="Premise name">
            <TextInput value={a.ResidenceName} onChange={(v) => patchAddress({ ResidenceName: v })} maxLength={50} />
          </Field>
          <Field label="Road / street">
            <TextInput value={a.RoadOrStreet} onChange={(v) => patchAddress({ RoadOrStreet: v })} maxLength={50} />
          </Field>
        </Grid3>
        <Grid2>
          <Field label="Area / locality" required>
            <TextInput value={a.LocalityOrArea} onChange={(v) => patchAddress({ LocalityOrArea: v })} maxLength={50} />
          </Field>
          <Field label="City / town / district" required>
            <TextInput value={a.CityOrTownOrDistrict} onChange={(v) => patchAddress({ CityOrTownOrDistrict: v })} maxLength={50} />
          </Field>
        </Grid2>
        <Grid3>
          <Field label="State" required>
            <Select
              value={a.StateCode}
              onChange={(v) => patchAddress({ StateCode: v })}
              options={states.map((o) => ({ code: o.code, label: `${o.code} · ${o.label}` }))}
            />
          </Field>
          <Field label="Country" required>
            <Select
              value={a.CountryCode}
              onChange={(v) => patchAddress({ CountryCode: v })}
              options={countries.map((o) => ({ code: o.code, label: `${o.code} · ${o.label}` }))}
            />
          </Field>
          <Field label="PIN code">
            <NumberInput value={a.PinCode} onChange={(v) => patchAddress({ PinCode: v })} placeholder="110001" />
          </Field>
        </Grid3>
        <Grid3>
          <Field label="Country mobile code" required>
            <NumberInput value={a.CountryCodeMobile} onChange={(v) => patchAddress({ CountryCodeMobile: v })} placeholder="91" />
          </Field>
          <Field label="Mobile" required>
            <NumberInput value={a.MobileNo} onChange={(v) => patchAddress({ MobileNo: v })} placeholder="9999999999" />
          </Field>
          <Field label="Email" required>
            <TextInput value={a.EmailAddress} onChange={(v) => patchAddress({ EmailAddress: v })} placeholder="name@example.com" />
          </Field>
        </Grid3>
      </Card>
    </div>
  );
}

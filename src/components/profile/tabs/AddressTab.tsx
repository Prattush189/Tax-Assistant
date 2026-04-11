import { useEffect, useState } from 'react';
import { ProfileManager } from '../../../hooks/useProfileManager';
import { AddressSlice } from '../lib/profileModel';
import { fetchItrEnum, ItrEnumOption } from '../../../services/api';
import { Card, Field, Grid2, Grid3, TextInput, NumberInput, Select } from '../../itr/shared/Inputs';

interface Props {
  manager: ProfileManager;
}

export function AddressTab({ manager }: Props) {
  const addr = (manager.currentProfile?.address as AddressSlice) ?? {};
  const [states, setStates] = useState<ItrEnumOption[]>([]);
  const [countries, setCountries] = useState<ItrEnumOption[]>([]);

  useEffect(() => {
    fetchItrEnum('states').then(setStates).catch(() => undefined);
    fetchItrEnum('countries').then(setCountries).catch(() => undefined);
  }, []);

  const patch = (p: Partial<AddressSlice>) => manager.updateAddress({ ...addr, ...p });

  return (
    <div className="space-y-4">
      <Card title="Address">
        <Grid3>
          <Field label="Flat / door #">
            <TextInput value={addr.flatNo} onChange={(v) => patch({ flatNo: v })} maxLength={50} />
          </Field>
          <Field label="Premise name">
            <TextInput value={addr.premiseName} onChange={(v) => patch({ premiseName: v })} maxLength={50} />
          </Field>
          <Field label="Road / street">
            <TextInput value={addr.roadOrStreet} onChange={(v) => patch({ roadOrStreet: v })} maxLength={50} />
          </Field>
        </Grid3>
        <Grid2>
          <Field label="Area / locality">
            <TextInput value={addr.locality} onChange={(v) => patch({ locality: v })} maxLength={50} />
          </Field>
          <Field label="City / town / district">
            <TextInput value={addr.city} onChange={(v) => patch({ city: v })} maxLength={50} />
          </Field>
        </Grid2>
        <Grid3>
          <Field label="State">
            <Select
              value={addr.stateCode}
              onChange={(v) => patch({ stateCode: v })}
              options={states.map((o) => ({ code: o.code, label: `${o.code} · ${o.label}` }))}
            />
          </Field>
          <Field label="Country">
            <Select
              value={addr.countryCode}
              onChange={(v) => patch({ countryCode: v })}
              options={countries.map((o) => ({ code: o.code, label: `${o.code} · ${o.label}` }))}
            />
          </Field>
          <Field label="PIN code">
            <NumberInput value={addr.pinCode} onChange={(v) => patch({ pinCode: v })} placeholder="110001" />
          </Field>
        </Grid3>
      </Card>

      <Card title="Contacts">
        <Grid3>
          <Field label="Country mobile code">
            <NumberInput
              value={addr.mobileCountryCode}
              onChange={(v) => patch({ mobileCountryCode: v })}
              placeholder="91"
            />
          </Field>
          <Field label="Mobile">
            <NumberInput value={addr.mobile} onChange={(v) => patch({ mobile: v })} placeholder="9999999999" />
          </Field>
          <Field label="Email">
            <TextInput value={addr.email} onChange={(v) => patch({ email: v })} placeholder="name@example.com" />
          </Field>
        </Grid3>
      </Card>
    </div>
  );
}

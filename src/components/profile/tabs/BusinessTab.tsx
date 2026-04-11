import { useEffect, useState } from 'react';
import { ProfileManager } from '../../../hooks/useProfileManager';
import { PerAySlice, BusinessSlice, ensureAySlice, emptyPerAy } from '../lib/profileModel';
import { fetchItrEnum, ItrEnumOption } from '../../../services/api';
import {
  Card,
  Field,
  Grid2,
  Grid3,
  TextInput,
  NumberInput,
  RupeeInput,
  Select,
} from '../../itr/shared/Inputs';

interface Props {
  manager: ProfileManager;
}

type Scheme = NonNullable<BusinessSlice['scheme']>;

export function BusinessTab({ manager }: Props) {
  const perAy = manager.currentProfile?.perAy ?? {};
  const slice: PerAySlice = ensureAySlice(perAy, manager.selectedAy);
  const b = slice.business ?? {};
  const [nobs, setNobs] = useState<ItrEnumOption[]>([]);

  useEffect(() => {
    fetchItrEnum('nature-of-business').then(setNobs).catch(() => undefined);
  }, []);

  const patch = (p: Partial<BusinessSlice>) => {
    const next: PerAySlice = { ...(slice ?? emptyPerAy()), business: { ...b, ...p } };
    manager.updatePerAy(next as unknown as Record<string, unknown>);
  };

  return (
    <div className="space-y-4">
      <Card title={`Presumptive scheme · AY ${manager.selectedAy}`}>
        <Field label="Scheme">
          <Select<Scheme>
            value={b.scheme}
            onChange={(v) => patch({ scheme: v })}
            options={[
              { code: 'NONE', label: 'Not applicable' },
              { code: '44AD', label: '44AD — Business (6% / 8% presumptive)' },
              { code: '44ADA', label: '44ADA — Profession (50%)' },
              { code: '44AE', label: '44AE — Goods transport' },
            ]}
          />
        </Field>
        {b.scheme && b.scheme !== 'NONE' && (
          <Grid2>
            <Field label="Nature of business / profession code">
              <Select
                value={b.natureCode}
                onChange={(v) => patch({ natureCode: v })}
                options={nobs.map((o) => ({ code: o.code, label: `${o.code} — ${o.label}` }))}
              />
            </Field>
            <Field label="Trade name">
              <TextInput
                value={b.tradeName}
                onChange={(v) => patch({ tradeName: v })}
                maxLength={75}
              />
            </Field>
          </Grid2>
        )}
        {b.scheme === '44AD' && (
          <Grid2>
            <Field label="Gross turnover — cash" hint="Presumed income: 8%">
              <RupeeInput
                value={b.grossTurnoverCash}
                onChange={(v) => patch({ grossTurnoverCash: v })}
              />
            </Field>
            <Field label="Gross turnover — digital" hint="Presumed income: 6%">
              <RupeeInput
                value={b.grossTurnoverDigital}
                onChange={(v) => patch({ grossTurnoverDigital: v })}
              />
            </Field>
          </Grid2>
        )}
        {b.scheme === '44ADA' && (
          <Field label="Gross receipts" hint="Presumed income: 50%">
            <RupeeInput
              value={b.grossReceipts}
              onChange={(v) => patch({ grossReceipts: v })}
            />
          </Field>
        )}
        {b.scheme === '44AE' && (
          <Grid3>
            <Field label="Heavy goods vehicles">
              <NumberInput
                value={b.numHeavyVehicles}
                onChange={(v) => patch({ numHeavyVehicles: v })}
              />
            </Field>
            <Field label="Other vehicles">
              <NumberInput
                value={b.numOtherVehicles}
                onChange={(v) => patch({ numOtherVehicles: v })}
              />
            </Field>
            <Field label="Months owned">
              <NumberInput value={b.monthsOwned} onChange={(v) => patch({ monthsOwned: v })} />
            </Field>
          </Grid3>
        )}
      </Card>

      <Card title="Financial particulars">
        <Grid2>
          <Field label="Sundry debtors">
            <RupeeInput value={b.sundryDebtors} onChange={(v) => patch({ sundryDebtors: v })} />
          </Field>
          <Field label="Sundry creditors">
            <RupeeInput value={b.sundryCreditors} onChange={(v) => patch({ sundryCreditors: v })} />
          </Field>
          <Field label="Stock-in-trade">
            <RupeeInput value={b.stockInTrade} onChange={(v) => patch({ stockInTrade: v })} />
          </Field>
          <Field label="Cash balance">
            <RupeeInput value={b.cashBalance} onChange={(v) => patch({ cashBalance: v })} />
          </Field>
        </Grid2>
      </Card>
    </div>
  );
}

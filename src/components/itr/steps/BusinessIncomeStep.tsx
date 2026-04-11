/**
 * ITR-4 business income (presumptive) — 44AD / 44ADA / 44AE.
 *
 * This is a SCAFFOLD for Phase C. The CBDT ScheduleBP structure is large and
 * intricate; for MVP we capture the top-level presumptive figures and the
 * nature-of-business code. The Review step's server validation will still
 * surface any ScheduleBP gaps, and an admin can fill them via the gov
 * Common Utility before upload.
 */
import { useEffect, useState } from 'react';
import { ItrWizardDraft } from '../lib/uiModel';
import { Card, Field, Grid2, Grid3, RupeeInput, Select, NumberInput, TextInput } from '../shared/Inputs';
import { fetchItrEnum, ItrEnumOption } from '../../../services/api';
import { Info } from 'lucide-react';
import { LoadFromProfile } from '../../profile/shared/LoadFromProfile';
import { profileToItrBusiness } from '../../profile/lib/prefillAdapters';

interface Props {
  draft: ItrWizardDraft;
  onChange: (patch: Partial<ItrWizardDraft> | ((p: ItrWizardDraft) => ItrWizardDraft)) => void;
}

type PresumptiveScheme = '44AD' | '44ADA' | '44AE' | 'NONE';

export function BusinessIncomeStep({ draft, onChange }: Props) {
  const bp = (draft as unknown as { _businessIncome?: BusinessState })._businessIncome ?? defaultBusinessState();
  const [nobs, setNobs] = useState<ItrEnumOption[]>([]);

  useEffect(() => {
    fetchItrEnum('nature-of-business')
      .then(setNobs)
      .catch(() => undefined);
  }, []);

  const patchBusiness = (patch: Partial<BusinessState>) => {
    onChange((prev) => {
      const current = (prev as unknown as { _businessIncome?: BusinessState })._businessIncome ?? defaultBusinessState();
      const next = { ...current, ...patch };
      // Derive presumptive income when possible
      if (next.scheme === '44AD') {
        const cash = Number(next.grossTurnoverCash) || 0;
        const digital = Number(next.grossTurnoverDigital) || 0;
        next.presumptiveIncome = Math.round(cash * 0.08 + digital * 0.06);
      } else if (next.scheme === '44ADA') {
        const receipts = Number(next.grossReceipts) || 0;
        next.presumptiveIncome = Math.round(receipts * 0.5);
      } else if (next.scheme === '44AE') {
        const heavy = Number(next.numHeavyVehicles) || 0;
        const other = Number(next.numOtherVehicles) || 0;
        const months = Number(next.monthsOwned) || 12;
        // ₹1,000/tonne/month for heavy goods vehicle, ₹7,500/month for other
        next.presumptiveIncome = (heavy * 1000 * 12 + other * 7500) * (months / 12);
      } else {
        next.presumptiveIncome = 0;
      }
      return {
        ...prev,
        _businessIncome: next,
      } as unknown as ItrWizardDraft;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <LoadFromProfile
          onPick={(profile) =>
            onChange((prev) => profileToItrBusiness(profile, prev, prev.assessmentYear))
          }
          label="Load business for this AY"
        />
      </div>
      <Card title="Presumptive business income (ITR-4)">
        <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/40 mb-3">
          <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-blue-800 dark:text-blue-300 font-semibold">
              ITR-4 supports only presumptive schemes.
            </p>
            <p className="text-[11px] text-blue-700 dark:text-blue-400 mt-1">
              If you maintain books of accounts or your income exceeds the presumptive scheme limits,
              you must file ITR-3 instead.
            </p>
          </div>
        </div>

        <Field label="Presumptive scheme" required>
          <Select<PresumptiveScheme>
            value={bp.scheme}
            onChange={(v) => patchBusiness({ scheme: v })}
            options={[
              { code: 'NONE', label: 'Not applicable' },
              { code: '44AD', label: '44AD — Small business (6% / 8% presumptive)' },
              { code: '44ADA', label: '44ADA — Profession (50% presumptive)' },
              { code: '44AE', label: '44AE — Goods transport (per-vehicle rate)' },
            ]}
          />
        </Field>

        {bp.scheme !== 'NONE' && (
          <Grid2>
            <Field label="Nature of business / profession code" required>
              <Select
                value={bp.natureCode}
                onChange={(v) => patchBusiness({ natureCode: v })}
                options={nobs.map((o) => ({ code: o.code, label: `${o.code} — ${o.label}` }))}
              />
            </Field>
            <Field label="Trade name">
              <TextInput value={bp.tradeName} onChange={(v) => patchBusiness({ tradeName: v })} maxLength={75} />
            </Field>
          </Grid2>
        )}

        {bp.scheme === '44AD' && (
          <Grid2>
            <Field label="Gross turnover — cash mode" hint="Presumed income: 8%">
              <RupeeInput
                value={bp.grossTurnoverCash}
                onChange={(v) => patchBusiness({ grossTurnoverCash: v })}
              />
            </Field>
            <Field label="Gross turnover — digital mode" hint="Presumed income: 6%">
              <RupeeInput
                value={bp.grossTurnoverDigital}
                onChange={(v) => patchBusiness({ grossTurnoverDigital: v })}
              />
            </Field>
          </Grid2>
        )}

        {bp.scheme === '44ADA' && (
          <Field label="Gross receipts" hint="Presumed income: 50%">
            <RupeeInput value={bp.grossReceipts} onChange={(v) => patchBusiness({ grossReceipts: v })} />
          </Field>
        )}

        {bp.scheme === '44AE' && (
          <Grid3>
            <Field label="Heavy goods vehicles" hint="> 12 tonne">
              <NumberInput
                value={bp.numHeavyVehicles}
                onChange={(v) => patchBusiness({ numHeavyVehicles: v })}
              />
            </Field>
            <Field label="Other vehicles">
              <NumberInput
                value={bp.numOtherVehicles}
                onChange={(v) => patchBusiness({ numOtherVehicles: v })}
              />
            </Field>
            <Field label="Months owned" hint="1 to 12">
              <NumberInput
                value={bp.monthsOwned}
                onChange={(v) => patchBusiness({ monthsOwned: v })}
              />
            </Field>
          </Grid3>
        )}

        {bp.scheme !== 'NONE' && bp.presumptiveIncome > 0 && (
          <div className="pt-3 border-t border-gray-200 dark:border-gray-800 flex justify-between items-center">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Presumptive income</p>
            <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
              ₹{bp.presumptiveIncome.toLocaleString('en-IN')}
            </p>
          </div>
        )}
      </Card>

      <Card title="Financial particulars">
        <p className="text-[11px] text-gray-500 dark:text-gray-500 mb-3">
          Short-form balance sheet as on 31 March 2025. Required for all presumptive cases.
        </p>
        <Grid2>
          <Field label="Sundry debtors">
            <RupeeInput value={bp.sundryDebtors} onChange={(v) => patchBusiness({ sundryDebtors: v })} />
          </Field>
          <Field label="Sundry creditors">
            <RupeeInput value={bp.sundryCreditors} onChange={(v) => patchBusiness({ sundryCreditors: v })} />
          </Field>
          <Field label="Stock-in-trade">
            <RupeeInput value={bp.stockInTrade} onChange={(v) => patchBusiness({ stockInTrade: v })} />
          </Field>
          <Field label="Cash balance">
            <RupeeInput value={bp.cashBalance} onChange={(v) => patchBusiness({ cashBalance: v })} />
          </Field>
        </Grid2>
      </Card>
    </div>
  );
}

interface BusinessState {
  scheme: PresumptiveScheme;
  natureCode?: string;
  tradeName?: string;
  grossTurnoverCash?: number;
  grossTurnoverDigital?: number;
  grossReceipts?: number;
  numHeavyVehicles?: number;
  numOtherVehicles?: number;
  monthsOwned?: number;
  presumptiveIncome: number;
  sundryDebtors?: number;
  sundryCreditors?: number;
  stockInTrade?: number;
  cashBalance?: number;
}

function defaultBusinessState(): BusinessState {
  return {
    scheme: 'NONE',
    monthsOwned: 12,
    presumptiveIncome: 0,
  };
}

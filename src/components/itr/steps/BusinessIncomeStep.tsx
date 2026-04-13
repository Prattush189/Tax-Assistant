/**
 * ITR-4 business income — 44AD / 44ADA / 44AE + financial particulars.
 * Fully maps to CBDT ScheduleBP + FinanclPartclrOfBusiness.
 */
import { useMemo } from 'react';
import {
  ItrWizardDraft,
  UiBusinessIncome,
  UiGoodsDtlsUs44AE,
  UiTurnoverGSTIN,
  UiFinanclPartclrOfBusiness,
  defaultBusinessIncome,
} from '../lib/uiModel';
import { Card, Field, Grid2, Grid3, RupeeInput, Select, NumberInput, TextInput, Accordion } from '../shared/Inputs';
import { fetchItrEnum, ItrEnumOption } from '../../../services/api';
import { Info, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { LoadFromProfile } from '../../profile/shared/LoadFromProfile';
import { profileToItrBusiness } from '../../profile/lib/prefillAdapters';
import { useEffect, useState } from 'react';

interface Props {
  draft: ItrWizardDraft;
  onChange: (patch: Partial<ItrWizardDraft> | ((p: ItrWizardDraft) => ItrWizardDraft)) => void;
}

const VEHICLE_FLAGS: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'OWN', label: 'Owned' },
  { code: 'LEASE', label: 'Leased' },
  { code: 'HIRED', label: 'Hired' },
];

export function BusinessIncomeStep({ draft, onChange }: Props) {
  const bp: UiBusinessIncome = draft._businessIncome ?? defaultBusinessIncome();
  const [nobs, setNobs] = useState<ItrEnumOption[]>([]);

  useEffect(() => {
    fetchItrEnum('nature-of-business').then(setNobs).catch(() => undefined);
  }, []);

  const patch = (p: Partial<UiBusinessIncome>) => {
    onChange((prev) => {
      const cur = prev._businessIncome ?? defaultBusinessIncome();
      const next = { ...cur, ...p };

      // Auto-compute presumptive income
      if (next.scheme === '44AD') {
        const bank = Number(next.grossTurnoverBank) || 0;
        const cash = Number(next.grossTurnoverCash) || 0;
        const other = Number(next.grossTurnoverOther) || 0;
        next.presumptiveInc6Per = Math.round(bank * 0.06);
        next.presumptiveInc8Per = Math.round((cash + other) * 0.08);
        next.totalPresumptive44AD = next.presumptiveInc6Per + next.presumptiveInc8Per;
      }
      if (next.scheme === '44ADA') {
        const bank = Number(next.grossReceiptsBank) || 0;
        const cash = Number(next.grossReceiptsCash) || 0;
        const other = Number(next.grossReceiptsOther) || 0;
        next.totalPresumptive44ADA = Math.round((bank + cash + other) * 0.5);
      }
      if (next.scheme === '44AE') {
        const vehicles = next.goodsVehicles ?? [];
        next.totalPresumptive44AE = vehicles.reduce((a, v) => a + (v.PresumptiveIncome ?? 0), 0)
          + (Number(next.salaryInterestByFirm) || 0);
      }

      // Auto-sum financial particulars
      if (next.financials) {
        const f = next.financials;
        f.TotCapLiabilities = (f.PartnerMemberOwnCapital ?? 0) + (f.SecuredLoans ?? 0) + (f.UnSecuredLoans ?? 0)
          + (f.Advances ?? 0) + (f.SundryCreditors ?? 0) + (f.OthrCurrLiab ?? 0);
        f.TotalAssets = (f.FixedAssets ?? 0) + (f.Inventories ?? 0) + (f.SundryDebtors ?? 0)
          + (f.BalWithBanks ?? 0) + (f.CashInHand ?? 0) + (f.LoansAndAdvances ?? 0) + (f.OtherAssets ?? 0);
      }

      return { ...prev, _businessIncome: next };
    });
  };

  const patchFinancials = (p: Partial<UiFinanclPartclrOfBusiness>) => {
    patch({ financials: { ...(bp.financials ?? {}), ...p } });
  };

  // 44AE vehicle helpers
  const vehicles = bp.goodsVehicles ?? [];
  const addVehicle = () => patch({ goodsVehicles: [...vehicles, { HoldingPeriod: 12, TonnageCapacity: 1 }] });
  const updateVehicle = (i: number, p: Partial<UiGoodsDtlsUs44AE>) => {
    const updated = vehicles.map((v, j) => j === i ? { ...v, ...p } : v);
    // Auto-calc per vehicle: ₹7,500/month (or ₹1,000/tonne/month if heavy)
    const v = updated[i];
    const months = v.HoldingPeriod ?? 12;
    const tonnage = v.TonnageCapacity ?? 1;
    v.PresumptiveIncome = tonnage > 12 ? 1000 * tonnage * months : 7500 * months;
    patch({ goodsVehicles: updated });
  };
  const removeVehicle = (i: number) => patch({ goodsVehicles: vehicles.filter((_, j) => j !== i) });

  // GSTIN helpers
  const gstinEntries = bp.gstinTurnover ?? [];
  const addGSTIN = () => patch({ gstinTurnover: [...gstinEntries, {}] });
  const updateGSTIN = (i: number, p: Partial<UiTurnoverGSTIN>) => {
    patch({ gstinTurnover: gstinEntries.map((e, j) => j === i ? { ...e, ...p } : e) });
  };
  const removeGSTIN = (i: number) => patch({ gstinTurnover: gstinEntries.filter((_, j) => j !== i) });

  const presumptiveTotal = bp.scheme === '44AD' ? (bp.totalPresumptive44AD ?? 0)
    : bp.scheme === '44ADA' ? (bp.totalPresumptive44ADA ?? 0)
    : bp.scheme === '44AE' ? (bp.totalPresumptive44AE ?? 0)
    : 0;

  const fin = bp.financials ?? {};
  const balMismatch = fin.TotCapLiabilities !== undefined && fin.TotalAssets !== undefined
    && fin.TotCapLiabilities !== fin.TotalAssets && (fin.TotCapLiabilities > 0 || fin.TotalAssets > 0);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <LoadFromProfile
          onPick={(profile) => onChange((prev) => profileToItrBusiness(profile, prev, prev.assessmentYear))}
          label="Load business for this AY"
        />
      </div>

      {/* ── Scheme + Nature ─────────────────────────────────────────── */}
      <Card title="Presumptive business income (ITR-4)">
        <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/40 mb-3">
          <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-blue-800 dark:text-blue-300 font-semibold">ITR-4 supports only presumptive schemes.</p>
            <p className="text-[11px] text-blue-700 dark:text-blue-400 mt-1">
              44AD: business turnover up to ₹3Cr · 44ADA: profession receipts up to ₹75L · 44AE: goods carriage
            </p>
          </div>
        </div>

        <Field label="Presumptive scheme" required>
          <Select
            value={bp.scheme}
            onChange={(v) => patch({ scheme: v as UiBusinessIncome['scheme'] })}
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
                onChange={(v) => patch({ natureCode: v })}
                options={nobs.map((o) => ({ code: o.code, label: `${o.code} — ${o.label}` }))}
              />
            </Field>
            <Field label="Trade name">
              <TextInput value={bp.tradeName} onChange={(v) => patch({ tradeName: v })} maxLength={75} />
            </Field>
          </Grid2>
        )}

        {/* ── 44AD ────────────────────────────────────────────────── */}
        {bp.scheme === '44AD' && (
          <>
            <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mt-3 mb-2">
              Turnover breakup (max ₹3 crore)
            </p>
            <Grid3>
              <Field label="Through banking channels" hint="Presumptive: 6%">
                <RupeeInput value={bp.grossTurnoverBank} onChange={(v) => patch({ grossTurnoverBank: v })} />
              </Field>
              <Field label="In cash" hint="Presumptive: 8%">
                <RupeeInput value={bp.grossTurnoverCash} onChange={(v) => patch({ grossTurnoverCash: v })} />
              </Field>
              <Field label="Any other mode" hint="Presumptive: 8%">
                <RupeeInput value={bp.grossTurnoverOther} onChange={(v) => patch({ grossTurnoverOther: v })} />
              </Field>
            </Grid3>
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 px-1 pt-2">
              <span>6% of bank: ₹{(bp.presumptiveInc6Per ?? 0).toLocaleString('en-IN')}</span>
              <span>8% of cash+other: ₹{(bp.presumptiveInc8Per ?? 0).toLocaleString('en-IN')}</span>
            </div>
          </>
        )}

        {/* ── 44ADA ───────────────────────────────────────────────── */}
        {bp.scheme === '44ADA' && (
          <>
            <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mt-3 mb-2">
              Gross receipts breakup (max ₹75 lakh)
            </p>
            <Grid3>
              <Field label="Through banking channels">
                <RupeeInput value={bp.grossReceiptsBank} onChange={(v) => patch({ grossReceiptsBank: v })} />
              </Field>
              <Field label="In cash">
                <RupeeInput value={bp.grossReceiptsCash} onChange={(v) => patch({ grossReceiptsCash: v })} />
              </Field>
              <Field label="Any other mode">
                <RupeeInput value={bp.grossReceiptsOther} onChange={(v) => patch({ grossReceiptsOther: v })} />
              </Field>
            </Grid3>
            <p className="text-[11px] text-gray-400 px-1 pt-1">
              Presumptive income: 50% of total receipts
            </p>
          </>
        )}

        {/* ── 44AE ────────────────────────────────────────────────── */}
        {bp.scheme === '44AE' && (
          <>
            <div className="flex items-center justify-between mt-3 mb-2">
              <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Goods vehicles
              </p>
              <button onClick={addVehicle} className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                <Plus className="w-3.5 h-3.5" /> Add vehicle
              </button>
            </div>
            {vehicles.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center">No vehicles added yet.</p>
            ) : (
              <div className="space-y-3">
                {vehicles.map((v, i) => (
                  <div key={i} className="p-3 border border-gray-200 dark:border-gray-800 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">Vehicle {i + 1}</p>
                      <button onClick={() => removeVehicle(i)} className="text-red-500 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <Grid2>
                      <Field label="Registration number">
                        <TextInput value={v.RegNumberGoodsCarriage} onChange={(val) => updateVehicle(i, { RegNumberGoodsCarriage: val })} maxLength={15} uppercase />
                      </Field>
                      <Field label="Owned / Leased / Hired">
                        <Select value={v.OwnedLeasedHiredFlag} onChange={(val) => updateVehicle(i, { OwnedLeasedHiredFlag: val as UiGoodsDtlsUs44AE['OwnedLeasedHiredFlag'] })} options={VEHICLE_FLAGS} />
                      </Field>
                    </Grid2>
                    <Grid3>
                      <Field label="Tonnage (tonnes)" hint="1-100">
                        <NumberInput value={v.TonnageCapacity} onChange={(val) => updateVehicle(i, { TonnageCapacity: val })} />
                      </Field>
                      <Field label="Months owned" hint="1-12">
                        <NumberInput value={v.HoldingPeriod} onChange={(val) => updateVehicle(i, { HoldingPeriod: val })} />
                      </Field>
                      <Field label="Presumptive income">
                        <RupeeInput value={v.PresumptiveIncome} onChange={(val) => updateVehicle(i, { PresumptiveIncome: val })} />
                      </Field>
                    </Grid3>
                  </div>
                ))}
              </div>
            )}
            <Field label="Salary / interest received from firm (if partner)">
              <RupeeInput value={bp.salaryInterestByFirm} onChange={(v) => patch({ salaryInterestByFirm: v })} />
            </Field>
          </>
        )}

        {/* ── Presumptive total ────────────────────────────────────── */}
        {bp.scheme !== 'NONE' && (
          <div className="pt-3 border-t border-gray-200 dark:border-gray-800 flex justify-between items-center mt-3">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Total presumptive income</p>
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
              ₹{presumptiveTotal.toLocaleString('en-IN')}
            </p>
          </div>
        )}
      </Card>

      {/* ── GSTIN Turnover ───────────────────────────────────────── */}
      {bp.scheme !== 'NONE' && (
        <Card
          title="GSTIN-wise turnover"
          action={
            <button onClick={addGSTIN} className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add GSTIN
            </button>
          }
        >
          {gstinEntries.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-2 text-center">
              No GSTIN entries. Add if you have GST registration.
            </p>
          ) : (
            <div className="space-y-3">
              {gstinEntries.map((e, i) => (
                <div key={i} className="p-3 border border-gray-200 dark:border-gray-800 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">GSTIN {i + 1}</p>
                    <button onClick={() => removeGSTIN(i)} className="text-red-500 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <Grid3>
                    <Field label="GSTIN" hint="15 characters">
                      <TextInput value={e.GSTIN} onChange={(v) => updateGSTIN(i, { GSTIN: v })} maxLength={15} uppercase />
                    </Field>
                    <Field label="Gross turnover">
                      <RupeeInput value={e.GrossTurnover} onChange={(v) => updateGSTIN(i, { GrossTurnover: v })} />
                    </Field>
                    <Field label="Gross receipt">
                      <RupeeInput value={e.GrossReceipt} onChange={(v) => updateGSTIN(i, { GrossReceipt: v })} />
                    </Field>
                  </Grid3>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Financial Particulars ─────────────────────────────────── */}
      {bp.scheme !== 'NONE' && (
        <Card title="Financial particulars (as on 31 March 2025)">
          <p className="text-[11px] text-gray-500 dark:text-gray-500 mb-3">
            Short-form balance sheet. Liabilities total should equal assets total.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Liabilities */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Liabilities</p>
              <Field label="Partner / member own capital">
                <RupeeInput value={fin.PartnerMemberOwnCapital} onChange={(v) => patchFinancials({ PartnerMemberOwnCapital: v })} />
              </Field>
              <Field label="Secured loans">
                <RupeeInput value={fin.SecuredLoans} onChange={(v) => patchFinancials({ SecuredLoans: v })} />
              </Field>
              <Field label="Unsecured loans">
                <RupeeInput value={fin.UnSecuredLoans} onChange={(v) => patchFinancials({ UnSecuredLoans: v })} />
              </Field>
              <Field label="Advances">
                <RupeeInput value={fin.Advances} onChange={(v) => patchFinancials({ Advances: v })} />
              </Field>
              <Field label="Sundry creditors">
                <RupeeInput value={fin.SundryCreditors} onChange={(v) => patchFinancials({ SundryCreditors: v })} />
              </Field>
              <Field label="Other current liabilities">
                <RupeeInput value={fin.OthrCurrLiab} onChange={(v) => patchFinancials({ OthrCurrLiab: v })} />
              </Field>
              <div className="pt-2 border-t border-gray-200 dark:border-gray-800 flex justify-between text-xs">
                <span className="font-semibold text-gray-700 dark:text-gray-300">Total liabilities</span>
                <span className="font-bold text-gray-900 dark:text-gray-100">₹{(fin.TotCapLiabilities ?? 0).toLocaleString('en-IN')}</span>
              </div>
            </div>

            {/* Assets */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Assets</p>
              <Field label="Fixed assets">
                <RupeeInput value={fin.FixedAssets} onChange={(v) => patchFinancials({ FixedAssets: v })} />
              </Field>
              <Field label="Inventories">
                <RupeeInput value={fin.Inventories} onChange={(v) => patchFinancials({ Inventories: v })} />
              </Field>
              <Field label="Sundry debtors">
                <RupeeInput value={fin.SundryDebtors} onChange={(v) => patchFinancials({ SundryDebtors: v })} />
              </Field>
              <Field label="Balance with banks">
                <RupeeInput value={fin.BalWithBanks} onChange={(v) => patchFinancials({ BalWithBanks: v })} />
              </Field>
              <Field label="Cash in hand">
                <RupeeInput value={fin.CashInHand} onChange={(v) => patchFinancials({ CashInHand: v })} />
              </Field>
              <Field label="Loans and advances">
                <RupeeInput value={fin.LoansAndAdvances} onChange={(v) => patchFinancials({ LoansAndAdvances: v })} />
              </Field>
              <Field label="Other assets">
                <RupeeInput value={fin.OtherAssets} onChange={(v) => patchFinancials({ OtherAssets: v })} />
              </Field>
              <div className="pt-2 border-t border-gray-200 dark:border-gray-800 flex justify-between text-xs">
                <span className="font-semibold text-gray-700 dark:text-gray-300">Total assets</span>
                <span className="font-bold text-gray-900 dark:text-gray-100">₹{(fin.TotalAssets ?? 0).toLocaleString('en-IN')}</span>
              </div>
            </div>
          </div>

          {balMismatch && (
            <div className="flex items-start gap-2 p-2 mt-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                Total liabilities (₹{(fin.TotCapLiabilities ?? 0).toLocaleString('en-IN')}) does not match total assets (₹{(fin.TotalAssets ?? 0).toLocaleString('en-IN')}). Balance sheet must balance.
              </p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

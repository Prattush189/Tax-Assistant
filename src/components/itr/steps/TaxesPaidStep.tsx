import { useMemo } from 'react';
import {
  ItrWizardDraft,
  UiTaxesPaid,
  UiTDSonSalaryEntry,
  UiTDSonOtherEntry,
  UiTCSEntry,
  UiTaxPaymentEntry,
} from '../lib/uiModel';
import { Card, Field, Grid2, Grid3, TextInput, RupeeInput, Select, Accordion } from '../shared/Inputs';
import { Plus, Trash2 } from 'lucide-react';

interface Props {
  draft: ItrWizardDraft;
  onChange: (patch: Partial<ItrWizardDraft> | ((p: ItrWizardDraft) => ItrWizardDraft)) => void;
}

// ── Array helpers ──────────────────────────────────────────────────────

function useArrayHelpers<T extends object>(
  draft: ItrWizardDraft,
  onChange: Props['onChange'],
  /** Path like 'TDSonSalaries' */
  scheduleKey: keyof ItrWizardDraft,
  /** Nested array key like 'TDSonSalary' */
  arrayKey: string,
  emptyItem: () => T,
) {
  const schedule = (draft[scheduleKey] ?? {}) as Record<string, unknown>;
  const items = (Array.isArray(schedule[arrayKey]) ? schedule[arrayKey] : []) as T[];

  const add = () => {
    onChange((prev) => {
      const existing = ((prev[scheduleKey] ?? {}) as Record<string, unknown>)[arrayKey];
      const arr = Array.isArray(existing) ? [...existing] : [];
      arr.push(emptyItem());
      return { ...prev, [scheduleKey]: { ...(prev[scheduleKey] as object ?? {}), [arrayKey]: arr } };
    });
  };

  const update = (index: number, patch: Partial<T>) => {
    onChange((prev) => {
      const existing = ((prev[scheduleKey] ?? {}) as Record<string, unknown>)[arrayKey];
      const arr = Array.isArray(existing) ? [...existing] : [];
      arr[index] = { ...arr[index], ...patch };
      return { ...prev, [scheduleKey]: { ...(prev[scheduleKey] as object ?? {}), [arrayKey]: arr } };
    });
  };

  const remove = (index: number) => {
    onChange((prev) => {
      const existing = ((prev[scheduleKey] ?? {}) as Record<string, unknown>)[arrayKey];
      const arr = Array.isArray(existing) ? [...existing] : [];
      arr.splice(index, 1);
      return { ...prev, [scheduleKey]: { ...(prev[scheduleKey] as object ?? {}), [arrayKey]: arr } };
    });
  };

  return { items, add, update, remove };
}

export function TaxesPaidStep({ draft, onChange }: Props) {
  const taxes: UiTaxesPaid = draft.TaxPaid?.TaxesPaid ?? {};

  // TDS on salary is auto-built from employers — show read-only
  const employers = draft._salaryEmployers ?? [];
  const autoTdsSalary = useMemo(
    () => employers.reduce((acc, e) => acc + (Number(e.tdsOnSalary) || 0), 0),
    [employers],
  );

  // TDS on other than salary
  const tdsOther = useArrayHelpers<UiTDSonOtherEntry>(
    draft, onChange, 'TDSonOthThanSals', 'TDSonOthThanSal',
    () => ({ EmployerOrDeductorOrCollectTAN: '', EmployerOrDeductorOrCollectName: '', AmtForTaxDeworDed: 0, TotalTDSonOthThanSals: 0 }),
  );
  const totalTdsOther = useMemo(
    () => tdsOther.items.reduce((acc, e) => acc + (Number(e.TotalTDSonOthThanSals) || 0), 0),
    [tdsOther.items],
  );

  // TCS
  const tcs = useArrayHelpers<UiTCSEntry>(
    draft, onChange, 'ScheduleTCS', 'TCS',
    () => ({ EmployerOrDeductorOrCollectTAN: '', EmployerOrDeductorOrCollectName: '', TotalTCS: 0 }),
  );
  const totalTcs = useMemo(
    () => tcs.items.reduce((acc, e) => acc + (Number(e.TotalTCS) || 0), 0),
    [tcs.items],
  );

  // Advance tax / self-assessment tax payments
  const taxPayments = useArrayHelpers<UiTaxPaymentEntry>(
    draft, onChange, 'TaxPayments', 'TaxPayment',
    () => ({ BSRCode: '', DateDep: '', SrlNoOfChaln: '', Amt: 0 }),
  );
  const totalTaxPayments = useMemo(
    () => taxPayments.items.reduce((acc, e) => acc + (Number(e.Amt) || 0), 0),
    [taxPayments.items],
  );

  // Grand total
  const grandTotal = autoTdsSalary + totalTdsOther + totalTcs + totalTaxPayments;

  // Auto-sync the aggregate TaxesPaid fields whenever items change
  const patchTaxes = (patch: Partial<UiTaxesPaid>) => {
    onChange((prev) => {
      const tp = prev.TaxPaid ?? {};
      const base = tp.TaxesPaid ?? {};
      const next = { ...base, ...patch };
      next.TotalTaxesPaid =
        (Number(next.AdvanceTax) || 0) +
        (Number(next.TDS) || 0) +
        (Number(next.TCS) || 0) +
        (Number(next.SelfAssessmentTax) || 0);
      return { ...prev, TaxPaid: { ...tp, TaxesPaid: next } };
    });
  };

  // Auto-fill aggregate from itemized
  const syncAggregates = () => {
    patchTaxes({
      TDS: autoTdsSalary + totalTdsOther,
      TCS: totalTcs,
      AdvanceTax: totalTaxPayments,
    });
  };

  return (
    <div className="space-y-4">
      {/* ── TDS on Salary (read-only, auto from employers) ───────────── */}
      <Card title="TDS on salary">
        {employers.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-2 text-center">
            Add employers in the Income step to see TDS on salary here.
          </p>
        ) : (
          <div className="space-y-2">
            {employers.filter(e => (e.tdsOnSalary ?? 0) > 0 || (e.grossSalary ?? 0) > 0).map((e, i) => (
              <div key={e._uid || i} className="flex justify-between items-center text-xs px-1 py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
                <div className="min-w-0 flex-1">
                  <span className="text-gray-700 dark:text-gray-300">{e.employerName || '(unnamed)'}</span>
                  {e.tan && <span className="text-gray-400 ml-2">{e.tan}</span>}
                </div>
                <div className="text-right shrink-0 ml-3">
                  <span className="text-gray-400">Salary ₹{(e.grossSalary ?? 0).toLocaleString('en-IN')}</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium ml-3">TDS ₹{(e.tdsOnSalary ?? 0).toLocaleString('en-IN')}</span>
                </div>
              </div>
            ))}
            <div className="flex justify-between text-xs font-semibold pt-1 text-gray-700 dark:text-gray-300">
              <span>Total TDS on salary</span>
              <span className="text-emerald-600 dark:text-emerald-400">₹{autoTdsSalary.toLocaleString('en-IN')}</span>
            </div>
          </div>
        )}
      </Card>

      {/* ── TDS on other than salary ─────────────────────────────────── */}
      <Card
        title="TDS on other than salary"
        action={
          <button onClick={tdsOther.add} className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        }
      >
        {tdsOther.items.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-2 text-center">
            No TDS entries yet. Add Form 16A / 16C entries here.
          </p>
        ) : (
          <div className="space-y-3">
            {tdsOther.items.map((e, i) => (
              <div key={i} className="p-3 border border-gray-200 dark:border-gray-800 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">Entry {i + 1}</p>
                  <button onClick={() => tdsOther.remove(i)} className="text-red-500 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Grid2>
                  <Field label="Deductor TAN">
                    <TextInput value={e.EmployerOrDeductorOrCollectTAN} onChange={(v) => tdsOther.update(i, { EmployerOrDeductorOrCollectTAN: v })} maxLength={10} uppercase />
                  </Field>
                  <Field label="Deductor name">
                    <TextInput value={e.EmployerOrDeductorOrCollectName} onChange={(v) => tdsOther.update(i, { EmployerOrDeductorOrCollectName: v })} maxLength={75} />
                  </Field>
                </Grid2>
                <Grid3>
                  <Field label="Gross amount">
                    <RupeeInput value={e.AmtForTaxDeworDed} onChange={(v) => tdsOther.update(i, { AmtForTaxDeworDed: v })} />
                  </Field>
                  <Field label="TDS deducted">
                    <RupeeInput value={e.TotalTDSonOthThanSals} onChange={(v) => tdsOther.update(i, { TotalTDSonOthThanSals: v })} />
                  </Field>
                  <Field label="TDS claimed this year">
                    <RupeeInput value={e.ClaimOutOfTotTDSOnAmtPaid} onChange={(v) => tdsOther.update(i, { ClaimOutOfTotTDSOnAmtPaid: v })} />
                  </Field>
                </Grid3>
              </div>
            ))}
            <div className="flex justify-between text-xs font-semibold pt-1 text-gray-700 dark:text-gray-300">
              <span>Total TDS (other)</span>
              <span className="text-emerald-600 dark:text-emerald-400">₹{totalTdsOther.toLocaleString('en-IN')}</span>
            </div>
          </div>
        )}
      </Card>

      {/* ── TCS ──────────────────────────────────────────────────────── */}
      <Card
        title="Tax collected at source (TCS)"
        action={
          <button onClick={tcs.add} className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        }
      >
        {tcs.items.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-2 text-center">
            No TCS entries. Add if tax was collected at source (e.g. car purchase, foreign remittance).
          </p>
        ) : (
          <div className="space-y-3">
            {tcs.items.map((e, i) => (
              <div key={i} className="p-3 border border-gray-200 dark:border-gray-800 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">Entry {i + 1}</p>
                  <button onClick={() => tcs.remove(i)} className="text-red-500 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Grid2>
                  <Field label="Collector TAN">
                    <TextInput value={e.EmployerOrDeductorOrCollectTAN} onChange={(v) => tcs.update(i, { EmployerOrDeductorOrCollectTAN: v })} maxLength={10} uppercase />
                  </Field>
                  <Field label="Collector name">
                    <TextInput value={e.EmployerOrDeductorOrCollectName} onChange={(v) => tcs.update(i, { EmployerOrDeductorOrCollectName: v })} maxLength={75} />
                  </Field>
                </Grid2>
                <Grid2>
                  <Field label="TCS amount">
                    <RupeeInput value={e.TotalTCS} onChange={(v) => tcs.update(i, { TotalTCS: v })} />
                  </Field>
                  <Field label="TCS claimed this year">
                    <RupeeInput value={e.ClaimOutOfTotTCS} onChange={(v) => tcs.update(i, { ClaimOutOfTotTCS: v })} />
                  </Field>
                </Grid2>
              </div>
            ))}
            <div className="flex justify-between text-xs font-semibold pt-1 text-gray-700 dark:text-gray-300">
              <span>Total TCS</span>
              <span className="text-emerald-600 dark:text-emerald-400">₹{totalTcs.toLocaleString('en-IN')}</span>
            </div>
          </div>
        )}
      </Card>

      {/* ── Advance Tax / Self-Assessment Tax ────────────────────────── */}
      <Card
        title="Advance tax & self-assessment tax"
        action={
          <button onClick={taxPayments.add} className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Add challan
          </button>
        }
      >
        {taxPayments.items.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-2 text-center">
            No tax payments yet. Add challan details for advance tax or self-assessment tax paid.
          </p>
        ) : (
          <div className="space-y-3">
            {taxPayments.items.map((e, i) => (
              <div key={i} className="p-3 border border-gray-200 dark:border-gray-800 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">Challan {i + 1}</p>
                  <button onClick={() => taxPayments.remove(i)} className="text-red-500 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Grid2>
                  <Field label="BSR code" hint="7-digit bank code">
                    <TextInput value={e.BSRCode} onChange={(v) => taxPayments.update(i, { BSRCode: v })} maxLength={7} />
                  </Field>
                  <Field label="Date of deposit" hint="DD/MM/YYYY">
                    <TextInput value={e.DateDep} onChange={(v) => taxPayments.update(i, { DateDep: v })} placeholder="31/03/2025" />
                  </Field>
                </Grid2>
                <Grid2>
                  <Field label="Challan serial no." hint="5-digit">
                    <TextInput value={e.SrlNoOfChaln} onChange={(v) => taxPayments.update(i, { SrlNoOfChaln: v })} maxLength={5} />
                  </Field>
                  <Field label="Amount paid">
                    <RupeeInput value={e.Amt} onChange={(v) => taxPayments.update(i, { Amt: v })} />
                  </Field>
                </Grid2>
              </div>
            ))}
            <div className="flex justify-between text-xs font-semibold pt-1 text-gray-700 dark:text-gray-300">
              <span>Total tax payments</span>
              <span className="text-emerald-600 dark:text-emerald-400">₹{totalTaxPayments.toLocaleString('en-IN')}</span>
            </div>
          </div>
        )}
      </Card>

      {/* ── Summary ──────────────────────────────────────────────────── */}
      <Card title="Total taxes paid">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">TDS on salary</span>
            <span className="text-gray-700 dark:text-gray-300">₹{autoTdsSalary.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">TDS on other income</span>
            <span className="text-gray-700 dark:text-gray-300">₹{totalTdsOther.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">TCS</span>
            <span className="text-gray-700 dark:text-gray-300">₹{totalTcs.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">Advance / self-assessment tax</span>
            <span className="text-gray-700 dark:text-gray-300">₹{totalTaxPayments.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-800">
            <span className="font-bold text-gray-800 dark:text-gray-100">Grand total</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400">₹{grandTotal.toLocaleString('en-IN')}</span>
          </div>
        </div>
        <button
          onClick={syncAggregates}
          className="mt-3 text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
        >
          Sync aggregates from itemized entries above
        </button>
      </Card>
    </div>
  );
}

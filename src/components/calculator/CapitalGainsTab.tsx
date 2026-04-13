import { useMemo, useState } from 'react';
import { cn } from '../../lib/utils';
import { formatINR } from '../../lib/utils';
import { calculateCapitalGains } from '../../lib/capitalGainsEngine';
import { getTaxRules } from '../../data/taxRules';
import type { CapitalGainsAssetType } from '../../types';
import { useTaxCalculator } from '../../contexts/TaxCalculatorContext';
import { CGImportSection } from './CGImportSection';

type FY = '2025-26' | '2024-25';

const ASSET_OPTIONS: { value: CapitalGainsAssetType; label: string }[] = [
  { value: 'equity', label: 'Equity / Mutual Funds' },
  { value: 'realEstate', label: 'Real Estate' },
  { value: 'other', label: 'Other Assets' },
];

function NumberInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}
      </label>
      {hint && <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{hint}</p>}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">₹</span>
        <input
          type="number"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          className="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}

export function CapitalGainsTab() {
  // Lifted state — persists across tab switches
  const { cgTabState, setCgTabState } = useTaxCalculator();
  const { fy } = useTaxCalculator(); // global FY
  const {
    assetType,
    salePrice,
    purchasePrice,
    holdingMonths,
    acquisitionBeforeJuly2024,
    indexedCost,
  } = cgTabState;
  const setAssetType = (v: CapitalGainsAssetType) => setCgTabState((s) => ({ ...s, assetType: v }));
  const setSalePrice = (v: string) => setCgTabState((s) => ({ ...s, salePrice: v }));
  const setPurchasePrice = (v: string) => setCgTabState((s) => ({ ...s, purchasePrice: v }));
  const setHoldingMonths = (v: string) => setCgTabState((s) => ({ ...s, holdingMonths: v }));
  const setAcquisitionBeforeJuly2024 = (v: boolean) =>
    setCgTabState((s) => ({ ...s, acquisitionBeforeJuly2024: v }));
  const setIndexedCost = (v: string) => setCgTabState((s) => ({ ...s, indexedCost: v }));

  const result = useMemo(() => {
    const sale = Number(salePrice) || 0;
    const purchase = Number(purchasePrice) || 0;
    const months = Number(holdingMonths) || 0;

    if (sale <= 0 || purchase <= 0 || months <= 0) return null;

    const rules = getTaxRules(fy);

    return calculateCapitalGains(
      {
        assetType,
        salePrice: sale,
        purchasePrice: purchase,
        holdingMonths: months,
        acquisitionBeforeJuly2024,
        indexedCost: indexedCost ? Number(indexedCost) : purchase,
      },
      rules,
    );
  }, [fy, assetType, salePrice, purchasePrice, holdingMonths, acquisitionBeforeJuly2024, indexedCost]);

  const [showImport, setShowImport] = useState(false);

  return (
    <div className="max-w-2xl">
      {/* Import section toggle */}
      <div className="mb-4 flex justify-end">
        <button
          onClick={() => setShowImport(!showImport)}
          className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
        >
          {showImport ? 'Hide broker import' : 'Import from broker CSV'}
        </button>
      </div>
      {showImport && (
        <div className="mb-6 p-4 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Import Capital Gains from Broker</h3>
          <CGImportSection />
        </div>
      )}

      {/* Asset type selector */}
      <div className="mb-5">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Asset Type</p>
        <div className="flex flex-wrap gap-2">
          {ASSET_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setAssetType(opt.value);
                setAcquisitionBeforeJuly2024(false);
                setIndexedCost('');
              }}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium border transition-colors',
                assetType === opt.value
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-blue-400',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Price and holding inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <NumberInput label="Sale Price (₹)" value={salePrice} onChange={setSalePrice} />
        <NumberInput label="Purchase Price (₹)" value={purchasePrice} onChange={setPurchasePrice} />
      </div>
      <div className="mb-5">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Holding Period (months)
        </label>
        <input
          type="number"
          min="0"
          value={holdingMonths}
          onChange={(e) => setHoldingMonths(e.target.value)}
          placeholder="0"
          className="w-full md:w-40 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Real estate: pre-July-2024 indexation option */}
      {assetType === 'realEstate' && (
        <div className="mb-5 border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-gray-50 dark:bg-gray-800/40">
          <label className="flex items-center gap-2 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={acquisitionBeforeJuly2024}
              onChange={(e) => {
                setAcquisitionBeforeJuly2024(e.target.checked);
                if (!e.target.checked) setIndexedCost('');
              }}
              className="accent-blue-600"
            />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Acquired before 23 July 2024
            </span>
          </label>
          {acquisitionBeforeJuly2024 && (
            <NumberInput
              label="Indexed Cost (CII adjusted) (₹)"
              value={indexedCost}
              onChange={setIndexedCost}
              hint="Leave blank to use purchase price if unsure"
            />
          )}
        </div>
      )}

      {/* Result card */}
      {result && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 p-5">
          {/* Gain type badge */}
          <div className="flex items-center gap-3 mb-4">
            <span
              className={cn(
                'px-3 py-1 rounded-full text-sm font-semibold',
                result.gainType === 'LTCG'
                  ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                  : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
              )}
            >
              {result.gainType}
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {result.gainType === 'LTCG' ? 'Long-term capital gain' : 'Short-term capital gain'}
            </span>
          </div>

          {/* Basic breakdown */}
          <div className="space-y-2 text-sm mb-4">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Raw gain</span>
              <span className="font-medium text-gray-700 dark:text-gray-300">{formatINR(result.rawGain)}</span>
            </div>
            {result.exemptionApplied > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Annual exemption (₹1.25L)</span>
                <span className="text-green-600 dark:text-green-400">- {formatINR(result.exemptionApplied)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Taxable gain</span>
              <span className="font-medium text-gray-700 dark:text-gray-300">{formatINR(result.taxableGain)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Tax rate</span>
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {result.taxRate === 'slab'
                  ? 'At slab rate (added to normal income)'
                  : `${(result.taxRate * 100).toFixed(1)}%`}
              </span>
            </div>
            <div className="flex justify-between border-t border-gray-100 dark:border-gray-700 pt-2 mt-2">
              <span className="text-gray-700 dark:text-gray-200 font-semibold">Estimated tax</span>
              <span className="font-bold text-gray-800 dark:text-gray-100">
                {result.taxAmount !== null
                  ? formatINR(result.taxAmount)
                  : 'Added to income — calculate in Income Tax tab'}
              </span>
            </div>
          </div>

          {/* Indexation comparison (pre-July-2024 real estate) */}
          {result.indexationOption && (
            <div className="border-t border-gray-200 dark:border-gray-600 pt-4 mt-2">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                Indexation Comparison
              </p>
              <div className="overflow-x-auto">
              <div className="grid grid-cols-2 gap-3 mb-3 min-w-[280px]">
                {/* With Indexation */}
                <div
                  className={cn(
                    'rounded-lg border p-3',
                    result.indexationOption.recommendedOption === 'withIndexation'
                      ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20'
                      : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40',
                  )}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">With Indexation (20%)</span>
                    {result.indexationOption.recommendedOption === 'withIndexation' && (
                      <span className="text-xs bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200 px-1.5 py-0.5 rounded font-semibold">
                        Lower Tax
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Taxable: {formatINR(result.indexationOption.withIndexation.taxableGain)}
                  </div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 mt-1">
                    Tax: {formatINR(result.indexationOption.withIndexation.taxAmount)}
                  </div>
                </div>

                {/* Without Indexation */}
                <div
                  className={cn(
                    'rounded-lg border p-3',
                    result.indexationOption.recommendedOption === 'withoutIndexation'
                      ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20'
                      : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40',
                  )}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Without Indexation (12.5%)</span>
                    {result.indexationOption.recommendedOption === 'withoutIndexation' && (
                      <span className="text-xs bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200 px-1.5 py-0.5 rounded font-semibold">
                        Lower Tax
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Taxable: {formatINR(result.indexationOption.withoutIndexation.taxableGain)}
                  </div>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200 mt-1">
                    Tax: {formatINR(result.indexationOption.withoutIndexation.taxAmount)}
                  </div>
                </div>
              </div>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Taxpayers who acquired property BEFORE 23 July 2024 may choose either option.
              </p>
            </div>
          )}
        </div>
      )}

      {/* 87A note */}
      <div className="mt-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300">
        Note: Section 87A rebate does NOT apply to LTCG (s.112A) or STCG (s.111A) tax. See the Income Tax tab for combined tax liability.
      </div>
    </div>
  );
}

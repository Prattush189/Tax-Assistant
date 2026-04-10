import { useState, useMemo } from 'react';
import { cn } from '../../lib/utils';
import { formatINR } from '../../lib/utils';
import { calculateTDS, TDS_SECTIONS } from '../../lib/tdsEngine';

export function TdsTab() {
  const [sectionId, setSectionId] = useState(TDS_SECTIONS[0].id);
  const [amount, setAmount] = useState('');
  const [hasPAN, setHasPAN] = useState(true);

  const { result, error } = useMemo(() => {
    const num = Number(amount) || 0;
    if (num <= 0) return { result: null, error: null };

    try {
      const res = calculateTDS({ sectionId, amount: num, hasPAN });
      return { result: res, error: null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : 'Calculation error' };
    }
  }, [amount, sectionId, hasPAN]);

  return (
    <div className="max-w-2xl">
      {/* Payment type selector */}
      <div className="mb-5">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Payment Type</p>
        <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
          {TDS_SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSectionId(s.id)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium border transition-colors',
                sectionId === s.id
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-blue-400',
              )}
            >
              {s.section} - {s.description}
            </button>
          ))}
        </div>
      </div>

      {/* Amount input */}
      <div className="mb-5">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Payment Amount
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">₹</span>
          <input
            type="number"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-full pl-7 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* PAN Available toggle */}
      <div className="mb-6">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">PAN Available</p>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="tds-pan"
              checked={hasPAN}
              onChange={() => setHasPAN(true)}
              className="accent-blue-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Yes</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="tds-pan"
              checked={!hasPAN}
              onChange={() => setHasPAN(false)}
              className="accent-blue-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">No</span>
          </label>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Result card */}
      {result && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 p-5 mb-4">
          {/* Section badge and description */}
          <div className="mb-4">
            <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
              Section {result.section.section}
            </span>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{result.section.description}</p>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Payment amount</span>
              <span className="font-medium text-gray-700 dark:text-gray-300">{formatINR(result.amount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">TDS Rate</span>
              <span className="font-medium text-gray-700 dark:text-gray-300">{(result.tdsRate * 100).toFixed(2)}%</span>
            </div>

            <div className="border-t border-gray-100 dark:border-gray-700 pt-2 mt-1 space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">TDS Amount</span>
                <span className="font-medium text-gray-700 dark:text-gray-300">{formatINR(result.tdsAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 dark:text-gray-100 font-bold">Net Payment</span>
                <span className="text-gray-800 dark:text-gray-100 font-bold">{formatINR(result.netPayment)}</span>
              </div>
            </div>
          </div>

          {/* Threshold note */}
          {result.belowThreshold && (
            <div className="mt-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 text-xs text-yellow-700 dark:text-yellow-300">
              Amount is below the TDS threshold of {formatINR(result.section.threshold)} for Section {result.section.section}. No TDS is applicable.
            </div>
          )}
        </div>
      )}

      {/* Info note */}
      <p className="text-xs text-gray-400 dark:text-gray-500">
        TDS rates as per the Income Tax Act. Section 192 (Salary) TDS is slab-based; the rate shown here is indicative. Without PAN, TDS is deducted at 20% (or 5% for 194-O / 194Q).
      </p>
    </div>
  );
}

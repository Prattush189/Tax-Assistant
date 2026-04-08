import { useState, useMemo } from 'react';
import { cn } from '../../lib/utils';
import { formatINR } from '../../lib/utils';
import { calculateGST } from '../../lib/gstEngine';
import type { GstTransactionType } from '../../types';

const STANDARD_RATES = [0, 5, 18, 40];
const SPECIAL_RATES = [3, 0.25];

export function GstTab() {
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState(18);
  const [transactionType, setTransactionType] = useState<GstTransactionType>('intraState');
  const [amountIncludesGST, setAmountIncludesGST] = useState(false);

  const { result, error } = useMemo(() => {
    const num = Number(amount) || 0;
    if (num <= 0) return { result: null, error: null };

    try {
      const res = calculateGST({ amount: num, rate, transactionType, amountIncludesGST });
      return { result: res, error: null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : 'Calculation error' };
    }
  }, [amount, rate, transactionType, amountIncludesGST]);

  return (
    <div className="max-w-xl">
      {/* Amount input */}
      <div className="mb-5">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {amountIncludesGST ? 'Amount (including GST)' : 'Amount (excluding GST)'}
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -trangray-y-1/2 text-gray-400 dark:text-gray-500 text-sm">₹</span>
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

      {/* Amount type toggle */}
      <div className="mb-5">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Amount type</p>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="gst-inclusive"
              checked={!amountIncludesGST}
              onChange={() => setAmountIncludesGST(false)}
              className="accent-blue-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Amount excludes GST</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="gst-inclusive"
              checked={amountIncludesGST}
              onChange={() => setAmountIncludesGST(true)}
              className="accent-blue-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Amount includes GST</span>
          </label>
        </div>
      </div>

      {/* GST rate selector */}
      <div className="mb-5">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">GST Rate</p>
        <div className="flex flex-wrap gap-2 mb-2">
          {STANDARD_RATES.map((r) => (
            <button
              key={r}
              onClick={() => setRate(r)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium border transition-colors',
                rate === r
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-blue-400',
              )}
            >
              {r}%
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Special rates (Gold / Diamonds)</p>
        <div className="flex flex-wrap gap-2">
          {SPECIAL_RATES.map((r) => (
            <button
              key={r}
              onClick={() => setRate(r)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium border transition-colors',
                rate === r
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-blue-400',
              )}
            >
              {r}%
            </button>
          ))}
        </div>
      </div>

      {/* Transaction type */}
      <div className="mb-6">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Transaction Type</p>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="gst-transaction"
              checked={transactionType === 'intraState'}
              onChange={() => setTransactionType('intraState')}
              className="accent-blue-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Intra-state (CGST + SGST)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="gst-transaction"
              checked={transactionType === 'interState'}
              onChange={() => setTransactionType('interState')}
              className="accent-blue-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Inter-state (IGST)</span>
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
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Taxable amount</span>
              <span className="font-medium text-gray-700 dark:text-gray-300">{formatINR(result.taxableAmount)}</span>
            </div>

            {transactionType === 'intraState' && result.cgst !== undefined && result.sgst !== undefined ? (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">CGST ({rate / 2}%)</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{formatINR(result.cgst)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">SGST ({rate / 2}%)</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{formatINR(result.sgst)}</span>
                </div>
              </>
            ) : (
              result.igst !== undefined && (
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">IGST ({rate}%)</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{formatINR(result.igst)}</span>
                </div>
              )
            )}

            <div className="border-t border-gray-100 dark:border-gray-700 pt-2 mt-1 space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Total GST</span>
                <span className="font-medium text-gray-700 dark:text-gray-300">{formatINR(result.gstAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-800 dark:text-gray-100 font-bold">Total amount</span>
                <span className="text-gray-800 dark:text-gray-100 font-bold">{formatINR(result.totalAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400 dark:text-gray-500">Effective GST rate</span>
                <span className="text-gray-500 dark:text-gray-400">{result.effectiveRate.toFixed(2)}%</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-xs text-gray-400 dark:text-gray-500">
        GST rates per September 2025 GST Council reform. The 12% and 28% slabs were eliminated effective 22 September 2025.
      </p>
    </div>
  );
}

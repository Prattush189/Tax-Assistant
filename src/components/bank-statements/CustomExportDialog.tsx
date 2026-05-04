import { useMemo, useState } from 'react';
import { X, Download, Filter } from 'lucide-react';
import Papa from 'papaparse';
import { BANK_STATEMENT_CATEGORIES } from './lib/categories';
import { cn } from '../../lib/utils';
import type { BankTransaction } from '../../services/api';

interface Props {
  /** All transactions for the statement; we filter client-side. */
  transactions: BankTransaction[];
  /** Default base filename — extension is appended automatically. */
  filenameBase: string;
  onClose: () => void;
}

type DirectionFilter = 'all' | 'credit' | 'debit';

/**
 * Custom export dialog for bank-statement transactions.
 *
 * Lets the user filter by direction (credit / debit / both),
 * categories, amount range, and date range, and exports the
 * matching subset as a .csv (Excel-compatible). The full-statement
 * "CSV" button stays as the one-click full export — this dialog is
 * for cases like "give me all the bank-charges debits over ₹500" or
 * "all September UPI credits to verify against another record."
 *
 * Filtering happens client-side on the already-loaded transactions
 * array; no extra server round-trip.
 */
export function CustomExportDialog({ transactions, filenameBase, onClose }: Props) {
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [categories, setCategories] = useState<Set<string>>(new Set());
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [exporting, setExporting] = useState(false);

  // Categories that actually appear in this statement, in the order
  // they appear in the canonical list. Hides the long tail of unused
  // ones so the picker stays scannable.
  const presentCategories = useMemo(() => {
    const present = new Set(transactions.map(t => t.category));
    return BANK_STATEMENT_CATEGORIES.filter(c => present.has(c));
  }, [transactions]);

  const filtered = useMemo(() => {
    const min = minAmount.trim() === '' ? null : Number(minAmount);
    const max = maxAmount.trim() === '' ? null : Number(maxAmount);
    return transactions.filter(t => {
      // Direction: positive amount = credit, negative = debit. We
      // compare against absolute amount everywhere else since the
      // user types positive numbers in the min/max fields.
      if (direction === 'credit' && t.amount < 0) return false;
      if (direction === 'debit' && t.amount >= 0) return false;
      // Categories: empty selection means "no filter" (include all).
      if (categories.size > 0 && !categories.has(t.category)) return false;
      const abs = Math.abs(t.amount);
      if (min != null && Number.isFinite(min) && abs < min) return false;
      if (max != null && Number.isFinite(max) && abs > max) return false;
      if (fromDate && t.date && t.date < fromDate) return false;
      if (toDate && t.date && t.date > toDate) return false;
      return true;
    });
  }, [transactions, direction, categories, minAmount, maxAmount, fromDate, toDate]);

  const toggleCategory = (cat: string) => {
    setCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleExport = () => {
    if (filtered.length === 0 || exporting) return;
    setExporting(true);
    try {
      // CSV columns mirror the full-statement export so opening side-
      // by-side gives consistent layouts. Amount is split into
      // signed + absolute columns so Excel formulas work either way.
      const rows = filtered.map(t => ({
        Date: t.date ?? '',
        Narration: t.narration ?? '',
        Type: t.amount >= 0 ? 'Credit' : 'Debit',
        Amount: Math.abs(t.amount).toFixed(2),
        SignedAmount: t.amount.toFixed(2),
        Balance: t.balance != null ? t.balance.toFixed(2) : '',
        Category: t.category,
        Subcategory: t.subcategory ?? '',
        Counterparty: t.counterparty ?? '',
        Reference: t.reference ?? '',
        Recurring: t.isRecurring ? 'yes' : 'no',
      }));
      const csv = Papa.unparse(rows);
      // BOM so Excel auto-detects UTF-8 (Indian narrations regularly
      // contain non-ASCII payee names; without the BOM Excel renders
      // them as garbage and the user has to manually re-import).
      const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = filenameBase.replace(/[^a-z0-9_-]+/gi, '_');
      const tag = describeFilter({ direction, categories, minAmount, maxAmount, fromDate, toDate });
      a.href = url;
      a.download = `${safeName}${tag ? `-${tag}` : ''}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onClose();
    } finally {
      setExporting(false);
    }
  };

  const inputClass = "w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 outline-none";
  const labelClass = "block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Custom export</h2>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Direction */}
          <div>
            <label className={labelClass}>Direction</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'all', label: 'All' },
                { value: 'credit', label: 'Credits only' },
                { value: 'debit', label: 'Debits only' },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDirection(opt.value)}
                  className={cn(
                    'px-3 py-2 text-sm rounded-lg border transition-colors',
                    direction === opt.value
                      ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-500 text-emerald-700 dark:text-emerald-300 font-medium'
                      : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Categories */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={labelClass}>Categories</label>
              {categories.size > 0 && (
                <button type="button" onClick={() => setCategories(new Set())} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                  Clear ({categories.size})
                </button>
              )}
            </div>
            {presentCategories.length === 0 ? (
              <p className="text-xs text-gray-500">No categories on this statement.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {presentCategories.map(cat => {
                  const active = categories.has(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => toggleCategory(cat)}
                      className={cn(
                        'px-2.5 py-1 text-xs rounded-full border transition-colors',
                        active
                          ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-500 text-emerald-700 dark:text-emerald-300 font-medium'
                          : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600',
                      )}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-1.5 text-xs text-gray-400">Empty = include all categories.</p>
          </div>

          {/* Amount range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Min amount (₹)</label>
              <input
                type="number"
                inputMode="decimal"
                value={minAmount}
                onChange={e => setMinAmount(e.target.value)}
                placeholder="e.g. 500"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Max amount (₹)</label>
              <input
                type="number"
                inputMode="decimal"
                value={maxAmount}
                onChange={e => setMaxAmount(e.target.value)}
                placeholder="e.g. 50000"
                className={inputClass}
              />
            </div>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>From date</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>To date</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className={inputClass} />
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-5 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-gray-700 dark:text-gray-200">{filtered.length}</span> of {transactions.length} transaction{transactions.length === 1 ? '' : 's'} match.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={filtered.length === 0 || exporting}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Build a short filename suffix describing what the export covers,
 *  so a user with a folder full of exports can tell them apart at a
 *  glance. Returns an empty string when no filter narrowed the set. */
function describeFilter(f: {
  direction: DirectionFilter;
  categories: Set<string>;
  minAmount: string;
  maxAmount: string;
  fromDate: string;
  toDate: string;
}): string {
  const parts: string[] = [];
  if (f.direction !== 'all') parts.push(f.direction);
  if (f.categories.size === 1) parts.push([...f.categories][0].toLowerCase().replace(/\s+/g, '-'));
  else if (f.categories.size > 1) parts.push(`${f.categories.size}cats`);
  if (f.minAmount || f.maxAmount) parts.push('range');
  if (f.fromDate || f.toDate) parts.push('dates');
  return parts.join('-').replace(/[^a-z0-9_-]+/gi, '_');
}

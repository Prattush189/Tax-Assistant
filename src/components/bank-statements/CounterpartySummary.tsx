/**
 * Party-wise breakdown of a bank statement. Two view modes:
 *
 *   Collapsed (default)  — Top 10 by absolute volume, list view.
 *                          Matches the legacy CounterpartySummary
 *                          surface so existing users see no
 *                          regression on first paint.
 *
 *   Expanded             — Full sortable / filterable table over
 *                          every party that appeared on the statement.
 *                          Columns: party, transactions, inflow,
 *                          outflow, net, primary category, first
 *                          seen, last seen.
 *
 * Grouping key: counterparty when extractCounterparty produced one;
 * fingerprint as a fallback for rows where counterparty was null
 * but the narration normalised to something stable. Rows with
 * neither (pure-noise narrations) are dropped from the summary —
 * they wouldn't aggregate meaningfully anyway.
 *
 * Why one component for both modes instead of a separate
 * "PartyWiseBreakdown" panel: the existing CounterpartySummary
 * already lives where the user expects to find party-wise info;
 * splitting that into two components would fragment discoverability.
 * "Show all" toggle is the established pattern.
 */
import { useMemo, useState } from 'react';
import { Users, ArrowUpDown, Search, ChevronDown, ChevronRight, Download, FileText } from 'lucide-react';
import Papa from 'papaparse';
import { BankTransaction } from '../../services/api';
import { formatINRCompact, formatINR, formatDate, cn } from '../../lib/utils';
import { downloadPartyLedgerPdf, downloadCombinedLedgerPdf } from '../../lib/partyLedgerPdf';

interface Props {
  transactions: BankTransaction[];
  /** Statement metadata for the ledger PDF header (bank name, period).
   *  Optional — the ledger derives a period from the txn dates when
   *  absent. */
  meta?: {
    bankName?: string | null;
    accountLabel?: string | null;
    periodFrom?: string | null;
    periodTo?: string | null;
  };
}

interface PartyRow {
  /** Stable display key. Counterparty when present, fingerprint
   *  prefix when not. */
  key: string;
  display: string;
  inflow: number;
  outflow: number;
  net: number;
  count: number;
  /** Most common category for this party. When there's a tie we
   *  pick the lexicographically first — deterministic but
   *  arbitrary; it's a display-only hint, not a filter. */
  primaryCategory: string;
  firstSeen: string | null;
  lastSeen: string | null;
}

type SortKey = 'volume' | 'inflow' | 'outflow' | 'net' | 'count' | 'display';

const COLLAPSED_LIMIT = 10;

/** Build + download a party-wise summary CSV. Client-side so we don't
 *  need a server endpoint — the user already has the aggregated rows
 *  in memory. BOM prefix for Excel; RFC-4180 quoting via Papa. */
function downloadPartyCsv(rows: PartyRow[]) {
  const csv = Papa.unparse({
    fields: ['Party', 'Transactions', 'Inflow', 'Outflow', 'Net', 'Primary Category', 'First Seen', 'Last Seen'],
    data: rows.map((r) => [
      r.display,
      r.count,
      r.inflow,
      r.outflow,
      r.net,
      r.primaryCategory,
      r.firstSeen ?? '',
      r.lastSeen ?? '',
    ]),
  });
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const today = new Date().toISOString().slice(0, 10);
  a.download = `party-summary-${today}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function CounterpartySummary({ transactions, meta }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Same grouping key the aggregation uses (counterparty, else
  // fingerprint), so the ledger for a row pulls exactly that row's
  // transactions back out of the full list.
  const partyKeyOf = (t: BankTransaction) =>
    (t.counterparty ?? '').trim() || (t.fingerprint ?? '').trim();
  const downloadLedger = (row: PartyRow) => {
    const txns = transactions.filter((t) => partyKeyOf(t) === row.key);
    downloadPartyLedgerPdf(row.display, txns, meta ?? {});
  };
  // One PDF, every party as its own ledger-account section. Ordered by
  // volume (largest first) so the parties that matter lead the book.
  const downloadCombined = () => {
    const byKey = new Map<string, BankTransaction[]>();
    for (const t of transactions) {
      const k = partyKeyOf(t);
      if (!k) continue;
      (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(t);
    }
    const ordered = [...rows]
      .sort((a, b) => (b.inflow + b.outflow) - (a.inflow + a.outflow))
      .map((r) => ({ name: r.display, txns: byKey.get(r.key) ?? [] }))
      .filter((p) => p.txns.length > 0);
    downloadCombinedLedgerPdf(ordered, meta ?? {});
  };
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('volume');
  const [sortDesc, setSortDesc] = useState(true);

  const rows = useMemo<PartyRow[]>(() => {
    type Acc = {
      key: string;
      display: string;
      inflow: number;
      outflow: number;
      count: number;
      categoryCounts: Map<string, number>;
      firstSeen: string | null;
      lastSeen: string | null;
    };
    const map = new Map<string, Acc>();

    // BankTransaction.fingerprint is optional (legacy pre-Phase-2
    // rows stay null). When present, we use it as a fallback
    // grouping key for rows where counterparty extraction failed.
    for (const t of transactions) {
      const counterparty = (t.counterparty ?? '').trim();
      const fingerprint = (t.fingerprint ?? '').trim();
      // Pick the most stable identity available. Counterparty wins
      // because it's display-friendly; fingerprint is the fallback
      // for rows where extraction failed.
      const key = counterparty || fingerprint;
      if (!key) continue;
      const display = counterparty || `(${fingerprint.slice(0, 32)})`;
      const acc = map.get(key) ?? {
        key,
        display,
        inflow: 0,
        outflow: 0,
        count: 0,
        categoryCounts: new Map<string, number>(),
        firstSeen: null,
        lastSeen: null,
      };
      if (t.amount >= 0) acc.inflow += t.amount;
      else acc.outflow += Math.abs(t.amount);
      acc.count += 1;
      acc.categoryCounts.set(
        t.category,
        (acc.categoryCounts.get(t.category) ?? 0) + 1,
      );
      // Dates are YYYY-MM-DD strings — lexicographic compare works.
      if (t.date) {
        if (!acc.firstSeen || t.date < acc.firstSeen) acc.firstSeen = t.date;
        if (!acc.lastSeen || t.date > acc.lastSeen) acc.lastSeen = t.date;
      }
      map.set(key, acc);
    }

    const out: PartyRow[] = [];
    for (const acc of map.values()) {
      // Pick the most common category. Stable tie-break by
      // lexicographic order so the display doesn't shuffle between
      // renders.
      let primary = '';
      let primaryCount = -1;
      for (const [cat, c] of acc.categoryCounts) {
        if (c > primaryCount || (c === primaryCount && cat < primary)) {
          primary = cat;
          primaryCount = c;
        }
      }
      out.push({
        key: acc.key,
        display: acc.display,
        inflow: acc.inflow,
        outflow: acc.outflow,
        net: acc.inflow - acc.outflow,
        count: acc.count,
        primaryCategory: primary || 'Other',
        firstSeen: acc.firstSeen,
        lastSeen: acc.lastSeen,
      });
    }
    return out;
  }, [transactions]);

  const filtered = useMemo(() => {
    let result = rows;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((r) =>
        r.display.toLowerCase().includes(q) ||
        r.primaryCategory.toLowerCase().includes(q),
      );
    }
    const sorted = [...result];
    sorted.sort((a, b) => {
      let diff = 0;
      switch (sortKey) {
        case 'volume': diff = (a.inflow + a.outflow) - (b.inflow + b.outflow); break;
        case 'inflow': diff = a.inflow - b.inflow; break;
        case 'outflow': diff = a.outflow - b.outflow; break;
        case 'net': diff = a.net - b.net; break;
        case 'count': diff = a.count - b.count; break;
        case 'display': diff = a.display.localeCompare(b.display); break;
      }
      return sortDesc ? -diff : diff;
    });
    return sorted;
  }, [rows, search, sortKey, sortDesc]);

  if (!rows.length) return null;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDesc((v) => !v);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  // Collapsed = top 10 by volume; preserves legacy UX.
  const collapsedRows = useMemo(() => {
    const sorted = [...rows].sort((a, b) => (b.inflow + b.outflow) - (a.inflow + a.outflow));
    return sorted.slice(0, COLLAPSED_LIMIT);
  }, [rows]);

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-500" />
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">
            {expanded ? 'All counterparties' : 'Top counterparties'}
          </h3>
          <span className="text-xs text-gray-400">({rows.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={downloadCombined}
            title="Download every party as one combined ledger PDF"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 hover:border-emerald-400 dark:hover:border-emerald-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900"
          >
            <FileText className="w-3.5 h-3.5" /> Combined ledger
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:text-emerald-800"
          >
            {expanded ? (
              <>Show top {COLLAPSED_LIMIT} <ChevronRight className="w-3 h-3 rotate-90" /></>
            ) : (
              <>Show all <ChevronDown className="w-3 h-3" /></>
            )}
          </button>
        </div>
      </div>

      {!expanded && (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {collapsedRows.map((row) => (
            <li key={row.key} className="py-2 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate" title={row.display}>
                  {row.display}
                </p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                  {row.count} txn{row.count === 1 ? '' : 's'} · {row.primaryCategory}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs whitespace-nowrap">
                {row.inflow > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{formatINRCompact(row.inflow)}</span>}
                {row.outflow > 0 && <span className="text-rose-600 dark:text-rose-400">−{formatINRCompact(row.outflow)}</span>}
              </div>
              <button
                type="button"
                onClick={() => downloadLedger(row)}
                title={`Download ${row.display} as a ledger PDF`}
                className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 border border-transparent hover:border-emerald-200 dark:hover:border-emerald-800 transition-colors"
              >
                <FileText className="w-3.5 h-3.5" /> Ledger
              </button>
            </li>
          ))}
        </ul>
      )}

      {expanded && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by party or category"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 text-gray-900 dark:text-gray-100"
              />
            </div>
            <button
              type="button"
              onClick={() => downloadPartyCsv(filtered)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 hover:border-emerald-400 dark:hover:border-emerald-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-900"
              title="Download the party-wise summary as CSV"
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto border border-gray-100 dark:border-gray-800 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/60 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 sticky top-0">
                <tr>
                  <SortableHeader label="Party" onClick={() => toggleSort('display')} active={sortKey === 'display'} desc={sortDesc} />
                  <SortableHeader label="Txns" align="right" onClick={() => toggleSort('count')} active={sortKey === 'count'} desc={sortDesc} />
                  <SortableHeader label="Inflow" align="right" onClick={() => toggleSort('inflow')} active={sortKey === 'inflow'} desc={sortDesc} />
                  <SortableHeader label="Outflow" align="right" onClick={() => toggleSort('outflow')} active={sortKey === 'outflow'} desc={sortDesc} />
                  <SortableHeader label="Net" align="right" onClick={() => toggleSort('net')} active={sortKey === 'net'} desc={sortDesc} />
                  <th className="px-3 py-2 text-left font-medium">Category</th>
                  <th className="px-3 py-2 text-left font-medium">First seen</th>
                  <th className="px-3 py-2 text-left font-medium">Last seen</th>
                  <th className="px-3 py-2 text-right font-medium">Ledger</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.map((row) => (
                  <tr key={row.key} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                    <td className="px-3 py-2 max-w-xs">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate" title={row.display}>{row.display}</p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{row.count.toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                      {row.inflow > 0 ? formatINR(row.inflow) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-rose-700 dark:text-rose-400">
                      {row.outflow > 0 ? formatINR(row.outflow) : '—'}
                    </td>
                    <td className={cn(
                      'px-3 py-2 text-right tabular-nums font-medium',
                      row.net > 0 ? 'text-emerald-700 dark:text-emerald-400'
                        : row.net < 0 ? 'text-rose-700 dark:text-rose-400'
                          : 'text-gray-500 dark:text-gray-400',
                    )}>
                      {row.net === 0 ? '—' : `${row.net > 0 ? '+' : '−'}${formatINR(Math.abs(row.net))}`}
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300 text-[12px]">{row.primaryCategory}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-[12px] tabular-nums">{formatDate(row.firstSeen) || '—'}</td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-[12px] tabular-nums">{formatDate(row.lastSeen) || '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => downloadLedger(row)}
                        title={`Download ${row.display} as a ledger PDF`}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 border border-transparent hover:border-emerald-200 dark:hover:border-emerald-800 transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5" /> PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && search.trim() && (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-2">
              No parties match "{search}"
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SortableHeader({
  label, onClick, active, desc, align,
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  desc: boolean;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className={cn(
        'px-3 py-2 font-medium cursor-pointer select-none',
        align === 'right' ? 'text-right' : 'text-left',
      )}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={cn('w-3 h-3', active ? 'text-emerald-600' : 'text-gray-300 dark:text-gray-600')} />
        {active && <span className="text-[9px] text-emerald-600">{desc ? '↓' : '↑'}</span>}
      </span>
    </th>
  );
}

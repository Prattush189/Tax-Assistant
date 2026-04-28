import { useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { formatINRPrecise, formatDate } from '../../lib/utils';
import { BankStatementDetail } from '../../hooks/useBankStatementManager';
import { downloadBankStatementCsv } from '../../services/api';

interface Props {
  detail: BankStatementDetail;
  onDelete: () => void;
}

export function BankStatementSummary({ detail, onDelete }: Props) {
  const { statement } = detail;
  const net = statement.totalInflow - statement.totalOutflow;
  const [downloading, setDownloading] = useState(false);

  const handleCsvDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadBankStatementCsv(statement.id, statement.name ?? statement.bankName ?? 'statement');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'CSV download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50">
            {statement.bankName ?? 'Bank Statement'}
            {statement.accountNumberMasked && (
              <span className="ml-2 text-sm font-normal text-gray-500">· {statement.accountNumberMasked}</span>
            )}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {statement.periodFrom && statement.periodTo
              ? `${formatDate(statement.periodFrom)} – ${formatDate(statement.periodTo)}`
              : 'Period not detected'}
            {' · '}
            {statement.txCount} transactions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCsvDownload}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            {downloading ? 'Downloading…' : 'CSV'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-red-50 hover:bg-red-100 text-red-700 dark:bg-red-900/20 dark:hover:bg-red-900/40 dark:text-red-400 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 p-4">
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">Inflow</p>
          <p className="text-2xl font-semibold text-emerald-800 dark:text-emerald-300 mt-1 tabular-nums">{formatINRPrecise(statement.totalInflow)}</p>
        </div>
        <div className="rounded-xl bg-rose-50 dark:bg-rose-900/20 p-4">
          <p className="text-xs font-medium text-rose-700 dark:text-rose-400 uppercase tracking-wide">Outflow</p>
          <p className="text-2xl font-semibold text-rose-800 dark:text-rose-300 mt-1 tabular-nums">{formatINRPrecise(statement.totalOutflow)}</p>
        </div>
        <div className={`rounded-xl p-4 ${net >= 0 ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-amber-50 dark:bg-amber-900/20'}`}>
          <p className={`text-xs font-medium uppercase tracking-wide ${net >= 0 ? 'text-blue-700 dark:text-blue-400' : 'text-amber-700 dark:text-amber-400'}`}>Net</p>
          <p className={`text-2xl font-semibold mt-1 tabular-nums ${net >= 0 ? 'text-blue-800 dark:text-blue-300' : 'text-amber-800 dark:text-amber-300'}`}>
            {formatINRPrecise(net)}
          </p>
        </div>
      </div>
    </div>
  );
}

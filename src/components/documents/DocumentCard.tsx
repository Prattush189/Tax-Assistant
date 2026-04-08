import { X, FileText } from 'lucide-react';
import { DocumentContext } from '../../types';
import { cn } from '../../lib/utils';

function formatINR(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
}

interface DocumentCardProps {
  document: DocumentContext;
  onDismiss: () => void;
}

export function DocumentCard({ document, onDismiss }: DocumentCardProps) {
  const d = document.extractedData;

  return (
    <div className={cn(
      "rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-4 space-y-3"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
          <div>
            <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{document.filename}</p>
            {d.documentType && (
              <p className="text-xs text-green-700 dark:text-green-400">{d.documentType}{d.financialYear ? ` · FY ${d.financialYear}` : ''}</p>
            )}
          </div>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss document"
          className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/50 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {d.summary && (
        <p className="text-sm text-gray-600 dark:text-gray-400 italic">{d.summary}</p>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {d.employerName && (
          <><span className="text-gray-500 dark:text-gray-400">Employer</span><span className="text-gray-800 dark:text-gray-100 font-medium">{d.employerName}</span></>
        )}
        {d.employeeName && (
          <><span className="text-gray-500 dark:text-gray-400">Employee</span><span className="text-gray-800 dark:text-gray-100 font-medium">{d.employeeName}</span></>
        )}
        {d.pan && (
          <><span className="text-gray-500 dark:text-gray-400">PAN</span><span className="text-gray-800 dark:text-gray-100 font-medium font-mono">{d.pan}</span></>
        )}
        {d.grossSalary !== null && (
          <><span className="text-gray-500 dark:text-gray-400">Gross Salary</span><span className="text-gray-800 dark:text-gray-100 font-medium">{formatINR(d.grossSalary)}</span></>
        )}
        {d.taxableSalary !== null && (
          <><span className="text-gray-500 dark:text-gray-400">Taxable Salary</span><span className="text-gray-800 dark:text-gray-100 font-medium">{formatINR(d.taxableSalary)}</span></>
        )}
        {d.tdsDeducted !== null && (
          <><span className="text-gray-500 dark:text-gray-400">TDS Deducted</span><span className="text-emerald-700 dark:text-emerald-400 font-medium">{formatINR(d.tdsDeducted)}</span></>
        )}
        {d.deductions80C !== null && (
          <><span className="text-gray-500 dark:text-gray-400">80C</span><span className="text-gray-800 dark:text-gray-100 font-medium">{formatINR(d.deductions80C)}</span></>
        )}
        {d.deductions80D !== null && (
          <><span className="text-gray-500 dark:text-gray-400">80D</span><span className="text-gray-800 dark:text-gray-100 font-medium">{formatINR(d.deductions80D)}</span></>
        )}
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500">Document active — ask questions about it in the Chat tab.</p>
    </div>
  );
}

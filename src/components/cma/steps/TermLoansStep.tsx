import { Plus, Trash2 } from 'lucide-react';
import { Card, Field, Grid2, NumberInput, TextInput } from '../../itr/shared/Inputs';
import type { CmaDraft, TermLoan } from '../lib/uiModel';
import { cn } from '../../../lib/utils';

interface Props {
  draft: CmaDraft;
  onChange: (patch: Partial<CmaDraft>) => void;
}

export function TermLoansStep({ draft, onChange }: Props) {
  const loans = draft.termLoans ?? [];

  const setLoans = (next: TermLoan[]) => onChange({ termLoans: next });
  const updateLoan = (idx: number, p: Partial<TermLoan>) => {
    setLoans(loans.map((l, i) => (i === idx ? { ...l, ...p } : l)));
  };
  const addLoan = (status: TermLoan['status']) => {
    setLoans([...loans, { status, repaymentType: 'equal_principal' }]);
  };

  return (
    <div className="space-y-4">
      <Card
        title={`Existing & proposed term loans (${loans.length})`}
        action={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => addLoan('existing')}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200"
            >
              <Plus className="w-3 h-3" /> Existing
            </button>
            <button
              type="button"
              onClick={() => addLoan('proposed')}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg hover:bg-emerald-100"
            >
              <Plus className="w-3 h-3" /> Proposed
            </button>
          </div>
        }
      >
        {loans.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
            No term loans yet. Click <span className="font-medium">Existing</span> for a loan already on the books, or{' '}
            <span className="font-medium">Proposed</span> for the loan being applied for.
          </p>
        )}
        <div className="space-y-3">
          {loans.map((loan, idx) => (
            <div
              key={idx}
              className={cn(
                'border rounded-xl p-4 space-y-3',
                loan.status === 'proposed'
                  ? 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/30 dark:bg-emerald-900/10'
                  : 'border-gray-200 dark:border-gray-800 bg-gray-50/30 dark:bg-gray-900/30',
              )}
            >
              <div className="flex items-center justify-between">
                <p className={cn(
                  'text-xs font-semibold uppercase tracking-wider',
                  loan.status === 'proposed' ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-600 dark:text-gray-400',
                )}>
                  {loan.status} loan #{idx + 1}
                </p>
                <button
                  type="button"
                  onClick={() => setLoans(loans.filter((_, i) => i !== idx))}
                  className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <Grid2>
                <Field label="Lender">
                  <TextInput value={loan.lender} onChange={(v) => updateLoan(idx, { lender: v })} placeholder="HDFC Bank" />
                </Field>
                <Field label="Principal (Rs.)" required>
                  <NumberInput value={loan.principal} onChange={(v) => updateLoan(idx, { principal: v ?? undefined })} placeholder="5000000" />
                </Field>
              </Grid2>
              <Grid2>
                <Field label="Interest rate %" required>
                  <NumberInput value={loan.interestRatePct} onChange={(v) => updateLoan(idx, { interestRatePct: v ?? undefined })} placeholder="11.5" />
                </Field>
                <Field label="Tenure (months)" required>
                  <NumberInput value={loan.tenureMonths} onChange={(v) => updateLoan(idx, { tenureMonths: v ?? undefined })} placeholder="60" />
                </Field>
              </Grid2>
              <Grid2>
                <Field label="Moratorium (months)" hint="Interest-only period before principal repayment begins">
                  <NumberInput value={loan.moratoriumMonths} onChange={(v) => updateLoan(idx, { moratoriumMonths: v ?? undefined })} placeholder="6" />
                </Field>
                <Field label={loan.status === 'proposed' ? 'Sanction date' : 'Drawn on'}>
                  <input
                    type="date"
                    value={loan.drawnAt ?? ''}
                    onChange={(e) => updateLoan(idx, { drawnAt: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-100"
                  />
                </Field>
              </Grid2>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

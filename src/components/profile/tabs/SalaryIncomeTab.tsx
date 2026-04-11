import { ProfileManager } from '../../../hooks/useProfileManager';
import { PerAySlice, SalaryEmployer, ensureAySlice, emptyPerAy } from '../lib/profileModel';
import { Card, Field, Grid2, TextInput, RupeeInput, Accordion } from '../../itr/shared/Inputs';
import { Plus, Trash2 } from 'lucide-react';

interface Props {
  manager: ProfileManager;
}

export function SalaryIncomeTab({ manager }: Props) {
  const perAy = manager.currentProfile?.perAy ?? {};
  const slice: PerAySlice = ensureAySlice(perAy, manager.selectedAy);
  const salary = slice.salary ?? {};
  const employers: SalaryEmployer[] = salary.employers ?? [];

  const patch = (p: Partial<PerAySlice['salary']>) => {
    const next: PerAySlice = { ...(slice ?? emptyPerAy()), salary: { ...salary, ...p } };
    manager.updatePerAy(next as unknown as Record<string, unknown>);
  };

  const addEmployer = () =>
    patch({
      employers: [
        ...employers,
        {
          uid: crypto.randomUUID(),
          employerName: '',
          tan: '',
          grossSalary: 0,
          tdsOnSalary: 0,
        },
      ],
    });

  const updateEmployer = (uid: string, u: Partial<SalaryEmployer>) =>
    patch({ employers: employers.map((e) => (e.uid === uid ? { ...e, ...u } : e)) });

  const removeEmployer = (uid: string) =>
    patch({ employers: employers.filter((e) => e.uid !== uid) });

  const totalGross = employers.reduce((a, e) => a + (Number(e.grossSalary) || 0), 0);
  const totalTds = employers.reduce((a, e) => a + (Number(e.tdsOnSalary) || 0), 0);

  return (
    <div className="space-y-4">
      <Card
        title={`Salary income · AY ${manager.selectedAy}`}
        action={
          <button
            onClick={addEmployer}
            className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add employer
          </button>
        }
      >
        {employers.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center">
            No employers yet.
          </p>
        ) : (
          <div className="space-y-3">
            {employers.map((e, i) => (
              <div key={e.uid} className="p-3 border border-gray-200 dark:border-gray-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">
                    Employer {i + 1}
                  </p>
                  <button
                    onClick={() => removeEmployer(e.uid)}
                    className="text-red-500 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Grid2>
                  <Field label="Employer name">
                    <TextInput
                      value={e.employerName}
                      onChange={(v) => updateEmployer(e.uid, { employerName: v })}
                      maxLength={75}
                    />
                  </Field>
                  <Field label="TAN">
                    <TextInput
                      value={e.tan}
                      onChange={(v) => updateEmployer(e.uid, { tan: v })}
                      maxLength={10}
                      uppercase
                    />
                  </Field>
                </Grid2>
                <Grid2>
                  <Field label="Gross salary">
                    <RupeeInput
                      value={e.grossSalary}
                      onChange={(v) => updateEmployer(e.uid, { grossSalary: v })}
                    />
                  </Field>
                  <Field label="TDS on salary">
                    <RupeeInput
                      value={e.tdsOnSalary}
                      onChange={(v) => updateEmployer(e.uid, { tdsOnSalary: v })}
                    />
                  </Field>
                </Grid2>
              </div>
            ))}
            <div className="pt-3 border-t border-gray-200 dark:border-gray-800 grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Total gross</span>
                <span className="font-bold text-gray-900 dark:text-gray-100">₹{totalGross.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Total TDS</span>
                <span className="font-bold text-gray-900 dark:text-gray-100">₹{totalTds.toLocaleString('en-IN')}</span>
              </div>
            </div>
          </div>
        )}

        <Accordion
          title="Additional salary fields"
          subtitle="Perquisites, profits in lieu, standard deduction"
        >
          <Grid2>
            <Field label="Perquisites (17(2))">
              <RupeeInput value={salary.perquisites} onChange={(v) => patch({ perquisites: v })} />
            </Field>
            <Field label="Profits in lieu (17(3))">
              <RupeeInput
                value={salary.profitsInSalary}
                onChange={(v) => patch({ profitsInSalary: v })}
              />
            </Field>
          </Grid2>
          <Grid2>
            <Field label="Standard deduction u/s 16(ia)" hint="New regime: ₹75,000 · Old: ₹50,000">
              <RupeeInput
                value={salary.standardDeduction}
                onChange={(v) => patch({ standardDeduction: v })}
              />
            </Field>
            <Field label="Professional tax u/s 16(iii)">
              <RupeeInput
                value={salary.professionalTax}
                onChange={(v) => patch({ professionalTax: v })}
              />
            </Field>
          </Grid2>
        </Accordion>
      </Card>

      <Card title={`Other sources · AY ${manager.selectedAy}`}>
        <Field label="Total income from other sources" hint="Savings interest, FD, dividends, family pension…">
          <RupeeInput
            value={salary.otherSourcesIncome}
            onChange={(v) => patch({ otherSourcesIncome: v })}
          />
        </Field>
      </Card>
    </div>
  );
}

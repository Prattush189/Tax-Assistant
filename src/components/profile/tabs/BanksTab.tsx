import { ProfileManager } from '../../../hooks/useProfileManager';
import { BankSlice, AccountType } from '../lib/profileModel';
import { Card, Field, Grid2, TextInput, Select, IfscInput } from '../../itr/shared/Inputs';
import { Plus, Trash2, Star } from 'lucide-react';

const ACCOUNT_TYPES: ReadonlyArray<{ code: AccountType; label: string }> = [
  { code: 'SB', label: 'Savings' },
  { code: 'CA', label: 'Current' },
  { code: 'CC', label: 'Cash credit' },
  { code: 'OD', label: 'Overdraft' },
  { code: 'NRO', label: 'NRO' },
  { code: 'OTH', label: 'Other' },
];

interface Props {
  manager: ProfileManager;
}

export function BanksTab({ manager }: Props) {
  const banks = (manager.currentProfile?.banks as BankSlice[]) ?? [];

  const write = (next: BankSlice[]) => {
    // Defensive: ensure exactly one default when list is non-empty
    if (next.length > 0 && !next.some((b) => b.isDefault)) {
      next = next.map((b, i) => ({ ...b, isDefault: i === 0 }));
    }
    manager.updateBanks(next);
  };

  const addBank = () =>
    write([
      ...banks,
      {
        uid: crypto.randomUUID(),
        ifsc: '',
        name: '',
        accountNo: '',
        type: 'SB',
        isDefault: banks.length === 0,
      },
    ]);

  const updateBank = (uid: string, p: Partial<BankSlice>) =>
    write(banks.map((b) => (b.uid === uid ? { ...b, ...p } : b)));

  const removeBank = (uid: string) => write(banks.filter((b) => b.uid !== uid));

  const markDefault = (uid: string) =>
    write(banks.map((b) => ({ ...b, isDefault: b.uid === uid })));

  return (
    <div className="space-y-4">
      <Card
        title="Bank accounts"
        action={
          <button
            onClick={addBank}
            className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add bank
          </button>
        }
      >
        {banks.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center">
            No bank accounts. Click "Add bank" to add one.
          </p>
        ) : (
          <div className="space-y-3">
            {banks.map((b, i) => (
              <div key={b.uid} className="p-3 border border-gray-200 dark:border-gray-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">
                      Bank {i + 1}
                    </p>
                    {b.isDefault && (
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                        Default
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {!b.isDefault && (
                      <button
                        onClick={() => markDefault(b.uid)}
                        className="text-xs text-gray-500 hover:text-emerald-600 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors flex items-center gap-1"
                      >
                        <Star className="w-3.5 h-3.5" />
                        Set default
                      </button>
                    )}
                    <button
                      onClick={() => removeBank(b.uid)}
                      className="text-red-500 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <Grid2>
                  <Field label="IFSC">
                    <IfscInput value={b.ifsc} onChange={(v) => updateBank(b.uid, { ifsc: v })} />
                  </Field>
                  <Field label="Bank name">
                    <TextInput
                      value={b.name}
                      onChange={(v) => updateBank(b.uid, { name: v })}
                      maxLength={75}
                    />
                  </Field>
                </Grid2>
                <Grid2>
                  <Field label="Account number">
                    <TextInput
                      value={b.accountNo}
                      onChange={(v) => updateBank(b.uid, { accountNo: v })}
                      maxLength={25}
                    />
                  </Field>
                  <Field label="Account type">
                    <Select
                      value={b.type}
                      onChange={(v) => updateBank(b.uid, { type: v })}
                      options={ACCOUNT_TYPES}
                    />
                  </Field>
                </Grid2>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

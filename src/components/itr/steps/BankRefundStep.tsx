import { ItrWizardDraft, UiBankDetail } from '../lib/uiModel';
import { Card, Field, Grid2, TextInput, Select, IfscInput } from '../shared/Inputs';
import { Plus, Trash2, Star } from 'lucide-react';
import { LoadFromProfile } from '../../profile/shared/LoadFromProfile';
import { profileToItrBanks } from '../../profile/lib/prefillAdapters';

interface Props {
  draft: ItrWizardDraft;
  onChange: (patch: Partial<ItrWizardDraft> | ((p: ItrWizardDraft) => ItrWizardDraft)) => void;
}

const ACCOUNT_TYPES: ReadonlyArray<{ code: NonNullable<UiBankDetail['AccountType']>; label: string }> = [
  { code: 'SB', label: 'Savings' },
  { code: 'CA', label: 'Current' },
  { code: 'CC', label: 'Cash credit' },
  { code: 'OD', label: 'Overdraft' },
  { code: 'NRO', label: 'NRO' },
  { code: 'OTH', label: 'Other' },
];

export function BankRefundStep({ draft, onChange }: Props) {
  const banks = draft.Refund?.BankAccountDtls?.AddtnlBankDetails ?? [];

  const patchBanks = (next: UiBankDetail[]) => {
    onChange((prev) => ({
      ...prev,
      Refund: {
        ...(prev.Refund ?? {}),
        BankAccountDtls: { AddtnlBankDetails: next },
      },
    }));
  };

  const addBank = () => {
    patchBanks([
      ...banks,
      {
        IFSCCode: '',
        BankName: '',
        BankAccountNo: '',
        AccountType: 'SB',
        UseForRefund: banks.length === 0 ? 'true' : 'false',
      },
    ]);
  };

  const updateBank = (i: number, patch: Partial<UiBankDetail>) => {
    patchBanks(banks.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  };

  const removeBank = (i: number) => {
    const next = banks.filter((_, idx) => idx !== i);
    // Ensure a refund target always exists when possible
    if (next.length > 0 && !next.some((b) => b.UseForRefund === 'true')) {
      next[0] = { ...next[0], UseForRefund: 'true' };
    }
    patchBanks(next);
  };

  const markPrimary = (i: number) => {
    patchBanks(banks.map((b, idx) => ({ ...b, UseForRefund: idx === i ? 'true' : 'false' })));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <LoadFromProfile
          onPick={(profile) => onChange((prev) => profileToItrBanks(profile, prev))}
          label="Load banks"
        />
      </div>
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
            At least one bank account is required. Click "Add bank".
          </p>
        ) : (
          <div className="space-y-3">
            {banks.map((b, i) => {
              const isPrimary = b.UseForRefund === 'true';
              return (
                <div
                  key={i}
                  className="p-3 border border-gray-200 dark:border-gray-800 rounded-xl space-y-3 relative"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">
                        Bank {i + 1}
                      </p>
                      {isPrimary && (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                          Refund
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {!isPrimary && (
                        <button
                          onClick={() => markPrimary(i)}
                          className="text-xs text-gray-500 hover:text-emerald-600 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors flex items-center gap-1"
                        >
                          <Star className="w-3.5 h-3.5" />
                          Set refund
                        </button>
                      )}
                      <button
                        onClick={() => removeBank(i)}
                        className="text-red-500 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <Grid2>
                    <Field label="IFSC">
                      <IfscInput value={b.IFSCCode} onChange={(v) => updateBank(i, { IFSCCode: v })} />
                    </Field>
                    <Field label="Bank name">
                      <TextInput
                        value={b.BankName}
                        onChange={(v) => updateBank(i, { BankName: v })}
                        maxLength={75}
                      />
                    </Field>
                  </Grid2>
                  <Grid2>
                    <Field label="Account number">
                      <TextInput
                        value={b.BankAccountNo}
                        onChange={(v) => updateBank(i, { BankAccountNo: v })}
                        maxLength={25}
                      />
                    </Field>
                    <Field label="Account type">
                      <Select
                        value={b.AccountType}
                        onChange={(v) => updateBank(i, { AccountType: v })}
                        options={ACCOUNT_TYPES}
                      />
                    </Field>
                  </Grid2>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

import {
  BoardResolutionDraft,
  AppointmentBody,
  BankAccountBody,
  BorrowingBody,
  AllotmentBody,
  BankSignatory,
  Allottee,
  DirectorDesignation,
} from '../lib/uiModel';
import {
  Card,
  Field,
  Grid2,
  TextInput,
  NumberInput,
  RupeeInput,
  IfscInput,
  PanInput,
  Select,
  Toggle,
} from '../../itr/shared/Inputs';
import { Plus, X } from 'lucide-react';

interface Props {
  draft: BoardResolutionDraft;
  onChange: (patch: Partial<BoardResolutionDraft> | ((p: BoardResolutionDraft) => BoardResolutionDraft)) => void;
}

export function ResolutionBodyStep({ draft, onChange }: Props) {
  switch (draft.templateId) {
    case 'appointment_of_director':
      return <AppointmentBodyForm draft={draft} onChange={onChange} />;
    case 'bank_account_opening':
      return <BankAccountBodyForm draft={draft} onChange={onChange} />;
    case 'borrowing_powers':
      return <BorrowingBodyForm draft={draft} onChange={onChange} />;
    case 'share_allotment':
      return <AllotmentBodyForm draft={draft} onChange={onChange} />;
    default:
      return null;
  }
}

// ── Appointment of director ─────────────────────────────────────────────

const DESIGNATION_OPTIONS: ReadonlyArray<{ code: DirectorDesignation; label: string }> = [
  { code: 'additional', label: 'Additional Director' },
  { code: 'executive', label: 'Executive Director' },
  { code: 'non_executive', label: 'Non-Executive Director' },
  { code: 'independent', label: 'Independent Director' },
  { code: 'whole_time', label: 'Whole-time Director' },
];

function AppointmentBodyForm({ draft, onChange }: Props) {
  const a = draft.appointment ?? {};
  const patch = (p: Partial<AppointmentBody>) => {
    onChange((prev) => ({ ...prev, appointment: { ...(prev.appointment ?? {}), ...p } }));
  };
  return (
    <div className="space-y-4">
      <Card title="Director details">
        <Grid2>
          <Field label="Director name" required>
            <TextInput value={a.directorName} onChange={(v) => patch({ directorName: v })} placeholder="John Doe" />
          </Field>
          <Field label="DIN" required hint="8-digit Director Identification Number">
            <TextInput
              value={a.din}
              onChange={(v) => patch({ din: v.replace(/\D/g, '') })}
              placeholder="01234567"
              maxLength={8}
            />
          </Field>
        </Grid2>
        <Grid2>
          <Field label="Designation" required>
            <Select
              value={a.designation}
              onChange={(v) => patch({ designation: v })}
              options={DESIGNATION_OPTIONS}
            />
          </Field>
          <Field label="Appointment date" required hint="DD/MM/YYYY">
            <TextInput
              value={a.appointmentDate}
              onChange={(v) => patch({ appointmentDate: v })}
              placeholder="01/04/2026"
            />
          </Field>
        </Grid2>
      </Card>

      <Card title="Supporting documents on file">
        <div className="space-y-3">
          <Toggle
            checked={a.dir2ConsentOnFile ?? false}
            onChange={(v) => patch({ dir2ConsentOnFile: v })}
            label="Form DIR-2 (written consent to act as director) received"
          />
          <Toggle
            checked={a.dir8DeclarationOnFile ?? false}
            onChange={(v) => patch({ dir8DeclarationOnFile: v })}
            label="Form DIR-8 (declaration of non-disqualification) received"
          />
        </div>
      </Card>
    </div>
  );
}

// ── Bank account opening ────────────────────────────────────────────────

const ACCOUNT_TYPE_OPTIONS: ReadonlyArray<{ code: 'current' | 'cash_credit' | 'overdraft' | 'savings'; label: string }> = [
  { code: 'current', label: 'Current Account' },
  { code: 'cash_credit', label: 'Cash Credit' },
  { code: 'overdraft', label: 'Overdraft' },
  { code: 'savings', label: 'Savings' },
];

const MODE_OPTIONS: ReadonlyArray<{ code: 'singly' | 'jointly'; label: string }> = [
  { code: 'singly', label: 'Singly' },
  { code: 'jointly', label: 'Jointly' },
];

function BankAccountBodyForm({ draft, onChange }: Props) {
  const b = draft.bankAccount ?? {};
  const patch = (p: Partial<BankAccountBody>) => {
    onChange((prev) => ({ ...prev, bankAccount: { ...(prev.bankAccount ?? {}), ...p } }));
  };

  const sigs = b.signatories ?? [];
  const addSig = () => patch({ signatories: [...sigs, {}] });
  const updateSig = (i: number, p: Partial<BankSignatory>) => {
    const next = sigs.map((s, idx) => (idx === i ? { ...s, ...p } : s));
    patch({ signatories: next });
  };
  const removeSig = (i: number) => {
    patch({ signatories: sigs.filter((_, idx) => idx !== i) });
  };

  return (
    <div className="space-y-4">
      <Card title="Bank details">
        <Grid2>
          <Field label="Bank name" required>
            <TextInput value={b.bankName} onChange={(v) => patch({ bankName: v })} placeholder="State Bank of India" />
          </Field>
          <Field label="Branch" required>
            <TextInput value={b.branch} onChange={(v) => patch({ branch: v })} placeholder="MG Road" />
          </Field>
        </Grid2>
        <Grid2>
          <Field label="IFSC">
            <IfscInput value={b.ifsc} onChange={(v) => patch({ ifsc: v })} />
          </Field>
          <Field label="Account type" required>
            <Select
              value={b.accountType}
              onChange={(v) => patch({ accountType: v })}
              options={ACCOUNT_TYPE_OPTIONS}
            />
          </Field>
        </Grid2>
        <Field label="Purpose" required hint="e.g. day-to-day banking, payroll">
          <TextInput value={b.purpose} onChange={(v) => patch({ purpose: v })} placeholder="Day-to-day banking operations" />
        </Field>
      </Card>

      <Card
        title={`Authorised signatories (${sigs.length})`}
        action={
          <button
            type="button"
            onClick={addSig}
            className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
          >
            <Plus className="w-3.5 h-3.5" />
            Add signatory
          </button>
        }
      >
        {sigs.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">No signatories yet. Click "Add signatory" to add one.</p>
        ) : (
          <div className="space-y-4">
            {sigs.map((s, i) => (
              <div key={i} className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Signatory {i + 1}</p>
                  <button
                    type="button"
                    onClick={() => removeSig(i)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <Grid2>
                  <Field label="Name">
                    <TextInput value={s.name} onChange={(v) => updateSig(i, { name: v })} placeholder="Jane Smith" />
                  </Field>
                  <Field label="Designation">
                    <TextInput value={s.designation} onChange={(v) => updateSig(i, { designation: v })} placeholder="Director" />
                  </Field>
                </Grid2>
                <Field label="Operating mode">
                  <Select
                    value={s.mode}
                    onChange={(v) => updateSig(i, { mode: v })}
                    options={MODE_OPTIONS}
                  />
                </Field>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Borrowing powers ────────────────────────────────────────────────────

function BorrowingBodyForm({ draft, onChange }: Props) {
  const b = draft.borrowing ?? {};
  const patch = (p: Partial<BorrowingBody>) => {
    onChange((prev) => ({ ...prev, borrowing: { ...(prev.borrowing ?? {}), ...p } }));
  };
  return (
    <div className="space-y-4">
      <Card title="Borrowing details">
        <Field label="Borrowing ceiling" required hint="Aggregate amount in rupees">
          <RupeeInput value={b.ceiling} onChange={(v) => patch({ ceiling: v })} placeholder="10000000" />
        </Field>
        <Field label="Lender name" required>
          <TextInput value={b.lenderName} onChange={(v) => patch({ lenderName: v })} placeholder="HDFC Bank Ltd" />
        </Field>
        <Field label="Purpose" required hint="Why the loan is being taken">
          <TextInput value={b.purpose} onChange={(v) => patch({ purpose: v })} placeholder="Working capital requirements" />
        </Field>
      </Card>

      <Card title="Authorised signatory">
        <Grid2>
          <Field label="Name" required>
            <TextInput
              value={b.authorisedOfficerName}
              onChange={(v) => patch({ authorisedOfficerName: v })}
              placeholder="Jane Smith"
            />
          </Field>
          <Field label="Designation" required>
            <TextInput
              value={b.authorisedOfficerDesignation}
              onChange={(v) => patch({ authorisedOfficerDesignation: v })}
              placeholder="Director"
            />
          </Field>
        </Grid2>
      </Card>
    </div>
  );
}

// ── Share allotment ─────────────────────────────────────────────────────

const CONSIDERATION_OPTIONS: ReadonlyArray<{ code: 'cash' | 'other'; label: string }> = [
  { code: 'cash', label: 'Cash (through banking channels)' },
  { code: 'other', label: 'Other than cash' },
];

function AllotmentBodyForm({ draft, onChange }: Props) {
  const a = draft.allotment ?? {};
  const patch = (p: Partial<AllotmentBody>) => {
    onChange((prev) => ({ ...prev, allotment: { ...(prev.allotment ?? {}), ...p } }));
  };

  const allottees = a.allottees ?? [];
  const addAllottee = () => patch({ allottees: [...allottees, {}] });
  const updateAllottee = (i: number, p: Partial<Allottee>) => {
    const next = allottees.map((x, idx) => (idx === i ? { ...x, ...p } : x));
    patch({ allottees: next });
  };
  const removeAllottee = (i: number) => {
    patch({ allottees: allottees.filter((_, idx) => idx !== i) });
  };

  return (
    <div className="space-y-4">
      <Card title="Issue details">
        <Grid2>
          <Field label="Number of shares" required>
            <NumberInput
              value={a.numberOfShares}
              onChange={(v) => patch({ numberOfShares: v })}
              placeholder="1000"
              min={1}
            />
          </Field>
          <Field label="Face value" required hint="Per share, in rupees">
            <RupeeInput value={a.faceValue} onChange={(v) => patch({ faceValue: v })} placeholder="10" />
          </Field>
        </Grid2>
        <Grid2>
          <Field label="Premium" hint="Per share, above face value">
            <RupeeInput value={a.premium} onChange={(v) => patch({ premium: v })} placeholder="0" />
          </Field>
          <Field label="Consideration mode" required>
            <Select
              value={a.considerationMode}
              onChange={(v) => patch({ considerationMode: v })}
              options={CONSIDERATION_OPTIONS}
            />
          </Field>
        </Grid2>
      </Card>

      <Card
        title={`Allottees (${allottees.length})`}
        action={
          <button
            type="button"
            onClick={addAllottee}
            className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
          >
            <Plus className="w-3.5 h-3.5" />
            Add allottee
          </button>
        }
      >
        {allottees.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">No allottees yet. Click "Add allottee" to add one.</p>
        ) : (
          <div className="space-y-4">
            {allottees.map((x, i) => (
              <div key={i} className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Allottee {i + 1}</p>
                  <button
                    type="button"
                    onClick={() => removeAllottee(i)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <Grid2>
                  <Field label="Name">
                    <TextInput value={x.name} onChange={(v) => updateAllottee(i, { name: v })} placeholder="Investor Name" />
                  </Field>
                  <Field label="PAN">
                    <PanInput value={x.pan} onChange={(v) => updateAllottee(i, { pan: v })} />
                  </Field>
                </Grid2>
                <Grid2>
                  <Field label="Shares">
                    <NumberInput value={x.shares} onChange={(v) => updateAllottee(i, { shares: v })} placeholder="500" min={1} />
                  </Field>
                  <Field label="Consideration (₹)">
                    <RupeeInput value={x.consideration} onChange={(v) => updateAllottee(i, { consideration: v })} placeholder="50000" />
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

import { PartnershipDeedDraft, FirmCore, DurationKind } from '../lib/uiModel';
import { INDIAN_STATES } from '../lib/states';
import { Card, Field, Grid2, TextInput } from '../../itr/shared/Inputs';
import { cn } from '../../../lib/utils';

interface Props {
  draft: PartnershipDeedDraft;
  onChange: (
    patch: Partial<PartnershipDeedDraft> | ((p: PartnershipDeedDraft) => PartnershipDeedDraft),
  ) => void;
}

export function FirmInfoStep({ draft, onChange }: Props) {
  const f = draft.firm ?? {};
  const patch = (p: Partial<FirmCore>) => {
    onChange((prev) => ({ ...prev, firm: { ...(prev.firm ?? {}), ...p } }));
  };

  const setDuration = (kind: DurationKind) => {
    patch({ duration: { kind, fixedUntil: kind === 'fixed' ? f.duration?.fixedUntil : undefined } });
  };

  return (
    <div className="space-y-4">
      <Card title="Firm details">
        <Field label="Firm name" required>
          <TextInput
            value={f.firmName}
            onChange={(v) => patch({ firmName: v })}
            placeholder="M/s Acme & Co."
          />
        </Field>
        <Field label="Nature of business" required hint="One-line description, e.g. trading in textiles">
          <TextInput
            value={f.businessNature}
            onChange={(v) => patch({ businessNature: v })}
            placeholder="Wholesale trading in textile goods"
          />
        </Field>
        <Grid2>
          <Field label="Principal place of business" required>
            <TextInput
              value={f.principalPlace}
              onChange={(v) => patch({ principalPlace: v })}
              placeholder="14, Gandhi Road, Mumbai 400001"
            />
          </Field>
          <Field label="State" required hint="Stamp duty + jurisdiction are looked up from this">
            <select
              value={f.state ?? ''}
              onChange={(e) => patch({ state: e.target.value })}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-gray-900 dark:text-gray-100"
            >
              <option value="">Select state…</option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
        </Grid2>
        <Grid2>
          <Field label="Commencement date" required>
            <input
              type="date"
              value={f.commencementDate ?? ''}
              onChange={(e) => patch({ commencementDate: e.target.value })}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-gray-900 dark:text-gray-100"
            />
          </Field>
          <Field label="Books of account location" hint="Often the principal place; specify if different">
            <TextInput
              value={f.booksLocation}
              onChange={(v) => patch({ booksLocation: v })}
              placeholder="At the principal place of business"
            />
          </Field>
        </Grid2>

        <div>
          <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
            Duration of partnership
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDuration('at_will')}
              className={cn(
                'flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors',
                f.duration?.kind === 'at_will'
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                  : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400',
              )}
            >
              At-will (no fixed term)
            </button>
            <button
              type="button"
              onClick={() => setDuration('fixed')}
              className={cn(
                'flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors',
                f.duration?.kind === 'fixed'
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                  : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400',
              )}
            >
              Fixed term
            </button>
          </div>
          {f.duration?.kind === 'fixed' && (
            <div className="mt-3">
              <Field label="Fixed term until" required>
                <input
                  type="date"
                  value={f.duration.fixedUntil ?? ''}
                  onChange={(e) =>
                    patch({ duration: { kind: 'fixed', fixedUntil: e.target.value } })
                  }
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-gray-900 dark:text-gray-100"
                />
              </Field>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

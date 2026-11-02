import { CheckCircle2 } from 'lucide-react';
import type { FormatRequestKind } from '../../services/api';

interface FormatSupportNoticeProps {
  kind: FormatRequestKind;
  /** Names we have a zero-touch rule for. Passed in from the rule
   *  files so this component can never list something that no longer
   *  works. */
  supported: ReadonlyArray<string>;
}

const COPY = {
  ledger: {
    listLabel: 'Auto-detected accounting software',
    otherLine: 'Any other software or scanned ledger is read automatically — no column mapping needed.',
  },
  bank: {
    listLabel: 'Auto-detected banks',
    otherLine: 'Any other bank or scanned statement is read automatically — no column mapping needed.',
  },
} as const;

/**
 * Shows which formats import with a deterministic rule. Anything else is
 * read by the AI reader, and the server files it in Format Support
 * Requests (with the file) so a rule can be added — there's no request
 * form and no column-mapping screen any more.
 */
export function FormatSupportNotice({ kind, supported }: FormatSupportNoticeProps) {
  const copy = COPY[kind];
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700/60 bg-gray-50/60 dark:bg-gray-800/30 px-3 py-2.5 text-[11px]">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-gray-600 dark:text-gray-300">
            <span className="font-semibold">{copy.listLabel}:</span>{' '}
            {supported.join(' · ')}
          </p>
          <p className="text-gray-400 mt-0.5">{copy.otherLine}</p>
        </div>
      </div>
    </div>
  );
}

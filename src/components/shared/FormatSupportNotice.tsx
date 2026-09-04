import { useState, useCallback, useRef } from 'react';
import { CheckCircle2, Upload, X, Send, Loader2, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { submitFormatRequest, type FormatRequestKind } from '../../services/api';

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
    askLabel: "Don't see your software?",
    nameLabel: 'Which accounting software?',
    namePlaceholder: 'e.g. Zoho Books, Vyapar, Saral, Miracle',
    sampleLabel: 'Sample ledger export',
    sampleHint: 'A short export is plenty — even one account for one month. PDF, CSV, or Excel.',
  },
  bank: {
    listLabel: 'Auto-detected banks',
    askLabel: "Don't see your bank?",
    nameLabel: 'Which bank?',
    namePlaceholder: 'e.g. Axis Bank, Union Bank, Federal Bank',
    sampleLabel: 'Sample statement',
    sampleHint: 'A short statement is plenty — even one month. PDF, CSV, or Excel.',
  },
} as const;

/**
 * Shows which formats import with zero setup, and collects a sample
 * from users whose format isn't on the list.
 *
 * The sample is the point. A bare "please support Vyapar" cannot be
 * acted on — the column rules are written against a real export — so
 * the form asks for a file and says why.
 *
 * Not shown as a blocking warning: an unlisted format still imports
 * through the column-mapping wizard. This is an "it'll be smoother
 * later" affordance, not an error.
 */
export function FormatSupportNotice({ kind, supported }: FormatSupportNoticeProps) {
  const copy = COPY[kind];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [sample, setSample] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setName(''); setNotes(''); setSample(null); setOpen(false);
  }, []);

  const submit = useCallback(async () => {
    const softwareName = name.trim();
    if (!softwareName) {
      toast.error(kind === 'bank' ? 'Please enter the bank name.' : 'Please enter the software name.');
      return;
    }
    setSending(true);
    try {
      const res = await submitFormatRequest({ kind, softwareName, notes: notes.trim(), sample });
      toast.success(res.message ?? 'Request sent — thank you.');
      setSent(true);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send your request.');
    } finally {
      setSending(false);
    }
  }, [kind, name, notes, sample, reset]);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700/60 bg-gray-50/60 dark:bg-gray-800/30 px-3 py-2.5 text-[11px]">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-gray-600 dark:text-gray-300">
            <span className="font-semibold">{copy.listLabel}:</span>{' '}
            {supported.join(' · ')}
          </p>
          <p className="text-gray-400 mt-0.5">
            Anything else still imports — you'll just map the columns yourself once.
          </p>

          {sent ? (
            <p className="mt-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
              Thanks — your request is with us.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(o => !o)}
              className="mt-1 inline-flex items-center gap-1 font-semibold text-[#059669] hover:underline"
            >
              {copy.askLabel} Ask us to add it
              <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {open && !sent && (
        <div className="mt-2.5 pt-2.5 border-t border-gray-200 dark:border-gray-700/60 space-y-2">
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
              {copy.nameLabel} <span className="text-red-500">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={copy.namePlaceholder}
              maxLength={120}
              className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#059669]/30 text-gray-900 dark:text-gray-100"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
              {copy.sampleLabel}
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.csv,.xls,.xlsx,.txt"
              onChange={(e) => setSample(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            {sample ? (
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
                <span className="flex-1 truncate text-xs text-gray-700 dark:text-gray-200">{sample.name}</span>
                <span className="text-[10px] text-gray-400 shrink-0">{(sample.size / 1024).toFixed(0)} KB</span>
                <button
                  type="button"
                  onClick={() => { setSample(null); if (fileRef.current) fileRef.current.value = ''; }}
                  className="text-gray-400 hover:text-rose-500 shrink-0"
                  aria-label="Remove sample"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-500 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-[#059669] hover:text-[#059669] transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                Attach a sample
              </button>
            )}
            <p className="text-[10px] text-gray-400 mt-1">
              {copy.sampleHint} We need a real export to build the rule — a name alone usually isn't enough.
            </p>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Anything we should know? <span className="font-normal normal-case tracking-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="e.g. multi-branch export, amounts have Dr/Cr suffixes"
              className="w-full resize-none px-2.5 py-1.5 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#059669]/30 text-gray-900 dark:text-gray-100"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={sending || !name.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#059669] text-white hover:bg-[#047857] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {sending ? 'Sending…' : 'Send request'}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={sending}
              className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

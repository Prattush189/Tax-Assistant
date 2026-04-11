import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Download, ExternalLink, Loader2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { importFromItPortal, ItPortalImportResult } from '../../services/api';

type Phase = 'form' | 'running' | 'success' | 'error';

interface Props {
  open: boolean;
  onClose: () => void;
  /** If provided, the server updates this existing profile; otherwise a new one is created. */
  existingProfileId?: string;
  /** If provided, the server prefills this ITR draft's PersonalInfo + Banks after import. */
  itrDraftId?: string;
  onImported?: (result: ItPortalImportResult) => void;
}

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function PortalImportDialog({
  open,
  onClose,
  existingProfileId,
  itrDraftId,
  onImported,
}: Props) {
  const [phase, setPhase] = useState<Phase>('form');
  const [pan, setPan] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ItPortalImportResult | null>(null);

  // Reset state whenever the dialog is opened
  useEffect(() => {
    if (open) {
      setPhase('form');
      setPan('');
      setPassword('');
      setError(null);
      setResult(null);
    }
  }, [open]);

  if (!open) return null;

  const panValid = PAN_REGEX.test(pan.toUpperCase());
  const canSubmit = panValid && password.length > 0 && phase !== 'running';

  const handleSubmit = async () => {
    setError(null);
    setPhase('running');
    try {
      const r = await importFromItPortal({
        pan: pan.toUpperCase(),
        password,
        profileId: existingProfileId,
        itrDraftId,
      });
      // Drop the password immediately
      setPassword('');
      setResult(r);
      setPhase('success');
      onImported?.(r);
    } catch (e) {
      setPassword(''); // still drop on failure
      setError(e instanceof Error ? e.message : 'Import failed');
      setPhase('error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={phase !== 'running' ? onClose : undefined}
    >
      <div
        className="bg-white dark:bg-[#1a1714] rounded-2xl shadow-2xl max-w-md w-full border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Download className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Import from Income Tax portal
              </h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-500">
                incometax.gov.in
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={phase === 'running'}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-30"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {phase === 'form' && (
            <>
              {/* Disclaimer banner */}
              <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                  <p className="font-semibold mb-1">
                    You're giving Smart AI your Income Tax portal password.
                  </p>
                  <p>
                    It is used only for this one-shot import, held in server memory, and
                    never saved to disk or logs. If you are already logged into{' '}
                    <a
                      href="https://www.incometax.gov.in"
                      target="_blank"
                      rel="noreferrer"
                      className="underline inline-flex items-center gap-0.5"
                    >
                      incometax.gov.in
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>{' '}
                    in another tab, that session will be ended.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                  PAN <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={pan}
                  onChange={(e) => setPan(e.target.value.toUpperCase())}
                  placeholder="ABCDE1234F"
                  maxLength={10}
                  autoComplete="off"
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-gray-900 dark:text-gray-100 tracking-wider font-mono"
                />
                {pan.length > 0 && !panValid && (
                  <p className="text-[11px] text-red-500 mt-1">
                    Format: 5 letters + 4 digits + 1 letter
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                  Portal password <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your incometax.gov.in password"
                  autoComplete="off"
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors text-gray-900 dark:text-gray-100"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canSubmit) handleSubmit();
                  }}
                />
              </div>

              <div className="text-[11px] text-gray-500 dark:text-gray-500 leading-relaxed">
                We will pull: identity, address, validated bank accounts, and assessing officer
                jurisdiction. {itrDraftId && 'Your open ITR draft will be prefilled automatically.'}
              </div>
            </>
          )}

          {phase === 'running' && (
            <div className="py-6 flex flex-col items-center text-center">
              <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mb-3" />
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Importing from portal…
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-1 max-w-[280px]">
                Authenticating, fetching profile, banks, and jurisdiction. This may take 5–15 seconds.
              </p>
            </div>
          )}

          {phase === 'success' && result && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/40">
                <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                    Import successful
                  </p>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                    Profile upserted{result.prefilledDraftId ? ' and ITR draft prefilled' : ''}.
                  </p>
                </div>
              </div>
              <dl className="text-xs space-y-2 bg-gray-50 dark:bg-gray-900/40 rounded-xl p-3">
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-500">Name</dt>
                  <dd className="text-gray-900 dark:text-gray-100 font-medium">
                    {result.imported.name}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-500">PAN</dt>
                  <dd className="text-gray-900 dark:text-gray-100 font-mono">
                    {result.imported.pan}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-500">Bank accounts</dt>
                  <dd className="text-gray-900 dark:text-gray-100 font-medium">
                    {result.imported.bankCount}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-gray-500">Jurisdiction</dt>
                  <dd className="text-gray-900 dark:text-gray-100 font-medium">
                    {result.imported.hasJurisdiction ? 'Imported' : 'Not available'}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                    Import failed
                  </p>
                  <p className="text-[11px] text-red-700 dark:text-red-400 mt-0.5 break-words">
                    {error ?? 'Unknown error'}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-500 leading-relaxed">
                Common causes: wrong password, DSC-only account, portal maintenance, or rate limiting.
                If the error persists, try logging in manually at incometax.gov.in to confirm your
                credentials work.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end p-5 pt-0">
          {phase === 'form' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={cn(
                  'px-4 py-2 text-sm font-semibold rounded-lg transition-all',
                  canSubmit
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/20'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed',
                )}
              >
                Import
              </button>
            </>
          )}
          {phase === 'success' && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
            >
              Done
            </button>
          )}
          {phase === 'error' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => setPhase('form')}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
              >
                Try again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

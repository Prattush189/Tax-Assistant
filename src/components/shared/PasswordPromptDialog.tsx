import { useEffect, useRef, useState } from 'react';
import { Lock, X, Eye, EyeOff } from 'lucide-react';

interface Props {
  filename: string;
  /** True when this prompt is being shown after a wrong-password
   *  retry — flips the title from "Locked" to "Incorrect password". */
  wrongPassword?: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

/**
 * Modal that asks the user for the password of an encrypted PDF.
 * Wired into the bank-statement and ledger uploaders: when
 * extractPdfGrid throws PdfPasswordError, the uploader pops this
 * dialog, then re-runs extractPdfGrid(file, password). Wrong
 * passwords come back through the same channel — re-render with
 * wrongPassword=true and show the inline error.
 */
export function PasswordPromptDialog({ filename, wrongPassword, onSubmit, onCancel }: Props) {
  const [password, setPassword] = useState('');
  const [showText, setShowText] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    if (!password.trim()) return;
    onSubmit(password);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-500" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {wrongPassword ? 'Incorrect password' : 'PDF is password-protected'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="px-5 py-4 space-y-3"
        >
          <div className="text-xs text-gray-600 dark:text-gray-400 truncate" title={filename}>
            {filename}
          </div>

          <div className="relative">
            <input
              ref={inputRef}
              type={showText ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter PDF password"
              autoComplete="off"
              className="w-full px-3 py-2 pr-9 text-sm bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 text-gray-800 dark:text-gray-100"
            />
            <button
              type="button"
              onClick={() => setShowText(s => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              tabIndex={-1}
              aria-label={showText ? 'Hide password' : 'Show password'}
            >
              {showText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {wrongPassword && (
            <p className="text-xs text-rose-600 dark:text-rose-400">
              That password didn't work — try again.
            </p>
          )}

          <p className="text-[11px] text-gray-500 dark:text-gray-500 leading-relaxed">
            Banks send PDF statements with a password — usually your PAN, date of birth,
            or a combination. Check the email the bank sent for the format.
            The password is used only to unlock the file in your browser; it isn't sent to our server.
          </p>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!password.trim()}
              className="px-4 py-1.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Unlock
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

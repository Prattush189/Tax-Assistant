import { AlertTriangle, FileText } from 'lucide-react';

interface Props {
  /** Filename to surface in the dialog. */
  filename: string;
  /** Short label used in the heading, e.g. "statement", "notice". */
  documentLabel: string;
  /** Confirm-button label. Defaults to "Continue with AI scan". */
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Shared "this PDF has no text layer" confirmation dialog. Used by every
 * upload flow that has to escalate scanned PDFs to AI vision: it makes the
 * cost trade-off explicit so users with quota concerns can back out and
 * upload a digital export instead.
 *
 * Bank statements use a slightly different first sentence (column-mapping
 * specific) but share the same component skeleton — keep the heading
 * neutral so this works across features without per-caller copy.
 */
export function ScannedPdfConfirmDialog({
  filename,
  documentLabel,
  confirmLabel = 'Continue with AI scan',
  onCancel,
  onConfirm,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 max-w-lg w-full p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-300" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">
              This {documentLabel} has no readable text
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              The file appears to be scanned or image-only, so we have to fall back to AI vision to read it.
            </p>
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
              Heads up: scanned PDFs may consume 5–10× more of your token quota than digital PDFs. Uploading a
              digital export instead will be faster and cheaper.
            </p>
            <p className="mt-2 text-xs font-mono text-gray-500 dark:text-gray-400 break-all">
              {filename}
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
          >
            <FileText className="w-4 h-4" />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

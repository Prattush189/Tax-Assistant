import { AlertTriangle, FileText } from 'lucide-react';

interface Props {
  filename: string;
  /** Short label used in the heading, e.g. "statement", "notice". */
  documentLabel: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Shared "this PDF has no readable text" confirmation dialog. Used
 * by bank-statement / ledger / notice uploads to warn the user before
 * routing the upload to the AI vision path (Sonnet 4.5).
 *
 * Vision is significantly more expensive per token than the text
 * paths — Sonnet 4.5 weighs ~30× per input token vs the cheapest
 * Gemini path. The warning gives the user a chance to back out and
 * upload a digital export (CSV / readable PDF) before the cost lands.
 *
 * Skips for: digital PDFs (text path used directly), images (no
 * alternative path exists, user already knows it's an image).
 */
export function ScannedPdfConfirmDialog({
  filename,
  documentLabel,
  confirmLabel = 'Continue with AI vision',
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
              The file appears to be scanned or image-only. AI vision can read it, but uses
              significantly more of your token quota than a digital export.
            </p>
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
              Heads up: a typical scanned PDF can consume 30× more tokens than a readable PDF or CSV.
              Upload a digital export instead to keep your quota intact.
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

interface BlockProps {
  filename: string;
  pageCount: number;
  documentLabel: string;
  onClose: () => void;
}

/**
 * Block dialog for PDFs over the 100-page Anthropic limit. No
 * "continue anyway" — there's no way to process these as a single
 * upload, so the user has to come back with a CSV export or split
 * the file.
 */
export function PdfTooLargeDialog({ filename, pageCount, documentLabel, onClose }: BlockProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 max-w-lg w-full p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-rose-700 dark:text-rose-300" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">
              {documentLabel.charAt(0).toUpperCase() + documentLabel.slice(1)} is too large for AI vision
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              This PDF has <span className="font-semibold">{pageCount.toLocaleString('en-IN')} pages</span> —
              AI vision is capped at 100 pages per upload.
            </p>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Please upload a CSV export, or split this file into smaller PDFs and upload each separately.
            </p>
            <p className="mt-2 text-xs font-mono text-gray-500 dark:text-gray-400 break-all">
              {filename}
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

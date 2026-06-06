import { AlertTriangle, FileText } from 'lucide-react';

interface Props {
  filename: string;
  /** Short label used in the heading, e.g. "statement", "notice". */
  documentLabel: string;
  confirmLabel?: string;
  /** When true, show the OCR-pipeline copy (free local extraction, takes
   *  30-90 s) instead of the AI-vision copy (paid, fast). Bank-statement
   *  uploads opt in because the server routes scanned PDFs through
   *  PaddleOCR before falling back to vision. Other call sites (notice,
   *  ledger) keep the original AI-vision copy. */
  useOcr?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Shared "this PDF has no readable text" confirmation dialog. Used
 * by bank-statement / ledger / notice uploads to warn the user before
 * routing the upload to the OCR or AI-vision path.
 *
 * Two flavours of copy:
 *   - useOcr=true (bank-statement): server-side PaddleOCR pipeline
 *     handles the file. Free locally, takes 30-90s, no token cost.
 *   - useOcr=false (default — ledger / notice): AI vision processes
 *     the file, ~1.5×–2× the tokens of a wizard-mapped digital export.
 *
 * Skips for: digital PDFs (text path used directly), images (no
 * alternative path exists, user already knows it's an image).
 */
export function ScannedPdfConfirmDialog({
  filename,
  documentLabel,
  confirmLabel,
  useOcr = false,
  onCancel,
  onConfirm,
}: Props) {
  const finalConfirmLabel = confirmLabel ?? (useOcr ? 'Continue with OCR' : 'Continue with AI vision');
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
            {useOcr ? (
              <>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  The file appears to be scanned. We'll run OCR locally to read it — no AI vision tokens used.
                </p>
                <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
                  Heads up: OCR typically takes 30-90 seconds for a 20-page statement. The page can be closed during processing — your statement will be ready when you come back.
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                  The file appears to be scanned or has an unusual layout. AI vision can read it,
                  but uses a bit more of your token quota than a digital export with a clean column structure.
                </p>
                <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
                  Heads up: AI vision uses roughly 1.5×–2× more tokens than a readable PDF or CSV.
                  Upload a digital export if you want to keep token usage minimal.
                </p>
              </>
            )}
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
            {finalConfirmLabel}
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

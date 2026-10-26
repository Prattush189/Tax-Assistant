import { ArrowLeft } from 'lucide-react';

/** "← All reports" link at the top of a wizard, back to its draft picker.
 *  CMA and TB → Statements have no sidebar list, so without this an open
 *  draft was a dead end. */
export function BackToList({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 mb-2 -ml-1 px-1 py-0.5 rounded-md text-xs font-medium text-gray-500 hover:text-emerald-700 dark:text-gray-400 dark:hover:text-emerald-300 transition-colors"
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

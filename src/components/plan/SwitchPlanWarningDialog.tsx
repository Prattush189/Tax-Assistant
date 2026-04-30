import { AlertTriangle, X } from 'lucide-react';

interface Props {
  fromPlan: string;
  toPlan: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation dialog shown when a paid-plan user tries to buy the
 * other paid plan (Pro ↔ Enterprise). Without this gate the server
 * silently created a second Razorpay subscription and never cancelled
 * the first one — double-billing the customer until they manually
 * cancelled. We now cancel the old subscription server-side after
 * /verify, but this modal makes the consequence explicit so the user
 * knows what to expect (loss of pre-paid time, no auto-refund).
 */
export function SwitchPlanWarningDialog({ fromPlan, toPlan, onConfirm, onCancel }: Props) {
  const isUpgrade = fromPlan === 'Pro' && toPlan === 'Enterprise';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              {isUpgrade ? `Upgrade from ${fromPlan} to ${toPlan}?` : `Switch from ${fromPlan} to ${toPlan}?`}
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

        <div className="px-5 py-4 space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <p>
            Your current <span className="font-semibold">{fromPlan}</span> subscription will be cancelled
            as soon as the {toPlan} payment goes through.
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-gray-600 dark:text-gray-400">
            <li>{toPlan} starts billing today and runs on its own cycle.</li>
            <li>Pre-paid time on {fromPlan} is not refunded.</li>
            <li>You'll keep all your data, history, and settings.</li>
          </ul>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-800">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            Stay on {fromPlan}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-semibold text-white bg-[#0D9668] hover:bg-[#0A7B55] rounded-lg transition-colors"
          >
            Continue with {toPlan}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { fetchLaunchOffer, markLaunchOfferSeen } from '../../services/api';
import { offerLastDay } from '../../lib/launchOffer';

/**
 * One-time pop-up announcing the launch offer: every feature except chat uses 50%
 * fewer credits. Never names the model behind the app. Shows once per
 * user (the server records it as seen when closed), and only while the
 * offer is on. `enabled`: signed in, not embedded, not behind the trial
 * wall — the parent decides.
 */
export function OfferDialog({ enabled }: { enabled: boolean }) {
  const [offer, setOffer] = useState<{ discountPct: number; endsAt: string } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchLaunchOffer()
      .then(o => { if (!cancelled && o.active && !o.seen) setOffer({ discountPct: o.discountPct, endsAt: o.endsAt }); })
      .catch(() => { /* no pop-up is the safe failure */ });
    return () => { cancelled = true; };
  }, [enabled]);

  const close = () => {
    setOffer(null);
    markLaunchOfferSeen().catch(() => { /* shows again next visit; harmless */ });
  };

  useEffect(() => {
    if (!offer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [offer]);

  return (
    <AnimatePresence>
      {offer && (
        <motion.div
          key="offer-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={close}
        >
          <motion.div
            key="offer-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="offer-title"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.15 }}
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-gray-200 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-orange-100 dark:bg-orange-900/30">
                <Sparkles className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 id="offer-title" className="text-base font-semibold text-gray-900 dark:text-white mb-1">
                  {offer.discountPct}% off every feature except chat
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Notice replies, documents, bank statements and ledger scrutiny use {offer.discountPct}% fewer credits until {offerLastDay(offer.endsAt)}, while the offer lasts. Chat is unchanged. It's applied automatically.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={close}
                autoFocus
                className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors bg-emerald-600 hover:bg-emerald-700"
              >
                Got it
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

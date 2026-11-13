import { fetchLaunchOffer, type LaunchOffer } from '../services/api';

/**
 * Launch offer helpers (50% off every feature except chat). Shared by
 * the plans page, the chat box tooltips and the Settings credit hints so
 * they all show the same price. Never name the model behind the app in
 * anything built from these.
 */

/** Last day of the offer: endsAt is the exclusive IST midnight after it. */
export function offerLastDay(endsAt: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
    .format(new Date(Date.parse(endsAt) - 1));
}

/** Still on right now? Also true-to-the-clock in a tab left open past the end. */
export function offerLive(offer: LaunchOffer | null | undefined): offer is LaunchOffer {
  return !!offer && offer.active && Date.now() < Date.parse(offer.endsAt);
}

/** What a discounted credit cost is multiplied by: 0.5 while the offer
 *  is on, else 1. Use offerFactorFor for a specific feature. */
export function offerFactor(offer: LaunchOffer | null | undefined): number {
  return offerLive(offer) ? 1 - offer.discountPct / 100 : 1;
}

/** The factor for one feature, keyed like the credit estimates
 *  (chat_fast, notice_draft, ...): 1 for chat, which the offer excludes,
 *  else offerFactor. */
export function offerFactorFor(offer: LaunchOffer | null | undefined, estimateKey: string): number {
  const category = estimateKey.startsWith('chat') ? 'chat' : estimateKey;
  return (offer?.excludes ?? ['chat']).includes(category) ? 1 : offerFactor(offer);
}

/** A credit cost after the discount: up to two decimals, no trailing zeros. */
export function formatCredits(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** "1 credit" / "0.25 credits". */
export function creditsLabel(n: number): string {
  return `${formatCredits(n)} credit${n === 1 ? '' : 's'}`;
}

let pending: Promise<LaunchOffer | null> | null = null;

/** The offer, fetched once per page load; null when off or unreachable (retried next call). */
export function loadLaunchOffer(): Promise<LaunchOffer | null> {
  if (!pending) {
    pending = fetchLaunchOffer()
      .then(o => (o.active ? o : null))
      .catch(() => { pending = null; return null; });
  }
  return pending;
}

import { useEffect, useState } from 'react';
import type { LaunchOffer } from '../services/api';
import { loadLaunchOffer, offerLive } from '../lib/launchOffer';

/**
 * The launch offer while it is on, else null. One request per page load,
 * shared by every caller. `enabled: false` (signed out) skips the request.
 */
export function useLaunchOffer(enabled = true): LaunchOffer | null {
  const [offer, setOffer] = useState<LaunchOffer | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadLaunchOffer().then(o => { if (!cancelled) setOffer(o); });
    return () => { cancelled = true; };
  }, [enabled]);
  return offerLive(offer) ? offer : null;
}

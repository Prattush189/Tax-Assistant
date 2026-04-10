import { useMemo, useEffect } from 'react';
import {
  getAllowedOrigins,
  isAllowedOrigin,
  parseParentMessage,
  postToParent,
  type ParentToIframeMessage,
} from '../lib/pluginProtocol';

// Re-export for convenience so callers don't need two imports
export { postToParent };
export type { ParentToIframeMessage };

function detectPluginMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('plugin') === 'true';
}

/**
 * Root plugin-mode hook. Call this ONCE at the top of the app tree.
 *
 * Responsibilities:
 *   - Detect plugin mode from `?plugin=true`
 *   - Post TAX_ASSISTANT_READY on mount
 *   - Attach ResizeObserver that reports body height
 *   - (optional) Handle SET_THEME messages via `onSetTheme` callback
 *
 * For additional parent-message subscribers, use `usePluginParentMessage`.
 */
export function usePluginMode(onSetTheme?: (dark: boolean) => void) {
  const isPluginMode = useMemo(detectPluginMode, []);

  // Ready signal + height reporter (PLUG-01 / PLUG-02)
  useEffect(() => {
    if (!isPluginMode) return;

    postToParent({ type: 'TAX_ASSISTANT_READY' });

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = Math.ceil(entry.contentRect.height);
        postToParent({ type: 'TAX_ASSISTANT_HEIGHT', payload: { height } });
      }
    });

    resizeObserver.observe(document.body);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isPluginMode]);

  // Theme sync (PLUG-04) — optional, kept on the root hook for back-compat
  useEffect(() => {
    if (!isPluginMode || !onSetTheme) return;

    const handler = (event: MessageEvent) => {
      if (!isAllowedOrigin(event.origin)) return;
      const msg = parseParentMessage(event.data);
      if (msg?.type === 'SET_THEME') {
        onSetTheme(msg.dark === true);
      }
    };

    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
    };
  }, [isPluginMode, onSetTheme]);

  return { isPluginMode, allowedOrigins: getAllowedOrigins() };
}

/**
 * Subscribe to parent → iframe messages. Safe to call multiple times from
 * different components — each attaches its own listener.
 *
 * The callback receives already-validated, typed messages. Unknown messages
 * and untrusted origins are filtered out at the hook level.
 *
 * NO-OP when not in plugin mode.
 */
export function usePluginParentMessage(
  onMessage: (msg: ParentToIframeMessage) => void,
) {
  const isPluginMode = useMemo(detectPluginMode, []);

  useEffect(() => {
    if (!isPluginMode) return;

    const handler = (event: MessageEvent) => {
      if (!isAllowedOrigin(event.origin)) return;
      const msg = parseParentMessage(event.data);
      if (!msg) return;
      onMessage(msg);
    };

    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
    };
  }, [isPluginMode, onMessage]);
}

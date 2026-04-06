import { useMemo, useEffect } from 'react';

export function usePluginMode(onSetTheme?: (dark: boolean) => void) {
  const isPluginMode = useMemo<boolean>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('plugin') === 'true';
    }
    return false;
  }, []);

  // PLUG-01: Height reporter + PLUG-02 ready signal
  useEffect(() => {
    if (!isPluginMode) return;

    const PARENT_ORIGIN = 'https://ai.smartbizin.com';

    // Signal readiness before ResizeObserver fires so parent can sync its listener
    window.parent.postMessage({ type: 'TAX_ASSISTANT_READY' }, PARENT_ORIGIN);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = Math.ceil(entry.contentRect.height);
        window.parent.postMessage(
          { type: 'TAX_ASSISTANT_HEIGHT', payload: { height } },
          PARENT_ORIGIN
        );
      }
    });

    resizeObserver.observe(document.body);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isPluginMode]);

  // PLUG-02: Origin validation + PLUG-04: Theme sync
  useEffect(() => {
    if (!isPluginMode) return;

    const ALLOWED_ORIGINS = ['https://ai.smartbizin.com'];

    const handler = (event: MessageEvent) => {
      if (!ALLOWED_ORIGINS.includes(event.origin)) return;
      if (event.data?.type === 'SET_THEME' && onSetTheme) {
        onSetTheme(event.data.dark === true);
      }
    };

    window.addEventListener('message', handler);

    return () => {
      window.removeEventListener('message', handler);
    };
  }, [isPluginMode, onSetTheme]);

  return { isPluginMode };
}

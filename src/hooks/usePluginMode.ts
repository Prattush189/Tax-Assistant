import { useMemo } from 'react';

export function usePluginMode() {
  const isPluginMode = useMemo<boolean>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('plugin') === 'true';
    }
    return false;
  }, []);

  return { isPluginMode };
}

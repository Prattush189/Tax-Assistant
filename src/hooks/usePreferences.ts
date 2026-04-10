import { useState, useEffect, useCallback } from 'react';

/** User preferences stored in localStorage */
export interface UserPreferences {
  confirmBeforeDeletingChats: boolean;
}

const DEFAULTS: UserPreferences = {
  confirmBeforeDeletingChats: true, // On by default — safer UX
};

const STORAGE_KEY = 'smart_ai_prefs';

function loadPreferences(): UserPreferences {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function savePreferences(prefs: UserPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore quota/privacy errors
  }
}

/** Hook for reading and updating user preferences */
export function usePreferences() {
  const [prefs, setPrefs] = useState<UserPreferences>(() => loadPreferences());

  // Listen for changes from other tabs
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setPrefs(loadPreferences());
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const updatePreference = useCallback(<K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K],
  ) => {
    setPrefs(prev => {
      const next = { ...prev, [key]: value };
      savePreferences(next);
      return next;
    });
  }, []);

  return { prefs, updatePreference };
}

/** Read preferences directly (for non-React contexts) */
export function getPreference<K extends keyof UserPreferences>(key: K): UserPreferences[K] {
  return loadPreferences()[key];
}

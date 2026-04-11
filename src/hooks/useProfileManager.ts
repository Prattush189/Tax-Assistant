import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchGenericProfiles,
  createGenericProfile,
  fetchGenericProfile,
  updateGenericProfile,
  deleteGenericProfile,
  updateGenericProfilePerAy,
  GenericProfile,
} from '../services/api';

export type ProfileAy = '2024-25' | '2025-26' | '2026-27';

/**
 * Manages the generic profile list + currently-open profile with debounced
 * autosave. Structurally mirrors useItrManager.
 */
export function useProfileManager(enabled: boolean) {
  const [profiles, setProfiles] = useState<GenericProfile[]>([]);
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null);
  const [currentProfile, setCurrentProfile] = useState<GenericProfile | null>(null);
  const [selectedAy, setSelectedAy] = useState<ProfileAy>('2025-26');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    (async () => {
      setIsLoading(true);
      try {
        const data = await fetchGenericProfiles();
        setProfiles(data.profiles);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load profiles');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [enabled]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await fetchGenericProfiles();
      setProfiles(data.profiles);
    } catch {
      // non-fatal
    }
  }, [enabled]);

  const clearCurrent = useCallback(() => {
    setCurrentProfileId(null);
    setCurrentProfile(null);
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const createProfile = useCallback(async (name: string): Promise<GenericProfile> => {
    const profile = await createGenericProfile(name);
    setProfiles((prev) => [profile, ...prev]);
    setCurrentProfileId(profile.id);
    setCurrentProfile(profile);
    return profile;
  }, []);

  const loadProfile = useCallback(async (id: string) => {
    try {
      const profile = await fetchGenericProfile(id);
      setCurrentProfileId(profile.id);
      setCurrentProfile(profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profile');
    }
  }, []);

  const removeProfile = useCallback(
    async (id: string) => {
      await deleteGenericProfile(id);
      setProfiles((prev) => prev.filter((p) => p.id !== id));
      if (currentProfileId === id) clearCurrent();
    },
    [currentProfileId, clearCurrent],
  );

  const saveDebounced = useCallback(
    (id: string, patch: Parameters<typeof updateGenericProfile>[1]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          const updated = await updateGenericProfile(id, patch);
          setCurrentProfile(updated);
          setProfiles((prev) =>
            prev.map((p) => (p.id === id ? updated : p)),
          );
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to save');
        }
      }, 1500);
    },
    [],
  );

  const updateIdentity = useCallback(
    (identity: Record<string, unknown>) => {
      if (!currentProfileId) return;
      setCurrentProfile((prev) => (prev ? { ...prev, identity } : prev));
      saveDebounced(currentProfileId, { identity });
    },
    [currentProfileId, saveDebounced],
  );

  const updateAddress = useCallback(
    (address: Record<string, unknown>) => {
      if (!currentProfileId) return;
      setCurrentProfile((prev) => (prev ? { ...prev, address } : prev));
      saveDebounced(currentProfileId, { address });
    },
    [currentProfileId, saveDebounced],
  );

  const updateBanks = useCallback(
    (banks: GenericProfile['banks']) => {
      if (!currentProfileId) return;
      setCurrentProfile((prev) => (prev ? { ...prev, banks } : prev));
      saveDebounced(currentProfileId, { banks });
    },
    [currentProfileId, saveDebounced],
  );

  const updateNoticeDefaults = useCallback(
    (noticeDefaults: Record<string, unknown>) => {
      if (!currentProfileId) return;
      setCurrentProfile((prev) => (prev ? { ...prev, noticeDefaults } : prev));
      saveDebounced(currentProfileId, { noticeDefaults });
    },
    [currentProfileId, saveDebounced],
  );

  const updateName = useCallback(
    (name: string) => {
      if (!currentProfileId) return;
      setCurrentProfile((prev) => (prev ? { ...prev, name } : prev));
      saveDebounced(currentProfileId, { name });
    },
    [currentProfileId, saveDebounced],
  );

  /**
   * Merge a patch into the per-AY slice for the currently-selected AY.
   * Uses the dedicated /per-ay/:year endpoint so concurrent edits to
   * different years don't clobber each other.
   */
  const updatePerAy = useCallback(
    (patch: Record<string, unknown>) => {
      if (!currentProfileId) return;
      // Optimistic in-memory update
      setCurrentProfile((prev) => {
        if (!prev) return prev;
        const existing = prev.perAy?.[selectedAy] ?? {};
        return {
          ...prev,
          perAy: { ...(prev.perAy ?? {}), [selectedAy]: { ...existing, ...patch } },
        };
      });
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          const updated = await updateGenericProfilePerAy(currentProfileId, selectedAy, patch);
          setCurrentProfile(updated);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to save per-AY data');
        }
      }, 1500);
    },
    [currentProfileId, selectedAy],
  );

  return {
    profiles,
    currentProfileId,
    currentProfile,
    selectedAy,
    setSelectedAy,
    isLoading,
    error,
    createProfile,
    loadProfile,
    clearCurrent,
    removeProfile,
    updateIdentity,
    updateAddress,
    updateBanks,
    updateNoticeDefaults,
    updateName,
    updatePerAy,
    refresh,
  };
}

export type ProfileManager = ReturnType<typeof useProfileManager>;

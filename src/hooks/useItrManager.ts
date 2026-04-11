import { useState, useCallback, useEffect, useRef } from 'react';
import {
  fetchItrDrafts,
  createItrDraft,
  fetchItrDraft,
  updateItrDraft,
  deleteItrDraft,
  ItrDraft,
  ItrFormType,
} from '../services/api';

/**
 * Manages the list of ITR drafts for the current user, the currently open
 * draft, and a debounced autosave of the in-memory UI payload.
 */
export function useItrManager(enabled: boolean) {
  const [drafts, setDrafts] = useState<ItrDraft[]>([]);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [currentDraft, setCurrentDraft] = useState<ItrDraft | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load drafts on mount (only when enabled — avoids firing for non-admin users)
  useEffect(() => {
    if (!enabled) return;
    (async () => {
      setIsLoading(true);
      try {
        const data = await fetchItrDrafts();
        setDrafts(data.drafts);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load drafts');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [enabled]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await fetchItrDrafts();
      setDrafts(data.drafts);
    } catch {
      // non-fatal
    }
  }, [enabled]);

  const clearDraft = useCallback(() => {
    setCurrentDraftId(null);
    setCurrentDraft(null);
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const createDraft = useCallback(
    async (input: { form_type: ItrFormType; assessment_year: string; name: string }) => {
      const draft = await createItrDraft({ ...input, ui_payload: {} });
      setDrafts((prev) => [draft, ...prev]);
      setCurrentDraftId(draft.id);
      setCurrentDraft(draft);
      return draft;
    },
    [],
  );

  const loadDraft = useCallback(async (draftId: string) => {
    try {
      const draft = await fetchItrDraft(draftId);
      setCurrentDraftId(draft.id);
      setCurrentDraft(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load draft');
    }
  }, []);

  const removeDraft = useCallback(
    async (draftId: string) => {
      await deleteItrDraft(draftId);
      setDrafts((prev) => prev.filter((d) => d.id !== draftId));
      if (currentDraftId === draftId) clearDraft();
    },
    [currentDraftId, clearDraft],
  );

  /**
   * Debounced autosave — call this on every change. The server PATCH only
   * fires 1.5s after the user stops typing. Also updates the in-memory draft
   * so components always see the latest payload without waiting for the
   * network round-trip.
   */
  const updatePayload = useCallback(
    (payload: Record<string, unknown>, opts: { name?: string } = {}) => {
      if (!currentDraftId) return;
      setCurrentDraft((prev) =>
        prev
          ? { ...prev, ui_payload: payload, name: opts.name ?? prev.name }
          : prev,
      );
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          await updateItrDraft(currentDraftId, {
            ui_payload: payload,
            name: opts.name,
          });
          // Sync list row so sidebar updates timestamp / name
          setDrafts((prev) =>
            prev.map((d) =>
              d.id === currentDraftId
                ? { ...d, name: opts.name ?? d.name, updated_at: new Date().toISOString() }
                : d,
            ),
          );
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to save draft');
        }
      }, 1500);
    },
    [currentDraftId],
  );

  return {
    drafts,
    currentDraftId,
    currentDraft,
    isLoading,
    error,
    createDraft,
    loadDraft,
    clearDraft,
    removeDraft,
    updatePayload,
    refresh,
  };
}

export type ItrManager = ReturnType<typeof useItrManager>;

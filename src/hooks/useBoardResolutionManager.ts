import { useState, useCallback, useEffect, useRef } from 'react';
import {
  fetchBoardResolutionDrafts,
  createBoardResolutionDraft,
  fetchBoardResolutionDraft,
  updateBoardResolutionDraft,
  deleteBoardResolutionDraft,
  BoardResolutionDraft,
  BoardResolutionTemplateId,
} from '../services/api';

/**
 * Manages the list of board-resolution drafts for the current user, the
 * currently open draft, and a debounced autosave of the in-memory payload.
 * Mirrors useItrManager exactly.
 */
export function useBoardResolutionManager(enabled: boolean) {
  const [drafts, setDrafts] = useState<BoardResolutionDraft[]>([]);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [currentDraft, setCurrentDraft] = useState<BoardResolutionDraft | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    (async () => {
      setIsLoading(true);
      try {
        const data = await fetchBoardResolutionDrafts();
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
      const data = await fetchBoardResolutionDrafts();
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
    async (input: { template_id: BoardResolutionTemplateId; name: string }) => {
      const draft = await createBoardResolutionDraft({ ...input, ui_payload: {} });
      setDrafts((prev) => [draft, ...prev]);
      setCurrentDraftId(draft.id);
      setCurrentDraft(draft);
      return draft;
    },
    [],
  );

  const loadDraft = useCallback(async (draftId: string) => {
    try {
      const draft = await fetchBoardResolutionDraft(draftId);
      setCurrentDraftId(draft.id);
      setCurrentDraft(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load draft');
    }
  }, []);

  const removeDraft = useCallback(
    async (draftId: string) => {
      await deleteBoardResolutionDraft(draftId);
      setDrafts((prev) => prev.filter((d) => d.id !== draftId));
      if (currentDraftId === draftId) clearDraft();
    },
    [currentDraftId, clearDraft],
  );

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
          await updateBoardResolutionDraft(currentDraftId, {
            ui_payload: payload,
            name: opts.name,
          });
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

export type BoardResolutionManager = ReturnType<typeof useBoardResolutionManager>;

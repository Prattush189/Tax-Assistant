/**
 * CMA draft manager. Simpler than usePartnershipDeedsManager:
 *   - No streaming generation (CMA emits Excel, not AI text).
 *   - No quota gating (no Gemini calls in v1).
 *   - No status polling (no async server-side work to track).
 *
 * Behaviour:
 *   - Loads draft list on mount when `enabled`.
 *   - `createDraft({ name })` creates an empty draft and opens it.
 *   - `load(id)` opens an existing draft.
 *   - `updatePayload(payload)` merges a partial CmaDraft into the
 *     current draft and debounces a PATCH to the server (800ms).
 *   - `rename(name)` flushes a name change immediately (no debounce
 *     because users expect the sidebar label to update fast).
 *   - `clear()` closes the open draft without unsaving.
 *
 * Autosave: every updatePayload call resets a single shared debounce
 * timer. The pending payload is held in a ref so concurrent rapid
 * edits coalesce into one PATCH at the end of the burst.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  fetchCmaDrafts,
  fetchCmaDraft,
  createCmaDraft,
  updateCmaDraft,
  deleteCmaDraft,
  type CmaDraftRow,
} from '../services/api';
import { emptyDraft, type CmaDraft } from '../components/cma/lib/uiModel';

const AUTOSAVE_DEBOUNCE_MS = 800;

export interface CMAManager {
  drafts: CmaDraftRow[];
  currentId: string | null;
  currentDraft: CmaDraftRow | null;
  isLoading: boolean;
  error: string | null;
  /** Refresh the list (used after delete / external mutation). */
  refresh: () => Promise<void>;
  /** Load an existing draft into the editor by id. */
  load: (id: string) => Promise<void>;
  /** Close the editor without unsaving in-flight changes. */
  clear: () => void;
  /** Create a new empty draft and open it. */
  createDraft: (input: { name: string; ui_payload?: CmaDraft }) => Promise<CmaDraftRow>;
  /** Rename the open draft (no debounce — immediate PATCH). */
  rename: (name: string) => Promise<void>;
  /** Delete a draft by id. Clears the editor if it was open. */
  remove: (id: string) => Promise<void>;
  /** Merge a partial payload into the current draft; debounced save. */
  updatePayload: (patch: Partial<CmaDraft>) => void;
  /** Replace the entire current draft payload; debounced save. */
  setPayload: (next: CmaDraft) => void;
}

export function useCMAManager(enabled: boolean): CMAManager {
  const [drafts, setDrafts] = useState<CmaDraftRow[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentDraft, setCurrentDraft] = useState<CmaDraftRow | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPayload = useRef<CmaDraft | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await fetchCmaDrafts();
      setDrafts(data.drafts);
    } catch (err) {
      // Non-fatal: probably unauthenticated state being torn down.
      console.error('[cma] failed to list drafts:', err);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    setIsLoading(true);
    refresh().finally(() => setIsLoading(false));
  }, [enabled, refresh]);

  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (!currentId || !pendingPayload.current) return;
    const payload = pendingPayload.current;
    pendingPayload.current = null;
    try {
      await updateCmaDraft(currentId, { ui_payload: payload });
    } catch (err) {
      console.error('[cma] autosave failed:', err);
      // Re-queue so the next debounce-flush retries. Don't surface a
      // toast on every miss — autosave failures are usually transient
      // and the user gets a final error when they explicitly Save /
      // Export at the review step.
      pendingPayload.current = payload;
    }
  }, [currentId]);

  // Flush in-flight saves on unmount / before navigation. Without this
  // a quick "edit + tab-close" leaves the last 800ms of typing lost.
  useEffect(() => {
    const handler = () => { void flushSave(); };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      void flushSave();
    };
  }, [flushSave]);

  const updatePayload = useCallback((patch: Partial<CmaDraft>) => {
    setCurrentDraft((prev) => {
      if (!prev) return prev;
      const merged: CmaDraft = { ...prev.ui_payload, ...patch };
      pendingPayload.current = merged;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { void flushSave(); }, AUTOSAVE_DEBOUNCE_MS);
      return { ...prev, ui_payload: merged };
    });
  }, [flushSave]);

  const setPayload = useCallback((next: CmaDraft) => {
    setCurrentDraft((prev) => {
      if (!prev) return prev;
      pendingPayload.current = next;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { void flushSave(); }, AUTOSAVE_DEBOUNCE_MS);
      return { ...prev, ui_payload: next };
    });
  }, [flushSave]);

  const load = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const row = await fetchCmaDraft(id);
      setCurrentId(id);
      setCurrentDraft(row);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load CMA draft');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createDraft = useCallback(async (input: { name: string; ui_payload?: CmaDraft }) => {
    const payload = input.ui_payload ?? emptyDraft(input.name);
    const row = await createCmaDraft({ name: input.name, ui_payload: payload });
    setCurrentId(row.id);
    setCurrentDraft(row);
    setDrafts((prev) => [row, ...prev]);
    return row;
  }, []);

  const clear = useCallback(() => {
    // Flush any pending save before dropping state — the closing
    // user expects their latest edits to be persisted.
    void flushSave();
    setCurrentId(null);
    setCurrentDraft(null);
  }, [flushSave]);

  const rename = useCallback(async (name: string) => {
    if (!currentId) return;
    await updateCmaDraft(currentId, { name });
    setCurrentDraft((prev) => prev ? { ...prev, name } : prev);
    setDrafts((prev) => prev.map((d) => d.id === currentId ? { ...d, name } : d));
  }, [currentId]);

  const remove = useCallback(async (id: string) => {
    await deleteCmaDraft(id);
    if (currentId === id) {
      setCurrentId(null);
      setCurrentDraft(null);
    }
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }, [currentId]);

  return {
    drafts,
    currentId,
    currentDraft,
    isLoading,
    error,
    refresh,
    load,
    clear,
    createDraft,
    rename,
    remove,
    updatePayload,
    setPayload,
  };
}

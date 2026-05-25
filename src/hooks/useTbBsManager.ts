/**
 * TB → BS draft manager. Same shape as useCMAManager — no streaming,
 * no quota, debounced autosave.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  fetchTbBsDrafts,
  fetchTbBsDraft,
  createTbBsDraft,
  updateTbBsDraft,
  deleteTbBsDraft,
  type TbBsDraftRow,
} from '../services/api';
import { emptyTbBsDraft, type TbBsDraft } from '../components/tb-bs/lib/uiModel';

const AUTOSAVE_DEBOUNCE_MS = 800;

export interface TbBsManager {
  drafts: TbBsDraftRow[];
  currentId: string | null;
  currentDraft: TbBsDraftRow | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  load: (id: string) => Promise<void>;
  clear: () => void;
  createDraft: (input: { name: string; ui_payload?: TbBsDraft }) => Promise<TbBsDraftRow>;
  rename: (name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  updatePayload: (patch: Partial<TbBsDraft>) => void;
  setPayload: (next: TbBsDraft) => void;
}

export function useTbBsManager(enabled: boolean): TbBsManager {
  const [drafts, setDrafts] = useState<TbBsDraftRow[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentDraft, setCurrentDraft] = useState<TbBsDraftRow | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPayload = useRef<TbBsDraft | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await fetchTbBsDrafts();
      setDrafts(data.drafts);
    } catch (err) {
      console.error('[tb-bs] failed to list drafts:', err);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    setIsLoading(true);
    refresh().finally(() => setIsLoading(false));
  }, [enabled, refresh]);

  const flushSave = useCallback(async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (!currentId || !pendingPayload.current) return;
    const payload = pendingPayload.current;
    pendingPayload.current = null;
    try {
      await updateTbBsDraft(currentId, { ui_payload: payload });
    } catch (err) {
      console.error('[tb-bs] autosave failed:', err);
      pendingPayload.current = payload;
    }
  }, [currentId]);

  useEffect(() => {
    const handler = () => { void flushSave(); };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      void flushSave();
    };
  }, [flushSave]);

  const updatePayload = useCallback((patch: Partial<TbBsDraft>) => {
    setCurrentDraft((prev) => {
      if (!prev) return prev;
      const merged: TbBsDraft = { ...prev.ui_payload, ...patch };
      pendingPayload.current = merged;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { void flushSave(); }, AUTOSAVE_DEBOUNCE_MS);
      return { ...prev, ui_payload: merged };
    });
  }, [flushSave]);

  const setPayload = useCallback((next: TbBsDraft) => {
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
      const row = await fetchTbBsDraft(id);
      setCurrentId(id);
      setCurrentDraft(row);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load draft');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createDraft = useCallback(async (input: { name: string; ui_payload?: TbBsDraft }) => {
    const payload = input.ui_payload ?? emptyTbBsDraft(input.name);
    const row = await createTbBsDraft({ name: input.name, ui_payload: payload });
    setCurrentId(row.id);
    setCurrentDraft(row);
    setDrafts((prev) => [row, ...prev]);
    return row;
  }, []);

  const clear = useCallback(() => {
    void flushSave();
    setCurrentId(null);
    setCurrentDraft(null);
  }, [flushSave]);

  const rename = useCallback(async (name: string) => {
    if (!currentId) return;
    await updateTbBsDraft(currentId, { name });
    setCurrentDraft((prev) => prev ? { ...prev, name } : prev);
    setDrafts((prev) => prev.map((d) => d.id === currentId ? { ...d, name } : d));
  }, [currentId]);

  const remove = useCallback(async (id: string) => {
    await deleteTbBsDraft(id);
    if (currentId === id) {
      setCurrentId(null);
      setCurrentDraft(null);
    }
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }, [currentId]);

  return {
    drafts, currentId, currentDraft, isLoading, error,
    refresh, load, clear, createDraft, rename, remove,
    updatePayload, setPayload,
  };
}

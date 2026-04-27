import { useState, useCallback, useEffect, useRef } from 'react';
import {
  fetchPartnershipDeedDrafts,
  createPartnershipDeedDraft,
  fetchPartnershipDeedDraft,
  updatePartnershipDeedDraft,
  deletePartnershipDeedDraft,
  generatePartnershipDeed,
  PartnershipDeedDraft,
  PartnershipDeedTemplateId,
} from '../services/api';

/**
 * Manages the list of partnership-deed drafts, the currently open draft,
 * a debounced autosave of the form payload, AND the streaming generation
 * of the deed body. Hybrid of useBoardResolutionManager (form persistence)
 * and useNoticeDrafter (AI streaming).
 */
export function usePartnershipDeedsManager(enabled: boolean) {
  const [drafts, setDrafts] = useState<PartnershipDeedDraft[]>([]);
  const [usage, setUsage] = useState<{ used: number; limit: number }>({ used: 0, limit: 3 });
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [currentDraft, setCurrentDraft] = useState<PartnershipDeedDraft | null>(null);
  const [generatedContent, setGeneratedContent] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** When true, the latest error came from a 429 quota response — UI shows an upgrade CTA. */
  const [errorKind, setErrorKind] = useState<'quota' | 'generic' | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadList = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await fetchPartnershipDeedDrafts();
      setDrafts(data.drafts);
      setUsage(data.usage);
    } catch {
      // non-fatal — user might not be logged in yet
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    setIsLoading(true);
    loadList().finally(() => setIsLoading(false));
  }, [enabled, loadList]);

  // Reload-resume polling. Server flips the draft row to status='generating'
  // before the Gemini call and updates it on completion (Node keeps the
  // handler running on tab close, so the row settles even if this manager
  // never sees the SSE done event). Poll every 5 s while any draft is in
  // 'generating' so the list refreshes and the active draft picks up the
  // final generated_content.
  useEffect(() => {
    if (!enabled) return;
    const hasInProgress = drafts.some(d => d.status === 'generating');
    if (!hasInProgress) return;
    const handle = setInterval(() => {
      void loadList();
      if (currentDraftId) void loadDraft(currentDraftId);
    }, 5000);
    return () => clearInterval(handle);
    // loadDraft / loadList are stable useCallback refs; including them
    // would re-create the interval on every render they fire in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, drafts, currentDraftId]);

  const clearDraft = useCallback(() => {
    setCurrentDraftId(null);
    setCurrentDraft(null);
    setGeneratedContent('');
    setError(null);
    setErrorKind(null);
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const createDraft = useCallback(
    async (input: { template_id: PartnershipDeedTemplateId; name: string }) => {
      const draft = await createPartnershipDeedDraft({ ...input, ui_payload: {} });
      setDrafts((prev) => [draft, ...prev]);
      setCurrentDraftId(draft.id);
      setCurrentDraft(draft);
      setGeneratedContent(draft.generated_content ?? '');
      return draft;
    },
    [],
  );

  const loadDraft = useCallback(async (draftId: string) => {
    try {
      const draft = await fetchPartnershipDeedDraft(draftId);
      setCurrentDraftId(draft.id);
      setCurrentDraft(draft);
      setGeneratedContent(draft.generated_content ?? '');
      setError(null);
      setErrorKind(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load draft');
      setErrorKind('generic');
    }
  }, []);

  const removeDraft = useCallback(
    async (draftId: string) => {
      await deletePartnershipDeedDraft(draftId);
      setDrafts((prev) => prev.filter((d) => d.id !== draftId));
      if (currentDraftId === draftId) clearDraft();
    },
    [currentDraftId, clearDraft],
  );

  const updatePayload = useCallback(
    (payload: Record<string, unknown>, opts: { name?: string } = {}) => {
      if (!currentDraftId) return;
      setCurrentDraft((prev) =>
        prev ? { ...prev, ui_payload: payload, name: opts.name ?? prev.name } : prev,
      );
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          await updatePartnershipDeedDraft(currentDraftId, {
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
          setErrorKind('generic');
        }
      }, 1500);
    },
    [currentDraftId],
  );

  const generate = useCallback(async () => {
    if (!currentDraftId) return;
    setIsGenerating(true);
    setGeneratedContent('');
    setError(null);
    setErrorKind(null);

    await generatePartnershipDeed(
      currentDraftId,
      (text) => setGeneratedContent((prev) => prev + text),
      (msg, kind = 'generic') => {
        setError(msg);
        setErrorKind(kind);
        setIsGenerating(false);
      },
      () => {
        setIsGenerating(false);
        // Refresh the draft + usage so the saved generated_content is in
        // sync and the quota counter updates.
        loadDraft(currentDraftId);
        loadList();
      },
    );
  }, [currentDraftId, loadDraft, loadList]);

  // Any draft still being generated on the server, derived from the
  // persisted status field rather than just this session's isGenerating
  // (which resets on reload). UI consumers gate destructive actions on
  // this so a tab close + reload + retry can't double-spend Gemini.
  const hasInProgressJob = isGenerating || drafts.some(d => d.status === 'generating');

  return {
    drafts,
    usage,
    currentDraftId,
    currentDraft,
    generatedContent,
    setGeneratedContent,
    isGenerating,
    hasInProgressJob,
    isLoading,
    error,
    errorKind,
    createDraft,
    loadDraft,
    clearDraft,
    removeDraft,
    updatePayload,
    generate,
    refresh: loadList,
  };
}

export type PartnershipDeedsManager = ReturnType<typeof usePartnershipDeedsManager>;

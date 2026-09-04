import { useState, useCallback, useEffect } from 'react';
import {
  generateNotice,
  enhanceNotice,
  fetchNotices,
  fetchNotice,
  deleteNotice,
  NoticeItem,
  NoticeGenerateInput,
} from '../services/api';
import { postToParent } from '../lib/pluginProtocol';

const isPluginMode = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('plugin') === 'true';

/** Letterhead (header + watermark) configuration for generated notices */
export interface LetterheadConfig {
  header: {
    enabled: boolean;
    type: 'text' | 'image';
    text: string;
    imageDataUrl: string; // base64 data URL
    align: 'left' | 'center' | 'right';
  };
  watermark: {
    enabled: boolean;
    type: 'text' | 'image';
    text: string;
    imageDataUrl: string;
    opacity: number; // 0-100
  };
}

const DEFAULT_LETTERHEAD: LetterheadConfig = {
  header: { enabled: false, type: 'text', text: '', imageDataUrl: '', align: 'center' },
  watermark: { enabled: false, type: 'text', text: '', imageDataUrl: '', opacity: 15 },
};

const LETTERHEAD_KEY = 'smart_ai_notice_letterhead';

function loadLetterhead(): LetterheadConfig {
  if (typeof window === 'undefined') return DEFAULT_LETTERHEAD;
  try {
    const raw = localStorage.getItem(LETTERHEAD_KEY);
    if (!raw) return DEFAULT_LETTERHEAD;
    const parsed = JSON.parse(raw);
    return {
      header: { ...DEFAULT_LETTERHEAD.header, ...(parsed.header || {}) },
      watermark: { ...DEFAULT_LETTERHEAD.watermark, ...(parsed.watermark || {}) },
    };
  } catch {
    return DEFAULT_LETTERHEAD;
  }
}

export function useNoticeDrafter() {
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [usage, setUsage] = useState<{ used: number; limit: number }>({ used: 0, limit: 3 });
  const [generatedContent, setGeneratedContent] = useState('');
  const [currentNoticeId, setCurrentNoticeId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [letterhead, setLetterheadState] = useState<LetterheadConfig>(() => loadLetterhead());

  const setLetterhead = useCallback((next: LetterheadConfig) => {
    setLetterheadState(next);
    try {
      localStorage.setItem(LETTERHEAD_KEY, JSON.stringify(next));
    } catch {
      // ignore quota/privacy errors
    }
  }, []);

  // Load notices on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchNotices();
        setNotices(data.notices);
        setUsage(data.usage);
      } catch {
        // silent — user may not be logged in yet
      }
    })();
  }, []);

  const loadNotices = useCallback(async () => {
    try {
      const data = await fetchNotices();
      setNotices(data.notices);
      setUsage(data.usage);
      if (isPluginMode) {
        postToParent({
          type: 'USAGE_UPDATE',
          plan: 'current',
          feature: 'notices',
          used: data.usage.used,
          limit: data.usage.limit,
        });
      }
    } catch (err) {
      console.error('Failed to load notices:', err);
    }
  }, []);

  // Reload-resume polling. Server creates a notice row UPFRONT with
  // status='generating' before the Gemini call, so a tab close + reload
  // mid-draft doesn't lose work — Node keeps the handler running and
  // updates the row to 'generated' or 'error' on completion. Poll every
  // 5 s while any notice is 'generating' so the list refreshes and the
  // hasInProgressJob flag exits cleanly.
  useEffect(() => {
    const hasInProgress = notices.some(n => n.status === 'generating');
    if (!hasInProgress) return;
    const handle = setInterval(() => { void loadNotices(); }, 5000);
    return () => clearInterval(handle);
  }, [notices, loadNotices]);

  const generate = useCallback(async (input: NoticeGenerateInput, file?: File) => {
    setIsGenerating(true);
    setGeneratedContent('');
    setError(null);
    setCurrentNoticeId(null);

    try {
      await generateNotice(
        input,
        (text) => setGeneratedContent(prev => prev + text),
        (msg) => { setError(msg); setIsGenerating(false); },
        async (noticeId, meta) => {
          setCurrentNoticeId(noticeId);
          setIsGenerating(false);
          // When the server post-processed the draft (e.g. stripped
          // citations without an authoritative source URL), the
          // streamed text the user just watched come in is now stale
          // — the persisted draft has fewer citations. Re-fetch the
          // canonical content so the on-screen view matches what
          // will be exported / filed.
          if ((meta?.citationsSanitized || (meta?.urlsDropped ?? 0) > 0) && noticeId) {
            try {
              const fresh = await fetchNotice(noticeId);
              if (fresh.generated_content) setGeneratedContent(fresh.generated_content);
              // Report what ACTUALLY happened. Saying "cleaned up
              // citations" when the only change was a stripped dead
              // link left users hunting for a citation that was fine.
              const n = meta.citationsDropped ?? 0;
              const u = meta.urlsDropped ?? 0;
              const parts: string[] = [];
              if (n > 0) parts.push(`${n} case-law citation${n === 1 ? '' : 's'} we couldn't verify`);
              if (u > 0) parts.push(`${u} source link${u === 1 ? '' : 's'} that didn't resolve to a known official page`);
              const msg = parts.length > 0
                ? `Removed ${parts.join(' and ')}. The wording is intact — only the unverifiable reference${n + u === 1 ? ' was' : 's were'} dropped. Always double-check before filing.`
                : `Cleaned up references to keep only verified ones. Always double-check before filing.`;
              // Lazy-import toast so the hook stays react-only.
              const { default: toast } = await import('react-hot-toast');
              toast(msg, { icon: '⚠️', duration: 6000 });
            } catch (e) {
              console.warn('[useNoticeDrafter] re-fetch after sanitisation failed:', e);
            }
          }
          loadNotices();
        },
        file,
      );
    } catch {
      setError('An unexpected error occurred.');
      setIsGenerating(false);
    }
  }, [loadNotices]);

  /** Refine the current draft from a plain-language instruction.
   *  The server re-emits the WHOLE letter, so we clear the draft and
   *  rebuild it from the stream rather than appending. On failure the
   *  server leaves the stored draft untouched; we restore the previous
   *  text locally so a failed enhance never loses the user's letter. */
  const enhance = useCallback(async (instruction: string) => {
    if (!currentNoticeId) {
      setError('Save or generate a draft before enhancing it.');
      return;
    }
    const previous = generatedContent;
    setIsEnhancing(true);
    setError(null);
    let streamed = '';
    let failed = false;

    try {
      await enhanceNotice(
        currentNoticeId,
        instruction,
        (text) => {
          streamed += text;
          // First chunk replaces the old letter; later chunks extend it.
          setGeneratedContent(streamed);
        },
        (msg) => { failed = true; setError(msg); setGeneratedContent(previous); },
        async (_noticeId, meta) => {
          if ((meta?.citationsSanitized || (meta?.urlsDropped ?? 0) > 0) && currentNoticeId) {
            try {
              const fresh = await fetchNotice(currentNoticeId);
              if (fresh.generated_content) setGeneratedContent(fresh.generated_content);
              // Report what ACTUALLY happened. Saying "cleaned up
              // citations" when the only change was a stripped dead
              // link left users hunting for a citation that was fine.
              const n = meta.citationsDropped ?? 0;
              const u = meta.urlsDropped ?? 0;
              const parts: string[] = [];
              if (n > 0) parts.push(`${n} case-law citation${n === 1 ? '' : 's'} we couldn't verify`);
              if (u > 0) parts.push(`${u} source link${u === 1 ? '' : 's'} that didn't resolve to a known official page`);
              const msg = parts.length > 0
                ? `Removed ${parts.join(' and ')}. The wording is intact — only the unverifiable reference${n + u === 1 ? ' was' : 's were'} dropped. Always double-check before filing.`
                : `Cleaned up references to keep only verified ones. Always double-check before filing.`;
              const { default: toast } = await import('react-hot-toast');
              toast(msg, { icon: '⚠️', duration: 6000 });
            } catch (e) {
              console.warn('[useNoticeDrafter] re-fetch after enhance sanitisation failed:', e);
            }
          }
          loadNotices();
        },
      );
    } catch {
      failed = true;
      setError('An unexpected error occurred while enhancing the draft.');
      setGeneratedContent(previous);
    } finally {
      setIsEnhancing(false);
    }
    return !failed;
  }, [currentNoticeId, generatedContent, loadNotices]);

  const loadNotice = useCallback(async (id: string) => {
    try {
      const notice = await fetchNotice(id);
      setGeneratedContent(notice.generated_content || '');
      setCurrentNoticeId(id);
      setError(null);
    } catch {
      console.error('Failed to load notice');
    }
  }, []);

  const removeNotice = useCallback(async (id: string) => {
    await deleteNotice(id);
    if (currentNoticeId === id) {
      setCurrentNoticeId(null);
      setGeneratedContent('');
    }
    await loadNotices();
  }, [currentNoticeId, loadNotices]);

  const clearDraft = useCallback(() => {
    setGeneratedContent('');
    setCurrentNoticeId(null);
    setError(null);
  }, []);

  // Any notice still being generated on the server (status='generating'
  // in the persisted list, or the in-flight isGenerating flag from this
  // session). UI uses this to gate destructive actions across the app.
  const hasInProgressJob = isGenerating || notices.some(n => n.status === 'generating');

  return {
    notices,
    usage,
    generatedContent,
    setGeneratedContent,
    currentNoticeId,
    isGenerating,
    isEnhancing,
    enhance,
    hasInProgressJob,
    error,
    letterhead,
    setLetterhead,
    loadNotices,
    generate,
    loadNotice,
    removeNotice,
    clearDraft,
  };
}

export type NoticeDrafterState = ReturnType<typeof useNoticeDrafter>;

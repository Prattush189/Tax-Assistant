import { useState, useCallback, useEffect } from 'react';
import {
  generateNotice,
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

  const generate = useCallback(async (input: NoticeGenerateInput) => {
    setIsGenerating(true);
    setGeneratedContent('');
    setError(null);
    setCurrentNoticeId(null);

    try {
      await generateNotice(
        input,
        (text) => setGeneratedContent(prev => prev + text),
        (msg) => { setError(msg); setIsGenerating(false); },
        (noticeId) => {
          setCurrentNoticeId(noticeId);
          setIsGenerating(false);
          loadNotices();
        },
      );
    } catch {
      setError('An unexpected error occurred.');
      setIsGenerating(false);
    }
  }, [loadNotices]);

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

  return {
    notices,
    usage,
    generatedContent,
    setGeneratedContent,
    currentNoticeId,
    isGenerating,
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

import { useState, useCallback } from 'react';
import {
  generateNotice,
  fetchNotices,
  fetchNotice,
  deleteNotice,
  NoticeItem,
  NoticeGenerateInput,
} from '../services/api';

export function useNoticeDrafter() {
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [usage, setUsage] = useState<{ used: number; limit: number }>({ used: 0, limit: 3 });
  const [generatedContent, setGeneratedContent] = useState('');
  const [currentNoticeId, setCurrentNoticeId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNotices = useCallback(async () => {
    try {
      const data = await fetchNotices();
      setNotices(data.notices);
      setUsage(data.usage);
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
    loadNotices,
    generate,
    loadNotice,
    removeNotice,
    clearDraft,
  };
}

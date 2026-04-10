import { useState, useEffect, useRef, useCallback } from 'react';
import { Message, DocumentContext, SectionReference } from '../types';
import {
  fetchChats,
  createChat as apiCreateChat,
  fetchChatMessages,
  deleteChat as apiDeleteChat,
  sendChatMessage,
  ChatItem,
} from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export function useChatManager() {
  const { isAuthenticated } = useAuth();
  const [chatList, setChatList] = useState<ChatItem[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeDocuments, setActiveDocuments] = useState<DocumentContext[]>([]);
  const [referencedProfile, setReferencedProfile] = useState<{ id: string; name: string; data: Record<string, unknown> } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const lastUserMsgRef = useRef<HTMLDivElement>(null);
  const scrollActionRef = useRef<'none' | 'user-to-top' | 'to-bottom'>('none');
  const streamingChatIdRef = useRef<string | null>(null);

  useEffect(() => {
    const action = scrollActionRef.current;
    if (action === 'none') return;

    requestAnimationFrame(() => {
      if (action === 'to-bottom') {
        // Scroll to the very bottom (switching chats, loading history)
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      } else if (action === 'user-to-top') {
        // Scroll so the user's new message is near the top of the viewport
        const container = scrollAreaRef.current;
        const userEl = lastUserMsgRef.current;
        if (container && userEl) {
          const containerRect = container.getBoundingClientRect();
          const userRect = userEl.getBoundingClientRect();
          const offset = userRect.top - containerRect.top + container.scrollTop - 16;
          container.scrollTo({ top: offset, behavior: 'smooth' });
        }
      }
      scrollActionRef.current = 'none';
    });
  }, [messages]);

  const loadChatList = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const chats = await fetchChats();
      setChatList(chats);
    } catch (err) {
      console.error('Failed to load chats:', err);
    }
  }, [isAuthenticated]);

  useEffect(() => { loadChatList(); }, [loadChatList]);

  const switchChat = useCallback(async (chatId: string) => {
    streamingChatIdRef.current = null;
    setIsLoading(false);
    setCurrentChatId(chatId);
    setActiveDocuments([]);
    scrollActionRef.current = 'to-bottom';
    try {
      const msgs = await fetchChatMessages(chatId);
      setMessages(
        msgs.map(m => ({
          role: m.role,
          content: m.content,
          timestamp: new Date(m.created_at + '+05:30'),
          attachment: m.attachment_filename
            ? { filename: m.attachment_filename, mimeType: m.attachment_mime_type! }
            : undefined,
        }))
      );
    } catch (err) {
      console.error('Failed to load messages:', err);
      setMessages([]);
    }
  }, []);

  const createNewChat = useCallback(async (): Promise<string> => {
    const chat = await apiCreateChat();
    setChatList(prev => [chat, ...prev]);
    setCurrentChatId(chat.id);
    setMessages([]);
    setActiveDocuments([]);
    return chat.id;
  }, []);

  const deleteChatById = useCallback(async (chatId: string) => {
    await apiDeleteChat(chatId);
    setChatList(prev => prev.filter(c => c.id !== chatId));
    if (currentChatId === chatId) {
      setCurrentChatId(null);
      setMessages([]);
      setActiveDocuments([]);
    }
  }, [currentChatId]);

  const send = useCallback(async () => {
    if (isLoading || input.trim() === '') return;

    let chatId = currentChatId;

    // Auto-create chat if none selected
    if (!chatId) {
      try {
        chatId = await createNewChat();
      } catch (err) {
        console.error('Failed to create chat:', err);
        return;
      }
    }

    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
      attachments: activeDocuments.length > 0
        ? activeDocuments.map(d => ({ filename: d.filename, mimeType: d.mimeType }))
        : undefined,
      profileRef: referencedProfile?.name,
    };

    const messageText = input.trim();
    const thisChatId = chatId; // capture for closure
    scrollActionRef.current = 'to-bottom';
    streamingChatIdRef.current = thisChatId;

    setMessages(prev => [...prev, userMessage, {
      role: 'model',
      content: '',
      timestamp: new Date(),
    }]);
    setInput('');
    setIsLoading(true);

    let wasTruncated = false;
    let receivedRefs: SectionReference[] | undefined;

    // Line-buffered streaming: accumulate text and only reveal complete lines
    let buffer = '';
    let revealed = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    // Guard: only write to state if still on the same chat
    const isStale = () => streamingChatIdRef.current !== thisChatId;

    const flushBuffer = () => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (isStale()) return;
      const lastNl = buffer.lastIndexOf('\n');
      if (lastNl === -1) return;
      revealed += buffer.slice(0, lastNl + 1);
      buffer = buffer.slice(lastNl + 1);
      const snapshot = revealed;
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: snapshot };
        return updated;
      });
    };

    const flushAll = () => {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (isStale()) return;
      revealed += buffer;
      buffer = '';
      const snapshot = revealed;
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: snapshot };
        return updated;
      });
    };

    try {
      await sendChatMessage(
        chatId,
        messageText,
        (text) => {
          if (isStale()) return;
          buffer += text;
          if (buffer.includes('\n')) {
            flushBuffer();
          } else {
            if (flushTimer) clearTimeout(flushTimer);
            flushTimer = setTimeout(flushBuffer, 300);
          }
        },
        (errorMsg) => {
          if (isStale()) return;
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { ...updated[updated.length - 1], content: errorMsg };
            return updated;
          });
        },
        activeDocuments.length > 0 ? activeDocuments.map(d => ({ filename: d.filename, mimeType: d.mimeType, extractedData: d.extractedData })) : undefined,
        (stopReason, references) => {
          if (stopReason === 'max_tokens') wasTruncated = true;
          if (references?.length) receivedRefs = references;
        },
        referencedProfile ? { name: referencedProfile.name, data: referencedProfile.data } : undefined,
      );

      setReferencedProfile(null);

      // Flush any remaining buffered text
      flushAll();

      // Mark truncated and/or attach references (only if still on the same chat)
      if (!isStale() && (wasTruncated || receivedRefs)) {
        setMessages(prev => {
          const updated = [...prev];
          const last = { ...updated[updated.length - 1] };
          if (wasTruncated) last.truncated = true;
          if (receivedRefs) last.references = receivedRefs;
          updated[updated.length - 1] = last;
          return updated;
        });
      }

      await loadChatList();
    } finally {
      if (!isStale()) setIsLoading(false);
    }
  }, [isLoading, input, currentChatId, activeDocuments, referencedProfile, createNewChat, loadChatList]);

  const continueResponse = useCallback(async () => {
    if (isLoading) return;
    const chatId = currentChatId;
    if (!chatId) return;

    setIsLoading(true);

    // Remove truncated flag from last message
    setMessages(prev => {
      const updated = [...prev];
      if (updated.length > 0) {
        updated[updated.length - 1] = { ...updated[updated.length - 1], truncated: false };
      }
      return updated;
    });

    // Add empty model message for streaming continuation
    setMessages(prev => [...prev, {
      role: 'model' as const,
      content: '',
      timestamp: new Date(),
    }]);

    let contTruncated = false;

    // Line-buffered streaming for continue
    let cBuffer = '';
    let cRevealed = '';
    let cFlushTimer: ReturnType<typeof setTimeout> | null = null;

    const cFlush = () => {
      if (cFlushTimer) { clearTimeout(cFlushTimer); cFlushTimer = null; }
      const lastNl = cBuffer.lastIndexOf('\n');
      if (lastNl === -1) return;
      cRevealed += cBuffer.slice(0, lastNl + 1);
      cBuffer = cBuffer.slice(lastNl + 1);
      const snapshot = cRevealed;
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: snapshot };
        return updated;
      });
    };

    const cFlushAll = () => {
      if (cFlushTimer) { clearTimeout(cFlushTimer); cFlushTimer = null; }
      cRevealed += cBuffer;
      cBuffer = '';
      const snapshot = cRevealed;
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: snapshot };
        return updated;
      });
    };

    try {
      await sendChatMessage(
        chatId,
        'Continue from where you left off. Do not repeat what you already said.',
        (text) => {
          cBuffer += text;
          if (cBuffer.includes('\n')) {
            cFlush();
          } else {
            if (cFlushTimer) clearTimeout(cFlushTimer);
            cFlushTimer = setTimeout(cFlush, 300);
          }
        },
        (errorMsg) => {
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { ...updated[updated.length - 1], content: errorMsg };
            return updated;
          });
        },
        undefined,
        (stopReason) => {
          if (stopReason === 'max_tokens') contTruncated = true;
        },
      );

      cFlushAll();

      if (contTruncated) {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], truncated: true };
          return updated;
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, currentChatId]);

  const attachDocument = (doc: DocumentContext) => setActiveDocuments(prev => [...prev, doc]);
  const detachDocument = (index?: number) => {
    if (index !== undefined) {
      setActiveDocuments(prev => prev.filter((_, i) => i !== index));
    } else {
      setActiveDocuments([]);
    }
  };

  const clearChat = () => {
    setCurrentChatId(null);
    setMessages([]);
    setInput('');
    setActiveDocuments([]);
  };

  return {
    chatList,
    currentChatId,
    messages,
    input,
    setInput,
    isLoading,
    messagesEndRef,
    scrollAreaRef,
    lastUserMsgRef,
    send,
    clearChat,
    createNewChat,
    switchChat,
    deleteChatById,
    activeDocuments,
    attachDocument,
    detachDocument,
    continueResponse,
    referencedProfile,
    setReferencedProfile,
  };
}

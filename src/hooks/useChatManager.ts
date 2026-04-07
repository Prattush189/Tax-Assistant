import { useState, useEffect, useRef, useCallback } from 'react';
import { Message, DocumentContext } from '../types';
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
  const { isAuthenticated, isGuest } = useAuth();
  const [chatList, setChatList] = useState<ChatItem[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeDocument, setActiveDocument] = useState<DocumentContext | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load chat list (authenticated only)
  const loadChatList = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const chats = await fetchChats();
      setChatList(chats);
    } catch (err) {
      console.error('Failed to load chats:', err);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    loadChatList();
  }, [loadChatList]);

  const switchChat = useCallback(async (chatId: string) => {
    setCurrentChatId(chatId);
    setActiveDocument(null);
    try {
      const msgs = await fetchChatMessages(chatId);
      setMessages(
        msgs.map(m => ({
          role: m.role,
          content: m.content,
          timestamp: new Date(m.created_at),
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
    if (isGuest) {
      // Guest: just clear local state, no API call
      setCurrentChatId(null);
      setMessages([]);
      setActiveDocument(null);
      return 'guest';
    }
    const chat = await apiCreateChat();
    setChatList(prev => [chat, ...prev]);
    setCurrentChatId(chat.id);
    setMessages([]);
    setActiveDocument(null);
    return chat.id;
  }, [isGuest]);

  const deleteChatById = useCallback(async (chatId: string) => {
    await apiDeleteChat(chatId);
    setChatList(prev => prev.filter(c => c.id !== chatId));
    if (currentChatId === chatId) {
      setCurrentChatId(null);
      setMessages([]);
      setActiveDocument(null);
    }
  }, [currentChatId]);

  // Send a message
  const send = useCallback(async () => {
    if (isLoading || input.trim() === '') return;

    let chatId = currentChatId;

    if (isAuthenticated && !chatId) {
      // Auto-create chat for authenticated users
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
      attachment: activeDocument
        ? { filename: activeDocument.filename, mimeType: activeDocument.mimeType }
        : undefined,
    };

    const messageText = input.trim();
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Add empty model placeholder
    setMessages(prev => [...prev, { role: 'model', content: '', timestamp: new Date() }]);

    try {
      await sendChatMessage(
        chatId ?? null,
        messageText,
        (text) => setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: updated[updated.length - 1].content + text,
          };
          return updated;
        }),
        (msg) => setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: msg,
          };
          return updated;
        }),
        activeDocument ? { filename: activeDocument.filename, mimeType: activeDocument.mimeType, extractedData: activeDocument.extractedData } : undefined,
        isGuest ? messages : undefined,
      );

      if (isAuthenticated) {
        await loadChatList();
      }
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, input, currentChatId, activeDocument, isAuthenticated, isGuest, messages, createNewChat, loadChatList]);

  const attachDocument = (doc: DocumentContext) => setActiveDocument(doc);
  const detachDocument = () => setActiveDocument(null);

  const clearChat = () => {
    setCurrentChatId(null);
    setMessages([]);
    setInput('');
    setActiveDocument(null);
  };

  return {
    chatList,
    currentChatId,
    messages,
    input,
    setInput,
    isLoading,
    messagesEndRef,
    send,
    clearChat,
    createNewChat,
    switchChat,
    deleteChatById,
    activeDocument,
    attachDocument,
    detachDocument,
    isGuest,
  };
}

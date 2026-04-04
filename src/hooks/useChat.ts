import { useState, useRef, useEffect } from 'react';
import { Message } from '../types';
import { sendChatMessage } from '../services/api';

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (isLoading || input.trim() === '') return;

    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Add empty model message placeholder to be filled by streamed chunks
    setMessages(prev => [...prev, { role: 'model', content: '', timestamp: new Date() }]);

    try {
      await sendChatMessage(
        userMessage.content,
        messages,
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
        })
      );
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setInput('');
  };

  return {
    messages,
    input,
    setInput,
    isLoading,
    messagesEndRef,
    send,
    clearChat,
  };
}

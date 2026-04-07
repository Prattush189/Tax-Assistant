import { Message, UploadResponse } from '../types';

const TOKEN_KEY = 'tax_access_token';

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Chat API (streaming) ─────────────────────────────────────────────────

export async function sendChatMessage(
  chatId: string | null,
  message: string,
  onChunk: (text: string) => void,
  onError: (msg: string) => void,
  fileContext?: { uri: string; mimeType: string },
  localHistory?: Message[],
): Promise<void> {
  // Build body — guest mode sends history, authenticated sends chatId
  const body: Record<string, unknown> = {
    message,
    fileContext: fileContext ?? null,
  };

  if (chatId && chatId !== 'guest') {
    body.chatId = chatId;
  }

  if (localHistory) {
    // Guest mode: send conversation history so server can forward to Gemini
    body.history = localHistory.map(m => ({
      role: m.role,
      parts: [{ text: m.content }],
    }));
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    let errorMessage = "I encountered an error while processing your request. Please try again.";
    try {
      const errData = await response.json();
      if (errData.error) errorMessage = errData.error;
    } catch {
      // ignore parse errors
    }
    onError(errorMessage);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') return;

      try {
        const parsed = JSON.parse(payload);
        if (parsed.error) {
          onError(parsed.message ?? "I'm having trouble connecting. Please try again in a moment.");
          return;
        }
        if (parsed.text) {
          onChunk(parsed.text);
        }
      } catch {
        // Malformed JSON chunk — skip
      }
    }
  }
}

// ── Upload API ────────────────────────────────────────────────────────────

export async function uploadFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: { ...getAuthHeaders() },
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Upload failed.');
  }

  return data as UploadResponse;
}

// ── Chat CRUD API ─────────────────────────────────────────────────────────

export interface ChatItem {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'model';
  content: string;
  attachment_filename: string | null;
  attachment_mime_type: string | null;
  created_at: string;
}

async function authFetch(url: string, options: RequestInit = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export async function fetchChats(): Promise<ChatItem[]> {
  return authFetch('/api/chats');
}

export async function createChat(title?: string): Promise<ChatItem> {
  return authFetch('/api/chats', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export async function fetchChatMessages(chatId: string): Promise<ChatMessage[]> {
  return authFetch(`/api/chats/${chatId}/messages`);
}

export async function updateChatTitle(chatId: string, title: string): Promise<void> {
  await authFetch(`/api/chats/${chatId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export async function deleteChat(chatId: string): Promise<void> {
  await authFetch(`/api/chats/${chatId}`, { method: 'DELETE' });
}

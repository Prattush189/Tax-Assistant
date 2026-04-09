import { Message, UploadResponse, SectionReference } from '../types';

const TOKEN_KEY = 'tax_access_token';

function getPluginKey(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('key');
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) return { Authorization: `Bearer ${token}` };

  // Guest/plugin mode — send plugin key if present
  const pluginKey = getPluginKey();
  if (pluginKey) return { 'X-Plugin-Key': pluginKey };

  return {};
}

// ── Chat API (streaming) ─────────────────────────────────────────────────

export async function sendChatMessage(
  chatId: string | null,
  message: string,
  onChunk: (text: string) => void,
  onError: (msg: string) => void,
  fileContext?: { filename: string; mimeType: string; extractedData?: unknown },
  onDone?: (stopReason: string | null, references?: SectionReference[]) => void,
): Promise<void> {
  const body: Record<string, unknown> = {
    message,
    chatId: chatId ?? undefined,
    fileContext: fileContext ?? null,
  };

  const doStreamFetch = () => fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(body),
  });

  let response = await doStreamFetch();

  // Auto-refresh on 401
  if (response.status === 401) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      response = await doStreamFetch();
    }
  }

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
      try {
        const parsed = JSON.parse(payload);
        if (parsed.done) {
          onDone?.(parsed.stop_reason ?? null, parsed.references ?? undefined);
          return;
        }
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

const REFRESH_KEY = 'tax_refresh_token';

async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    localStorage.setItem(TOKEN_KEY, data.accessToken);
    localStorage.setItem(REFRESH_KEY, data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

async function authFetch(url: string, options: RequestInit = {}) {
  const doFetch = () => fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options.headers,
    },
  });

  let res = await doFetch();

  // Auto-refresh on 401
  if (res.status === 401) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      res = await doFetch();
    }
  }

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

// ── Admin API ─────────────────────────────────────────────────────────────

export async function adminFetchStats(period = 'month') {
  return authFetch(`/api/admin/stats?period=${period}`);
}

export async function adminFetchUsers() {
  return authFetch('/api/admin/users');
}

export async function adminFetchUsage(period = 'month') {
  return authFetch(`/api/admin/usage?period=${period}`);
}

export async function adminSuspendUser(userId: string, hours: number) {
  return authFetch(`/api/admin/users/${userId}/suspend`, {
    method: 'POST',
    body: JSON.stringify({ hours }),
  });
}

export async function adminUnsuspendUser(userId: string) {
  return authFetch(`/api/admin/users/${userId}/unsuspend`, { method: 'POST' });
}

export async function adminBlockIp(ip: string, hours: number, reason?: string) {
  return authFetch(`/api/admin/ip/${encodeURIComponent(ip)}/block`, {
    method: 'POST',
    body: JSON.stringify({ hours, reason }),
  });
}

export async function adminUnblockIp(ip: string) {
  return authFetch(`/api/admin/ip/${encodeURIComponent(ip)}/unblock`, { method: 'POST' });
}

export async function adminChangePlan(userId: string, plan: 'free' | 'pro' | 'enterprise') {
  return authFetch(`/api/admin/users/${userId}/plan`, {
    method: 'POST',
    body: JSON.stringify({ plan }),
  });
}

// ── Notice Drafter API ───────────────────────────────────────────────────

export interface NoticeItem {
  id: string;
  notice_type: string;
  sub_type: string | null;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface NoticeGenerateInput {
  noticeType: string;
  subType?: string;
  senderDetails?: {
    name?: string;
    address?: string;
    pan?: string;
    gstin?: string;
  };
  recipientDetails?: {
    officer?: string;
    office?: string;
    address?: string;
  };
  noticeDetails?: {
    noticeNumber?: string;
    noticeDate?: string;
    section?: string;
    assessmentYear?: string;
    din?: string;
  };
  keyPoints: string;
  extractedText?: string;
}

export async function generateNotice(
  input: NoticeGenerateInput,
  onChunk: (text: string) => void,
  onError: (msg: string) => void,
  onDone?: (noticeId: string | null) => void,
): Promise<void> {
  const doFetch = () => fetch('/api/notices/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(input),
  });

  let response = await doFetch();
  if (response.status === 401) {
    const refreshed = await tryRefreshToken();
    if (refreshed) response = await doFetch();
  }

  if (!response.ok || !response.body) {
    let errorMessage = 'Failed to generate notice draft.';
    try {
      const errData = await response.json();
      if (errData.error) errorMessage = errData.error;
    } catch { /* ignore */ }
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
      try {
        const parsed = JSON.parse(line.slice(6).trim());
        if (parsed.done) { onDone?.(parsed.noticeId ?? null); return; }
        if (parsed.error) { onError(parsed.message ?? 'Generation failed.'); return; }
        if (parsed.text) onChunk(parsed.text);
      } catch { /* skip */ }
    }
  }
}

export async function fetchNotices(): Promise<{ notices: NoticeItem[]; usage: { used: number; limit: number } }> {
  return authFetch('/api/notices');
}

export async function fetchNotice(id: string) {
  return authFetch(`/api/notices/${id}`);
}

export async function updateNotice(id: string, content: string, title?: string) {
  return authFetch(`/api/notices/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ content, title }),
  });
}

export async function deleteNotice(id: string) {
  return authFetch(`/api/notices/${id}`, { method: 'DELETE' });
}

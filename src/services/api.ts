import { Message, UploadResponse } from '../types';

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

// Kept as a string alias for forward compatibility — only 'fast' is exercised.
export type ChatMode = 'fast';

// If the server stops pushing chunks for this long, abort and surface an error
// instead of leaving the UI stuck in "thinking" forever.
const CHAT_IDLE_TIMEOUT_MS = 45_000;

export async function sendChatMessage(
  chatId: string | null,
  message: string,
  onChunk: (text: string) => void,
  onError: (msg: string) => void,
  fileContexts?: { filename: string; mimeType: string; extractedData?: unknown }[],
  onDone?: (stopReason: string | null) => void,
  profileContext?: { name: string; data: Record<string, unknown> },
): Promise<void> {
  const body: Record<string, unknown> = {
    message,
    chatId: chatId ?? undefined,
    // Send as single fileContext for backward compat, or array for multi
    ...(fileContexts && fileContexts.length === 1
      ? { fileContext: fileContexts[0] }
      : fileContexts && fileContexts.length > 1
        ? { fileContexts }
        : { fileContext: null }),
    ...(profileContext ? { profileContext } : {}),
  };

  const controller = new AbortController();
  const doStreamFetch = () => fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  let response: Response;
  try {
    response = await doStreamFetch();
  } catch (err) {
    onError(err instanceof Error && err.name === 'AbortError'
      ? 'Request cancelled.'
      : 'Network error. Please check your connection and try again.');
    return;
  }

  // Auto-refresh on 401
  if (response.status === 401) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      try {
        response = await doStreamFetch();
      } catch (err) {
        onError(err instanceof Error && err.name === 'AbortError'
          ? 'Request cancelled.'
          : 'Network error. Please check your connection and try again.');
        return;
      }
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
  let terminated = false; // true after we've surfaced a done/error to the caller
  let receivedAnyText = false;

  // Idle-timeout watchdog: if no bytes arrive for CHAT_IDLE_TIMEOUT_MS,
  // abort the fetch so the reader.read() promise rejects and we can surface
  // a helpful error instead of hanging indefinitely.
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { controller.abort(); }, CHAT_IDLE_TIMEOUT_MS);
  };
  armIdle();

  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (terminated) break;
        const isAbort = err instanceof Error && err.name === 'AbortError';
        onError(isAbort
          ? (receivedAnyText
              ? 'The response was cut off. Please try again.'
              : 'The server stopped responding. Please try again.')
          : "I'm having trouble connecting. Please try again in a moment.");
        terminated = true;
        break;
      }
      const { done, value } = chunk;
      if (done) break;
      armIdle();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        try {
          const parsed = JSON.parse(payload);
          // Server heartbeat — just resets idle watchdog, no user-visible effect.
          if (parsed.heartbeat) continue;
          // Primary model went down mid-request and we're switching to
          // backup. Surface a one-shot toast so the user knows why the
          // first few hundred ms felt slower than usual.
          if (parsed.providerFallback) { notifyProviderFallback(); continue; }
          if (parsed.done) {
            onDone?.(parsed.stop_reason ?? null);
            terminated = true;
            return;
          }
          if (parsed.error) {
            onError(parsed.message ?? "I'm having trouble connecting. Please try again in a moment.");
            terminated = true;
            return;
          }
          if (parsed.text) {
            receivedAnyText = true;
            onChunk(parsed.text);
          }
        } catch {
          // Malformed JSON chunk — skip
        }
      }
    }

    // Stream ended (reader.done) without a terminal event — treat as truncation.
    if (!terminated) {
      onError(receivedAnyText
        ? 'The response was cut off before it finished. Please try again.'
        : "I didn't get a response. Please try again.");
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    try { reader.releaseLock(); } catch { /* noop */ }
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
    // Surface server-provided `detail` when present. The bare `error`
    // is usually a UX-friendly headline ("Comparison failed. Try
    // again or contact support."), and `detail` carries the actual
    // exception slice the route appended (token-quota name, JSON
    // truncation reason, LLM-provider 5xx code). Without joining
    // the two the user got a one-liner with no diagnostic — and
    // worse, the developer couldn't tell from the toast whether the
    // comparison hit MAX_TOKENS, lost auth, or the LLM timed out.
    const headline = data.error || `Request failed (${res.status})`;
    const msg = data.detail ? `${headline} — ${data.detail}` : headline;
    // Strip the [gemini-user] sentinel prefix that the server attaches
    // to sanitised AI-service errors before they surface here. The
    // prefix is invisible to end users but lets the client tell a
    // pre-formatted message from a raw passthrough.
    const clean = msg.startsWith('[gemini-user]') ? msg.slice('[gemini-user]'.length).trim() : msg;
    throw new Error(clean);
  }
  // Surface provider-fallback so the UI can toast "Server busy, retrying…".
  // Set by routes whose LLM call fell from the primary to a backup model
  // mid-request. Best-effort: a missing header just means no fallback fired.
  if (res.headers.get('X-Provider-Fallback') === '1') {
    notifyProviderFallback();
  }
  return res.json();
}

// Emits a one-shot "Server busy, retrying…" toast when an API response
// signals that the primary LLM model fell over to a fallback. Throttled
// per-page so a burst of API calls during the same outage doesn't spam.
let lastFallbackToastAt = 0;
const FALLBACK_TOAST_THROTTLE_MS = 8_000;
function notifyProviderFallback(): void {
  const now = Date.now();
  if (now - lastFallbackToastAt < FALLBACK_TOAST_THROTTLE_MS) return;
  lastFallbackToastAt = now;
  // Lazy import to avoid pulling react-hot-toast into the auth bundle
  // and to keep this module dependency-light for the few callers that
  // import api.ts in non-toast contexts.
  void import('react-hot-toast').then(({ default: toast }) => {
    toast('Server busy — switched to backup model. Retrying…', {
      duration: 4000,
      id: 'provider-fallback',
    });
  }).catch(() => { /* ignore */ });
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

export interface AdminUserDetails {
  user: {
    id: string; name: string; email: string; plan: string;
    effectivePlan: string; role: string; created_at: string;
    suspended_until: string | null;
  };
  totals: {
    requests: number; inputTokens: number; outputTokens: number;
    totalTokens: number;
    totalCostUsd: number; totalCostInr: number;
    avgCostPer1MUsd: number; avgCostPer1MInr: number;
    lastUsed: string | null;
  };
  monthly: { tokensUsed: number; tokenBudget: number; pct: number };
  daily: Array<{
    date: string; requests: number;
    input_tokens: number; output_tokens: number;
    /** Weighted total (model-weight × raw tokens). Matches the
     *  quota gate's accounting so the chart and the budget bar
     *  align. Optional for safety on legacy admin responses. */
    weighted_tokens?: number;
    cost: number; cost_inr: number;
  }>;
  recent: Array<{
    id: string;
    input_tokens: number; output_tokens: number;
    /** Pre-flight token estimate from the quota gate. Only set on the
     *  summary row of a request (per-chunk / failure / cancel rows
     *  stay at 0). Used to audit estimate-vs-actual in the admin UI. */
    estimated_tokens: number;
    cost: number; cost_inr: number;
    model: string | null; search_used: number;
    is_plugin: number; category: string | null;
    status: string | null; created_at: string;
  }>;
}

export async function adminFetchUserDetails(userId: string): Promise<AdminUserDetails> {
  return authFetch(`/api/admin/users/${userId}/details`);
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

/** Admin self-service: wipe THIS month's feature_usage rows for the
 *  calling admin's own billing user. Resets every quota bar to 0%
 *  without waiting for the calendar rollover. Cannot be used to
 *  reset another user — the server route ignores any param. */
export async function adminResetOwnUsage(): Promise<{ success: true; cleared: number; billingUserId: string }> {
  return authFetch('/api/admin/usage/reset-self', { method: 'POST' });
}

export async function adminFetchTrend() {
  return authFetch('/api/admin/stats/trend');
}

export async function adminFetchPlans() {
  return authFetch('/api/admin/stats/plans');
}

// ── Usage API ────────────────────────────────────────────────────────────

export interface UsageMetric {
  used: number;
  /** Per-feature limit. Omitted on metrics where the per-feature cap
   *  was removed (everything except `profiles`). When absent the UI
   *  should show only `used` and skip the "of Y" segment of the bar. */
  limit?: number;
  period: 'day' | 'month' | 'total';
  label: string;
  /** Optional unit-conversion multiplier (credits → user-visible unit
   *  like transactions). When present, the UI multiplies used and
   *  limit by this for display. */
  rowsPerCredit?: number;
}

export interface UserUsageResponse {
  plan: 'free' | 'pro' | 'enterprise';
  planExpiresAt: string | null;
  trialEndsAt: string;
  trialExpired: boolean;
  trialDaysLeft: number | null;
  trialDays: number;
  /** Cross-feature token budget — the only hard quota gate. Other
   *  per-feature counts under `usage` are soft display. */
  tokens: {
    used: number;
    budget: number;
    remaining: number;
  };
  usage: {
    messages: UsageMetric;
    attachments: UsageMetric;
    suggestions: UsageMetric;
    notices: UsageMetric;
    boardResolutions: UsageMetric;
    partnershipDeeds: UsageMetric;
    bankStatements: UsageMetric;
    ledgerScrutiny: UsageMetric;
    profiles: UsageMetric;
  };
}

export async function fetchUserUsage(): Promise<UserUsageResponse> {
  return authFetch('/api/usage');
}

export interface UserLicenseInfo {
  license: {
    id: string;
    key: string;
    plan: 'free' | 'pro' | 'enterprise' | 'admin';
    starts_at: string;
    expires_at: string | null;
    status: 'active' | 'expired' | 'revoked' | 'superseded';
  } | null;
  isActive: boolean;
}

export async function fetchUserLicense(): Promise<UserLicenseInfo> {
  return authFetch('/api/usage/license');
}

// ── Payments API ─────────────────────────────────────────────────────────

export interface CreateOrderResponse {
  orderId: string;
  keyId: string;
  plan: string;
  amount: number; // paise
}

export async function createOrder(
  plan: 'pro' | 'enterprise',
): Promise<CreateOrderResponse> {
  return authFetch('/api/payments/create-order', {
    method: 'POST',
    body: JSON.stringify({ plan }),
  });
}

export async function verifyOrderPayment(payload: {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
  plan: string;
}): Promise<{ success: boolean; plan: string; planExpiresAt: string }> {
  return authFetch('/api/payments/verify', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface PaymentHistoryResponse {
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  payments: {
    id: string;
    plan: string;
    billing: string;
    amount: number;
    currency: string;
    status: string;
    createdAt: string;
    paidAt: string | null;
    expiresAt: string | null;
    paymentMethod: string | null;
    documentType: 'proforma' | 'tax_invoice';
    documentNumber: string | null;
  }[];
}

export async function fetchPaymentHistory(): Promise<PaymentHistoryResponse> {
  return authFetch('/api/payments/history');
}

// ── Billing Details API ───────────────────────────────────────────────────

export interface BillingDetails {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  pincode: string;
  gstin?: string;
}

export async function fetchBillingDetails(): Promise<{ billingDetails: BillingDetails | null }> {
  return authFetch('/api/billing-details');
}

export async function saveBillingDetails(details: BillingDetails): Promise<{ ok: boolean; billingDetails: BillingDetails }> {
  return authFetch('/api/billing-details', {
    method: 'PUT',
    body: JSON.stringify(details),
  });
}

// ── Account Settings API ────────────────────────────────────────────────

export async function updateAccountName(name: string) {
  return authFetch('/api/auth/name', {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function updateAccountEmail(newEmail: string, currentPassword: string) {
  return authFetch('/api/auth/email', {
    method: 'PATCH',
    body: JSON.stringify({ newEmail, currentPassword }),
  });
}

export async function updateAccountPassword(currentPassword: string, newPassword: string) {
  return authFetch('/api/auth/password', {
    method: 'PATCH',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function deleteAccount(currentPassword: string | null, confirmation: string) {
  return authFetch('/api/auth/account', {
    method: 'DELETE',
    body: JSON.stringify({ currentPassword, confirmation }),
  });
}

// ── Active Sessions API ─────────────────────────────────────────────────

export interface ActiveSession {
  id: string;
  deviceLabel: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  /** True for the session this very request is being made from. The
   *  Settings UI uses this to highlight the current device and disable
   *  its revoke button (revoking yourself is what /logout is for). */
  current: boolean;
}

export interface ListSessionsResponse {
  maxSessions: number;
  sessions: ActiveSession[];
}

export async function listSessions(): Promise<ListSessionsResponse> {
  return authFetch('/api/auth/sessions');
}

export async function revokeSession(id: string): Promise<{ ok: true }> {
  return authFetch(`/api/auth/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** Sign out of every device EXCEPT the one calling this. Returns the
 *  number of sessions that were revoked so the UI can surface a toast. */
export async function revokeAllOtherSessions(): Promise<{ ok: true; revoked: number }> {
  return authFetch('/api/auth/sessions', {
    method: 'DELETE',
  });
}

// ── Notice Drafter API ───────────────────────────────────────────────────

export type NoticeStatus = 'draft' | 'generating' | 'generated' | 'error';

export interface NoticeItem {
  id: string;
  notice_type: string;
  sub_type: string | null;
  title: string | null;
  status: NoticeStatus;
  error_message?: string | null;
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

/** Extra metadata included in the SSE `done` event so the UI can
 *  react to server-side post-processing (e.g. citation sanitisation
 *  that mutated the persisted draft and made the live-streamed text
 *  stale). All fields optional — older server builds omit them. */
export interface NoticeGenerateDoneMeta {
  citationsSanitized?: boolean;
  citationsDropped?: number;
}

export async function generateNotice(
  input: NoticeGenerateInput,
  onChunk: (text: string) => void,
  onError: (msg: string) => void,
  onDone?: (noticeId: string | null, meta?: NoticeGenerateDoneMeta) => void,
  file?: File,
): Promise<void> {
  // When a file is attached, we ship it as multipart so the notice route can
  // extract it server-side. This bypasses /api/upload, which means the upload
  // does NOT consume the user's chat-attachment monthly quota — only the
  // per-notice counter is bumped after a successful draft.
  const doFetch = () => {
    if (file) {
      const form = new FormData();
      form.append('payload', JSON.stringify(input));
      form.append('file', file);
      return fetch('/api/notices/generate', {
        method: 'POST',
        headers: { ...getAuthHeaders() },
        body: form,
      });
    }
    return fetch('/api/notices/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(input),
    });
  };

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
        if (parsed.done) {
          onDone?.(parsed.noticeId ?? null, {
            citationsSanitized: parsed.citationsSanitized === true,
            citationsDropped: typeof parsed.citationsDropped === 'number' ? parsed.citationsDropped : undefined,
          });
          return;
        }
        if (parsed.error) { onError(parsed.message ?? 'Generation failed.'); return; }
        if (parsed.text) onChunk(parsed.text);
      } catch { /* skip */ }
    }
  }
}

export async function fetchNotices(): Promise<{ notices: NoticeItem[]; usage: { used: number } }> {
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

// ── Tax Notifications (welcome-screen daily list) ───────────────────────

export interface TaxNotificationListItem {
  id: string;
  category: 'GST' | 'TDS' | 'INCOME_TAX' | 'OTHER';
  heading: string;
  summary: string | null;
  notificationDate: string | null;
  sourceUrl: string | null;
  hasDetail: boolean;
  fetchedAt: string;
}

export async function fetchLatestNotifications(): Promise<{ items: TaxNotificationListItem[] }> {
  return authFetch('/api/notifications/latest');
}

export async function fetchNotificationDetail(id: string, chatId?: string): Promise<{
  detail: string;
  cached: boolean;
  generatedAt: string;
  heading: string;
  sourceUrl: string | null;
  chatId: string | null;
}> {
  return authFetch(`/api/notifications/${id}/detail`, {
    method: 'POST',
    // Including chatId tells the server to append the synthetic
    // user→model exchange to that chat's history so the conversation
    // is durable and the user can ask follow-ups in the same thread.
    body: JSON.stringify({ chatId: chatId ?? null }),
  });
}

// ── Tax Profile API ─────────────────────────────────────────────────────

export interface TaxProfileData {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  fy: string;
  gross_salary: string;
  other_income: string;
  age_category: string;
  deductions_data: string;
  hra_data: string;
  created_at: string;
  updated_at: string;
}

/**
 * Calculator profiles now use the generic profiles system under the hood.
 * The calc-specific state (fy, gross_salary, etc.) is stored inside
 * perAy[fy].calculatorState in the generic profile's per_ay_data JSON.
 * This unifies the two profile systems — one profile limit for everything.
 */

function genericToCalcProfile(gp: GenericProfile): TaxProfileData {
  // Find the first AY that has calculatorState, or use defaults
  const perAy = gp.perAy ?? {};
  let calcState: Record<string, unknown> = {};
  let calcFy = '2025-26';
  for (const [ay, data] of Object.entries(perAy)) {
    const cs = (data as Record<string, unknown>)?.calculatorState as Record<string, unknown> | undefined;
    if (cs) {
      calcState = cs;
      calcFy = ay;
      break;
    }
  }
  return {
    id: gp.id,
    user_id: gp.user_id,
    name: gp.name,
    description: null,
    fy: (calcState.fy as string) ?? calcFy,
    gross_salary: (calcState.gross_salary as string) ?? '',
    other_income: (calcState.other_income as string) ?? '',
    age_category: (calcState.age_category as string) ?? 'below60',
    deductions_data: (calcState.deductions_data as string) ?? '{}',
    hra_data: (calcState.hra_data as string) ?? '{}',
    created_at: gp.created_at,
    updated_at: gp.updated_at,
  };
}

export async function fetchProfiles(): Promise<{ profiles: TaxProfileData[]; limit: number; used: number }> {
  const res: { profiles: GenericProfile[]; limit: number; used: number } =
    await authFetch('/api/generic-profiles');
  return {
    profiles: res.profiles.map(genericToCalcProfile),
    limit: res.limit,
    used: res.used,
  };
}

export async function createProfile(data: Record<string, unknown>): Promise<TaxProfileData> {
  const name = (data.name as string) || 'Calculator Profile';
  const gp: GenericProfile = await authFetch('/api/generic-profiles', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  // Store calc state inside perAy
  const fy = (data.fy as string) || '2025-26';
  const calcState = {
    fy,
    gross_salary: data.gross_salary ?? '',
    other_income: data.other_income ?? '',
    age_category: data.age_category ?? 'below60',
    deductions_data: data.deductions_data ?? '{}',
    hra_data: data.hra_data ?? '{}',
  };
  await authFetch(`/api/generic-profiles/${gp.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ perAy: { [fy]: { calculatorState: calcState } } }),
  });
  return genericToCalcProfile({ ...gp, perAy: { [fy]: { calculatorState: calcState } } });
}

export async function updateProfile(id: string, data: Record<string, unknown>): Promise<void> {
  const fy = (data.fy as string) || '2025-26';
  const calcState = {
    fy,
    gross_salary: data.gross_salary ?? '',
    other_income: data.other_income ?? '',
    age_category: data.age_category ?? 'below60',
    deductions_data: data.deductions_data ?? '{}',
    hra_data: data.hra_data ?? '{}',
  };
  const patch: Record<string, unknown> = {
    perAy: { [fy]: { calculatorState: calcState } },
  };
  if (data.name) patch.name = data.name;
  await authFetch(`/api/generic-profiles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteProfile(id: string): Promise<void> {
  await authFetch(`/api/generic-profiles/${id}`, { method: 'DELETE' });
}

// ── ITR Filing API (admin-only) ──────────────────────────────────────────

export type ItrFormType = 'ITR1' | 'ITR4';

export interface ItrDraft {
  id: string;
  user_id: string;
  form_type: ItrFormType;
  assessment_year: string;
  name: string;
  ui_payload: Record<string, unknown>;
  last_validated_at: string | null;
  last_validation_errors: string | null;
  exported_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItrEnumOption {
  code: string;
  label: string;
}

export interface ItrValidationError {
  path: string;
  message: string;
  params?: Record<string, unknown>;
}

export interface ItrBusinessRuleViolation {
  ruleId: string;
  severity: 'error' | 'warning';
  path: string;
  message: string;
}

export interface ItrValidationResult {
  valid: boolean;
  schemaValid: boolean;
  schemaErrors: ItrValidationError[];
  businessRules: ItrBusinessRuleViolation[];
}

export interface ItrFinalizeResult extends ItrValidationResult {
  payload: Record<string, unknown> | null;
}

export async function fetchItrDrafts(): Promise<{ drafts: ItrDraft[] }> {
  return authFetch('/api/itr/drafts');
}

export async function createItrDraft(input: {
  form_type: ItrFormType;
  assessment_year: string;
  name: string;
  ui_payload?: Record<string, unknown>;
}): Promise<ItrDraft> {
  return authFetch('/api/itr/drafts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchItrDraft(id: string): Promise<ItrDraft> {
  return authFetch(`/api/itr/drafts/${id}`);
}

export async function updateItrDraft(
  id: string,
  patch: { name?: string; ui_payload?: Record<string, unknown> },
): Promise<void> {
  await authFetch(`/api/itr/drafts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteItrDraft(id: string): Promise<void> {
  await authFetch(`/api/itr/drafts/${id}`, { method: 'DELETE' });
}

export async function validateItr(input: {
  form_type: ItrFormType;
  payload: unknown;
  draft_id?: string;
}): Promise<ItrValidationResult> {
  return authFetch('/api/itr/validate', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function finalizeItr(input: {
  form_type: ItrFormType;
  payload: unknown;
  intermediaryCity?: string;
  swId?: string;
  draft_id?: string;
}): Promise<ItrFinalizeResult> {
  return authFetch('/api/itr/finalize', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// Cached enum fetcher — enums are static once loaded.
const enumCache = new Map<string, ItrEnumOption[]>();
export async function fetchItrEnum(
  name: 'states' | 'countries' | 'nature-of-business' | 'tds-sections',
): Promise<ItrEnumOption[]> {
  const cached = enumCache.get(name);
  if (cached) return cached;
  const data = (await authFetch(`/api/itr/enums/${name}`)) as { options: ItrEnumOption[] };
  enumCache.set(name, data.options);
  return data.options;
}

// ── Board Resolution API (admin-only) ───────────────────────────────────

export type BoardResolutionTemplateId =
  | 'appointment_of_director'
  | 'bank_account_opening'
  | 'borrowing_powers'
  | 'share_allotment';

export interface BoardResolutionDraft {
  id: string;
  user_id: string;
  template_id: BoardResolutionTemplateId;
  name: string;
  ui_payload: Record<string, unknown>;
  exported_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchBoardResolutionDrafts(): Promise<{ drafts: BoardResolutionDraft[] }> {
  return authFetch('/api/board-resolutions/drafts');
}

export async function createBoardResolutionDraft(input: {
  template_id: BoardResolutionTemplateId;
  name: string;
  ui_payload?: Record<string, unknown>;
}): Promise<BoardResolutionDraft> {
  return authFetch('/api/board-resolutions/drafts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchBoardResolutionDraft(id: string): Promise<BoardResolutionDraft> {
  return authFetch(`/api/board-resolutions/drafts/${id}`);
}

export async function updateBoardResolutionDraft(
  id: string,
  patch: { name?: string; ui_payload?: Record<string, unknown> },
): Promise<void> {
  await authFetch(`/api/board-resolutions/drafts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteBoardResolutionDraft(id: string): Promise<void> {
  await authFetch(`/api/board-resolutions/drafts/${id}`, { method: 'DELETE' });
}

// ── Partnership Deeds API ───────────────────────────────────────────────

export type PartnershipDeedTemplateId =
  | 'partnership_deed'
  | 'llp_agreement'
  | 'reconstitution_deed'
  | 'retirement_deed'
  | 'retirement_admission_deed'
  | 'dissolution_deed';

export type PartnershipDeedStatus = 'draft' | 'generating' | 'generated' | 'error';

export interface PartnershipDeedDraft {
  id: string;
  user_id: string;
  template_id: PartnershipDeedTemplateId;
  name: string;
  ui_payload: Record<string, unknown>;
  generated_content: string | null;
  status: PartnershipDeedStatus;
  error_message?: string | null;
  exported_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchPartnershipDeedDrafts(): Promise<{
  drafts: PartnershipDeedDraft[];
  usage: { used: number };
}> {
  return authFetch('/api/partnership-deeds/drafts');
}

export async function createPartnershipDeedDraft(input: {
  template_id: PartnershipDeedTemplateId;
  name: string;
  ui_payload?: Record<string, unknown>;
}): Promise<PartnershipDeedDraft> {
  return authFetch('/api/partnership-deeds/drafts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchPartnershipDeedDraft(id: string): Promise<PartnershipDeedDraft> {
  return authFetch(`/api/partnership-deeds/drafts/${id}`);
}

export async function updatePartnershipDeedDraft(
  id: string,
  patch: { name?: string; ui_payload?: Record<string, unknown> },
): Promise<void> {
  await authFetch(`/api/partnership-deeds/drafts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deletePartnershipDeedDraft(id: string): Promise<void> {
  await authFetch(`/api/partnership-deeds/drafts/${id}`, { method: 'DELETE' });
}

export async function markPartnershipDeedExported(id: string): Promise<void> {
  await authFetch(`/api/partnership-deeds/drafts/${id}/mark-exported`, {
    method: 'POST',
  });
}

/**
 * Stream-generate the deed body. Backend returns SSE events:
 *   data: {"text": "..."}            ← incremental markdown chunk
 *   data: {"done": true, "draftId": "..."}
 *   data: {"error": true, "message": "..."}
 *
 * 429 (quota exhausted) and 400 (validation) are returned as plain JSON
 * BEFORE the SSE stream opens — caller's `onError` handles both.
 */
export async function generatePartnershipDeed(
  draftId: string,
  onChunk: (text: string) => void,
  onError: (msg: string, kind?: 'quota' | 'generic') => void,
  onDone?: () => void,
): Promise<void> {
  const doFetch = () => fetch(`/api/partnership-deeds/drafts/${draftId}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  });

  let response = await doFetch();
  if (response.status === 401) {
    const refreshed = await tryRefreshToken();
    if (refreshed) response = await doFetch();
  }

  if (!response.ok || !response.body) {
    let errorMessage = 'Failed to generate partnership deed.';
    let kind: 'quota' | 'generic' = 'generic';
    try {
      const errData = await response.json();
      if (errData.error) errorMessage = errData.error;
      if (response.status === 429 || errData.upgrade) kind = 'quota';
    } catch { /* ignore */ }
    onError(errorMessage, kind);
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
        if (parsed.done) { onDone?.(); return; }
        if (parsed.error) { onError(parsed.message ?? 'Generation failed.', 'generic'); return; }
        if (parsed.text) onChunk(parsed.text);
      } catch { /* skip */ }
    }
  }
}

// ── CMA Data Module API ─────────────────────────────────────────────────

import type { CmaDraft } from '../components/cma/lib/uiModel';

/** Server row shape — distinct from the wizard-side CmaDraft type
 *  (server returns metadata fields like exported_at + timestamps;
 *  ui_payload is the wizard's persisted state). */
export interface CmaDraftRow {
  id: string;
  user_id: string;
  name: string;
  ui_payload: CmaDraft;
  exported_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchCmaDrafts(): Promise<{ drafts: CmaDraftRow[] }> {
  return authFetch('/api/cma/drafts');
}

export async function fetchCmaDraft(id: string): Promise<CmaDraftRow> {
  return authFetch(`/api/cma/drafts/${id}`);
}

export async function createCmaDraft(input: {
  name: string;
  ui_payload?: CmaDraft;
}): Promise<CmaDraftRow> {
  return authFetch('/api/cma/drafts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateCmaDraft(
  id: string,
  patch: { name?: string; ui_payload?: CmaDraft },
): Promise<void> {
  await authFetch(`/api/cma/drafts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteCmaDraft(id: string): Promise<void> {
  await authFetch(`/api/cma/drafts/${id}`, { method: 'DELETE' });
}

export async function markCmaExported(id: string): Promise<void> {
  await authFetch(`/api/cma/drafts/${id}/mark-exported`, { method: 'POST' });
}

/** AI-assisted mapping. Frontend sends row labels + canonical chart
 *  options; server calls Gemini and returns suggested keys per row. */
export async function aiSuggestCmaMapping(
  draftId: string,
  rows: Array<{ index: number; label: string }>,
  options: Array<{ key: string; label: string; group: string }>,
): Promise<{ suggestions: Array<{ index: number; key: string | null }> }> {
  return (await authFetch(`/api/cma/drafts/${draftId}/ai-suggest-mapping`, {
    method: 'POST',
    body: JSON.stringify({ rows, options }),
  })) as { suggestions: Array<{ index: number; key: string | null }> };
}

export interface CmaNarrativeResponse {
  briefProfile: string;
  machineryDetails: string;
  premises: string;
  powerConnection: string;
  rateOfInterestNotes: string;
}

/** Generate Project-Report narrative via Gemini. Server logs cost
 *  under feature='cma_ai_narrative' and returns trimmed strings. The
 *  client merges them into draft.projectReport via the existing
 *  draft-update path (so the auto-save picks them up). */
export async function generateCmaNarrative(
  draftId: string,
  inputs: {
    firmName: string;
    businessNature: string;
    state?: string;
    applicationContext?: string;
    latestRevenueLacs?: number | null;
    proposedLoanLacs?: number | null;
  },
): Promise<CmaNarrativeResponse> {
  return (await authFetch(`/api/cma/drafts/${draftId}/ai-narrative`, {
    method: 'POST',
    body: JSON.stringify(inputs),
  })) as CmaNarrativeResponse;
}

// ── TB → BS API ─────────────────────────────────────────────────

import type { TbBsDraft } from '../components/tb-bs/lib/uiModel';

export interface TbBsDraftRow {
  id: string;
  user_id: string;
  name: string;
  ui_payload: TbBsDraft;
  exported_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchTbBsDrafts(): Promise<{ drafts: TbBsDraftRow[] }> {
  return authFetch('/api/tb-bs/drafts');
}

export async function fetchTbBsDraft(id: string): Promise<TbBsDraftRow> {
  return authFetch(`/api/tb-bs/drafts/${id}`);
}

export async function createTbBsDraft(input: { name: string; ui_payload?: TbBsDraft }): Promise<TbBsDraftRow> {
  return authFetch('/api/tb-bs/drafts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateTbBsDraft(id: string, patch: { name?: string; ui_payload?: TbBsDraft }): Promise<void> {
  await authFetch(`/api/tb-bs/drafts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteTbBsDraft(id: string): Promise<void> {
  await authFetch(`/api/tb-bs/drafts/${id}`, { method: 'DELETE' });
}

export async function markTbBsExported(id: string): Promise<void> {
  await authFetch(`/api/tb-bs/drafts/${id}/mark-exported`, { method: 'POST' });
}

export async function aiSuggestTbBsMapping(
  draftId: string,
  rows: Array<{ index: number; label: string }>,
  options: Array<{ key: string; label: string; group: string }>,
): Promise<{ suggestions: Array<{ index: number; key: string | null }> }> {
  return (await authFetch(`/api/tb-bs/drafts/${draftId}/ai-suggest-mapping`, {
    method: 'POST',
    body: JSON.stringify({ rows, options }),
  })) as { suggestions: Array<{ index: number; key: string | null }> };
}

// ── Income Tax portal import ────────────────────────────────────────────

export interface ItPortalImportResult {
  ok: true;
  profileId: string;
  prefilledDraftId: string | null;
  imported: {
    name: string;
    pan: string;
    bankCount: number;
    hasJurisdiction: boolean;
  };
}

/**
 * Imports identity + address + banks + jurisdiction from the Income Tax
 * e-filing portal in a single round trip. The server authenticates with
 * the provided PAN + password, fetches the data, upserts a generic profile,
 * and optionally prefills an open ITR draft.
 *
 * SECURITY: the password travels over HTTPS and is used only for the
 * one-shot portal call. The server does not log or persist it.
 */
// ── Writing style profile ───────────────────────────────────────────────

export interface StyleRules {
  tone?: string;
  formalityLevel?: number;
  languagePatterns?: string[];
  typicalPhrases?: string[];
  paragraphStyle?: string;
  openingStyle?: string;
  closingStyle?: string;
  citationStyle?: string;
  overallDescription?: string;
}

export interface StyleProfile {
  id: string;
  name: string;
  sourceFilename: string | null;
  rules: StyleRules;
  createdAt: string;
  updatedAt: string;
}

export async function getStyleProfile(): Promise<{ styleProfile: StyleProfile | null }> {
  return authFetch('/api/style-profile');
}

export async function extractStyleProfile(input: File | string, name?: string): Promise<{ ok: true; styleProfile: StyleProfile }> {
  if (typeof input === 'string') {
    return authFetch('/api/style-profile/extract', {
      method: 'POST',
      body: JSON.stringify({ text: input, name }),
    });
  }
  // File upload — use FormData
  const form = new FormData();
  form.append('sample', input);
  if (name) form.append('name', name);
  const token = localStorage.getItem('token');
  const res = await fetch('/api/style-profile/extract', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function deleteStyleProfile(): Promise<{ ok: true }> {
  return authFetch('/api/style-profile', { method: 'DELETE' });
}

// ── Form 16 Import ─────────────────────────────────────────────────────

export interface Form16ExtractedData {
  employerName: string | null;
  employerTAN: string | null;
  pan: string | null;
  employeeName: string | null;
  assessmentYear: string | null;
  grossSalary: number | null;
  perquisites17_2: number | null;
  profitsInLieu17_3: number | null;
  standardDeduction16ia: number | null;
  professionalTax16iii: number | null;
  incomeFromSal: number | null;
  netSalary: number | null;
  section80C: number | null;
  section80D: number | null;
  section80CCD1B: number | null;
  section80E: number | null;
  section80G: number | null;
  section80TTA: number | null;
  tdsOnSalary: number | null;
}

export interface Form16ImportResult {
  success: boolean;
  filename: string;
  extractedData: Form16ExtractedData;
}

export async function importForm16(file: File): Promise<Form16ImportResult> {
  const form = new FormData();
  form.append('file', file);

  const doFetch = () => fetch('/api/form16-import/import', {
    method: 'POST',
    headers: { ...getAuthHeaders() },
    body: form,
  });

  let res = await doFetch();

  if (res.status === 401) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      res = await doFetch();
    }
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Form 16 import failed');
  }
  return data as Form16ImportResult;
}

// ── Income Tax portal import ────────────────────────────────────────────

// ── Client management (CA bulk ITR) ─────────────────────────────────────

export interface ClientData {
  id: string;
  user_id: string;
  name: string;
  pan: string | null;
  email: string | null;
  phone: string | null;
  profile_id: string | null;
  itr_draft_id: string | null;
  form_type: string;
  assessment_year: string;
  filing_status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchClients(): Promise<{ clients: ClientData[]; summary: Record<string, number>; limit: number; used: number }> {
  return authFetch('/api/clients');
}

export async function createClient(data: { name: string; pan?: string; email?: string; phone?: string; formType?: string; assessmentYear?: string }): Promise<ClientData> {
  return authFetch('/api/clients', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateClient(id: string, data: Partial<ClientData>): Promise<ClientData> {
  return authFetch(`/api/clients/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteClient(id: string): Promise<{ ok: true }> {
  return authFetch(`/api/clients/${id}`, { method: 'DELETE' });
}

export async function createClientDraft(clientId: string): Promise<{ profileId: string; draftId: string; client: ClientData }> {
  return authFetch(`/api/clients/${clientId}/create-draft`, { method: 'POST' });
}

export async function bulkCreateClients(clients: Array<{ name: string; pan?: string; email?: string; phone?: string }>): Promise<{ created: number; skipped: number; available: number }> {
  return authFetch('/api/clients/bulk-create', { method: 'POST', body: JSON.stringify({ clients }) });
}

// ── Income Tax portal import ────────────────────────────────────────────

// ── Admin API cost analytics ─────────────────────────────────────────────

export interface ApiCostUser {
  user_id: string;
  user_name: string;
  user_email: string;
  user_plan: string;
  requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
  total_cost_inr: number;
  avg_cost_per_msg: number;
  avg_cost_per_msg_inr: number;
  last_used: string;
}

export interface ApiCostDailyEntry {
  date: string;
  requests: number;
  total_cost: number;
  total_cost_inr: number;
}

export interface ApiCostData {
  period: string;
  summary: {
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    totalCostInr: number;
    avgCostPerMsgUsd: number;
    avgCostPerMsgInr: number;
    uniqueUsers: number;
  };
  costByPlan: Record<string, { requests: number; cost: number; users: number }>;
  byUser: ApiCostUser[];
  daily: ApiCostDailyEntry[];
  recent: Array<{ id: number; user_name: string; input_tokens: number; output_tokens: number; cost: number; cost_inr: number; created_at: string }>;
}

export async function fetchApiCosts(period: string = 'month'): Promise<ApiCostData> {
  return authFetch(`/api/admin/api-costs?period=${period}`);
}

// ── Admin recent API calls (paginated) ───────────────────────────────────

export interface RecentApiCall {
  id: number;
  user_id: string | null;
  user_name: string;
  user_email: string;
  user_plan: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  /** Pre-flight estimate stored on the summary row only — 0 on
   *  per-chunk / failure / cancel rows. Used for the Δ% column. */
  estimated_tokens: number;
  /** Per-row weighted tokens (input × wIn + output × wOut for the
   *  row's model). What the cross-feature quota gate sums. */
  weighted_tokens: number;
  cost: number;
  cost_inr: number;
  search_used: boolean;
  is_plugin: boolean;
  category: string | null;
  /** Size of the user input in the unit that matters for the
   *  category — txn count for bank/ledger, page count for
   *  notice/document, message count for chat. 0 for legacy or
   *  un-instrumented call sites. */
  input_units: number;
  /** 'success' | 'cancelled' | 'failed'. Cancelled means the user
   *  stopped the run mid-flight (tokens still consumed and counted
   *  toward budget). Failed means a parse / network / content-
   *  filter error (tokens NOT counted toward budget). */
  status: 'success' | 'cancelled' | 'failed' | string;
  /** Wall-clock duration in ms — only set on summary rows; 0 on
   *  legacy rows or per-chunk failures. */
  duration_ms: number;
  created_at: string;
}

export interface RecentApiCallsResponse {
  total: number;
  limit: number;
  offset: number;
  calls: RecentApiCall[];
}

export async function adminFetchRecentCalls(limit = 100, offset = 0): Promise<RecentApiCallsResponse> {
  return authFetch(`/api/admin/recent-calls?limit=${limit}&offset=${offset}`);
}

// ── Admin Gemini config (limits + active key) ────────────────────────────

export interface GeminiConfig {
  activeKeyIndex: number;
  t1Limit: number;
  t2Limit: number;
  defaults: { t1: number; t2: number };
  keys: Array<{ index: number; label: string; hasKey: boolean }>;
}

export async function adminFetchGeminiConfig(): Promise<GeminiConfig> {
  return authFetch('/api/admin/gemini-config');
}

export async function adminSetGeminiLimits(input: { t1Limit?: number; t2Limit?: number }): Promise<GeminiConfig> {
  return authFetch('/api/admin/gemini-limits', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function adminSetActiveKey(keyIndex: number): Promise<GeminiConfig> {
  return authFetch('/api/admin/active-key', {
    method: 'POST',
    body: JSON.stringify({ keyIndex }),
  });
}

// ── Licensing (admin) ──────────────────────────────────────────────────

export interface AdminLicenseRow {
  id: string;
  key: string;
  user_id: string;
  user_name: string;
  user_email: string;
  plan: 'free' | 'pro' | 'enterprise' | 'admin';
  starts_at: string;
  expires_at: string | null;
  status: 'active' | 'expired' | 'revoked' | 'superseded';
  generated_via: 'razorpay' | 'offline' | 'seed' | 'free-signup' | 'admin-signup';
  payment_id: string | null;
  issued_by_admin_id: string | null;
  issued_notes: string | null;
  superseded_by_id: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  created_at: string;
}

export interface AdminPaymentRow {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  plan: 'pro' | 'enterprise';
  billing: string;
  amount: number;       // paise
  currency: string;
  status: 'created' | 'paid' | 'failed';
  created_at: string;
  paid_at: string | null;
  expires_at: string | null;
  billing_details: string | null;
  license: { id: string; key: string; plan: string; status: string; expires_at: string | null } | null;
  invoice_number: number | null;
  proforma_number: number | null;
  payment_method: string | null;
}

export async function adminFetchLicenses(opts: { search?: string; plan?: string; status?: string; page?: number } = {}): Promise<{ rows: AdminLicenseRow[]; total: number; page: number; limit: number }> {
  const qs = new URLSearchParams();
  if (opts.search) qs.set('search', opts.search);
  if (opts.plan) qs.set('plan', opts.plan);
  if (opts.status) qs.set('status', opts.status);
  if (opts.page) qs.set('page', String(opts.page));
  const tail = qs.toString() ? `?${qs}` : '';
  return authFetch(`/api/admin/licenses${tail}`);
}

export type AdminPaymentMethod = 'cash' | 'cheque' | 'neft' | 'imps' | 'upi' | 'rtgs' | 'card' | 'other';

export interface AdminBillingDetails {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  pincode: string;
  gstin?: string;
}

export async function adminGenerateLicense(input: {
  userId: string;
  plan: 'pro' | 'enterprise';
  /** Free-of-charge grant (team members, partners). Skips payment
   *  method / amount / billing entirely — no payment row, invoice,
   *  or receipt is created. `notes` becomes mandatory (the audit
   *  trail records who the grant is for and why). */
  complimentary?: boolean;
  paymentMethod?: AdminPaymentMethod;
  paymentReference?: string;
  amount?: number; // paise — required for paid grants, omit for complimentary
  billingDetails?: AdminBillingDetails;
  notes?: string;
}): Promise<{ license: AdminLicenseRow; paymentId: string | null; invoiceUrl: string | null; receiptUrl: string | null }> {
  return authFetch('/api/admin/licenses', { method: 'POST', body: JSON.stringify(input) });
}

export interface AdminBillingPrefill {
  billingDetails: AdminBillingDetails | null;
  lastPaymentMethod: AdminPaymentMethod | null;
  lastPaymentReference: string | null;
}

export async function adminFetchBillingPrefill(userId: string): Promise<AdminBillingPrefill> {
  return authFetch(`/api/admin/users/${userId}/billing-prefill`);
}

/** Re-issue licenses for users whose plan column doesn't match their
 *  active license's plan. Returns count of users affected. */
export async function adminReconcileLicenses(): Promise<{ reconciled: number }> {
  return authFetch('/api/admin/licenses/reconcile', { method: 'POST' });
}

/** Delete a single SUPERSEDED license row. The server refuses any
 *  other status — active/expired/revoked rows are audit history. */
export async function adminDeleteLicense(id: string): Promise<{ success: boolean }> {
  return authFetch(`/api/admin/licenses/${id}`, { method: 'DELETE' });
}

/** Bulk-delete every superseded license row (skips any still
 *  referenced by a user account). Returns rows removed. */
export async function adminDeleteSupersededLicenses(): Promise<{ deleted: number }> {
  return authFetch('/api/admin/licenses/superseded', { method: 'DELETE' });
}

// ── External API keys (for assist.smartbizin.com etc.) ─────────────────

export interface AdminExternalKey {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  webhook_url: string | null;
}

export async function adminFetchExternalKeys(): Promise<{ keys: AdminExternalKey[] }> {
  return authFetch('/api/admin/external-keys');
}

export async function adminCreateExternalKey(input: { label: string; webhookUrl?: string }): Promise<{ id: string; plaintextKey: string }> {
  return authFetch('/api/admin/external-keys', { method: 'POST', body: JSON.stringify(input) });
}

export async function adminRevokeExternalKey(id: string): Promise<{ success: boolean }> {
  return authFetch(`/api/admin/external-keys/${id}/revoke`, { method: 'POST' });
}

export async function adminUpdateExternalKeyWebhook(id: string, webhookUrl: string | null): Promise<{ success: boolean; webhookUrl: string | null }> {
  return authFetch(`/api/admin/external-keys/${id}/webhook`, { method: 'PATCH', body: JSON.stringify({ webhookUrl }) });
}

export async function adminRenewLicense(licenseId: string, durationMonths: number): Promise<{ license: AdminLicenseRow }> {
  return authFetch(`/api/admin/licenses/${licenseId}/renew`, { method: 'POST', body: JSON.stringify({ durationMonths }) });
}

export async function adminRevokeLicense(licenseId: string, reason?: string): Promise<{ success: boolean }> {
  return authFetch(`/api/admin/licenses/${licenseId}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export async function adminFetchPayments(opts: { search?: string; page?: number } = {}): Promise<{ rows: AdminPaymentRow[]; total: number; page: number; limit: number }> {
  const qs = new URLSearchParams();
  if (opts.search) qs.set('search', opts.search);
  if (opts.page) qs.set('page', String(opts.page));
  const tail = qs.toString() ? `?${qs}` : '';
  return authFetch(`/api/admin/payments${tail}`);
}

export async function adminDeletePayment(id: string): Promise<void> {
  await authFetch(`/api/admin/payments/${id}`, { method: 'DELETE' });
}

// ── Income Tax portal import ────────────────────────────────────────────

export async function importFromItPortal(input: {
  pan: string;
  password: string;
  profileId?: string;
  itrDraftId?: string;
}): Promise<ItPortalImportResult> {
  return authFetch('/api/it-portal/import', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ── Generic Profiles API (identity, address, banks, per-AY data) ────────

export interface GenericProfileBank {
  ifsc?: string;
  name?: string;
  accountNo?: string;
  type?: 'SB' | 'CA' | 'CC' | 'OD' | 'NRO' | 'OTH';
  isDefault?: boolean;
}

export interface GenericProfile {
  id: string;
  user_id: string;
  name: string;
  identity: Record<string, unknown>;
  address: Record<string, unknown>;
  banks: GenericProfileBank[];
  noticeDefaults: Record<string, unknown>;
  perAy: Record<string, Record<string, unknown>>;
  created_at: string;
  updated_at: string;
}

export async function fetchGenericProfiles(): Promise<{ profiles: GenericProfile[] }> {
  return authFetch('/api/generic-profiles');
}

export async function fetchGenericProfile(id: string): Promise<GenericProfile> {
  return authFetch(`/api/generic-profiles/${id}`);
}

export async function createGenericProfile(name: string): Promise<GenericProfile> {
  return authFetch('/api/generic-profiles', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function updateGenericProfile(
  id: string,
  patch: Partial<Omit<GenericProfile, 'id' | 'user_id' | 'created_at' | 'updated_at'>>,
): Promise<GenericProfile> {
  return authFetch(`/api/generic-profiles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function updateGenericProfilePerAy(
  id: string,
  year: string,
  patch: Record<string, unknown>,
): Promise<GenericProfile> {
  return authFetch(`/api/generic-profiles/${id}/per-ay/${year}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteGenericProfile(id: string): Promise<void> {
  await authFetch(`/api/generic-profiles/${id}`, { method: 'DELETE' });
}

// ── Email verification (OTP) ─────────────────────────────────────────────

export interface VerifyEmailResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string; role: 'user' | 'admin'; plan: 'free' | 'pro' | 'enterprise' };
}

export async function verifyEmailCode(email: string, code: string): Promise<VerifyEmailResult> {
  // This endpoint is public — we don't send the auth header.
  const res = await fetch('/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Verification failed');
  return data;
}

export async function resendVerificationCode(email: string): Promise<void> {
  const res = await fetch('/api/auth/resend-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Resend failed');
}

// ── Forgot password / reset password ─────────────────────────────────────

export async function requestPasswordReset(email: string): Promise<void> {
  const res = await fetch('/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not request password reset');
}

export async function resetPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<VerifyEmailResult> {
  const res = await fetch('/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code, newPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Password reset failed');
  return data;
}

// ── Team invitations ─────────────────────────────────────────────────────

export interface InvitationListItem {
  id: string;
  email: string | null;
  phone: string | null;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface InvitationMember {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  created_at: string;
}

export interface InvitationsListResponse {
  invitations: InvitationListItem[];
  members: InvitationMember[];
  seats: { accepted: number; pending: number; total: number; cap: number };
  canInvite: boolean;
}

export interface CreatedInvitation extends InvitationListItem {
  acceptUrl: string;
  token: string;
  emailSent: boolean;
}

export async function fetchInvitations(): Promise<InvitationsListResponse> {
  return authFetch('/api/invitations');
}

export async function createInvitation(input: {
  email?: string;
  phone?: string;
}): Promise<CreatedInvitation> {
  return authFetch('/api/invitations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function revokeInvitation(id: string): Promise<{ action: 'revoked' | 'detached' }> {
  return authFetch(`/api/invitations/${id}`, { method: 'DELETE' });
}

export async function acceptInvitation(input: {
  token: string;
  password?: string;
  name?: string;
}): Promise<VerifyEmailResult> {
  const res = await fetch('/api/invitations/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to accept invitation');
  return data;
}

// ── Bank Statement Analyzer API ───────────────────────────────────────────

export type BankStatementStatus = 'analyzing' | 'done' | 'error' | 'cancelled';

export interface BankStatementSummary {
  id: string;
  name: string;
  bankName: string | null;
  accountNumberMasked: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  sourceFilename: string | null;
  sourceMime: string | null;
  totalInflow: number;
  totalOutflow: number;
  txCount: number;
  status: BankStatementStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  /** CSV-batch progress while the wizard's categorisation runs.
   *  Both 0 on direct CSV uploads / vision path / completed runs. */
  analyzeChunksTotal: number;
  analyzeChunksDone: number;
  providerFallback?: boolean;
}

export interface BankTransaction {
  id: string;
  date: string | null;
  narration: string | null;
  amount: number;          // signed: positive=credit, negative=debit
  balance: number | null;
  category: string;
  subcategory: string | null;
  counterparty: string | null;
  reference: string | null;
  isRecurring: boolean;
  userOverride: boolean;
  /** Normalized narration signature — used by the party-wise
   *  breakdown as a fallback grouping key when counterparty
   *  extraction returned null. Pre-Phase-2 rows are null. */
  fingerprint?: string | null;
}

export interface BankStatementRule {
  id: string;
  matchText: string;
  category: string | null;
  counterpartyLabel: string | null;
  createdAt: string;
}

export interface BankStatementCondition {
  id: string;
  text: string;
  createdAt: string;
}

export async function fetchBankStatements(): Promise<{
  statements: BankStatementSummary[];
  usage: {
    creditsUsed: number;
    creditsLimit: number;
    pagesPerCredit: number;
    csvRowsPerCredit: number;
  };
}> {
  return authFetch('/api/bank-statements');
}

/** A flagged transaction surfaced by the Phase 2 anomaly detector.
 *  One transaction can produce multiple anomalies (e.g. outlier
 *  amount AND new counterparty); each is a separate object here. */
export interface BankTransactionAnomaly {
  id: string;
  transactionId: string;
  type: 'outlier_amount' | 'new_counterparty' | 'round_cash_deposit' | 'same_day_cash_cluster';
  severity: 'info' | 'warn';
  reason: string;
}

export async function fetchBankStatement(id: string): Promise<{ statement: BankStatementSummary; transactions: BankTransaction[]; anomalies?: BankTransactionAnomaly[]; alreadyAnalyzed?: boolean }> {
  return authFetch(`/api/bank-statements/${id}`);
}

export interface BankStatementAnalyzeProgress {
  completed: number;
  total: number;
  pages?: [number, number];
}

export async function analyzeBankStatementFile(
  file: File,
  _onProgress?: (p: BankStatementAnalyzeProgress) => void,
): Promise<{ statement: BankStatementSummary; transactions: BankTransaction[]; anomalies?: BankTransactionAnomaly[]; alreadyAnalyzed?: boolean }> {
  // Vision-only fallback path. The "TSV via Gemini text extraction"
  // path used to live here — when the client could pull a text layer
  // out of the PDF, we'd send raw text to the server and have Gemini
  // extract + classify every row. That path averaged ~3× the per-row
  // cost of the wizard → CSV path and ~3× the cost of vision on the
  // primary tier; once the per-bank rules + relaxed wizard threshold
  // landed, the only uploads still hitting this entry point are PDFs
  // whose grid extraction returned <3 columns OR threw outright. Those
  // genuinely need vision — the wizard has nothing to work with.
  //
  // Sequence is unchanged from the legacy multipart branch: the server
  // accepts the file, runs vision extraction, persists, and returns the
  // analysis. Progress callback is unused on this path (vision is a
  // single call with no SSE chunks) — kept in the signature so callers
  // don't need to change.
  const formData = new FormData();
  formData.append('file', file);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 360_000);
  const doFetch = () => fetch('/api/bank-statements/analyze', {
    method: 'POST',
    headers: { ...getAuthHeaders() },
    body: formData,
    signal: controller.signal,
  });
  try {
    let res = await doFetch();
    if (res.status === 401) {
      const refreshed = await tryRefreshToken();
      if (refreshed) res = await doFetch();
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const parts = [data.error ?? 'Failed to analyze statement'];
      if (data.hint) parts.push(data.hint);
      if (data.detail) parts.push(`(${data.detail})`);
      throw new Error(parts.join(' — '));
    }
    return data;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // Could be a 6-min timer or a tab navigation that aborted the
      // in-flight fetch. Either way, the analysis keeps running on the
      // server (Node default — handlers don't abort on disconnect) and
      // the placeholder row will settle to 'done' or 'error'. Reload to
      // pick up the result instead of treating this as terminal.
      throw new Error('Analysis is still running server-side — reload the page in a few minutes to see the result. (Or, for very large statements over 150 pages, try a CSV export.)');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// analyzeBankStatementPdfText / consumeAnalyzeStream removed when the TSV
// extraction path was killed. The remaining bank-statement entry points are:
//   - analyzeBankStatementFile : vision multipart for un-grid-able PDFs
//   - analyzeBankStatementCsv  : wizard-mapped uploads (the cheap path)

export async function analyzeBankStatementCsv(
  csvText: string,
  filename?: string,
  accountKind?: 'asset' | 'liability',
): Promise<{ statement: BankStatementSummary; transactions: BankTransaction[]; anomalies?: BankTransactionAnomaly[]; alreadyAnalyzed?: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  // accountKind tells the server's balance-delta reconciler which
  // sign convention this account uses. 'liability' (Cash Credit /
  // Overdraft / Loan) inverts the delta sign so a deposit reducing
  // the Dr-balance is correctly recorded as an inflow. Omitting the
  // field defaults the server to 'asset' (savings-style) — fine for
  // regular accounts but inverts every CC sign.
  const doFetch = () => fetch('/api/bank-statements/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ csvText, filename, accountKind }),
    signal: controller.signal,
  });
  try {
    let res = await doFetch();
    if (res.status === 401) {
      const refreshed = await tryRefreshToken();
      if (refreshed) res = await doFetch();
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to analyze CSV');
    return data;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Analysis timed out — please try again with a smaller file.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function renameBankStatement(id: string, name: string): Promise<{ statement: BankStatementSummary }> {
  return authFetch(`/api/bank-statements/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function deleteBankStatement(id: string): Promise<void> {
  await authFetch(`/api/bank-statements/${id}`, { method: 'DELETE' });
}

export async function cancelBankStatement(id: string): Promise<{ statement: BankStatementSummary | null }> {
  return authFetch(`/api/bank-statements/${id}/cancel`, { method: 'POST' });
}

/** Shape of a learned classification surfaced by the backend (the
 *  per-firm memory rule that maps narration fingerprints to categories).
 *  Returned by the `learned` field on reclassify responses and as
 *  list entries from the management endpoint. */
export interface LearnedClassification {
  id: string;
  fingerprint: string;
  category: string;
  subcategory: string | null;
  directionScope: 'credit' | 'debit' | 'either';
  sampleNarration: string | null;
  hitCount: number;
  createdByName: string | null;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastAppliedAt: string | null;
}

export async function updateBankTransaction(
  statementId: string,
  txId: string,
  category: string,
  subcategory?: string | null,
  options?: {
    /** When 'always', the server upserts a learned rule for this
     *  narration's fingerprint scoped to the firm. The next analyze
     *  run that sees a similar narration auto-applies this category
     *  without an AI roundtrip. */
    remember?: 'always';
    /** Required when remember === 'always' — the narration the server
     *  fingerprints to build the rule key. The frontend already has
     *  this on the row; passing it avoids a server-side DB read. */
    narration?: string;
    /** Scope the rule to one direction or both. Default 'either' —
     *  the same counterparty often appears on both sides of the
     *  ledger and the same category typically applies. */
    direction?: 'credit' | 'debit' | 'either';
  },
): Promise<{ learned: LearnedClassification | null }> {
  const body: Record<string, unknown> = {
    category,
    subcategory: subcategory ?? null,
  };
  if (options?.remember) {
    body.remember = options.remember;
    if (options.narration) body.narration = options.narration;
    if (options.direction) body.direction = options.direction;
  }
  const data = (await authFetch(`/api/bank-statements/${statementId}/transactions/${txId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })) as { learned?: LearnedClassification | null };
  return { learned: data.learned ?? null };
}

// ── Learned classifications management ───────────────────────────

export async function listLearnedClassifications(): Promise<{ rules: LearnedClassification[] }> {
  return (await authFetch('/api/bank-statements/learned-rules')) as { rules: LearnedClassification[] };
}

export async function updateLearnedClassification(
  ruleId: string,
  patch: Partial<{ category: string; subcategory: string | null; disabled: boolean }>,
): Promise<{ rule: LearnedClassification | null }> {
  return (await authFetch(`/api/bank-statements/learned-rules/${ruleId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })) as { rule: LearnedClassification | null };
}

export async function deleteLearnedClassification(ruleId: string): Promise<void> {
  await authFetch(`/api/bank-statements/learned-rules/${ruleId}`, { method: 'DELETE' });
}

export async function bulkUpdateLearnedClassifications(input: {
  ids: string[];
  category: string;
  subcategory?: string | null;
}): Promise<{ changed: number }> {
  return (await authFetch('/api/bank-statements/learned-rules/bulk-update', {
    method: 'POST',
    body: JSON.stringify(input),
  })) as { changed: number };
}

export async function downloadBankStatementCsv(id: string, suggestedName: string): Promise<void> {
  // Plain <a href> downloads can't carry the Authorization header, so the
  // /export.csv endpoint 401s. Fetch with auth, then trigger a download via a
  // blob URL so the user gets a normal "Save as" with the right filename.
  const res = await fetch(`/api/bank-statements/${id}/export.csv`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`CSV export failed (${res.status}): ${msg.slice(0, 200) || res.statusText}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const safeName = suggestedName.replace(/[^a-z0-9_-]+/gi, '_') || 'statement';
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke. a.click() only queues the browser's download
  // dispatch — it doesn't actually fetch the blob synchronously. If
  // we revoke in a `finally` right after click(), the revoke can fire
  // BEFORE the browser starts reading the blob, producing a silent
  // failure that "goes away on reload" (the reload re-runs the
  // handler and a fresh blob URL is created). A short delay holds the
  // URL alive long enough for the download to actually start; the
  // memory cost is microscopic and the GC reclaims the blob once the
  // last reference drops.
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

export async function fetchBankStatementRules(): Promise<{ rules: BankStatementRule[] }> {
  return authFetch('/api/bank-statements/rules');
}

export async function createBankStatementRule(input: {
  matchText: string;
  category?: string | null;
  counterpartyLabel?: string | null;
}): Promise<{ rule: BankStatementRule }> {
  return authFetch('/api/bank-statements/rules', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteBankStatementRule(id: string): Promise<void> {
  await authFetch(`/api/bank-statements/rules/${id}`, { method: 'DELETE' });
}

export const BANK_STATEMENT_CONDITION_MAX_WORDS = 50;

export async function fetchBankStatementConditions(): Promise<{ conditions: BankStatementCondition[]; maxWords: number }> {
  return authFetch('/api/bank-statements/conditions');
}

export async function createBankStatementCondition(text: string): Promise<{ condition: BankStatementCondition }> {
  return authFetch('/api/bank-statements/conditions', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export async function deleteBankStatementCondition(id: string): Promise<void> {
  await authFetch(`/api/bank-statements/conditions/${id}`, { method: 'DELETE' });
}

/** Re-run the deterministic classifier against an already-ingested
 *  statement. Useful after a classifier deploy: stale categories
 *  from earlier rule versions get refreshed without re-uploading the
 *  PDF. Rows that the user has manually re-tagged (user_override = 1)
 *  are left alone. */
export async function reclassifyBankStatement(id: string): Promise<{ success: boolean; scanned: number; updated: number }> {
  return authFetch(`/api/bank-statements/${id}/reclassify`, { method: 'POST' });
}

/** Negate every transaction's amount + balance in a statement. The
 *  escape hatch for the rare case where Cash Credit auto-detection
 *  got the account-type wrong on upload — most CC and overdraft
 *  statements are detected correctly via the Dr-suffix-prevalence
 *  scan in pdfGrid, but short loan statements, mixed Dr/Cr exports,
 *  and unfamiliar bank layouts can slip through. Calling this twice
 *  restores the original signs, so it's safe to experiment with. */
export async function flipBankStatementSigns(id: string): Promise<{
  success: boolean; updated: number; totalInflow: number; totalOutflow: number;
}> {
  return authFetch(`/api/bank-statements/${id}/flip-signs`, { method: 'POST' });
}

/** Toggle the per-user "require OTP via email on every login" flag.
 *  Server-side: PATCH /api/auth/settings/require-login-otp. The change
 *  takes effect on the user's NEXT sign-in — the current session keeps
 *  working. */
export async function setRequireLoginOtp(enabled: boolean): Promise<{ success: boolean; user: unknown }> {
  return authFetch('/api/auth/settings/require-login-otp', {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

/** Re-apply the user's current bank-statement conditions as a
 *  post-extraction visibility filter against the stored rows. Used
 *  when the user adds/edits/removes a condition without wanting to
 *  re-upload. */
export async function reapplyBankStatementConditions(id: string): Promise<{ success: boolean; hidden: number; total: number }> {
  return authFetch(`/api/bank-statements/${id}/reapply-conditions`, { method: 'POST' });
}

/** Apply the user's current auto-tagging rules to an already-processed
 *  statement (separator-insensitive narration match → category /
 *  counterparty). Rows the user manually re-tagged are left alone.
 *  Used when the user adds/edits a rule and wants it reflected on an
 *  existing statement without re-uploading. */
export async function reapplyBankStatementRules(id: string): Promise<{ success: boolean; scanned: number; updated: number; noRules?: boolean }> {
  return authFetch(`/api/bank-statements/${id}/reapply-rules`, { method: 'POST' });
}

export interface PayeeReviewRow {
  fingerprint: string;
  count: number;
  direction: 'credit' | 'debit';
  mixed: boolean;
  current_category: string;
  sample_narration: string;
  label: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  needs_human: boolean;
}

/** ADMIN: download the deduped payee list for an offline labeling pass.
 *  minCount filters to recurring payees (5 → the high-volume head; 1 →
 *  the full long tail). Returns the array plus coverage stats. */
export async function fetchPayeeExport(minCount: number): Promise<{
  minCount: number; count: number; rowsCovered: number; payees: PayeeReviewRow[];
}> {
  return authFetch(`/api/bank-statements/admin/payee-export?minCount=${encodeURIComponent(minCount)}`);
}

/** One exported chatbot (question, answer) pair awaiting a judge verdict. */
export interface ChatAuditPair {
  answerId: number;
  chatId: string;
  askedAt: string;
  hadAttachment: boolean;
  question: string;
  answer: string;
  verdict: null | 'ok' | 'wrong' | 'risky' | 'na';
  severity: null | 'low' | 'medium' | 'high';
  issue: string | null;
  correction: string | null;
}

/** ADMIN: download recent chatbot (question, answer) pairs for an external
 *  LLM-judge audit pass. sinceDays (1–365) + limit (1–5000) bound the batch.
 *  Returns the pairs plus metadata; the file is built on demand, never stored. */
export async function fetchChatAuditExport(sinceDays: number, limit: number): Promise<{
  generatedAt: string; sinceDays: number; limit: number; count: number;
  note: string; pairs: ChatAuditPair[];
}> {
  return authFetch(`/api/admin/chat-audit/export?sinceDays=${encodeURIComponent(sinceDays)}&limit=${encodeURIComponent(limit)}`);
}

// ── Ledger Scrutiny API ───────────────────────────────────────────────────

export type LedgerScrutinySeverity = 'info' | 'warn' | 'high';
export type LedgerObservationStatus = 'open' | 'resolved';
export type LedgerJobStatus = 'pending' | 'extracting' | 'scrutinizing' | 'done' | 'error' | 'cancelled';

export interface LedgerScrutinyJob {
  id: string;
  name: string;
  partyName: string | null;
  gstin: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  sourceFilename: string | null;
  sourceMime: string | null;
  status: LedgerJobStatus;
  totalFlagsHigh: number;
  totalFlagsWarn: number;
  totalFlagsInfo: number;
  totalFlaggedAmount: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  /** Chunked-scrutiny progress — surfaces "5 of 46 chunks audited"
   *  while an upload-time auto-chained scrutiny is running. Both 0
   *  on jobs that haven't reached the audit phase yet. */
  scrutinyChunksTotal: number;
  scrutinyChunksDone: number;
  /** Extract-phase progress (TSV chunked path). Pages_total / processed
   *  on the server; surfaces "12 of 33 chunks extracted" during the
   *  extract phase, before scrutiny starts. */
  extractChunksTotal: number;
  extractChunksDone: number;
  /** True once the run dropped from the primary LLM model to a backup
   *  tier. UI shows a "Server busy — switched to backup model" line on
   *  the progress card so the user understands the slower pace. */
  providerFallback?: boolean;
}

export interface LedgerScrutinyAccount {
  id: string;
  name: string;
  accountType: string | null;
  opening: number;
  closing: number;
  totalDebit: number;
  totalCredit: number;
  txCount: number;
}

export interface LedgerScrutinyObservation {
  id: string;
  accountId: string | null;
  accountName: string | null;
  code: string;
  severity: LedgerScrutinySeverity;
  message: string;
  amount: number | null;
  dateRef: string | null;
  suggestedAction: string | null;
  status: LedgerObservationStatus;
  source: string;
  createdAt: string;
}

export interface LedgerScrutinyDetail {
  job: LedgerScrutinyJob;
  accounts: LedgerScrutinyAccount[];
  observations: LedgerScrutinyObservation[];
}

export async function fetchLedgerScrutinyJobs(): Promise<{
  jobs: LedgerScrutinyJob[];
  usage: {
    used: number;
    limit: number;
    creditsUsed: number;
    creditsLimit: number;
    pagesPerCredit: number;
    csvRowsPerCredit: number;
  };
}> {
  return authFetch('/api/ledger-scrutiny');
}

export async function fetchLedgerScrutinyJob(id: string): Promise<LedgerScrutinyDetail> {
  return authFetch(`/api/ledger-scrutiny/${id}`);
}

export async function uploadLedgerScrutinyPdf(file: File): Promise<LedgerScrutinyDetail> {
  // Fast / reliable path: digital Tally / Busy / Marg PDFs already carry a
  // text layer. Extract it in the browser and send text-only JSON; the
  // server runs the chunked TSV pipeline that handles 50+ pages cleanly.
  // Scanned image-only PDFs (no text layer) fall through to multipart and
  // get the legacy single-call vision pass.
  if (file.type === 'application/pdf') {
    try {
      const { extractPdfTextClient } = await import('../lib/pdfText');
      const text = await extractPdfTextClient(file);
      if (text) {
        return uploadLedgerScrutinyPdfText(text, file.name);
      }
    } catch (err) {
      // Text extraction is best-effort — fall back to vision on any failure.
      console.warn('[uploadLedgerScrutinyPdf] text extract failed, falling back to vision:', err);
    }
  }

  const formData = new FormData();
  formData.append('file', file);
  // Server now auto-chains extract → chunked scrutiny inline, so a single
  // upload covers BOTH passes end-to-end (extract ~5-10 min, audit ~2-5 min
  // for 170+ account ledgers, 7-15 min total typical). Cap at 20 min so a
  // genuine slow-but-progressing run isn't killed by the client close-event
  // mid-audit. The server keeps running even if the tab closes — the
  // resumability poll picks the result back up on reload.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_200_000);
  const doFetch = () => fetch('/api/ledger-scrutiny/upload', {
    method: 'POST',
    headers: { ...getAuthHeaders() },
    body: formData,
    signal: controller.signal,
  });
  try {
    let res = await doFetch();
    if (res.status === 401) {
      const refreshed = await tryRefreshToken();
      if (refreshed) res = await doFetch();
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const parts = [data.error ?? 'Failed to upload ledger'];
      if (data.hint) parts.push(data.hint);
      if (data.detail) parts.push(`(${data.detail})`);
      throw new Error(parts.join(' — '));
    }
    return data;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Ledger extract + audit took longer than 20 minutes — the run is still going server-side; reload to pick it up, or split the year and try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Pre-extracted upload: the user ran the column-mapping wizard, so we
 *  ship a ready-built ExtractedLedger to the server which skips Gemini
 *  extraction and goes straight to the audit pass. Tokens saved (no
 *  extract) and credit/debit signs are deterministic from the wizard. */
export async function uploadLedgerScrutinyPreExtracted(
  preExtracted: unknown,
  filename: string,
): Promise<LedgerScrutinyDetail> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_200_000);
  const doFetch = () => fetch('/api/ledger-scrutiny/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ preExtracted, filename }),
    signal: controller.signal,
  });
  try {
    let res = await doFetch();
    if (res.status === 401) {
      const refreshed = await tryRefreshToken();
      if (refreshed) res = await doFetch();
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const parts = [data.error ?? 'Failed to upload ledger'];
      if (data.hint) parts.push(data.hint);
      if (data.detail) parts.push(`(${data.detail})`);
      throw new Error(parts.join(' — '));
    }
    return data;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Audit took longer than 20 minutes — the run is still going server-side; reload to pick it up.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function uploadLedgerScrutinyPdfText(pdfText: string, filename: string): Promise<LedgerScrutinyDetail> {
  // Long ledgers run chunked Gemini calls in parallel; allow 4 minutes
  // before the client kills the request, matching the multipart timeout.
  // Server now auto-chains extract → chunked scrutiny inline, so a single
  // upload covers BOTH passes end-to-end (extract ~5-10 min, audit ~2-5 min
  // for 170+ account ledgers, 7-15 min total typical). Cap at 20 min so a
  // genuine slow-but-progressing run isn't killed by the client close-event
  // mid-audit. The server keeps running even if the tab closes — the
  // resumability poll picks the result back up on reload.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_200_000);
  const doFetch = () => fetch('/api/ledger-scrutiny/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ pdfText, filename }),
    signal: controller.signal,
  });
  try {
    let res = await doFetch();
    if (res.status === 401) {
      const refreshed = await tryRefreshToken();
      if (refreshed) res = await doFetch();
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const parts = [data.error ?? 'Failed to upload ledger'];
      if (data.hint) parts.push(data.hint);
      if (data.detail) parts.push(`(${data.detail})`);
      throw new Error(parts.join(' — '));
    }
    return data;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Ledger extract + audit took longer than 20 minutes — the run is still going server-side; reload to pick it up, or split the year and try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface LedgerScrutinyProgress {
  phase?: 'scrutinizing';
  completed: number;
  total: number;
  accountsTotal?: number;
  /** Surfaced from the polled job row; renders the "Server busy" line
   *  inside the progress card. */
  providerFallback?: boolean;
}

export async function scrutinizeLedger(
  jobId: string,
  onChunk: (text: string) => void,
  onError: (msg: string, kind?: 'quota' | 'generic') => void,
  onDone?: (summary: { jobId: string; observationsCount: number }) => void,
  onProgress?: (p: LedgerScrutinyProgress) => void,
): Promise<void> {
  const doFetch = () => fetch(`/api/ledger-scrutiny/${jobId}/scrutinize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  });

  let response = await doFetch();
  if (response.status === 401) {
    const refreshed = await tryRefreshToken();
    if (refreshed) response = await doFetch();
  }

  if (!response.ok || !response.body) {
    let errorMessage = 'Failed to scrutinize ledger.';
    let kind: 'quota' | 'generic' = 'generic';
    try {
      const errData = await response.json();
      if (errData.error) errorMessage = errData.error;
      if (response.status === 429 || errData.upgrade) kind = 'quota';
    } catch { /* ignore */ }
    onError(errorMessage, kind);
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
        if (parsed.heartbeat) continue;
        if (parsed.done) {
          onDone?.({ jobId: parsed.jobId, observationsCount: parsed.observationsCount });
          return;
        }
        if (parsed.error) { onError(parsed.message ?? 'Scrutiny failed.', 'generic'); return; }
        if (parsed.phase === 'scrutinizing' || parsed.progress === true) {
          onProgress?.({
            phase: parsed.phase === 'scrutinizing' ? 'scrutinizing' : undefined,
            completed: typeof parsed.completed === 'number' ? parsed.completed : 0,
            total: typeof parsed.total === 'number' ? parsed.total : 0,
            accountsTotal: typeof parsed.accountsTotal === 'number' ? parsed.accountsTotal : undefined,
          });
          continue;
        }
        if (parsed.text) onChunk(parsed.text);
      } catch { /* skip */ }
    }
  }
}

export async function renameLedgerScrutinyJob(id: string, name: string): Promise<{ job: LedgerScrutinyJob }> {
  return authFetch(`/api/ledger-scrutiny/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function deleteLedgerScrutinyJob(id: string): Promise<void> {
  await authFetch(`/api/ledger-scrutiny/${id}`, { method: 'DELETE' });
}

export async function cancelLedgerScrutinyJob(id: string): Promise<{ job: LedgerScrutinyJob | null }> {
  return authFetch(`/api/ledger-scrutiny/${id}/cancel`, { method: 'POST' });
}

/** Resume a paused/cancelled ledger audit from the chunk it stopped
 *  at. Server validates that the job is in a resumable state and
 *  that there are remaining chunks. Returns the job row with status
 *  flipped back to 'scrutinizing'; the actual chunk work runs in
 *  the background and progress shows up via the existing 5s polling. */
export async function resumeLedgerScrutinyJob(id: string): Promise<{ job: LedgerScrutinyJob; resuming: boolean; fromChunk: number; totalChunks: number }> {
  return authFetch(`/api/ledger-scrutiny/${id}/resume`, { method: 'POST' });
}

export async function updateLedgerObservationStatus(
  jobId: string,
  obsId: string,
  status: LedgerObservationStatus,
): Promise<{ observation: LedgerScrutinyObservation }> {
  return authFetch(`/api/ledger-scrutiny/${jobId}/observations/${obsId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

// ── Ledger comparison (Entity A vs Entity B reconciliation) ─────────────

export type LedgerType = 'sales' | 'purchase' | 'sundry_debtor' | 'sundry_creditor' | 'other';

export const LEDGER_TYPE_LABELS: Record<LedgerType, string> = {
  sales: 'Sales',
  purchase: 'Purchase',
  sundry_debtor: 'Sundry Debtor',
  sundry_creditor: 'Sundry Creditor',
  other: 'Other',
};

export interface LedgerComparisonRow {
  id: string;
  label_a: string;
  label_b: string;
  type_a: LedgerType;
  type_b: LedgerType;
  filename_a: string | null;
  filename_b: string | null;
  status: 'pending' | 'comparing' | 'completed' | 'failed' | 'cancelled';
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// 2026-05: schema changed from AI-based date+amount matching to
// deterministic bill-by-bill matching. New buckets:
//   - matched           : bill found on both sides, amounts agree
//   - amountMismatches  : bill found on both sides, amounts diverge
//   - onlyInA / onlyInB : bill on one side only
//   - noBillA / noBillB : transactions without an extractable bill ref
export interface LedgerComparisonReport {
  summary: {
    typeA: LedgerType;
    typeB: LedgerType;
    totalA: number;
    totalB: number;
    matchedCount: number;
    amountMismatchCount: number;
    onlyInACount: number;
    onlyInBCount: number;
    /** Pairs from the tight date+amount(±₹1) no-bill matcher. */
    paymentMatchedCount: number;
    /** Pairs from the looser unique-date pass — same date but amounts
     *  disagree. Surfaced separately so the user can review them. */
    paymentDateMatchedCount: number;
    /** Pairs from the loosest bank-anchored pass — bank account number
     *  matched a known anchor from earlier matches; either dates were
     *  within ±3 days OR amounts within ±10% / ₹10K cap. */
    paymentBankMatchedCount: number;
    /** Pairs matched by AMOUNT ALONE (one side has bill, other has
     *  only journal entry; unique amount on both sides; no date
     *  constraint). Catches invoice-vs-late-journal-entry pairs. */
    amountOnlyMatchedCount: number;
    noBillCountA: number;
    noBillCountB: number;
    grossA: number;
    grossB: number;
    netA: number;
    netB: number;
    netDifference: number;
    headline: string;
  };
  matched: Array<{ bill: string; dateA: string | null; dateB: string | null; amountA: number; amountB: number; narrationA: string; narrationB: string }>;
  amountMismatches: Array<{ bill: string; dateA: string | null; dateB: string | null; amountA: number; amountB: number; diff: number; narrationA: string; narrationB: string }>;
  onlyInA: Array<{ bill: string; date: string | null; amount: number; narration: string }>;
  onlyInB: Array<{ bill: string; date: string | null; amount: number; narration: string }>;
  /** Date+amount pairs for rows without a bill reference. Typically
   *  payments booked on both sides (A as a credit-note, B as a bank
   *  receipt). amountA / amountB carry both sides' values — they're
   *  usually equal, but a ±₹1 ERP rounding split (Marg truncates
   *  paise, Finsys rounds up) is tolerated and surfaces as `diff > 0`.
   *  bankRefA / bankRefB carry the cheque / UTR / NEFT references
   *  extracted from each side's narration for confirmation —
   *  informational, not used for matching. */
  paymentMatches: Array<{
    date: string;
    /** B-side date when it differs from `date` — set by the Pass 1.5
     *  ±3 day window sub-pass. For same-day matches it's undefined and
     *  the renderer falls back to `date` for both sides. */
    dateB?: string;
    amountA: number;
    amountB: number;
    diff: number;
    narrationA: string;
    narrationB: string;
    bankRefA: string | null;
    bankRefB: string | null;
  }>;
  /** Looser bucket: same date, only one leftover row on each side
   *  for that date, but amounts differ by more than ±₹1. Same shape
   *  as paymentMatches — the user reviews these to decide whether
   *  they represent the same underlying payment with a real
   *  discrepancy. */
  paymentDateMatches: Array<{
    date: string;
    amountA: number;
    amountB: number;
    diff: number;
    narrationA: string;
    narrationB: string;
    bankRefA: string | null;
    bankRefB: string | null;
  }>;
  /** Loosest bucket: bank account number from a successfully-matched
   *  pair was found in one or both narrations, AND either dates are
   *  within ±3 days OR amounts are within ±10% (capped at ₹10K).
   *  matchedBy says which branch fired ('date' or 'amount').
   *  bankAnchor carries the actual fingerprint used for the pair so
   *  the user can verify visually. */
  paymentBankMatches: Array<{
    dateA: string | null;
    dateB: string | null;
    dateDeltaDays: number;
    amountA: number;
    amountB: number;
    diff: number;
    bankAnchor: string;
    matchedBy: 'date' | 'amount';
    narrationA: string;
    narrationB: string;
    bankRefA: string | null;
    bankRefB: string | null;
  }>;
  /** Cross-bucket pairs matched by amount alone — one side has a
   *  bill key (`bill`), the other had no extractable ref. Same
   *  amount on both sides (±₹1), unique at that amount on both
   *  sides, no date constraint other than ≤ 365 day gap. `dateGapDays`
   *  is surfaced explicitly so the reviewer can sanity-check at a
   *  glance how far apart the postings were. */
  amountOnlyMatches: Array<{
    bill: string;
    dateA: string | null;
    dateB: string | null;
    dateGapDays: number;
    amountA: number;
    amountB: number;
    diff: number;
    narrationA: string;
    narrationB: string;
  }>;
  noBillA: Array<{ date: string | null; amount: number; narration: string }>;
  noBillB: Array<{ date: string | null; amount: number; narration: string }>;
  balanceCheck: {
    openingA: number; openingB: number; openingGap: number;
    closingA: number; closingB: number; closingGap: number;
    note: string;
  };
}

export interface LedgerComparisonDetail {
  id: string;
  labelA: string;
  labelB: string;
  typeA: LedgerType;
  typeB: LedgerType;
  filenameA: string | null;
  filenameB: string | null;
  extractedA: unknown;
  extractedB: unknown;
  report: LedgerComparisonReport | null;
  status: LedgerComparisonRow['status'];
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchLedgerComparisons(): Promise<{ comparisons: LedgerComparisonRow[] }> {
  return authFetch('/api/ledger-scrutiny/compare');
}

export async function fetchLedgerComparison(id: string): Promise<LedgerComparisonDetail> {
  return authFetch(`/api/ledger-scrutiny/compare/${id}`);
}

export async function createLedgerComparison(input: {
  labelA: string;
  labelB: string;
  typeA: LedgerType;
  typeB: LedgerType;
  filenameA: string | null;
  filenameB: string | null;
  preExtractedA: unknown;
  preExtractedB: unknown;
}): Promise<{ id: string; status: string; report: LedgerComparisonReport }> {
  return authFetch('/api/ledger-scrutiny/compare', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteLedgerComparison(id: string): Promise<void> {
  await authFetch(`/api/ledger-scrutiny/compare/${id}`, { method: 'DELETE' });
}

/** Run the ledger extract pass via AI vision and return the parsed
 *  ExtractedLedger without running the scrutiny audit. Compare mode
 *  uses this when one side is a Finsys / scanned PDF the
 *  deterministic grid extractor can't handle — feeds the result
 *  back into createLedgerComparison as preExtractedA/B.
 *
 *  Uses raw fetch (NOT authFetch) because authFetch hard-codes
 *  Content-Type: application/json which collides with the
 *  multipart/form-data the browser auto-generates for FormData
 *  bodies. The server's body-parser ends up trying to JSON.parse
 *  the multipart boundary ("Unexpected token '-', '------WebK'..."
 *  in production logs). Same pattern as uploadLedgerScrutinyPdf. */
export async function extractLedgerViaVision(file: File): Promise<{
  id: string;
  status: string;
  extracted: {
    partyName: string | null;
    gstin: string | null;
    periodFrom: string | null;
    periodTo: string | null;
    accounts: Array<{
      name: string;
      accountType: string | null;
      opening: number;
      closing: number;
      totalDebit: number;
      totalCredit: number;
      transactions: Array<{
        date: string | null;
        narration: string | null;
        voucher: string | null;
        debit: number;
        credit: number;
        balance: number | null;
      }>;
    }>;
  };
}> {
  const formData = new FormData();
  formData.append('file', file);
  // 10-minute cap — vision-extract on a 30-50 page Finsys ledger
  // typically lands in 2-5 min; the cap is just to stop a stalled
  // request from hanging the dialog forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 600_000);
  const doFetch = () => fetch('/api/ledger-scrutiny/upload?extractOnly=1', {
    method: 'POST',
    headers: { ...getAuthHeaders() },
    body: formData,
    signal: controller.signal,
  });
  try {
    let res = await doFetch();
    if (res.status === 401) {
      const refreshed = await tryRefreshToken();
      if (refreshed) res = await doFetch();
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error ?? `Vision extract failed (${res.status})`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

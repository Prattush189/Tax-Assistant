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

export async function adminFetchTrend() {
  return authFetch('/api/admin/stats/trend');
}

export async function adminFetchPlans() {
  return authFetch('/api/admin/stats/plans');
}

// ── Usage API ────────────────────────────────────────────────────────────

export interface UsageMetric {
  used: number;
  limit: number;
  period: 'day' | 'month' | 'total';
  label: string;
}

export interface UserUsageResponse {
  plan: 'free' | 'pro' | 'enterprise';
  planExpiresAt: string | null;
  trialEndsAt: string;
  trialExpired: boolean;
  trialDaysLeft: number | null;
  trialDays: number;
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

// ── Payments API ─────────────────────────────────────────────────────────

export interface CreateSubscriptionResponse {
  subscriptionId: string;
  keyId: string;
  plan: string;
  billing: string;
  amount: number; // paise
}

export async function createSubscription(
  plan: 'pro' | 'enterprise',
  billing: 'monthly' | 'yearly',
): Promise<CreateSubscriptionResponse> {
  return authFetch('/api/payments/create-subscription', {
    method: 'POST',
    body: JSON.stringify({ plan, billing }),
  });
}

export async function verifySubscriptionPayment(payload: {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
  plan: string;
  billing: string;
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
  }[];
}

export async function fetchPaymentHistory(): Promise<PaymentHistoryResponse> {
  return authFetch('/api/payments/history');
}

export async function cancelSubscription(): Promise<{ success: boolean; message: string }> {
  return authFetch('/api/payments/subscription', { method: 'DELETE' });
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
  | 'dissolution_deed';

export interface PartnershipDeedDraft {
  id: string;
  user_id: string;
  template_id: PartnershipDeedTemplateId;
  name: string;
  ui_payload: Record<string, unknown>;
  generated_content: string | null;
  exported_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchPartnershipDeedDrafts(): Promise<{
  drafts: PartnershipDeedDraft[];
  usage: { used: number; limit: number };
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
  cost: number;
  cost_inr: number;
  search_used: boolean;
  is_plugin: boolean;
  category: string | null;
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
  createdAt: string;
  updatedAt: string;
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

export async function fetchBankStatements(): Promise<{ statements: BankStatementSummary[] }> {
  return authFetch('/api/bank-statements');
}

export async function fetchBankStatement(id: string): Promise<{ statement: BankStatementSummary; transactions: BankTransaction[] }> {
  return authFetch(`/api/bank-statements/${id}`);
}

export interface BankStatementAnalyzeProgress {
  completed: number;
  total: number;
  pages?: [number, number];
}

export async function analyzeBankStatementFile(
  file: File,
  onProgress?: (p: BankStatementAnalyzeProgress) => void,
): Promise<{ statement: BankStatementSummary; transactions: BankTransaction[] }> {
  // Fast path: if this is a digitally-generated PDF, extract the text layer
  // in the browser and send text-only to the server. The server skips the
  // Gemini vision pass and completes in ~10-15s instead of 30-60s. Scanned
  // PDFs (no text layer) fall through to the multipart/vision path below.
  if (file.type === 'application/pdf') {
    try {
      const { extractPdfTextClient } = await import('../lib/pdfText');
      const text = await extractPdfTextClient(file);
      if (text) {
        return analyzeBankStatementPdfText(text, file.name, onProgress);
      }
    } catch (err) {
      // Text extraction is best-effort — fall back to vision on any failure.
      console.warn('[analyzeBankStatementFile] text extract failed, falling back to vision:', err);
    }
  }

  const formData = new FormData();
  formData.append('file', file);
  const controller = new AbortController();
  // Long statements (50+ pages) on the chunked TSV pipeline can run close to
  // 5 minutes end-to-end. The vision fallback (image PDFs) is single-call
  // but still benefits from headroom on slow Gemini bursts.
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
      throw new Error('Analysis timed out — the file may be too large or complex. Try a CSV export instead.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function analyzeBankStatementPdfText(
  pdfText: string,
  filename: string,
  onProgress?: (p: BankStatementAnalyzeProgress) => void,
): Promise<{ statement: BankStatementSummary; transactions: BankTransaction[]; warning?: string }> {
  // Large multi-chunk statements (50+ pages) can take 4-5 minutes of parallel
  // Gemini calls. Cap at 6 min so a slow-but-progressing run completes rather
  // than the client killing it just before the server returns.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 360_000);
  // Stream mode only when a progress sink is provided — otherwise use the
  // simpler JSON response so callers that don't care about progress stay on
  // the single code path.
  const wantsStream = typeof onProgress === 'function';
  const doFetch = () => fetch('/api/bank-statements/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(wantsStream ? { Accept: 'text/event-stream' } : {}),
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ pdfText, filename, ...(wantsStream ? { stream: true } : {}) }),
    signal: controller.signal,
  });
  try {
    let res = await doFetch();
    if (res.status === 401) {
      const refreshed = await tryRefreshToken();
      if (refreshed) res = await doFetch();
    }

    if (wantsStream && res.ok && res.body) {
      return await consumeAnalyzeStream(res.body, onProgress!);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Server returns `{error, detail?, hint?}` — fold them into one message
      // so the user actually sees what went wrong and how to recover.
      const parts = [data.error ?? 'Failed to analyze statement'];
      if (data.hint) parts.push(data.hint);
      if (data.detail) parts.push(`(${data.detail})`);
      throw new Error(parts.join(' — '));
    }
    return data;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Analysis timed out. Very large statements (>150 pages) may exceed our time budget — try a CSV export instead.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse an SSE stream from /api/bank-statements/analyze.
 *
 * Protocol (matches server):
 *   { type: 'start',    totalChunks, pages }
 *   { type: 'progress', completed, total, pages: [from,to], txInChunk }  (one per chunk)
 *   { type: 'done',     statement, transactions, txCount, warning? }
 *   { type: 'error',    error, detail?, hint? }
 *
 * We can't change HTTP status after SSE headers flush, so errors arrive as a
 * payload, not a non-200 response — translate them back into a thrown Error
 * whose message matches the JSON path so callers show the same toast.
 */
async function consumeAnalyzeStream(
  body: ReadableStream<Uint8Array>,
  onProgress: (p: BankStatementAnalyzeProgress) => void,
): Promise<{ statement: BankStatementSummary; transactions: BankTransaction[]; warning?: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalPayload: { statement: BankStatementSummary; transactions: BankTransaction[]; warning?: string } | null = null;
  let errorPayload: { error?: string; detail?: string; hint?: string } | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE event boundary is a blank line (\n\n). Keep the trailing partial
    // event in the buffer for the next read.
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json) continue;
      try {
        const evt = JSON.parse(json) as {
          type: string;
          totalChunks?: number;
          total?: number;
          completed?: number;
          pages?: [number, number] | number;
          [k: string]: unknown;
        };
        if (evt.type === 'start') {
          onProgress({
            completed: 0,
            total: evt.totalChunks ?? 0,
          });
        } else if (evt.type === 'progress') {
          onProgress({
            completed: evt.completed ?? 0,
            total: evt.total ?? 0,
            pages: Array.isArray(evt.pages) ? (evt.pages as [number, number]) : undefined,
          });
        } else if (evt.type === 'done') {
          finalPayload = {
            statement: evt.statement as BankStatementSummary,
            transactions: evt.transactions as BankTransaction[],
            warning: evt.warning as string | undefined,
          };
        } else if (evt.type === 'error') {
          errorPayload = {
            error: evt.error as string | undefined,
            detail: evt.detail as string | undefined,
            hint: evt.hint as string | undefined,
          };
        }
      } catch {
        // Malformed event — skip. Stream continues on the next boundary.
      }
    }
  }

  if (errorPayload) {
    const parts = [errorPayload.error ?? 'Failed to analyze statement'];
    if (errorPayload.hint) parts.push(errorPayload.hint);
    if (errorPayload.detail) parts.push(`(${errorPayload.detail})`);
    throw new Error(parts.join(' — '));
  }
  if (!finalPayload) {
    throw new Error('Analysis stream ended without a final result.');
  }
  return finalPayload;
}

export async function analyzeBankStatementCsv(csvText: string, filename?: string): Promise<{ statement: BankStatementSummary; transactions: BankTransaction[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const doFetch = () => fetch('/api/bank-statements/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ csvText, filename }),
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

export async function updateBankTransaction(
  statementId: string,
  txId: string,
  category: string,
  subcategory?: string | null,
): Promise<void> {
  await authFetch(`/api/bank-statements/${statementId}/transactions/${txId}`, {
    method: 'PATCH',
    body: JSON.stringify({ category, subcategory: subcategory ?? null }),
  });
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
  try {
    const safeName = suggestedName.replace(/[^a-z0-9_-]+/gi, '_') || 'statement';
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
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

// ── Ledger Scrutiny API ───────────────────────────────────────────────────

export type LedgerScrutinySeverity = 'info' | 'warn' | 'high';
export type LedgerObservationStatus = 'open' | 'resolved';
export type LedgerJobStatus = 'pending' | 'extracting' | 'scrutinizing' | 'done' | 'error';

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
  usage: { used: number; limit: number };
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
  // Long Tally / Busy ledgers run dozens of chunked Gemini calls in parallel
  // and can legitimately take 5-10 minutes end-to-end. Cap at 10 min so a
  // genuine slow-but-progressing extraction completes rather than aborting.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 600_000);
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
      throw new Error('Ledger extract took longer than 10 minutes — try a smaller export or split the year.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function uploadLedgerScrutinyPdfText(pdfText: string, filename: string): Promise<LedgerScrutinyDetail> {
  // Long ledgers run chunked Gemini calls in parallel; allow 4 minutes
  // before the client kills the request, matching the multipart timeout.
  // Long Tally / Busy ledgers run dozens of chunked Gemini calls in parallel
  // and can legitimately take 5-10 minutes end-to-end. Cap at 10 min so a
  // genuine slow-but-progressing extraction completes rather than aborting.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 600_000);
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
      throw new Error('Ledger extract took longer than 10 minutes — try a smaller export or split the year.');
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

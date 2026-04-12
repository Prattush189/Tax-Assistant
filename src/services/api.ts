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
  fileContexts?: { filename: string; mimeType: string; extractedData?: unknown }[],
  onDone?: (stopReason: string | null, references?: SectionReference[]) => void,
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
  usage: {
    messages: UsageMetric;
    attachments: UsageMetric;
    suggestions: UsageMetric;
    notices: UsageMetric;
    profiles: UsageMetric;
  };
}

export async function fetchUserUsage(): Promise<UserUsageResponse> {
  return authFetch('/api/usage');
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

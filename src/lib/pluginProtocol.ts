/**
 * Plugin mode message protocol — v2
 *
 * Single source of truth for every postMessage exchanged between the iframe
 * (Smart AI) and the parent host (ai.smartbizin.com).
 *
 * Every message is a discriminated union keyed by `type`.
 * Both sides MUST validate `event.origin` against `getAllowedOrigins()`.
 */

export type ActiveView = 'chat' | 'calculator' | 'dashboard' | 'admin' | 'plan' | 'notices' | 'settings';
export type CalculatorTab = 'income' | 'capitalGains' | 'gst' | 'tds' | 'advanceTax' | 'salary' | 'investment';

/** Shared plan IDs (includes 'enterprise-shared' for consultant-pool plans) */
export type PlanId = 'free' | 'pro' | 'enterprise' | 'enterprise-shared';

/** Consultant-hierarchy role (only meaningful for enterprise-shared plans) */
export type ConsultantRole = 'consultant' | 'staff' | 'client';

/**
 * Optional per-user limit overrides the parent can push on SSO.
 * All fields optional — omit any feature to use the plan default.
 * Used by consultant apps that allocate a shared pool to their staff/clients.
 */
export interface PluginLimitOverrides {
  messages?: { limit: number; period: 'day' | 'month' };
  attachments?: number;   // monthly
  suggestions?: number;   // monthly
  notices?: number;       // monthly
  profiles?: number;      // total
}

/** Signed handshake payload posted by the parent inside a PLUGIN_SSO message */
export interface SsoPayload {
  userId: string;        // parent's user id
  email: string;
  name: string;
  timestamp: number;     // ms since epoch — rejected if ±5 min skew
  nonce: string;         // random per-request
  signature: string;     // hex HMAC-SHA256 — see PLUGIN_INTEGRATION.md for base string

  // --- Optional enterprise-shared fields (all included in the signature) ---
  plan?: PlanId;                    // override the user's Smart AI plan (e.g. 'enterprise-shared')
  limits?: PluginLimitOverrides;    // per-feature caps assigned by the consultant
  role?: ConsultantRole;            // consultant | staff | client
  consultantId?: string;            // parent's ID of the owning consultant (staff/client only)
}

// ---------- Parent → Iframe ----------
export type ParentToIframeMessage =
  | { type: 'SET_THEME'; dark: boolean }
  | { type: 'PLUGIN_SSO'; payload: SsoPayload }
  | { type: 'SET_VIEW'; view: ActiveView }
  | { type: 'SET_CALCULATOR_TAB'; tab: CalculatorTab }
  | { type: 'LOGOUT' };

// ---------- Iframe → Parent ----------
export type IframeToParentMessage =
  | { type: 'TAX_ASSISTANT_READY' }
  | { type: 'TAX_ASSISTANT_HEIGHT'; payload: { height: number } }
  | { type: 'PLUGIN_SSO_REQUEST' }
  | { type: 'PLUGIN_SSO_OK'; userId: string }
  | { type: 'PLUGIN_SSO_ERROR'; error: string }
  | { type: 'CLOSE_PLUGIN' }
  | { type: 'MINIMIZE_PLUGIN' }
  | { type: 'NAVIGATE_TO'; url: string }
  | { type: 'USAGE_UPDATE'; plan: string; feature: string; used: number; limit: number }
  | { type: 'ERROR_EVENT'; message: string; code?: string };

/** Read the comma-separated allowed origins list from Vite env */
export function getAllowedOrigins(): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (import.meta as any).env?.VITE_PLUGIN_ALLOWED_ORIGINS as string | undefined;
  const list = (raw ?? 'https://ai.smartbizin.com')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);
  return list;
}

/** True if the given origin is in the allow-list */
export function isAllowedOrigin(origin: string): boolean {
  return getAllowedOrigins().includes(origin);
}

/**
 * Post a message to the parent window.
 * Called only from the iframe — broadcasts to every allowed origin
 * since we don't know which one is actually hosting us.
 */
export function postToParent(msg: IframeToParentMessage): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  for (const origin of getAllowedOrigins()) {
    try {
      window.parent.postMessage(msg, origin);
    } catch {
      // cross-origin posting can throw if the target origin is invalid — ignore
    }
  }
}

/** Narrow an unknown message to a typed ParentToIframeMessage — returns null if invalid */
export function parseParentMessage(data: unknown): ParentToIframeMessage | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as { type?: unknown };
  if (typeof m.type !== 'string') return null;
  switch (m.type) {
    case 'SET_THEME':
    case 'PLUGIN_SSO':
    case 'SET_VIEW':
    case 'SET_CALCULATOR_TAB':
    case 'LOGOUT':
      return data as ParentToIframeMessage;
    default:
      return null;
  }
}

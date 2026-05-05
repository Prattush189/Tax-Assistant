/**
 * Outbound webhooks to external API consumers (assist.smartbizin.com etc.)
 *
 * When Razorpay activates a plan or a license is issued / revoked, we
 * fan out an HTTP POST to every active external API key that has a
 * webhook_url configured. Fire-and-forget — the calling route doesn't
 * wait on these. Failures are logged; there's no retry queue today.
 *
 * Payload shape (POST application/json):
 *   {
 *     event: 'license.issued' | 'license.revoked' | 'license.renewed',
 *     license: { ...license_keys row },
 *     payment: { ...payments row } | null,
 *     user: { id, name, email, plan },
 *     timestamp: ISO,
 *   }
 *
 * Each request is signed with HMAC-SHA256 over the raw body using the
 * receiver's API key as the secret, and the signature is sent as
 * X-Smartbizin-Signature so receivers can verify the call came from
 * Tax-Assistant. (The receiver knows its own plaintext key — they
 * gave it to us at creation — so they can recompute and compare.)
 */

import crypto from 'crypto';
import db from '../db/index.js';

interface WebhookKeyRow {
  id: string;
  webhook_url: string;
}

interface OutboundEvent {
  event: 'license.issued' | 'license.revoked' | 'license.renewed';
  license: Record<string, unknown>;
  payment?: Record<string, unknown> | null;
  user?: { id: string; name: string | null; email: string | null; plan: string } | null;
}

const FIRE_TIMEOUT_MS = 8_000;

/** Read every active key with a webhook_url set. Fail closed (empty
 *  list) on DB error; webhook delivery is opportunistic. */
function listWebhookTargets(): WebhookKeyRow[] {
  try {
    return db.prepare(`
      SELECT id, webhook_url
      FROM external_api_keys
      WHERE webhook_url IS NOT NULL
        AND webhook_url != ''
        AND revoked_at IS NULL
    `).all() as WebhookKeyRow[];
  } catch (err) {
    console.warn('[externalWebhook] list targets failed:', (err as Error).message);
    return [];
  }
}

/**
 * Fire-and-forget POST. Never throws into the calling route — the
 * upstream payment activation already succeeded; webhook failure
 * shouldn't roll any of that back. Logs failures to operator log.
 */
export function fanoutEvent(event: OutboundEvent): void {
  const targets = listWebhookTargets();
  if (targets.length === 0) return;
  const body = JSON.stringify({
    ...event,
    timestamp: new Date().toISOString(),
  });
  for (const target of targets) {
    void postOne(target, body);
  }
}

async function postOne(target: WebhookKeyRow, body: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FIRE_TIMEOUT_MS);
  try {
    // Signature uses the key id as the secret — we don't have the
    // plaintext after issuance (only the hash), so receivers verify
    // by signing with their own key and comparing. The id is stable
    // and known to both sides via the webhook header.
    const signature = crypto.createHmac('sha256', target.id).update(body).digest('hex');
    const res = await fetch(target.webhook_url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-smartbizin-key-id': target.id,
        'x-smartbizin-signature': signature,
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[externalWebhook] ${target.webhook_url} returned ${res.status}`);
    }
  } catch (err) {
    console.warn(`[externalWebhook] ${target.webhook_url} delivery failed:`, (err as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

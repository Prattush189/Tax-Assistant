/**
 * External API key library.
 *
 * Used to authenticate machine-to-machine calls from sister apps
 * (assist.smartbizin.com, future integrations) into Tax-Assistant's
 * /api/external/* namespace. Distinct from the user-JWT auth that
 * gates the rest of the API.
 *
 * Generation:
 *   - Cryptographically random 32-byte token, base64url-encoded.
 *   - Prefixed `EXTKEY-` so they're visually distinct from license
 *     keys (FREE-/PRO-/ENT-/ADMIN-) in logs and the admin UI.
 *   - Plaintext shown to the admin ONCE at issuance. Only the
 *     SHA-256 hash is persisted; lookup verifies a header-supplied
 *     key by hashing and matching.
 */

import crypto from 'crypto';
import db from '../db/index.js';

const EXT_KEY_PREFIX = 'EXTKEY-';

export interface ExternalApiKeyRow {
  id: string;
  key_hash: string;
  label: string;
  created_by_admin_id: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_by_admin_id: string | null;
  webhook_url: string | null;
}

const stmts = {
  insert: db.prepare(`
    INSERT INTO external_api_keys (id, key_hash, label, created_by_admin_id, webhook_url)
    VALUES (?, ?, ?, ?, ?)
  `),
  findByHash: db.prepare('SELECT * FROM external_api_keys WHERE key_hash = ?'),
  list: db.prepare('SELECT id, label, created_at, last_used_at, revoked_at, webhook_url FROM external_api_keys ORDER BY created_at DESC'),
  touch: db.prepare(`UPDATE external_api_keys SET last_used_at = datetime('now', '+5 hours', '+30 minutes') WHERE id = ?`),
  revoke: db.prepare(`UPDATE external_api_keys SET revoked_at = datetime('now', '+5 hours', '+30 minutes'), revoked_by_admin_id = ? WHERE id = ?`),
};

function hashKey(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

/** Mint a new external API key. Returns the plaintext (only chance
 *  the admin gets to copy it) and the row id for the audit log. */
export function issueExternalApiKey(input: {
  label: string;
  createdByAdminId: string;
  webhookUrl?: string | null;
}): { id: string; plaintextKey: string } {
  const id = crypto.randomUUID();
  const random = crypto.randomBytes(32).toString('base64url');
  const plaintextKey = `${EXT_KEY_PREFIX}${random}`;
  const keyHash = hashKey(plaintextKey);
  stmts.insert.run(id, keyHash, input.label.trim().slice(0, 200), input.createdByAdminId, input.webhookUrl ?? null);
  return { id, plaintextKey };
}

/** Look up + validate a plaintext key. Returns the active row if
 *  the hash matches and revoked_at is null, else null. Bumps
 *  last_used_at on a successful match so the admin can spot stale
 *  / unused keys. */
export function validateExternalApiKey(plaintextKey: string): ExternalApiKeyRow | null {
  if (!plaintextKey || !plaintextKey.startsWith(EXT_KEY_PREFIX)) return null;
  const row = stmts.findByHash.get(hashKey(plaintextKey)) as ExternalApiKeyRow | undefined;
  if (!row) return null;
  if (row.revoked_at) return null;
  // Best-effort touch — failing to update last_used_at must not
  // block the request, hence try/catch around it. The key is valid
  // either way.
  try { stmts.touch.run(row.id); } catch { /* swallow */ }
  return row;
}

export function listExternalApiKeys(): Array<Pick<ExternalApiKeyRow, 'id' | 'label' | 'created_at' | 'last_used_at' | 'revoked_at' | 'webhook_url'>> {
  return stmts.list.all() as Array<Pick<ExternalApiKeyRow, 'id' | 'label' | 'created_at' | 'last_used_at' | 'revoked_at' | 'webhook_url'>>;
}

export function revokeExternalApiKey(id: string, revokingAdminId: string): boolean {
  const result = stmts.revoke.run(revokingAdminId, id);
  return result.changes > 0;
}

/** Update the webhook URL on a key. Used for "where should we POST
 *  Razorpay-licensed events for this consumer?". Null clears it. */
export function setExternalWebhookUrl(id: string, url: string | null): boolean {
  const result = db.prepare('UPDATE external_api_keys SET webhook_url = ? WHERE id = ?').run(url, id);
  return result.changes > 0;
}

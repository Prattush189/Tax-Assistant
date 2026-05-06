# Assist (assist.smartbizin.com) — Build Prompt

Hand this file to a fresh Claude Code session that will build the dealer-facing console at `assist.smartbizin.com`. This is the *consumer* of the `/api/external/*` namespace that already exists on Tax-Assistant (`ai.smartbizin.com`).

---

## What you are building

`assist.smartbizin.com` — a dealer-facing console where authorised SmartBizin dealers log in and **issue / renew / revoke licenses for `ai.smartbizin.com` (Tax-Assistant) users on behalf of their customers**, plus view payments and download invoices/receipts.

It maintains **no persistent business data of its own**. All users, licenses, payments live on Tax-Assistant. Assist is a thin UI + auth layer that calls Tax-Assistant's REST API.

## Architecture

```
Dealer (browser)
   │  dealer login (assist's own session)
   ▼
assist.smartbizin.com  (this app — frontend + thin BFF)
   │  Bearer EXTKEY-...   (server-side only — never exposed to browser)
   │  + dealer attribution in body
   ▼
ai.smartbizin.com /api/external/*   (already built, do not modify)
```

Two independent things:
1. **Dealer auth** — assist has its own login. Could be: a small SQLite/Postgres table of dealers (email + bcrypt password + name + location), magic-link, or Google OAuth restricted to a whitelist. Pick the simplest that fits — stack-wise mirror Tax-Assistant (Express + better-sqlite3 + React + Vite + TypeScript ESM) unless you have a reason not to.
2. **Outbound calls to Tax-Assistant** — every authenticated dealer action proxies through assist's backend, which adds `Authorization: Bearer ${EXTKEY}` and `dealer: { id, email, name, location }` and forwards to `https://ai.smartbizin.com/api/external/...`. The EXTKEY lives only in assist's server env (`TAX_ASSISTANT_API_KEY`), never in the browser.

## Tax-Assistant external API (already shipped)

Base URL: `https://ai.smartbizin.com/api/external`
Auth header: `Authorization: Bearer EXTKEY-...` (issued by Tax-Assistant admin in *Admin → External API Keys*)
Write endpoints additionally require a `dealer` object in the JSON body — at minimum `email` or `id` must be set; `name` and `location` are display-only.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Smoke-test the key |
| GET | `/users` | List Tax-Assistant users (id, name, email, plan, role, created_at, activeLicense{key, plan, status, expires_at}) |
| GET | `/users/:id/billing-prefill` | Get last billing details + last offline payment method/reference for a user, to prefill the issue form |
| GET | `/licenses?search=&plan=&status=&page=` | Paginated license list (50/page) |
| POST | `/licenses` | Issue a new license (Pro or Enterprise yearly only) |
| POST | `/licenses/:id/renew` | Renew (body: `durationMonths` 1..60, `dealer`) |
| POST | `/licenses/:id/revoke` | Revoke (body: `reason?`, `dealer`) |
| GET | `/payments?search=&page=` | Paginated payments list |
| GET | `/payments/:id/invoice.pdf` | Inline PDF |
| GET | `/payments/:id/receipt.pdf` | Inline PDF |

### POST /licenses request body

```json
{
  "userId": "usr_...",
  "plan": "pro" | "enterprise",
  "paymentMethod": "cash" | "cheque" | "neft" | "imps" | "upi" | "rtgs" | "card" | "other",
  "paymentReference": "string (required for cheque/neft/imps/upi/rtgs)",
  "amount": 500000,                // paise (integer, > 0)
  "billingDetails": {
    "name": "...",                 // required
    "addressLine1": "...",         // required
    "addressLine2": "...",         // optional
    "city": "...",                 // required
    "state": "...",                // required
    "pincode": "...",              // required
    "gstin": "..."                 // optional
  },
  "notes": "optional string",
  "dealer": {
    "id": "dealer_...",            // either id OR email required
    "name": "Acme CA Co.",
    "email": "raj@acme.example",
    "location": "Mumbai"
  }
}
```

Response: `{ license, paymentId, invoiceUrl, receiptUrl }`. The license object includes the full `key` (e.g. `PRO-XXXX-XXXX-XXXX-XX`). The PDF URLs are `/api/external/payments/<id>/(invoice|receipt).pdf` — proxy these through assist's backend so the browser can download them without seeing the EXTKEY.

### Pricing

Pro yearly: ₹7,080 incl. GST (`amount: 708000` paise — base ₹6,000 + 18% GST).
Enterprise yearly: ₹11,800 incl. GST (`amount: 1180000` paise — base ₹10,000 + 18% GST).
(Hard-code these in the assist UI — Tax-Assistant accepts whatever integer paise value you send for offline issuance, but match the Razorpay prices.)

## Inbound webhook (Tax-Assistant → assist)

When a customer pays via Razorpay on Tax-Assistant's own checkout (i.e. **not** via the dealer console), Tax-Assistant fans out a `license.issued` event to every active EXTKEY that has a `webhook_url` configured.

To register your URL: have the Tax-Assistant admin set `webhook_url` on assist's EXTKEY row (the admin UI has an edit-webhook action).

### Webhook delivery

```
POST <your webhook_url>
Content-Type: application/json
X-Smartbizin-Key-Id: <the EXTKEY's id, NOT the plaintext>
X-Smartbizin-Signature: hex(HMAC-SHA256(rawBody, key.id))
```

**Verification:** the receiver knows its plaintext EXTKEY but the signature uses the *key id* as the secret (because Tax-Assistant only stores a hash of the plaintext after issuance). Both sides see the id in `X-Smartbizin-Key-Id`. Verify by recomputing `HMAC-SHA256(rawBody, headerKeyId)` and `timingSafeEqual` against `X-Smartbizin-Signature`. Reject mismatches.

### Payload

```json
{
  "event": "license.issued" | "license.revoked" | "license.renewed",
  "license": { /* license_keys row — id, key, user_id, plan, status, starts_at, expires_at, ... */ },
  "payment": { /* payments row */ } | null,
  "user":    { "id", "name", "email", "plan" } | null,
  "timestamp": "2026-05-05T..."
}
```

8s timeout, fire-and-forget, no retries. Respond fast (200) and process async.

## UI scope (MVP)

Match Tax-Assistant's visual language (Tailwind, same colour tokens) but it doesn't need to be pixel-identical.

- **/login** — dealer email + password.
- **/** dashboard — counts (active licenses issued by this dealer, expiring in 30 days, total revenue this month).
- **/users** — search + list of Tax-Assistant users, click to open issue dialog prefilled via `/users/:id/billing-prefill`.
- **/licenses** — paginated table mirroring Tax-Assistant's admin LicensesDashboard. Filters: search, plan, status. Row actions: renew, revoke. **Show only licenses where `issued_by_dealer.email` matches the logged-in dealer** (or all licenses if you want a "global view" toggle for super-dealers — your call, default to scoped).
- **/payments** — paginated table; download invoice/receipt buttons proxy through assist's backend.
- **Issue License dialog** — Pro/Enterprise + payment method + reference (when needed) + billing form. Same UX as Tax-Assistant's `GenerateLicenseDialog` (read it for reference at `src/components/admin/GenerateLicenseDialog.tsx` in the Tax-Assistant repo). On success show the license key once with a "copy" button.

## Non-goals for v1

- Recurring/auto-renew (Tax-Assistant is one-shot yearly orders).
- Free-plan licenses (external API rejects `plan: 'free'`).
- Editing user data (assist is licensing-only; profile edits stay on Tax-Assistant).
- Dealer self-signup (admin onboards dealers manually).

## Build steps

1. Scaffold Express + Vite + React + TS + Tailwind (mirror Tax-Assistant's structure: `server/` + `src/`).
2. Dealer auth table + login route + session cookie (httpOnly, sameSite=Lax, secure in prod).
3. Server proxy: `/api/proxy/*` that injects `Authorization: Bearer ${process.env.TAX_ASSISTANT_API_KEY}` and merges `dealer: { id, email, name, location }` into the JSON body for write requests, then forwards to `${process.env.TAX_ASSISTANT_BASE}/api/external/${path}`.
4. Webhook receiver `POST /webhooks/tax-assistant` — verify signature (HMAC-SHA256, key = `X-Smartbizin-Key-Id` header value), then update an `inbox_events` table (id PK = `${license.id}:${event}` for idempotency) and notify the dealer UI via SSE/poll.
5. Frontend pages above.
6. Dockerfile + PM2 ecosystem config; deploy to assist.smartbizin.com behind Apache/Nginx with HTTPS.

## Env vars (assist server)

```
TAX_ASSISTANT_BASE=https://ai.smartbizin.com
TAX_ASSISTANT_API_KEY=EXTKEY-...           # never sent to browser
SESSION_SECRET=<32 random bytes>
PORT=4002
NODE_ENV=production
```

## Test checklist

- [ ] `GET /api/external/health` returns `{ok:true}` with the EXTKEY.
- [ ] Issue Pro license for a real Tax-Assistant user; confirm key appears in Tax-Assistant Admin → Licenses with `issued_by_dealer` JSON populated.
- [ ] Receipt + invoice PDFs download (via assist proxy, no EXTKEY in browser network tab).
- [ ] Razorpay-paid license fires the webhook; assist marks it received.
- [ ] Webhook signature mismatch → 401, no DB write.
- [ ] Revoke downgrades the user's plan to free on Tax-Assistant side.
- [ ] Renew extends `expires_at` by the requested months.

## Reference files in Tax-Assistant repo

If you have read access to the Tax-Assistant repo, these are the canonical sources of truth:

- `server/routes/external.ts` — every endpoint contract.
- `server/lib/externalWebhook.ts` — outbound webhook signature scheme.
- `server/middleware/externalApiKey.ts` — auth middleware (mirror the verification logic for the inbound webhook).
- `src/components/admin/GenerateLicenseDialog.tsx` — UX reference for the issue dialog.
- `src/components/admin/LicensesDashboard.tsx` + `PaymentsDashboard.tsx` — UX reference for tables.

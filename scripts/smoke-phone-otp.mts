// End-to-end check of mandatory mobile verification + WhatsApp/email OTP.
// Fresh DB; outbound WhatsApp / email / assist calls are stubbed so the
// codes can be read back. Run: npx tsx scripts/smoke-phone-otp.mts
import fs from 'fs';
const DB = './scratch/smoke-phone-otp.db';
for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });
process.env.DB_PATH = DB;
process.env.SMTP2GO_API_KEY = 'test';
process.env.META_WA_ACCESS_TOKEN = 'test';
process.env.META_WA_PHONE_NUMBER_ID = '123';

type Sent = { to: string; code: string };
const waSent: Sent[] = [];
const mailSent: Sent[] = [];
let waFail = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(url, init);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (u.includes('graph.facebook.com')) {
    if (waFail) return new Response(JSON.stringify({ error: { code: 131026, message: 'undeliverable' } }), { status: 400 });
    waSent.push({ to: body.to, code: body.template.components[0].parameters[0].text });
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.x' }] }), { status: 200 });
  }
  if (u.includes('smtp2go')) {
    const code = String(body.text_body ?? body.html_body ?? '').match(/\b\d{6}\b/)?.[0] ?? '';
    mailSent.push({ to: body.to?.[0] ?? '', code });
    return new Response(JSON.stringify({ data: { succeeded: 1 } }), { status: 200 });
  }
  return new Response('{}', { status: 200 });
}) as typeof fetch;

const express = (await import('express')).default;
const authRouter = (await import('../server/routes/auth.js')).default;
const { authMiddleware, phoneRequiredMiddleware } = await import('../server/middleware/auth.js');
const { userRepo } = await import('../server/db/repositories/userRepo.js');
const db = (await import('../server/db/index.js')).default;

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
app.use('/api', authMiddleware);
app.use('/api', phoneRequiredMiddleware);
app.get('/api/ping', (_req, res) => { res.json({ pong: true }); });
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await realFetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) as any };
}
// The auth limiter is 10/min per IP; this script makes more calls than that.
const { authLimiter } = await import('../server/middleware/rateLimiter.js');
const resetLimit = () => {
  for (const k of ['::ffff:127.0.0.1', '127.0.0.1', '::1']) (authLimiter as unknown as { resetKey?: (k: string) => void }).resetKey?.(k);
};
const backdateCodes = () => db.prepare("UPDATE email_verification_codes SET created_at = datetime(created_at, '-2 minutes')").run();

async function signupAndVerify(email: string, phone: string) {
  resetLimit();
  const s = await call('POST', '/api/auth/signup', { name: 'T', email, phone, password: 'password123' });
  if (s.status !== 201) return { s };
  const code = mailSent.filter(m => m.to.includes(email)).at(-1)!.code;
  const v = await call('POST', '/api/auth/verify-email', { email, code });
  return { s, v, token: v.data.accessToken as string };
}

// ── signup validation ──
resetLimit();
ok((await call('POST', '/api/auth/signup', { name: 'T', email: 'a@x.com', password: 'password123' })).status === 400, 'signup without mobile → 400');
ok((await call('POST', '/api/auth/signup', { name: 'T', email: 'a@x.com', phone: '12345', password: 'password123' })).status === 400, 'signup with invalid mobile → 400');

// ── user A: signup, gate, verify mobile ──
const a = await signupAndVerify('a@x.com', '+91 98765 43210');
ok(a.s.status === 201, 'signup with mobile → 201');
ok(a.v?.data.user?.needs_phone === true, 'after email verification user.needs_phone = true');
ok((await call('GET', '/api/ping', undefined, a.token)).data.error === 'phone_required', 'app API blocked with phone_required');
ok((await call('GET', '/api/auth/me', undefined, a.token)).status === 200, '/api/auth/me still reachable');
resetLimit();
const sc = await call('POST', '/api/auth/phone/send-code', { phone: '+91 98765 43210' }, a.token);
ok(sc.status === 200 && waSent.at(-1)?.to === '919876543210', `send-code → WhatsApp to 919876543210 (${sc.status} ${waSent.at(-1)?.to})`);
ok(sc.data.phoneMasked === '+91 98******10', 'masked number returned (' + sc.data.phoneMasked + ')');
ok((await call('POST', '/api/auth/phone/send-code', { phone: '9876543210' }, a.token)).status === 429, 'immediate resend → 429 cooldown');
ok((await call('POST', '/api/auth/phone/verify', { code: '000000' === waSent.at(-1)!.code ? '111111' : '000000' }, a.token)).status === 401, 'wrong code → 401');
const pv = await call('POST', '/api/auth/phone/verify', { code: waSent.at(-1)!.code }, a.token);
ok(pv.status === 200 && pv.data.user.phone === '9876543210' && pv.data.user.needs_phone === false, 'right code → phone saved, needs_phone false');
ok((await call('GET', '/api/ping', undefined, a.token)).status === 200, 'app API open after verification');

// ── reuse of the number ──
resetLimit();
const b0 = await call('POST', '/api/auth/signup', { name: 'B', email: 'b@x.com', phone: '09876543210', password: 'password123' });
ok(b0.status === 409 && /already linked/.test(b0.data.error), 'second signup with same number (0-prefixed) → 409');
const b = await signupAndVerify('b@x.com', '9123456780');
resetLimit();
ok((await call('POST', '/api/auth/phone/send-code', { phone: '9876543210' }, b.token)).status === 409, 'other account cannot claim a verified number');

// ── login with mobile ──
resetLimit();
const lp = await call('POST', '/api/auth/login', { identifier: '+91-98765-43210', password: 'password123' });
ok(lp.status === 200 && !!lp.data.accessToken, 'login with mobile + password');

// ── 2FA over WhatsApp, with email fallback ──
ok((await call('PATCH', '/api/auth/settings/otp-channel', { channel: 'whatsapp' }, b.token)).status === 400, 'WhatsApp channel refused without verified mobile');
await call('PATCH', '/api/auth/settings/require-login-otp', { enabled: true }, a.token);
const ch = await call('PATCH', '/api/auth/settings/otp-channel', { channel: 'whatsapp' }, a.token);
ok(ch.status === 200 && ch.data.user.otp_channel === 'whatsapp', 'channel set to whatsapp');
resetLimit();
const l1 = await call('POST', '/api/auth/login', { identifier: 'a@x.com', password: 'password123' });
ok(l1.data.requiresOtp && l1.data.otpChannel === 'whatsapp', 'login → code on WhatsApp (' + l1.data.emailMasked + ')');
const vl = await call('POST', '/api/auth/verify-login-otp', { pendingLoginToken: l1.data.pendingLoginToken, code: waSent.at(-1)!.code });
ok(vl.status === 200 && !!vl.data.accessToken, 'WhatsApp login code accepted');
waFail = true;
resetLimit();
const l2 = await call('POST', '/api/auth/login', { identifier: '9876543210', password: 'password123' });
ok(l2.data.otpChannel === 'email', 'WhatsApp failure → falls back to email');
const vl2 = await call('POST', '/api/auth/verify-login-otp', { pendingLoginToken: l2.data.pendingLoginToken, code: mailSent.at(-1)!.code });
ok(vl2.status === 200, 'email fallback code accepted');
waFail = false;

// ── closed account keeps its number ──
userRepo.softDelete(userRepo.findByEmail('a@x.com')!.id);
resetLimit();
const c0 = await call('POST', '/api/auth/signup', { name: 'C', email: 'c@x.com', phone: '9876543210', password: 'password123' });
ok(c0.status === 409 && /closed account/.test(c0.data.error), 'new signup with a closed account\'s number → 409');
resetLimit();
const a2 = await call('POST', '/api/auth/signup', { name: 'A', email: 'a@x.com', phone: '9876543210', password: 'password123' });
ok(a2.status === 201, 'closed account reopening with its own email may keep its number');

// ── changing number in settings ──
backdateCodes();
resetLimit();
await call('POST', '/api/auth/phone/send-code', { phone: '9000000001' }, b.token);
const pv2 = await call('POST', '/api/auth/phone/verify', { code: waSent.at(-1)!.code }, b.token);
ok(pv2.data.user?.phone === '9000000001', 'B verified a number');
backdateCodes();
resetLimit();
await call('POST', '/api/auth/phone/send-code', { phone: '9000000002' }, b.token);
const pv3 = await call('POST', '/api/auth/phone/verify', { code: waSent.at(-1)!.code }, b.token);
ok(pv3.data.user?.phone === '9000000002', 'B changed number in settings');

// ── admins exempt ──
db.prepare("UPDATE users SET role = 'admin', phone = NULL WHERE email = 'b@x.com'").run();
ok((await call('GET', '/api/ping', undefined, b.token)).status === 200, 'admin without mobile not blocked');

server.close();
console.log(fails === 0 ? '\nALL PASSED' : '\n' + fails + ' FAILED');
process.exit(fails === 0 ? 0 : 1);

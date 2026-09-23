/** Account closure + re-signup smoke test.
 *  Run: npx tsx scripts/smoke-deleted-account-guard.mts */
import fs from 'node:fs';
const DB = './scratch/smoke-deleted-account-guard.db';
for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });
process.env.DB_PATH = DB;

const db = (await import('../server/db/index.js')).default;
const { userRepo } = await import('../server/db/repositories/userRepo.js');
const { usageRepo } = await import('../server/db/repositories/usageRepo.js');
const { chatRepo } = await import('../server/db/repositories/chatRepo.js');
const { messageRepo } = await import('../server/db/repositories/messageRepo.js');
const { getUsagePeriodStart, isTrialExpired } = await import('../server/lib/planLimits.js');
const { normalizeEmailForAbuse, recordDeletedAccount, applyDeletedAccountCarryover } = await import('../server/lib/deletedAccountGuard.js');

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
const used = (id: string) => {
  const u = userRepo.findById(id)!;
  return usageRepo.sumTokensSinceForBillingUser(u.id, getUsagePeriodStart(u));
};
const count = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;

// Same sequence as DELETE /api/auth/account.
const closeAccount = (id: string) => db.transaction(() => { recordDeletedAccount(userRepo.findById(id)!); userRepo.softDelete(id); })();
// Same sequence as POST /api/auth/signup.
const signup = (email: string, name = 'T') => {
  const e = email.toLowerCase().trim();
  const closed = userRepo.findDeleted({ email: e });
  return closed
    ? userRepo.reactivate(closed.id, { password: 'newhash', name, emailVerified: false })
    : applyDeletedAccountCarryover(userRepo.create(e, 'x', name));
};

ok(normalizeEmailForAbuse(' Study.Is.Fun7890+2@GoogleMail.com ') === 'studyisfun7890@gmail.com', 'gmail dots, +tag, case and googlemail collapse');

// Account 40 days old (trial over), with a chat, a session and usage.
const a = userRepo.create('studyisfun7890@gmail.com', 'x', 'ggg');
db.prepare("UPDATE users SET created_at = datetime('now', '+5 hours', '+30 minutes', '-40 days') WHERE id = ?").run(a.id);
const chat = chatRepo.create(a.id, 'RCM');
messageRepo.create(chat.id, 'user', 'q');
usageRepo.logWithBilling('1.1.1.1', a.id, a.id, 6000, 3500, 0.01, false, 'gemini-3.8-flash', true, 'chat', 0, 'success', 0, 1000);
const member = userRepo.create('member@x.in', 'x', 'M');
userRepo.setInviterId(member.id, a.id);
const usedA = used(a.id);
const createdA = userRepo.findById(a.id)!.created_at;

closeAccount(a.id);
const row = userRepo.findAnyById(a.id)!;
ok(!!row && !!row.deleted_at, 'user master row kept, marked deleted');
ok(row.email === 'studyisfun7890@gmail.com' && row.name === 'ggg', 'name and email retained');
ok(row.password === '' && row.session_token === null, 'credentials and session cleared');
ok(!userRepo.findById(a.id) && !userRepo.findByEmail('studyisfun7890@gmail.com'), 'closed account invisible to login lookups');
ok(count('SELECT COUNT(*) n FROM chats WHERE user_id = ?', a.id) === 0, 'chats deleted');
ok(count('SELECT COUNT(*) n FROM messages WHERE chat_id = ?', chat.id) === 0, 'messages deleted with them');
ok(count('SELECT COUNT(*) n FROM api_usage WHERE billing_user_id = ? AND user_id = ?', a.id, a.id) === 1, 'usage kept and still linked to the user');
ok(userRepo.findById(member.id)!.inviter_id === null, 'team members detached');

// Same email → the same account reopens.
const b = signup('studyisfun7890@gmail.com', 'ggg2');
ok(b.id === a.id, 'exact-email re-signup reopens the same account');
ok(used(b.id) === usedA, 'used credits unchanged (' + used(b.id) + ')');
ok(userRepo.findById(b.id)!.created_at === createdA && isTrialExpired(createdA), 'trial clock unchanged, still expired');
ok(userRepo.findById(b.id)!.email_verified === 0, 'reopened account must verify the email again');

// Variant email → new account, but usage and trial carry over.
closeAccount(b.id);
const c = signup('study.isfun7890+x@gmail.com');
ok(c.id !== a.id && used(c.id) === usedA, 'variant email: new row with carried usage (' + used(c.id) + ')');
ok(userRepo.findById(c.id)!.created_at === createdA, 'variant email: trial clock carried');

// Unrelated signup untouched; paid accounts leave no tombstone.
ok(used(signup('someone.else@gmail.com').id) === 0, 'unrelated new signup starts at 0');
const p = userRepo.create('payer@firm.in', 'x', 'P');
userRepo.updatePlan(p.id, 'pro');
closeAccount(p.id);
ok(count('SELECT COUNT(*) n FROM deleted_account_usage') === 2, 'only the two free closures left tombstones');

ok((db.prepare('SELECT email_hash FROM deleted_account_usage').all() as Array<{ email_hash: string }>).every(r => /^[0-9a-f]{64}$/.test(r.email_hash)), 'tombstones hold hashes only');

db.close();
for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });
console.log(fails === 0 ? '\nALL PASSED' : '\n' + fails + ' FAILED');
process.exit(fails === 0 ? 0 : 1);

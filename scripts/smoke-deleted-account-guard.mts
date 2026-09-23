/** Delete-and-re-signup guard smoke test.
 *  Run: npx tsx scripts/smoke-deleted-account-guard.mts */
import fs from 'node:fs';
const DB = './scratch/smoke-deleted-account-guard.db';
for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });
process.env.DB_PATH = DB;

const db = (await import('../server/db/index.js')).default;
const { userRepo } = await import('../server/db/repositories/userRepo.js');
const { usageRepo } = await import('../server/db/repositories/usageRepo.js');
const { getUsagePeriodStart, isTrialExpired } = await import('../server/lib/planLimits.js');
const { normalizeEmailForAbuse, recordDeletedAccount, applyDeletedAccountCarryover } = await import('../server/lib/deletedAccountGuard.js');

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };
const used = (id: string) => {
  const u = userRepo.findById(id)!;
  return usageRepo.sumTokensSinceForBillingUser(u.id, getUsagePeriodStart(u));
};
const deleteLikeRoute = (id: string) => db.transaction(() => { recordDeletedAccount(userRepo.findById(id)!); userRepo.deleteById(id); })();
const signup = (email: string) => applyDeletedAccountCarryover(userRepo.create(email, 'x', 'T'));

ok(normalizeEmailForAbuse(' Study.Is.Fun7890+2@GoogleMail.com ') === 'studyisfun7890@gmail.com', 'gmail dots, +tag, case and googlemail collapse');
ok(normalizeEmailForAbuse('a.b+x@company.in') === 'a.b@company.in', 'non-gmail keeps dots, drops +tag');

// First account, 40 days old (trial over), used 180K weighted.
const a = userRepo.create('studyisfun7890@gmail.com', 'x', 'ggg');
db.prepare("UPDATE users SET created_at = datetime('now', '+5 hours', '+30 minutes', '-40 days') WHERE id = ?").run(a.id);
usageRepo.logWithBilling('1.1.1.1', a.id, a.id, 6000, 3500, 0.01, false, 'gemini-3.8-flash', true, 'chat', 0, 'success', 0, 1000);
const usedA = used(a.id);
ok(usedA > 100_000, 'first account used ' + usedA + ' weighted');
const createdA = userRepo.findById(a.id)!.created_at;

deleteLikeRoute(a.id);
ok(!userRepo.findById(a.id), 'first account deleted');

// Re-signup with a dotted +tag variant.
const b = signup('study.isfun7890+new@gmail.com');
ok(used(b.id) === usedA, 're-signup inherits used credits (' + used(b.id) + ')');
ok(userRepo.findById(b.id)!.created_at === createdA, 'trial clock inherits the original signup date');
ok(isTrialExpired(userRepo.findById(b.id)!.created_at), 'so the expired trial stays expired');

// Second cycle: usage keeps accumulating, never resets.
usageRepo.logWithBilling('1.1.1.1', b.id, b.id, 1000, 500, 0.001, false, 'gemini-3.1-flash-lite', true, 'chat', 0, 'success', 0, 1000);
const usedB = used(b.id);
deleteLikeRoute(b.id);
const c = signup('studyisfun7890@gmail.com');
ok(used(c.id) === usedB, 'third account inherits the running total (' + used(c.id) + ' = ' + usedB + ')');

// A genuinely new email is untouched.
const d = signup('someone.else@gmail.com');
ok(used(d.id) === 0, 'unrelated new signup starts at 0');

// Paid accounts leave no tombstone.
const p = userRepo.create('payer@firm.in', 'x', 'P');
userRepo.updatePlan(p.id, 'pro');
deleteLikeRoute(p.id);
const p2 = signup('payer@firm.in');
ok(used(p2.id) === 0 && !isTrialExpired(userRepo.findById(p2.id)!.created_at), 'former paid customer is not penalised');

const stored = db.prepare('SELECT email_hash FROM deleted_account_usage').all() as Array<{ email_hash: string }>;
ok(stored.every(r => /^[0-9a-f]{64}$/.test(r.email_hash)), 'only hashes stored, no email addresses');

db.close();
for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });
console.log(fails === 0 ? '\nALL PASSED' : '\n' + fails + ' FAILED');
process.exit(fails === 0 ? 0 : 1);

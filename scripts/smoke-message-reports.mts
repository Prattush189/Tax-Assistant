/** Chat "Report response" storage smoke test.
 *  Run: npx tsx scripts/smoke-message-reports.mts */
import fs from 'node:fs';
const DB = './scratch/smoke-message-reports.db';
for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });
process.env.DB_PATH = DB;

const db = (await import('../server/db/index.js')).default;
const { messageRepo } = await import('../server/db/repositories/messageRepo.js');
const { chatRepo } = await import('../server/db/repositories/chatRepo.js');
const { messageReportRepo } = await import('../server/db/repositories/messageReportRepo.js');

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };

const u = 'u' + Date.now();
db.prepare("INSERT INTO users (id, email, password, name, role) VALUES (?, ?, 'x', 'Tester', 'user')").run(u, u + '@e.com');
const chat = chatRepo.create(u, 'RCM chat');
messageRepo.create(chat.id, 'user', 'Is RCM payable on boiler fee paid to Punjab govt?');
const ans = messageRepo.create(chat.id, 'model', 'No, RCM is not payable ...');

ok(messageRepo.findById(ans.id)?.role === 'model', 'findById returns the answer');

messageReportRepo.upsert(ans.id, u, 'wrong_info', null);
let recent = messageReportRepo.recent(10);
ok(recent.length === 1, 'report stored');
ok(recent[0].question === 'Is RCM payable on boiler fee paid to Punjab govt?', 'report carries the question it answered');
ok(recent[0].answer.startsWith('No, RCM'), 'report carries the answer');
ok(recent[0].user_email === u + '@e.com', 'report carries reporter email');

messageReportRepo.upsert(ans.id, u, 'confusing', 'too long');
recent = messageReportRepo.recent(10);
ok(recent.length === 1 && recent[0].reason === 'confusing' && recent[0].note === 'too long', 're-reporting updates instead of duplicating');

ok(messageReportRepo.reasonsByMessage().get(ans.id) === 'confusing', 'export tag map has the reason');

chatRepo.delete(chat.id);
ok(messageReportRepo.recent(10).length === 0, 'deleting the chat removes its reports');

db.close();
for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });
console.log(fails === 0 ? '\nALL PASSED' : '\n' + fails + ' FAILED');
process.exit(fails === 0 ? 0 : 1);

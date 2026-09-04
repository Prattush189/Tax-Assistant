process.env.DB_PATH = process.env.DB_PATH || './scratch/smoke-format-requests.db';
const { formatRequestRepo } = await import('../server/db/repositories/formatRequestRepo.js');
const db = (await import('../server/db/index.js')).default;

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fails++; };

const u = 'testuser' + Date.now();
db.prepare("INSERT INTO users (id, email, password, name, role) VALUES (?, ?, 'x', 'T', 'user')").run(u, u + '@e.com');

const bytes = Buffer.from('Date,Narration,Debit,Credit,Balance\n01/04/2025,Test,100.00,,900.00\n');
const id = formatRequestRepo.create({
  userId: u, billingUserId: u, kind: 'bank', softwareName: 'Axis Bank',
  notes: 'Multi-page, Dr/Cr suffix', file: { name: 'axis.csv', mime: 'text/csv', size: bytes.length, buffer: bytes },
});
ok(!!id, 'created request ' + id);

const all = formatRequestRepo.listAll();
const row = all.find(r => r.id === id)!;
ok(!!row, 'appears in admin listing');
ok(row.user_email === u + '@e.com', 'user email joined for admin (' + row.user_email + ')');
ok(row.software_name === 'Axis Bank' && row.kind === 'bank', 'fields stored');
ok(row.status === 'new', 'defaults to status=new');
ok(!('file_blob' in row), 'listing does NOT carry file bytes');
ok(row.file_size === bytes.length, 'file_size recorded');

const f = formatRequestRepo.findFile(id)!;
ok(!!f.file_blob && Buffer.from(f.file_blob).equals(bytes), 'sample bytes round-trip intact');

ok(formatRequestRepo.listAll({ kind: 'ledger' }).every(r => r.id !== id), 'kind filter excludes bank row');
ok(formatRequestRepo.listAll({ status: 'new' }).some(r => r.id === id), 'status filter finds it');

ok(formatRequestRepo.update(id, { status: 'in_progress' }), 'status update');
ok(formatRequestRepo.listAll().find(r => r.id === id)!.status === 'in_progress', 'status persisted');

// No-sample request is allowed (name-only).
const id2 = formatRequestRepo.create({ userId: u, billingUserId: u, kind: 'ledger', softwareName: 'Vyapar', notes: null, file: null });
ok(formatRequestRepo.findFile(id2)!.file_blob === null, 'name-only request stores no blob');

ok(formatRequestRepo.countRecentForUser(u) === 2, 'daily counter sees both (' + formatRequestRepo.countRecentForUser(u) + ')');
ok(formatRequestRepo.listForUser(u).length === 2, 'user sees own requests');

ok(formatRequestRepo.deleteById(id), 'delete');
ok(formatRequestRepo.findFile(id) === null, 'sample bytes gone after delete');

db.prepare('DELETE FROM users WHERE id = ?').run(u);
ok(formatRequestRepo.listForUser(u).length === 0, 'cascade removes rows with the user');

console.log(fails === 0 ? '\nALL PASSED' : '\n' + fails + ' FAILED');
process.exit(fails === 0 ? 0 : 1);

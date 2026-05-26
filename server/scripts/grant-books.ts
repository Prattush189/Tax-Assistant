/**
 * Grant or revoke access to the Books-paid features (TB → Statements
 * and CMA Report) for a specific user, independently of plan and
 * admin role. Flips the `books_paid_enabled` column on the users
 * table.
 *
 * Admins always have access regardless of this flag — the server-
 * side gates check `role === 'admin'` first and only consult the
 * column for non-admin users. So running this script against an
 * admin is a no-op (and tells you so).
 *
 * USAGE
 *
 *   npx tsx server/scripts/grant-books.ts <email>             # grant
 *   npx tsx server/scripts/grant-books.ts <email> grant       # grant
 *   npx tsx server/scripts/grant-books.ts <email> revoke      # revoke
 *   npx tsx server/scripts/grant-books.ts --list              # list granted users
 *
 * On production:
 *
 *   cd /path/to/tax-assistant
 *   npx tsx server/scripts/grant-books.ts someone@example.com
 *
 * The user's browser must then hard-refresh (Ctrl+Shift+R) or log
 * out + back in so the new JWT / /me response carries the updated
 * flag and the TB → Statements + CMA Report tabs appear inside
 * Books.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = process.env.DB_PATH ?? path.join(__dirname, '..', '..', 'data', 'tax-assistant.db');

const db = new Database(dbPath);

interface UserLite {
  id: string;
  email: string;
  name: string;
  role: string;
  books_paid_enabled: number;
}

function die(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log('USAGE:');
  console.log('  npx tsx server/scripts/grant-books.ts <email> [grant|revoke]');
  console.log('  npx tsx server/scripts/grant-books.ts --list');
  process.exit(0);
}

if (args[0] === '--list') {
  const rows = db
    .prepare(
      'SELECT id, email, name, role, books_paid_enabled FROM users WHERE books_paid_enabled = 1 OR role = ? ORDER BY email',
    )
    .all('admin') as UserLite[];
  if (rows.length === 0) {
    console.log('No users with Books-paid access.');
    process.exit(0);
  }
  console.log(`Users with Books-paid (TB → Statements + CMA Report) access (${rows.length}):`);
  for (const r of rows) {
    const tag = r.role === 'admin' ? '[admin]' : '[books_paid_enabled]';
    console.log(`  ${tag.padEnd(22)} ${r.email}  (${r.name})`);
  }
  process.exit(0);
}

const email = args[0].toLowerCase().trim();
const action = (args[1] ?? 'grant').toLowerCase();

if (action !== 'grant' && action !== 'revoke') {
  die(`Unknown action: ${action}. Expected "grant" or "revoke".`);
}

const user = db
  .prepare('SELECT id, email, name, role, books_paid_enabled FROM users WHERE email = ?')
  .get(email) as UserLite | undefined;

if (!user) {
  die(`No user found with email: ${email}`);
}

if (user.role === 'admin') {
  console.log(`${email} is an admin — Books-paid access is automatic.`);
  console.log('No change made.');
  process.exit(0);
}

const newValue = action === 'grant' ? 1 : 0;
if (user.books_paid_enabled === newValue) {
  console.log(
    `${email} already ${action === 'grant' ? 'has' : 'does not have'} Books-paid access. No change.`,
  );
  process.exit(0);
}

db.prepare(
  "UPDATE users SET books_paid_enabled = ?, updated_at = datetime('now','+5 hours','+30 minutes') WHERE id = ?",
).run(newValue, user.id);

console.log(`${action === 'grant' ? '✓ Granted' : '✓ Revoked'} Books-paid access for ${email}.`);
console.log('');
console.log('Next steps:');
console.log('  1. Ask the user to log out + log back in (or hard-refresh the browser) so the');
console.log('     new JWT / /me response carries the updated capability.');
console.log('  2. The TB → Statements and CMA Report tabs should then appear inside Books.');

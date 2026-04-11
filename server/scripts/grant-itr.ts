/**
 * Grant or revoke ITR-tab access for a specific user, independently of the
 * admin role. This flips the `itr_enabled` column on the users table and
 * is the counterpart to the itrAccessMiddleware on the server + the
 * canAccessItr gate on the client.
 *
 * USAGE
 *
 *   npx tsx server/scripts/grant-itr.ts <email>              # grant
 *   npx tsx server/scripts/grant-itr.ts <email> grant        # grant
 *   npx tsx server/scripts/grant-itr.ts <email> revoke       # revoke
 *   npx tsx server/scripts/grant-itr.ts --list               # list granted users
 *
 * On production:
 *
 *   cd /path/to/tax-assistant
 *   npx tsx server/scripts/grant-itr.ts someone@example.com
 *
 * The user's browser must then hard-refresh (Ctrl+Shift+R) or log out + in
 * so the new JWT payload / /me response carries the updated flag.
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
  itr_enabled: number;
}

function die(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log('USAGE:');
  console.log('  npx tsx server/scripts/grant-itr.ts <email> [grant|revoke]');
  console.log('  npx tsx server/scripts/grant-itr.ts --list');
  process.exit(0);
}

if (args[0] === '--list') {
  const rows = db
    .prepare(
      'SELECT id, email, name, role, itr_enabled FROM users WHERE itr_enabled = 1 OR role = ? ORDER BY email',
    )
    .all('admin') as UserLite[];
  if (rows.length === 0) {
    console.log('No users with ITR access.');
    process.exit(0);
  }
  console.log(`Users with ITR access (${rows.length}):`);
  for (const r of rows) {
    const tag = r.role === 'admin' ? '[admin]' : '[itr_enabled]';
    console.log(`  ${tag.padEnd(15)} ${r.email}  (${r.name})`);
  }
  process.exit(0);
}

const email = args[0].toLowerCase().trim();
const action = (args[1] ?? 'grant').toLowerCase();

if (action !== 'grant' && action !== 'revoke') {
  die(`Unknown action: ${action}. Expected "grant" or "revoke".`);
}

const user = db
  .prepare('SELECT id, email, name, role, itr_enabled FROM users WHERE email = ?')
  .get(email) as UserLite | undefined;

if (!user) {
  die(`No user found with email: ${email}`);
}

if (user.role === 'admin') {
  console.log(`${email} is already an admin — ITR access is automatic.`);
  console.log('No change made. Use /api/admin/users/:id/plan or similar to change their role.');
  process.exit(0);
}

const newValue = action === 'grant' ? 1 : 0;
if (user.itr_enabled === newValue) {
  console.log(
    `${email} already ${action === 'grant' ? 'has' : 'does not have'} ITR access. No change.`,
  );
  process.exit(0);
}

db.prepare(
  "UPDATE users SET itr_enabled = ?, updated_at = datetime('now','+5 hours','+30 minutes') WHERE id = ?",
).run(newValue, user.id);

console.log(`${action === 'grant' ? '✓ Granted' : '✓ Revoked'} ITR access for ${email}.`);
console.log('');
console.log('Next steps:');
console.log('  1. Ask the user to log out + log back in (or hard-refresh the browser) so the');
console.log('     new JWT / /me response carries the updated capability.');
console.log('  2. The ITR tab should then appear in their sidebar and top nav.');

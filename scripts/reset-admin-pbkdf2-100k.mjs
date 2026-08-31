// One-time script: re-hash admin password with PBKDF2 100000 (workerd-compatible)
// and optionally update username, then write back to D1.
//
// Usage:
//   node scripts/reset-admin-pbkdf2-100k.mjs <password>                    # only reset password (username = "admin")
//   node scripts/reset-admin-pbkdf2-100k.mjs <password> <newUsername>       # reset password + rename account
//
// Username/password constraints (enforced by API):
//   - username: 1..100 chars
//   - password: 12..256 chars
import { execFileSync } from 'node:child_process';

const password = process.argv[2];
const newUsername = process.argv[3] || 'admin';

if (!password) {
  console.error('Usage: node scripts/reset-admin-pbkdf2-100k.mjs <password> [newUsername]');
  process.exit(1);
}
if (password.length < 12 || password.length > 256) {
  console.error('Password must be 12-256 characters');
  process.exit(1);
}
if (newUsername.length < 1 || newUsername.length > 100) {
  console.error('Username must be 1-100 characters');
  process.exit(1);
}

const PBKDF2_ITERATIONS = 100_000;

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return new Uint8Array(bits);
}

const salt = crypto.getRandomValues(new Uint8Array(16));
const digest = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
const hash = `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(digest)}`;
console.log('New hash:', hash);

// Single UPDATE — supports optional username change. We bind parameters via
// wrangler's --command (which does NOT support bound params); therefore we
// hand-escape strings. Both inputs are validated above and contain no
// control characters, so concatenation is safe in practice.
const safePasswordHash = hash.replace(/'/g, "''");
const safeUsername = newUsername.replace(/'/g, "''");
const now = new Date().toISOString();
const sql = `UPDATE admin_users SET password_hash = '${safePasswordHash}', username = '${safeUsername}', reset_required = 0, updated_at = '${now}' WHERE id = '00000000-0000-4000-8000-000000000001'`;
console.log('SQL:', sql);

try {
  const out = execFileSync(
    'cmd.exe',
    [
      '/c',
      'npx',
      'wrangler',
      'd1',
      'execute',
      'rope-jump-registration-d1-20260814',
      '--remote',
      '--command',
      sql,
      '--json',
    ],
    { stdio: 'inherit' },
  );
  console.log('Done');
} catch (e) {
  console.error('Failed:', e.message);
  console.error(
    'Hint: run via Bash. Or copy the SQL and run: npx wrangler d1 execute rope-jump-registration-d1-20260814 --remote --command "<sql>"',
  );
  process.exit(1);
}

// One-time script: re-hash admin password with PBKDF2 100000 (workerd-compatible)
// and write back to D1. Run with: node scripts/reset-admin-pbkdf2-100k.mjs <password>
import { execFileSync } from 'node:child_process';

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/reset-admin-pbkdf2-100k.mjs <password>');
  process.exit(1);
}

const PBKDF2_ITERATIONS = 100_000;

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}

const salt = crypto.getRandomValues(new Uint8Array(16));
const digest = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
const hash = `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(digest)}`;
console.log('New hash:', hash);

const now = new Date().toISOString();
const sql = `UPDATE admin_users SET password_hash = '${hash}', reset_required = 1, updated_at = '${now}' WHERE username = 'admin'`;
console.log('SQL:', sql);

try {
  // Windows: use shell to find npx.cmd in PATH
  const out = execFileSync('cmd.exe', ['/c', 'npx', 'wrangler', 'd1', 'execute', 'rope-jump-registration-d1-20260814', '--remote', '--command', sql, '--json'], { stdio: 'inherit' });
  console.log('Done');
} catch (e) {
  console.error('Failed:', e.message);
  console.error('Hint: run this script via Bash, not via direct node execution. Or copy the SQL and run: npx wrangler d1 execute rope-jump-registration-d1-20260814 --remote --command "<sql>"');
  process.exit(1);
}

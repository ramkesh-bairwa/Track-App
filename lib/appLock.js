// App lock: a password (not the login one) asked whenever MyTrack is opened
// or the user comes back to it from another app, window or tab.
import { query } from './db';

// The bcrypt hash, or null when the lock is off. A database that hasn't been
// migrated yet (no app_lock_password column) simply has no lock.
export async function appLockHash(userId) {
  try {
    const rows = await query('SELECT app_lock_password FROM users WHERE id = ?', [userId]);
    return rows[0]?.app_lock_password || null;
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') return null;
    throw err;
  }
}

// Wrong guesses: after 5 in a row, each try waits a little longer (per user,
// per server process).
const failures = (globalThis.__myTrackAppLockFails ||= new Map());

export function lockoutSeconds(userId) {
  const f = failures.get(userId);
  if (!f || Date.now() >= f.until) return 0;
  return Math.ceil((f.until - Date.now()) / 1000);
}

export function recordFailure(userId) {
  const f = failures.get(userId) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= 5) f.until = Date.now() + Math.min(300, 15 * 2 ** (f.count - 5)) * 1000;
  failures.set(userId, f);
}

export function clearFailures(userId) {
  failures.delete(userId);
}

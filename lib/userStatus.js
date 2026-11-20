// Deactivated accounts: users.is_active = 0 blocks signing in, ends every
// open session (web, mobile, desktop app) and keeps all their data.
import { query } from './db';

// The server runs MySQL, which can't apply schema.sql (its ADD COLUMN IF NOT
// EXISTS is MariaDB-only), so the column is added here once per process.
// false when it's missing and can't be added — everyone then counts as active.
const g = globalThis;
export function hasActiveColumn() {
  if (!g.__myTrackActiveColumn) {
    g.__myTrackActiveColumn = (async () => {
      const rows = await query(
        "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_active'"
      );
      if (rows.length) return true;
      try {
        await query('ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1');
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') throw err;
      }
      return true;
    })().catch((err) => {
      console.error('users.is_active unavailable:', err.message);
      g.__myTrackActiveColumn = null; // try again on the next request
      return false;
    });
  }
  return g.__myTrackActiveColumn;
}

// SQL to select the flag as `is_active` (1 when the column can't exist).
export async function activeSelect(alias = 'u') {
  return (await hasActiveColumn()) ? `${alias}.is_active` : '1';
}

export async function isUserActive(userId) {
  if (!(await hasActiveColumn())) return true;
  const [row] = await query('SELECT is_active FROM users WHERE id = ?', [userId]);
  return Boolean(row?.is_active);
}

export async function setUserActive(userId, active) {
  if (!(await hasActiveColumn())) throw new Error('Deactivating accounts needs the users.is_active column (ALTER permission on the database).');
  await query('UPDATE users SET is_active = ? WHERE id = ?', [active ? 1 : 0, userId]);
}

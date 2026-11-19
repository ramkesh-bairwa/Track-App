// Who may sync: another install presenting a sync key (created by an admin
// here), or the signed-in admin when managing keys / running a sync.
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { hashKey } from '@/lib/sync';

export async function requireSyncKey(request) {
  const header = request.headers.get('authorization') || '';
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!key) return { error: NextResponse.json({ error: 'Missing sync key.' }, { status: 401 }) };
  const rows = await query(
    `SELECT k.id, k.revoked_at, u.id AS user_id, u.email, u.is_admin
       FROM sync_keys k JOIN users u ON u.id = k.user_id
      WHERE k.key_hash = ?`,
    [hashKey(key)]
  );
  const row = rows[0];
  // Say exactly what's wrong, so it can be fixed on the right side.
  const deny = (msg) => ({ error: NextResponse.json({ error: msg }, { status: 401 }) });
  if (!row) return deny('The other app doesn’t know this sync key. Create a key on the other app (Sync → Sync keys) and paste it here — a key created on this app won’t work there.');
  if (row.revoked_at) return deny('This sync key was revoked on the other app. Create a new key there (Sync → Sync keys) and paste it here.');
  if (!row.is_admin) return deny(`The admin who created this key (${row.email}) is no longer an admin on the other app. Create a new key there.`);
  await query('UPDATE sync_keys SET last_used_at = NOW() WHERE id = ?', [row.id]);
  return { keyId: row.id, email: row.email };
}

export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!user.is_admin) return { error: NextResponse.json({ error: 'Only an admin can sync data.' }, { status: 403 }) };
  return { user };
}

// A random id for this install, so a sync can't be pointed at itself.
export async function instanceId() {
  const rows = await query("SELECT v FROM sync_state WHERE k = 'instance_id'");
  if (rows[0]?.v) return rows[0].v;
  const id = crypto.randomUUID();
  await query("INSERT IGNORE INTO sync_state (k, v) VALUES ('instance_id', ?)", [id]);
  return (await query("SELECT v FROM sync_state WHERE k = 'instance_id'"))[0].v;
}

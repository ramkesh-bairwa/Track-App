import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { withApiErrors } from '@/lib/apiError';
import { requireAdmin } from '@/lib/syncAuth';
import { hashKey, newKey } from '@/lib/sync';

// Sync keys other installs use to sync with this one. The key itself is
// shown once, at creation; only its hash is kept.
export const GET = withApiErrors(async () => {
  const { error } = await requireAdmin();
  if (error) return error;
  const keys = await query(
    `SELECT k.id, k.name, k.key_hint, k.created_at, k.last_used_at, u.name AS created_by
       FROM sync_keys k JOIN users u ON u.id = k.user_id
      WHERE k.revoked_at IS NULL ORDER BY k.id DESC`
  );
  return NextResponse.json({ keys });
});

export const POST = withApiErrors(async (request) => {
  const { user, error } = await requireAdmin();
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || '').trim().slice(0, 100) || 'Sync key';
  const key = newKey();
  await query('INSERT INTO sync_keys (user_id, name, key_hash, key_hint) VALUES (?, ?, ?, ?)', [user.id, name, hashKey(key), key.slice(-4)]);
  return NextResponse.json({ ok: true, key, name });
});

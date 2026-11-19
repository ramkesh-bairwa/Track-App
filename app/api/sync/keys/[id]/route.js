import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { withApiErrors } from '@/lib/apiError';
import { requireAdmin } from '@/lib/syncAuth';

// Revokes a key — the install using it can no longer sync.
export const DELETE = withApiErrors(async (request, { params }) => {
  const { error } = await requireAdmin();
  if (error) return error;
  await query('UPDATE sync_keys SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL', [Number(params.id) || 0]);
  return NextResponse.json({ ok: true });
});

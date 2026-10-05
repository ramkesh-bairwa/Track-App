import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { parseHiddenMenus } from '@/lib/menuItems';

// Saves which menu items this user has hidden: { hidden: ['calendar', …] }.
export const PATCH = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.hidden)) return NextResponse.json({ error: 'Send the list of hidden menu items.' }, { status: 400 });
  const hidden = parseHiddenMenus(body.hidden);
  await query('UPDATE users SET hidden_menus = ? WHERE id = ?', [hidden.length ? JSON.stringify(hidden) : null, user.id]);
  return NextResponse.json({ user: { hidden_menus: hidden } });
});

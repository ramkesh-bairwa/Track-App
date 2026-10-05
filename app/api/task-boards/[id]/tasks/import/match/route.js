import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { matchPersonName } from '@/lib/taskConfig';
import { getBoardAccess } from '@/lib/taskServer';

// Import preview, admin only: which MyTrack accounts do the assignee names in
// a spreadsheet mean? Only accounts matching a name the admin already has in
// their file come back — the user list itself is never exposed.
// → { matches: { "<name lowercased>": { person: { id, name, email } } | { problem } } }
export const POST = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getBoardAccess(params.id, user);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!access.isAdmin) return NextResponse.json({ matches: {} });

  const body = await request.json().catch(() => ({}));
  const names = [...new Set((Array.isArray(body.names) ? body.names : []).map((n) => String(n ?? '').trim()).filter(Boolean))].slice(0, 500);
  if (names.length === 0) return NextResponse.json({ matches: {} });

  const users = await query('SELECT id, name, email FROM users');
  const matches = {};
  for (const name of names) {
    const { person, problem } = matchPersonName(name, users);
    matches[name.toLowerCase()] = person ? { person: { id: person.id, name: person.name, email: person.email } } : { problem };
  }
  return NextResponse.json({ matches });
});

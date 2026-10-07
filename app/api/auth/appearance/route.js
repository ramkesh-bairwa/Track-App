import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// A field is present-but-null to reset it back to the theme default, or a
// valid hex string to set it — anything else (including "not sent") is a no-op.
function sanitizeColor(value) {
  if (value === null) return { set: true, value: null };
  if (typeof value === 'string' && HEX_COLOR.test(value)) return { set: true, value };
  return { set: false };
}

export const PATCH = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const fields = [];
  const values = [];

  if ('sidebar_color' in body) {
    const sidebar = sanitizeColor(body.sidebar_color);
    if (!sidebar.set) {
      return NextResponse.json({ error: 'Sidebar color must be a hex value like #1f9d85.' }, { status: 400 });
    }
    fields.push('sidebar_color = ?');
    values.push(sidebar.value);
  }

  if ('topbar_color' in body) {
    const topbar = sanitizeColor(body.topbar_color);
    if (!topbar.set) {
      return NextResponse.json({ error: 'Top bar color must be a hex value like #1f9d85.' }, { status: 400 });
    }
    fields.push('topbar_color = ?');
    values.push(topbar.value);
  }

  if ('content_color' in body) {
    const content = sanitizeColor(body.content_color);
    if (!content.set) {
      return NextResponse.json({ error: 'Page background color must be a hex value like #1f9d85.' }, { status: 400 });
    }
    fields.push('content_color = ?');
    values.push(content.value);
  }

  if (fields.length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  values.push(user.id);
  await query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);

  const rows = await query('SELECT sidebar_color, topbar_color, content_color FROM users WHERE id = ?', [user.id]);
  return NextResponse.json({ user: rows[0] });
});

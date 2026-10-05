import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { listActivity, recordActivity } from '@/lib/activityLog';

export const dynamic = 'force-dynamic';

const isInstant = (v) => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));

// What you did in MyTrack between two instants: ?from=<ISO>&to=<ISO>[&limit=]
export const GET = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const q = new URL(request.url).searchParams;
  const from = q.get('from');
  const to = q.get('to');
  if (!isInstant(from) || !isInstant(to) || Date.parse(to) < Date.parse(from)) {
    return NextResponse.json({ error: 'Give a valid from/to time range.' }, { status: 400 });
  }
  const items = await listActivity(user.id, { from: new Date(from), to: new Date(to), limit: q.get('limit') });
  return NextResponse.json({ items });
});

// Actions that happen only in the browser (downloading an edited photo, an
// export…) report themselves here. Kept to short plain text and a local link.
const CLIENT_KINDS = new Set(['export', 'photo', 'pdf']);

export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const kind = CLIENT_KINDS.has(body.kind) ? body.kind : null;
  const summary = typeof body.summary === 'string' ? body.summary.trim().slice(0, 200) : '';
  if (!kind || !summary) return NextResponse.json({ error: 'Nothing to record.' }, { status: 400 });
  const url = typeof body.url === 'string' && /^\/dashboard(\/|$)/.test(body.url) ? body.url.slice(0, 300) : null;
  await recordActivity(user.id, { kind, action: 'exported', summary, url, ref: `${kind}:${summary}` });
  return NextResponse.json({ ok: true });
});

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { getBoardAccess, listActivity } from '@/lib/taskServer';

// ?task=<id> narrows the log to one task's history. ?page=<n>&per=<n> pages
// through it (the board's history feed); ?views=0 leaves out "viewed" entries.
export const GET = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getBoardAccess(params.id, user);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('task') ? Number(searchParams.get('task')) : null;
  const hideViews = searchParams.get('views') === '0';
  const meta = { canRevert: access.isAdmin, me: user.id };
  if (searchParams.get('page')) {
    const per = Math.min(50, Math.max(1, Number(searchParams.get('per')) || 10));
    const page = Math.max(1, Math.floor(Number(searchParams.get('page')) || 1));
    const { activity, total } = await listActivity(access, user.id, {
      taskId,
      hideViews,
      limit: per,
      offset: (page - 1) * per,
      withTotal: true,
    });
    return NextResponse.json({ activity, total, page, per, ...meta });
  }
  const activity = await listActivity(access, user.id, { taskId, hideViews, limit: searchParams.get('limit') || 200 });
  return NextResponse.json({ activity, ...meta });
});

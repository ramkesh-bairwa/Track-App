import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { getBoardAccess, listActivity } from '@/lib/taskServer';

// ?task=<id> narrows the log to one task's history.
export const GET = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getBoardAccess(params.id, user);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('task') ? Number(searchParams.get('task')) : null;
  const activity = await listActivity(access, user.id, { taskId, limit: searchParams.get('limit') || 200 });
  return NextResponse.json({ activity, canRevert: access.isAdmin });
});

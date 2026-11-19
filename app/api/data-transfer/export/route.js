import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { buildExport, FORMATS } from '@/lib/databaseExport';

export const dynamic = 'force-dynamic';

// ?format=json|xlsx|sql  ?content=data|empty  ?scope=mine|all (all: admins only)
// No parameters: everything the signed-in user owns as a JSON file that
// Import understands (website ⇄ desktop app).
export const GET = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const format = params.get('format') || 'json';
  const withData = params.get('content') !== 'empty';
  const scope = params.get('scope') === 'all' ? 'all' : 'mine';
  if (!FORMATS[format]) return NextResponse.json({ error: 'Choose Excel, JSON or SQL.' }, { status: 400 });
  if (scope === 'all' && !user.is_admin) {
    return NextResponse.json({ error: 'Only an admin can export the whole database.' }, { status: 403 });
  }

  const { body, filename, type } = await buildExport({ userId: user.id, format, withData, scope });
  return new NextResponse(body, {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { importUserData, ImportError } from '@/lib/userDataTransfer';

export const dynamic = 'force-dynamic';

// Body: { mode: 'merge' | 'replace', usePassword: boolean, data: <export file> }
export const POST = withApiErrors(async (request) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body?.data) return NextResponse.json({ error: 'Choose an export file to import.' }, { status: 400 });
  const mode = body.mode === 'replace' ? 'replace' : 'merge';
  try {
    const stats = await importUserData(user, body.data, { mode, usePassword: Boolean(body.usePassword) });
    return NextResponse.json({ ok: true, ...stats });
  } catch (err) {
    if (err instanceof ImportError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
});

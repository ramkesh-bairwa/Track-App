import { NextResponse } from 'next/server';
import { withApiErrors } from '@/lib/apiError';
import { requireAdmin } from '@/lib/screenshots';
import { listDevices, COMMANDS } from '@/lib/agent';

export const dynamic = 'force-dynamic';

// Every desktop app linked to this server (?userId= for one person's).
export const GET = withApiErrors(async (request) => {
  const { error } = await requireAdmin();
  if (error) return error;
  const userId = Number(new URL(request.url).searchParams.get('userId')) || null;
  return NextResponse.json({ devices: await listDevices(userId), commands: COMMANDS });
});

import { NextResponse } from 'next/server';
import { withApiErrors } from '@/lib/apiError';
import { instanceId } from '@/lib/syncAuth';

// Which install answers at this address (no key needed — it's only a random
// id), so a sync pointed at its own app is caught before the key is checked.
// force-dynamic: it reads nothing from the request, so Next would otherwise
// prerender it at build time and bake the build machine's instance id in.
export const dynamic = 'force-dynamic';

export const GET = withApiErrors(async () =>
  NextResponse.json({ instance: await instanceId(), kind: process.env.MYTRACK_DESKTOP === '1' ? 'desktop' : 'web' })
);

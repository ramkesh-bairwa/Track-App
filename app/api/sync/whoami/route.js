import { NextResponse } from 'next/server';
import { withApiErrors } from '@/lib/apiError';
import { instanceId } from '@/lib/syncAuth';

// Which install answers at this address (no key needed — it's only a random
// id), so a sync pointed at its own app is caught before the key is checked.
export const GET = withApiErrors(async () =>
  NextResponse.json({ instance: await instanceId(), kind: process.env.MYTRACK_DESKTOP === '1' ? 'desktop' : 'web' })
);

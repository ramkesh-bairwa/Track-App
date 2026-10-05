import { NextResponse } from 'next/server';
import { withApiErrors } from '@/lib/apiError';
import { requireAdmin, usersWithCounts } from '@/lib/screenshots';

// Every account and how many tracker screenshots it has. Admins only.
export const GET = withApiErrors(async () => {
  const { error } = await requireAdmin();
  if (error) return error;
  return NextResponse.json({ users: await usersWithCounts() });
});

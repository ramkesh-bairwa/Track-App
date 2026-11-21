import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import ScreenshotsAdmin from '@/components/screenshots/ScreenshotsAdmin';

export const metadata = { title: 'Screenshots · MyTrack' };

export default async function ScreenshotsPage({ searchParams }) {
  const user = await getCurrentUser();
  if (!user?.is_admin) notFound();
  // ?user=<id> — opened from a person's page in the admin panel.
  return <ScreenshotsAdmin initialUserId={Number(searchParams?.user) || null} />;
}

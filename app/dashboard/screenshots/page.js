import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import ScreenshotsAdmin from '@/components/screenshots/ScreenshotsAdmin';

export const metadata = { title: 'Screenshots · MyTrack' };

export default async function ScreenshotsPage() {
  const user = await getCurrentUser();
  if (!user?.is_admin) notFound();
  return <ScreenshotsAdmin />;
}

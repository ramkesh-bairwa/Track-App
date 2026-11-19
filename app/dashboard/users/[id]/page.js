import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import UserAdmin from '@/components/users/UserAdmin';

export const metadata = { title: 'User · MyTrack' };

export default async function UserAdminPage({ params }) {
  const user = await getCurrentUser();
  if (!user?.is_admin) notFound();
  return <UserAdmin userId={Number(params.id) || 0} meId={user.id} />;
}

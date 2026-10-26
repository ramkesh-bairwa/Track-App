import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listActions, projectRoot } from '@/lib/serverConsole';
import ServerConsole from '@/components/ServerConsole';

export const metadata = { title: 'Server console · MyTrack' };

export default async function ConsolePage() {
  const user = await getCurrentUser();
  if (!user?.is_admin) notFound();
  return (
    <ServerConsole
      actions={listActions()}
      user={{ name: user.name, email: user.email }}
      root={projectRoot()}
    />
  );
}

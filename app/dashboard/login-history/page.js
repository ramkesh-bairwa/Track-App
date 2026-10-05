import { getCurrentUser } from '@/lib/auth';
import { listLogins, describeDevice } from '@/lib/loginHistory';
import LoginHistory from '@/components/LoginHistory';

export const metadata = { title: 'Login history · MyTrack' };

export default async function LoginHistoryPage() {
  const user = await getCurrentUser();
  const rows = await listLogins(user.id, 100);
  const logins = JSON.parse(JSON.stringify(rows)).map((r) => ({
    uuid: r.uuid,
    ip: r.ip,
    device: describeDevice(r.user_agent),
    hasPhoto: Boolean(r.has_photo),
    at: r.created_at,
  }));
  return <LoginHistory logins={logins} />;
}

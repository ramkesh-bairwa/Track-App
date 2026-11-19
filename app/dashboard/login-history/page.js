import { getCurrentUser } from '@/lib/auth';
import { listLogins, describeDevice } from '@/lib/loginHistory';
import { listSystemEvents, systemPhotosEnabled, SYSTEM_KINDS } from '@/lib/systemEvents';
import LoginHistory from '@/components/LoginHistory';

export const metadata = { title: 'Login history · MyTrack' };
export const dynamic = 'force-dynamic';

const plain = (rows) => JSON.parse(JSON.stringify(rows));

export default async function LoginHistoryPage() {
  const user = await getCurrentUser();
  const logins = plain(await listLogins(user.id, 200)).map((r) => ({
    uuid: r.uuid,
    ip: r.ip,
    device: describeDevice(r.user_agent),
    kind: r.kind || 'login',
    source: r.source || (/MyTrack desktop/.test(r.user_agent || '') ? 'desktop' : 'web'),
    hasPhoto: Boolean(r.has_photo),
    at: r.created_at,
  }));
  // System events are about the computer, not an account — admins only.
  const system = user.is_admin
    ? plain(await listSystemEvents(200)).map((e) => ({
        uuid: e.uuid,
        label: SYSTEM_KINDS[e.kind] || e.kind,
        kind: e.kind,
        device: [e.device, e.os].filter(Boolean).join(' · '),
        hasPhoto: Boolean(e.has_photo),
        at: e.created_at,
      }))
    : null;
  return (
    <LoginHistory
      logins={logins}
      system={system}
      isDesktop={process.env.MYTRACK_DESKTOP === '1'}
      systemEnabled={user.is_admin ? await systemPhotosEnabled() : false}
    />
  );
}

import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { withApiErrors } from '@/lib/apiError';
import { requireAdmin, shotOwner, trackerSwitch, trackerStatus, latestShots, dayCounts } from '@/lib/screenshots';
import { listDevices, COMMANDS } from '@/lib/agent';
import { listActivity } from '@/lib/activityLog';

export const dynamic = 'force-dynamic';

const one = async (sql, args) => Number((await query(sql, args))[0]?.n || 0);

// Everything an admin sees about one person: account, what they have, their
// desktop apps, latest screenshots, system photos and recent activity.
export const GET = withApiErrors(async (request, { params }) => {
  const { error } = await requireAdmin();
  if (error) return error;
  const id = Number(params.id) || 0;
  const [account] = await query(
    `SELECT id, name, email, avatar, is_admin, created_at, (app_lock_password IS NOT NULL) AS app_lock,
            (action_password IS NOT NULL) AS privacy_password FROM users WHERE id = ?`,
    [id]
  );
  if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const owner = await shotOwner(id);
  const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 14));
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);

  const [counts, devices, activity, system, logins, shots, power, status, shotDays] = await Promise.all([
    Promise.all([
      one('SELECT COUNT(*) n FROM tracks WHERE user_id = ?', [id]),
      one('SELECT COUNT(*) n FROM track_entries e JOIN tracks t ON t.id = e.track_id WHERE t.user_id = ?', [id]),
      one('SELECT COUNT(*) n FROM notes WHERE user_id = ?', [id]),
      one('SELECT COUNT(*) n FROM tasks WHERE assignee_id = ?', [id]),
      one('SELECT COUNT(*) n FROM task_boards WHERE owner_id = ?', [id]),
    ]).then(([tracks, records, notes, tasks, boards]) => ({ tracks, records, notes, tasks, boards })),
    listDevices(id),
    listActivity(id, { from, to, limit: 300 }),
    query(
      `SELECT e.uuid, e.kind, e.device, e.os, (e.photo IS NOT NULL) AS has_photo, e.created_at, d.name AS device_name
         FROM system_events e LEFT JOIN desktop_devices d ON d.id = e.device_id
        WHERE e.user_id = ? ORDER BY e.created_at DESC LIMIT 50`,
      [id]
    ),
    query('SELECT uuid, kind, source, ip, user_agent, (photo IS NOT NULL) AS has_photo, created_at FROM login_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [id]).catch(() => []),
    owner ? latestShots(owner, 8) : [],
    owner ? trackerSwitch(owner) : { enabled: false },
    owner ? trackerStatus(owner) : null,
    owner ? dayCounts(owner) : [],
  ]);
  return NextResponse.json({
    user: { ...account, is_admin: Boolean(account.is_admin), app_lock: Boolean(account.app_lock), privacy_password: Boolean(account.privacy_password) },
    counts,
    devices,
    commands: COMMANDS,
    screenshots: { enabled: power.enabled, since: power.since || null, status, latest: shots, days: shotDays },
    system,
    logins,
    activity,
    range: { from, to, days },
  });
});

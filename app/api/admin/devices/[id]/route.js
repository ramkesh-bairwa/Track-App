import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { withApiErrors } from '@/lib/apiError';
import { requireAdmin, shotOwner, setTrackerSwitch } from '@/lib/screenshots';
import { COMMANDS, cleanSettings, deviceSettings, queueCommand, listDevices } from '@/lib/agent';
import { recordActivity } from '@/lib/activityLog';

export const dynamic = 'force-dynamic';

// Control one desktop app (it picks changes up within a minute):
//   { settings: { systemPhotos?, screenshotMinutes? } }
//   { screenshots: true | false }   — the person's screenshot switch
//   { command: 'screenshot_now' | 'sync_now' | 'lock' | 'sign_out' }
//   { revoke: true }                — disconnect it from the server
export const PATCH = withApiErrors(async (request, { params }) => {
  const { user, error } = await requireAdmin();
  if (error) return error;
  const [device] = await query('SELECT * FROM desktop_devices WHERE id = ?', [Number(params.id) || 0]);
  if (!device) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const owner = await shotOwner(device.user_id);
  const done = [];

  if (body.settings) {
    const next = { ...deviceSettings(device), ...cleanSettings(body.settings) };
    await query('UPDATE desktop_devices SET settings = ? WHERE id = ?', [JSON.stringify(next), device.id]);
    done.push('changed settings');
  }
  if (typeof body.screenshots === 'boolean' && owner) {
    await setTrackerSwitch(owner, body.screenshots, user.name);
    done.push(`turned screenshots ${body.screenshots ? 'on' : 'off'}`);
  }
  if (body.command) {
    if (!COMMANDS[body.command]) return NextResponse.json({ error: 'Unknown command.' }, { status: 400 });
    await queueCommand(device.id, body.command, user.name);
    done.push(COMMANDS[body.command].toLowerCase());
  }
  if (typeof body.revoke === 'boolean') {
    await query(`UPDATE desktop_devices SET revoked_at = ${body.revoke ? 'NOW()' : 'NULL'} WHERE id = ?`, [device.id]);
    done.push(body.revoke ? 'disconnected it' : 'reconnected it');
  }
  if (done.length && owner) {
    await recordActivity(user.id, {
      kind: 'user',
      action: 'edited',
      summary: `Desktop app “${device.name || 'computer'}” of ${owner.name}: ${done.join(', ')}`,
      url: `/dashboard/users/${owner.id}`,
    });
  }
  const [updated] = await listDevices(device.user_id).then((list) => list.filter((d) => d.id === device.id));
  return NextResponse.json({ device: updated });
});

// Forget a desktop app completely (it has to sign in again to sync).
export const DELETE = withApiErrors(async (request, { params }) => {
  const { error } = await requireAdmin();
  if (error) return error;
  await query('DELETE FROM desktop_devices WHERE id = ?', [Number(params.id) || 0]);
  return NextResponse.json({ ok: true });
});

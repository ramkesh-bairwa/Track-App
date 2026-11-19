import { NextResponse } from 'next/server';
import { withApiErrors } from '@/lib/apiError';
import { requireDevice, touchDevice, takeCommands, deviceSettings } from '@/lib/agent';
import { shotOwner, trackerSwitch, writeTrackerStatus } from '@/lib/screenshots';

export const dynamic = 'force-dynamic';

// Every minute from a linked desktop app: { status, appVersion, os, name }
// in; { settings, commands, user } out. Screenshots on / off is the same
// switch as on this server's Screenshots page.
export const POST = withApiErrors(async (request) => {
  const { device, error } = await requireDevice(request);
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  const clip = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
  const status = body.status && typeof body.status === 'object' ? body.status : null;
  await touchDevice(device, request, {
    status: status ? JSON.stringify(status).slice(0, 4000) : device.status,
    app_version: clip(body.appVersion, 50) || device.app_version,
    os: clip(body.os, 50) || device.os,
    name: clip(body.name, 255) || device.name,
  });
  const owner = await shotOwner(device.user_id);
  if (owner && status?.tracker) await writeTrackerStatus(owner, status.tracker, device.name).catch(() => {});
  const power = owner ? await trackerSwitch(owner) : { enabled: false };
  return NextResponse.json({
    user: { email: device.email, name: device.user_name },
    settings: { ...deviceSettings(device), screenshots: power.enabled },
    commands: await takeCommands(device.id),
    serverTime: new Date().toISOString(),
  });
});

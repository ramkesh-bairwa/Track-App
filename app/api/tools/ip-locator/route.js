import net from 'node:net';
import { NextResponse } from 'next/server';
import { toolRoute, readBody } from '@/lib/toolsServer';
import { locateIp, requesterIp } from '@/lib/tools/ipLocate';
import { isBlockedIp } from '@/lib/downloader/netguard';

export const dynamic = 'force-dynamic';

// POST { ip } → its approximate location.
// - A public IP is looked up directly.
// - A private one (a phone or laptop's Wi‑Fi address, 192.168.x.x etc.) has no
//   location of its own: the internet only sees the network's public IP. If the
//   device shares MyTrack's network, that's this server's public IP, so we look
//   that up and flag the answer as `localNetwork`.
// - No ip → the caller (their address as seen here, or this server's when local).
export const POST = toolRoute(async (request) => {
  const body = await readBody(request);
  const typed = typeof body?.ip === 'string' ? body.ip.trim().replace(/^\[|\]$/g, '') : '';
  if (typed && net.isIP(typed) && isBlockedIp(typed)) {
    const result = await locateIp(null, { signal: request.signal });
    return NextResponse.json({ ...result, localNetwork: { typed, loopback: /^127\.|^::1$/.test(typed) } });
  }
  if (typed) return NextResponse.json(await locateIp(typed, { signal: request.signal }));
  const seen = requesterIp(request);
  const ip = seen && !isBlockedIp(seen) ? seen : null;
  return NextResponse.json({ ...(await locateIp(ip, { signal: request.signal })), self: true });
});

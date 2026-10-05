// IP Locator: the approximate place an IP address is registered to, from
// ipwho.is (free, no key). IP geolocation is city-level at best — often just
// the ISP's hub — so the coordinates are an estimate, not a GPS fix.
import net from 'node:net';
import { HttpError, safeFetch, withTimeout } from '@/lib/toolsServer';
import { isBlockedIp } from '@/lib/downloader/netguard';

const LOOKUP_TIMEOUT_MS = 10000;

// The caller's address as seen by this server (first hop of X-Forwarded-For when proxied).
export function requesterIp(request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || request.headers.get('x-real-ip')?.trim() || '';
  return net.isIP(ip) ? ip.replace(/^::ffff:(?=\d+\.)/i, '') : null;
}

// Looks up `ip`, or this server's own public address when `ip` is null.
export async function locateIp(ip, { signal } = {}) {
  if (ip != null) {
    if (!net.isIP(ip)) throw new HttpError(400, 'BAD_IP', 'That isn’t a valid IPv4 or IPv6 address.');
    if (isBlockedIp(ip)) {
      throw new HttpError(400, 'PRIVATE_IP', `${ip} is a private or local network address, so it has no public location.`);
    }
  }
  let json;
  try {
    const { res } = await safeFetch(`https://ipwho.is/${ip ? encodeURIComponent(ip) : ''}`, {
      signal: withTimeout(signal, LOOKUP_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (res.status === 429) throw new HttpError(429, 'RATE_LIMITED', 'The location service is rate-limiting requests — try again in a minute.');
    json = await res.json();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') throw new HttpError(504, 'TIMEOUT', 'The location service took too long to answer.');
    throw new HttpError(502, 'LOOKUP_FAILED', 'Couldn’t reach the location service.');
  }
  if (!json?.success) {
    throw new HttpError(422, 'NOT_FOUND', json?.message ? `No location for that address: ${json.message}` : 'No location found for that address.');
  }
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    ip: json.ip,
    type: json.type || null,
    latitude: num(json.latitude),
    longitude: num(json.longitude),
    city: json.city || null,
    region: json.region || null,
    postal: json.postal || null,
    country: json.country || null,
    countryCode: json.country_code || null,
    flag: json.flag?.emoji || null,
    continent: json.continent || null,
    timezone: json.timezone?.id || null,
    utcOffset: json.timezone?.utc || null,
    isp: json.connection?.isp || null,
    org: json.connection?.org || null,
    asn: json.connection?.asn ?? null,
  };
}

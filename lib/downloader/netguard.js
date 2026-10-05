import dns from 'node:dns/promises';
import net from 'node:net';
import { config } from './config';
import { HttpError, badRequest } from './errors';

const blocked = new net.BlockList();
for (const [ip, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
]) blocked.addSubnet(ip, prefix, 'ipv4');
blocked.addAddress('::', 'ipv6');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');

export function isBlockedIp(ip) {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  return blocked.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
}

export function parseHttpUrl(raw, field = 'url') {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw badRequest(`"${field}" must be a valid URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badRequest(`"${field}" must be an http or https URL`);
  }
  return url;
}

async function assertPublicHost(url) {
  if (config.allowPrivateUrls) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await dns.lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new HttpError(400, 'DNS_ERROR', `Could not resolve host "${host}"`);
    }
  }
  if (addresses.some(isBlockedIp)) {
    throw new HttpError(403, 'BLOCKED_URL', 'URLs pointing to local or private networks are not allowed');
  }
}

// fetch() that re-checks every redirect hop, so a public URL can't bounce the server onto its own network.
// `redirects` lists the hops followed: [{ url, status }] (the URL that answered with that redirect).
export async function safeFetch(input, { signal, headers = {}, maxRedirects = 5, method = 'GET' } = {}) {
  let url = input instanceof URL ? input : parseHttpUrl(input);
  const redirects = [];
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHost(url);
    const res = await fetch(url, {
      method,
      headers: { 'User-Agent': config.userAgent, ...headers },
      redirect: 'manual',
      signal,
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      redirects.push({ url: url.href, status: res.status });
      url = parseHttpUrl(new URL(location, url).href);
      continue;
    }
    return { res, finalUrl: url.href, redirects };
  }
  throw new HttpError(502, 'TOO_MANY_REDIRECTS', `More than ${maxRedirects} redirects`);
}

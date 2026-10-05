// Deep, multi-phase READ-ONLY security posture check for a public URL
// (server-side only). It performs a small number of ordinary GETs (the page,
// plus standard public files like robots.txt / security.txt) and one TLS
// handshake, then inspects what a normal browser already receives.
//
// It sends NO attack payloads — no XSS/SQLi/fuzzing, no probing for sensitive
// files, no auth attempts. It reports observable configuration in phases so
// you can harden sites you own. An SSRF guard blocks private/internal targets.
import dns from 'dns';
import net from 'net';
import tls from 'tls';

const SEV = { HIGH: 'HIGH', MED: 'MEDIUM', LOW: 'LOW', INFO: 'INFO' };

export const PHASES = [
  { id: 'reach', label: 'Phase 1 · Reachability & redirects' },
  { id: 'tls', label: 'Phase 2 · HTTPS & TLS' },
  { id: 'headers', label: 'Phase 3 · Security headers' },
  { id: 'csp', label: 'Phase 4 · Content-Security-Policy' },
  { id: 'cookies', label: 'Phase 5 · Cookies' },
  { id: 'cors', label: 'Phase 6 · CORS & cross-origin' },
  { id: 'info', label: 'Phase 7 · Information exposure' },
  { id: 'html', label: 'Phase 8 · Page hygiene (HTML)' },
  { id: 'wellknown', label: 'Phase 9 · Well-known files' },
];

// ---------- SSRF guard ----------
function ipInt(ip) {
  return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}
function v4Private(ip) {
  const n = ipInt(ip);
  const inR = (a, b) => n >= ipInt(a) && n <= ipInt(b);
  return (
    inR('10.0.0.0', '10.255.255.255') || inR('172.16.0.0', '172.31.255.255') || inR('192.168.0.0', '192.168.255.255') ||
    inR('127.0.0.0', '127.255.255.255') || inR('169.254.0.0', '169.254.255.255') || inR('100.64.0.0', '100.127.255.255') ||
    inR('0.0.0.0', '0.255.255.255') || inR('192.0.2.0', '192.0.2.255') || n === ipInt('255.255.255.255')
  );
}
function v6Private(ip) {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (s === '::1' || s === '::') return true;
  if (s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd')) return true;
  const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return v4Private(m[1]);
  return false;
}
export function isPrivateIP(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) return v4Private(ip);
  if (fam === 6) return v6Private(ip);
  return true;
}
export async function assertPublicUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('That is not a valid URL. Include http:// or https://');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http:// and https:// URLs can be checked.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new Error('Internal/loopback hosts are not allowed.');
  let addrs;
  if (net.isIP(host)) addrs = [{ address: host }];
  else {
    try {
      addrs = await dns.promises.lookup(host, { all: true });
    } catch {
      throw new Error(`Could not resolve ${host}.`);
    }
  }
  for (const a of addrs) if (isPrivateIP(a.address)) throw new Error('That host resolves to a private/internal address, which is not allowed.');
  return u;
}

function tlsInfo(host, port = 443) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, ALPNProtocols: ['h2', 'http/1.1'] }, () => {
      const cert = socket.getPeerCertificate();
      let daysLeft = null;
      if (cert?.valid_to) daysLeft = Math.round((new Date(cert.valid_to).getTime() - Date.now()) / 86400000);
      finish({
        protocol: socket.getProtocol(),
        authorized: socket.authorized,
        authError: socket.authorizationError ? String(socket.authorizationError) : null,
        alpn: socket.alpnProtocol || null,
        issuer: cert?.issuer?.O || cert?.issuer?.CN || null,
        subject: cert?.subject?.CN || null,
        validTo: cert?.valid_to || null,
        daysLeft,
      });
      socket.end();
    });
    socket.setTimeout(8000, () => {
      finish({ error: 'TLS handshake timed out' });
      socket.destroy();
    });
    socket.on('error', (e) => finish({ error: e.message }));
  });
}

const UA = 'MyTrack-PostureCheck/1.0 (read-only header check)';

async function fetchFollow(u, max = 6) {
  const chain = [];
  let current = u;
  for (let i = 0; i <= max; i++) {
    await assertPublicUrl(current.href);
    const res = await fetch(current.href, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, signal: AbortSignal.timeout(12000) });
    chain.push({ url: current.href, status: res.status });
    const loc = res.headers.get('location');
    if ([301, 302, 303, 307, 308].includes(res.status) && loc && i < max) {
      current = new URL(loc, current);
      continue;
    }
    return { res, chain, finalUrl: current };
  }
  throw new Error('Too many redirects.');
}

// A single read-only GET of a standard public path (same origin, SSRF-guarded).
async function probe(origin, path) {
  try {
    const url = new URL(path, origin).href;
    await assertPublicUrl(url);
    const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    return { status: res.status, type: res.headers.get('content-type') || '' };
  } catch {
    return { status: 0, type: '' };
  }
}

function parseCsp(csp) {
  const map = {};
  for (const part of csp.split(';')) {
    const [name, ...vals] = part.trim().split(/\s+/);
    if (name) map[name.toLowerCase()] = vals.map((v) => v.toLowerCase());
  }
  return map;
}

export async function checkUrl(raw) {
  const u = await assertPublicUrl(raw);
  const { res, chain, finalUrl } = await fetchFollow(u);
  const h = (k) => res.headers.get(k);
  const https = finalUrl.protocol === 'https:';
  const findings = [];
  // add(phase, name, ok, severity, detail, fix, impact)
  const add = (phase, name, ok, severity, detail, fix, impact) => findings.push({ phase, name, ok, severity, detail, fix: fix || '', impact: impact || '' });

  // ---------- Phase 1: reachability & redirects ----------
  add('reach', 'Site is reachable', res.status < 500, res.status < 500 ? SEV.INFO : SEV.HIGH,
    `final status ${res.status}${chain.length > 1 ? ` after ${chain.length - 1} redirect(s)` : ''}`,
    'ensure the server returns a normal 2xx/3xx response', 'A 5xx or unreachable site can’t be assessed and may be down for users.');
  if (chain.length > 1) {
    add('reach', 'Redirect chain is short', chain.length <= 4, chain.length <= 4 ? SEV.INFO : SEV.LOW,
      chain.map((c) => `${c.status}→`).join('') + finalUrl.href.replace(/^https?:\/\//, ''),
      'reduce the number of redirects', 'Long redirect chains slow first load and each hop is a place traffic can be intercepted or mis-set.');
  }
  add('reach', 'Final URL is canonical', true, SEV.INFO, `landed on ${finalUrl.href}`, '', '');

  // ---------- Phase 2: HTTPS & TLS ----------
  add('tls', 'Served over HTTPS', https, SEV.HIGH,
    https ? 'final URL is https' : 'final URL is http:// — traffic is unencrypted and tamperable',
    'serve the whole site over HTTPS and redirect http → https',
    'On plain HTTP anyone on the network can read or alter the page and capture logins and session cookies.');
  if (u.protocol === 'http:') {
    const upgraded = chain.some((c) => c.url.startsWith('https://')) || https;
    add('tls', 'HTTP redirects to HTTPS', upgraded, SEV.MED, upgraded ? 'http was upgraded to https' : 'http:// served without redirecting to https',
      'add a 301 redirect from http to https', 'A visitor reaching the http address stays unencrypted for that request, exposing it to interception.');
  }
  let tlsData = null;
  if (https) {
    tlsData = await tlsInfo(finalUrl.hostname, Number(finalUrl.port) || 443);
    if (tlsData.error) {
      add('tls', 'TLS handshake', false, SEV.MED, `could not complete: ${tlsData.error}`, 'check the TLS configuration / firewall', '');
    } else {
      const modern = tlsData.protocol && !['TLSv1', 'TLSv1.1', 'SSLv3'].includes(tlsData.protocol);
      add('tls', 'Modern TLS version', modern, SEV.HIGH, modern ? `negotiated ${tlsData.protocol}` : `negotiated ${tlsData.protocol} — deprecated`,
        'disable TLS 1.0/1.1; require TLS 1.2+ (prefer 1.3)', 'Old TLS versions have known weaknesses that can let an attacker decrypt or tamper with traffic.');
      add('tls', 'Certificate is trusted', tlsData.authorized, SEV.HIGH, tlsData.authorized ? `valid chain (issuer ${tlsData.issuer || 'unknown'})` : `not trusted: ${tlsData.authError || 'unknown'}`,
        'install a valid certificate from a trusted CA', 'An untrusted/invalid certificate lets an attacker present their own and impersonate the site (MITM).');
      if (tlsData.daysLeft != null) {
        add('tls', 'Certificate not expiring soon', tlsData.daysLeft > 14, tlsData.daysLeft <= 0 ? SEV.HIGH : SEV.MED,
          tlsData.daysLeft <= 0 ? `EXPIRED ${-tlsData.daysLeft} day(s) ago` : `expires in ${tlsData.daysLeft} day(s) (${tlsData.validTo})`,
          'renew and enable auto-renewal (e.g. Let’s Encrypt)', 'An expired certificate breaks the site for visitors and trains them to click through security warnings.');
      }
      add('tls', 'HTTP/2 or HTTP/3 (ALPN)', tlsData.alpn === 'h2' || tlsData.alpn === 'h3', SEV.INFO,
        tlsData.alpn ? `negotiated ${tlsData.alpn}` : 'HTTP/1.1 only', 'enable HTTP/2 for performance', '');
    }
    const hsts = h('strict-transport-security');
    const maxAge = hsts && Number((hsts.match(/max-age=(\d+)/i) || [])[1] || 0);
    add('tls', 'HSTS (Strict-Transport-Security)', Boolean(hsts) && maxAge >= 15552000, SEV.MED,
      hsts ? `present (max-age=${maxAge})` : 'missing — first visit can be downgraded to http',
      'add Strict-Transport-Security: max-age=31536000; includeSubDomains', 'Without HSTS the first visit can be silently downgraded to http and hijacked (SSL-strip).');
    if (hsts) {
      add('tls', 'HSTS includeSubDomains', /includeSubDomains/i.test(hsts), SEV.LOW, /includeSubDomains/i.test(hsts) ? 'present' : 'missing',
        'add includeSubDomains', 'Sub-domains without it can still be downgraded and used to set/read cookies for the parent domain.');
      add('tls', 'HSTS preload', /preload/i.test(hsts), SEV.INFO, /preload/i.test(hsts) ? 'present' : 'not preloaded',
        'add preload and submit to hstspreload.org', '');
    }
  }

  // ---------- Phase 3: security headers ----------
  const csp = h('content-security-policy');
  add('headers', 'Clickjacking protection', Boolean(h('x-frame-options') || (csp || '').includes('frame-ancestors')), SEV.MED,
    h('x-frame-options') || (csp || '').includes('frame-ancestors') ? 'present' : 'missing — page can be framed for clickjacking',
    "X-Frame-Options: DENY or CSP frame-ancestors 'none'", 'The page can be loaded invisibly in a frame on a malicious site to trick users into clicking hidden actions.');
  add('headers', 'X-Content-Type-Options: nosniff', (h('x-content-type-options') || '').toLowerCase() === 'nosniff', SEV.LOW,
    (h('x-content-type-options') || '').toLowerCase() === 'nosniff' ? 'present' : 'missing',
    'add X-Content-Type-Options: nosniff', 'Browsers may guess a response is script/HTML and execute it, turning an upload or text endpoint into code execution.');
  add('headers', 'Referrer-Policy', Boolean(h('referrer-policy')), SEV.LOW, h('referrer-policy') ? `present (${h('referrer-policy')})` : 'missing',
    'add Referrer-Policy: strict-origin-when-cross-origin', 'Full URLs — which can contain tokens or ids — leak to third-party sites via the Referer header.');
  add('headers', 'Permissions-Policy', Boolean(h('permissions-policy') || h('feature-policy')), SEV.INFO, h('permissions-policy') ? 'present' : 'missing',
    'add a Permissions-Policy to disable unused features', 'Embedded/third-party code can reach camera, microphone or geolocation the site never meant to expose.');
  add('headers', 'Cross-Origin-Opener-Policy', Boolean(h('cross-origin-opener-policy')), SEV.INFO, h('cross-origin-opener-policy') ? `present (${h('cross-origin-opener-policy')})` : 'missing',
    'add Cross-Origin-Opener-Policy: same-origin', 'COOP isolates the page from other windows, mitigating cross-window attacks (e.g. Spectre, tab-nabbing).');
  if ((h('x-xss-protection') || '').startsWith('1')) {
    add('headers', 'Legacy X-XSS-Protection disabled', false, SEV.LOW, `set to "${h('x-xss-protection')}" — the legacy filter can introduce bugs`,
      'set X-XSS-Protection: 0 and rely on CSP', 'The deprecated XSS auditor has itself caused vulnerabilities; modern guidance is to disable it and use CSP.');
  }

  // ---------- Phase 4: Content-Security-Policy ----------
  add('csp', 'Content-Security-Policy present', Boolean(csp), SEV.MED, csp ? 'present' : 'missing — no defense-in-depth if XSS slips through',
    "add a Content-Security-Policy (start with default-src 'self')", 'With no CSP, any injected script (stored/reflected XSS) runs with full access to the page, its data and cookies.');
  if (csp) {
    const d = parseCsp(csp);
    const scriptSrc = d['script-src'] || d['default-src'] || [];
    add('csp', "script-src avoids 'unsafe-inline'", !scriptSrc.includes("'unsafe-inline'"), SEV.MED,
      scriptSrc.includes("'unsafe-inline'") ? "'unsafe-inline' present — inline scripts are allowed" : "no 'unsafe-inline'",
      "drop 'unsafe-inline'; use nonces or hashes", "'unsafe-inline' lets injected inline scripts run, which largely defeats the point of a CSP.");
    add('csp', "script-src avoids 'unsafe-eval'", !scriptSrc.includes("'unsafe-eval'"), SEV.LOW,
      scriptSrc.includes("'unsafe-eval'") ? "'unsafe-eval' present" : "no 'unsafe-eval'", "remove 'unsafe-eval'", "'unsafe-eval' allows eval()/new Function, expanding what injected code can do.");
    add('csp', 'script-src is not a wildcard', !scriptSrc.includes('*') && !scriptSrc.includes('https:'), SEV.MED,
      scriptSrc.includes('*') || scriptSrc.includes('https:') ? 'allows scripts from any host (* or https:)' : 'restricted to specific hosts',
      'list only the exact script origins you use', 'A wildcard script source lets an attacker load malicious scripts from any domain they control.');
    add('csp', "object-src 'none'", (d['object-src'] || d['default-src'] || []).includes("'none'"), SEV.LOW,
      (d['object-src'] || []).includes("'none'") ? "present" : "not set to 'none'", "add object-src 'none'", 'Blocks legacy plugin/embed vectors (Flash/Java) that can bypass other protections.');
    add('csp', 'base-uri is restricted', Boolean(d['base-uri']), SEV.LOW, d['base-uri'] ? `set to ${d['base-uri'].join(' ')}` : 'not set',
      "add base-uri 'self'", 'Without base-uri, an injected <base> tag can redirect every relative URL (scripts, forms) to an attacker.');
    add('csp', 'Blocks framing (frame-ancestors)', Boolean(d['frame-ancestors']), SEV.INFO, d['frame-ancestors'] ? `set to ${d['frame-ancestors'].join(' ')}` : 'not set',
      "add frame-ancestors 'none' (or your own origins)", 'frame-ancestors is the modern clickjacking control and covers browsers that ignore X-Frame-Options.');
  }

  // ---------- Phase 5: cookies ----------
  const cookies = res.headers.getSetCookie?.() || (h('set-cookie') ? [h('set-cookie')] : []);
  if (!cookies.length) {
    add('cookies', 'Cookies set on this response', true, SEV.INFO, 'no Set-Cookie on this page', '', '');
  } else {
    for (const c of cookies.slice(0, 12)) {
      const name = c.split('=')[0];
      const flags = [];
      if (!/httponly/i.test(c)) flags.push('HttpOnly');
      if (!/secure/i.test(c)) flags.push('Secure');
      if (!/samesite/i.test(c)) flags.push('SameSite');
      add('cookies', `Cookie "${name}" hardened`, flags.length === 0, flags.includes('HttpOnly') ? SEV.MED : SEV.LOW,
        flags.length ? `missing ${flags.join(', ')}` : 'HttpOnly + Secure + SameSite all set',
        'set HttpOnly, Secure and SameSite on cookies',
        'Missing HttpOnly lets XSS steal the cookie; missing Secure sends it over http; missing SameSite enables CSRF.');
      if (/samesite=none/i.test(c) && !/secure/i.test(c)) {
        add('cookies', `Cookie "${name}" SameSite=None is Secure`, false, SEV.MED, 'SameSite=None without Secure — browsers reject it',
          'add Secure whenever SameSite=None', 'A SameSite=None cookie without Secure is dropped by modern browsers, breaking sessions.');
      }
    }
  }

  // ---------- Phase 6: CORS & cross-origin ----------
  const acao = h('access-control-allow-origin');
  if (!acao) {
    add('cors', 'No permissive CORS on this page', true, SEV.INFO, 'no Access-Control-Allow-Origin header', '', '');
  } else {
    const creds = (h('access-control-allow-credentials') || '').toLowerCase() === 'true';
    add('cors', 'CORS not open to any origin with credentials', !(acao === '*' && creds), SEV.MED,
      acao === '*' ? `Access-Control-Allow-Origin: *${creds ? ' WITH credentials — dangerous' : ' (no credentials)'}` : `restricted to ${acao}`,
      'echo only allow-listed origins; never combine * with credentials',
      'ACAO:* with credentials lets any website read this site’s authenticated responses on a logged-in user’s behalf.');
  }

  // ---------- Phase 7: information exposure ----------
  const leakHeaders = ['server', 'x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version', 'x-generator', 'x-runtime', 'via'];
  const leaks = leakHeaders.map((k) => (h(k) ? `${k}: ${h(k)}` : null)).filter(Boolean);
  add('info', 'No version/tech disclosure headers', leaks.length === 0, SEV.INFO, leaks.length ? `reveals ${leaks.join('; ')}` : 'no obvious version headers',
    'remove or obfuscate Server, X-Powered-By and version headers', 'Advertising exact software versions helps an attacker look up known exploits for that version.');

  // ---------- Phase 8: page hygiene (HTML) ----------
  let body = '';
  if ((h('content-type') || '').includes('text/html')) {
    try {
      body = (await res.clone?.().text?.())?.slice(0, 800000) || '';
    } catch {
      body = '';
    }
  }
  if (body) {
    const mixed = https ? (body.match(/\b(?:src|href)\s*=\s*["']http:\/\//gi) || []).length : 0;
    if (https) add('html', 'No mixed content', mixed === 0, SEV.MED, mixed === 0 ? 'no http:// resources referenced' : `${mixed} http:// resource reference(s) on an https page`,
      'load all sub-resources over https', 'http sub-resources on an https page can be swapped by a network attacker and are blocked by browsers, breaking the page.');
    const httpForms = (body.match(/<form[^>]+action\s*=\s*["']http:\/\//gi) || []).length;
    add('html', 'No forms submitting over http', httpForms === 0, SEV.HIGH, httpForms === 0 ? 'no insecure form actions found' : `${httpForms} form(s) post to an http:// URL`,
      'point every form action at an https URL', 'A form that posts over http sends everything the user typed — including passwords — in clear text.');
    const blankNoOpener = (body.match(/target\s*=\s*["']_blank["'][^>]*>/gi) || []).filter((t) => !/rel\s*=\s*["'][^"']*noopener/i.test(t)).length;
    add('html', 'target="_blank" links use rel=noopener', blankNoOpener === 0, SEV.LOW, blankNoOpener === 0 ? 'external new-tab links are safe' : `${blankNoOpener} link(s) open a new tab without rel="noopener"`,
      'add rel="noopener noreferrer" to target="_blank" links', 'Without noopener the opened page can control your tab via window.opener (reverse tab-nabbing / phishing).');
    const extScripts = (body.match(/<script[^>]+src\s*=\s*["']https?:\/\//gi) || []);
    const noSri = extScripts.filter((s) => !/integrity\s*=/i.test(s)).length;
    add('html', 'External scripts use Subresource Integrity', extScripts.length === 0 || noSri === 0, SEV.INFO,
      extScripts.length === 0 ? 'no external scripts' : noSri === 0 ? 'all external scripts have integrity hashes' : `${noSri} external <script> without integrity=`,
      'add integrity="sha384-…" and crossorigin to third-party scripts', 'Without SRI, a compromised CDN can serve altered JavaScript that runs on your page.');
    add('html', 'Charset declared', /<meta[^>]+charset/i.test(body) || (h('content-type') || '').includes('charset='), SEV.INFO,
      /<meta[^>]+charset/i.test(body) || (h('content-type') || '').includes('charset=') ? 'charset declared' : 'no charset declared',
      'declare <meta charset="utf-8"> early in <head>', 'An undeclared charset can enable certain XSS encoding tricks in older browsers.');
  }

  // ---------- Phase 9: well-known files ----------
  const origin = finalUrl.origin;
  const robots = await probe(origin, '/robots.txt');
  add('wellknown', 'robots.txt present', robots.status >= 200 && robots.status < 400, SEV.INFO,
    robots.status >= 200 && robots.status < 400 ? 'served' : `not found (${robots.status || 'no response'})`,
    'add a robots.txt', 'Not a vulnerability — a well-formed robots.txt is a hygiene signal (and shouldn’t list secret paths).');
  const secTxt = await probe(origin, '/.well-known/security.txt');
  add('wellknown', 'security.txt present', secTxt.status >= 200 && secTxt.status < 400, SEV.LOW,
    secTxt.status >= 200 && secTxt.status < 400 ? 'served — reporters know how to reach you' : 'missing — no documented way to report a vulnerability',
    'add /.well-known/security.txt with a contact', 'security.txt gives ethical reporters a clear channel, so issues reach you instead of going public.');
  const sitemap = await probe(origin, '/sitemap.xml');
  add('wellknown', 'sitemap.xml present', sitemap.status >= 200 && sitemap.status < 400, SEV.INFO,
    sitemap.status >= 200 && sitemap.status < 400 ? 'served' : 'not found', 'add a sitemap.xml (optional)', '');

  // ---------- summarize ----------
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2, INFO: 3 };
  const passed = findings.filter((f) => f.ok).length;
  const fails = findings.filter((f) => !f.ok).sort((a, b) => order[a.severity] - order[b.severity]);
  const phaseStats = PHASES.map((p) => {
    const items = findings.filter((f) => f.phase === p.id);
    return { id: p.id, label: p.label, total: items.length, passed: items.filter((f) => f.ok).length, failed: items.filter((f) => !f.ok).length };
  }).filter((p) => p.total > 0);

  return {
    url: raw,
    finalUrl: finalUrl.href,
    redirects: chain,
    https,
    tls: tlsData,
    server: h('server') || null,
    findings,
    phases: phaseStats,
    summary: { total: findings.length, passed, failed: fails.length, fails },
  };
}

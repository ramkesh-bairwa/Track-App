// Server-side security self-test suite for YOUR OWN MyTrack instance.
// Pure HTTP probes against `base` (the app's own origin). It creates two
// throwaway accounts, records what the app does against common web attacks,
// and returns results. The caller removes the throwaway accounts afterwards
// (by the returned `tag`). Used by both the /api/security-test route and
// scripts/security-test.mjs, so there is one source of truth.

import { SEV, SEV_ORDER, CATS, BROWSER_CATS, CAT_LABELS, INJECTION_CHEATSHEET } from './securityMeta.js';

export { SEV, SEV_ORDER, CATS, BROWSER_CATS, CAT_LABELS, INJECTION_CHEATSHEET };

// Login requires a camera photo; the suite sends a placeholder so it can reach
// the password/rate-limit logic behind that check.
const TEST_PHOTO = 'data:image/jpeg;base64,' + 'A'.repeat(1400);

export async function runSuite({ base, categories = [], fetchImpl = fetch, ratelimitAttempts = 20 }) {
  base = base.replace(/\/$/, '');
  const tag = `sectest-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const results = [];
  const wants = (c) => categories.length === 0 || categories.includes(c);

  const makeJar = () => ({ cookie: '' });
  async function http(method, url, { jar, body, headers = {} } = {}) {
    const res = await fetchImpl(base + url, {
      method,
      redirect: 'manual',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(jar?.cookie ? { Cookie: jar.cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    if (jar) {
      const sc = res.headers.getSetCookie?.() || (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
      for (const c of sc) {
        const [pair] = c.split(';');
        if (pair.split('=')[0].trim() === 'mytrack_session') jar.cookie = pair.trim();
      }
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* html / not json */
    }
    return { res, status: res.status, json, text, setCookie: res.headers.getSetCookie?.() || [] };
  }
  const register = async (jar, name) => {
    const email = `${tag}-${name}@example.test`;
    const r = await http('POST', '/api/auth/register', { jar, body: { name: `SecTest ${name}`, email, password: 'Passw0rd!sec' } });
    return { email, ok: r.status === 200 };
  };
  const check = (cat, name, passed, severity, detailPass, detailFail, howToInject) =>
    results.push({ cat, name, ok: passed, severity, detail: passed ? detailPass : detailFail, howToInject });

  const attacker = makeJar();
  const victim = makeJar();
  const a = await register(attacker, 'attacker');
  const v = await register(victim, 'victim');
  if (!a.ok || !v.ok) {
    return { results, tag, error: 'Could not create throwaway accounts — is the database migrated and reachable?' };
  }

  // ---- AUTH ----
  if (wants('auth')) {
    const noAuth = makeJar();
    for (const [method, url] of [
      ['GET', '/api/tracks'],
      ['GET', '/api/task-boards'],
      ['GET', '/api/code'],
      ['GET', '/api/users'],
      ['POST', '/api/notes'],
    ]) {
      const r = await http(method, url, { jar: noAuth, body: method === 'POST' ? {} : undefined });
      check('auth', `${method} ${url} rejects no session`, r.status === 401, SEV.HIGH, 'returns 401 without a cookie', `returned ${r.status} (expected 401) — may leak data to anonymous callers`, `curl -X ${method} ${base}${url} (no Cookie)`);
    }
    const dash = await http('GET', '/dashboard', { jar: noAuth });
    check('auth', 'GET /dashboard redirects when logged out', dash.status === 307 || dash.status === 302, SEV.MED, 'redirects to /login', `returned ${dash.status} — protected page may render for anonymous users`, `open ${base}/dashboard logged out`);
    const bad = { cookie: 'mytrack_session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.invalidsig' };
    const r = await http('GET', '/api/tracks', { jar: bad });
    check('auth', 'Forged/tampered JWT rejected', r.status === 401, SEV.CRIT, 'invalid signature → 401', `returned ${r.status} — signature may not be verified`, 'send a token with a wrong signature');
    const noneTok = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url') + '.' + Buffer.from('{"sub":"1"}').toString('base64url') + '.';
    const rn = await http('GET', '/api/tracks', { jar: { cookie: `mytrack_session=${noneTok}` } });
    check('auth', 'JWT "alg:none" downgrade rejected', rn.status === 401, SEV.CRIT, 'alg:none → 401', `returned ${rn.status} — unsigned tokens may be accepted`, 'craft a header {"alg":"none"} with empty signature');
  }

  // ---- IDOR ----
  if (wants('idor')) {
    const vt = await http('POST', '/api/tracks', { jar: victim, body: { name: 'victim-track', columns: [{ label: 'Secret', field_type: 'text' }] } });
    const trackId = vt.json?.trackId;
    const vb = await http('POST', '/api/task-boards', { jar: victim, body: { name: 'victim-board' } });
    const boardUuid = vb.json?.uuid;
    const vc = await http('POST', '/api/code', { jar: victim, body: { name: 'victim.js' } });
    const codeUuid = vc.json?.uuid;
    const vme = await http('GET', '/api/auth/me', { jar: victim });
    const victimId = vme.json?.user?.id ?? vme.json?.id;

    if (trackId) {
      const r1 = await http('GET', `/api/tracks/${trackId}`, { jar: attacker });
      check('idor', "Read another user's track", r1.status === 404 || r1.status === 403, SEV.HIGH, `blocked (${r1.status})`, `returned ${r1.status} with data`, `GET /api/tracks/<id> as a different user`);
      const r2 = await http('PATCH', `/api/tracks/${trackId}`, { jar: attacker, body: { name: 'hacked' } });
      check('idor', "Edit another user's track", r2.status === 404 || r2.status === 403, SEV.HIGH, `blocked (${r2.status})`, `returned ${r2.status}`, 'PATCH /api/tracks/<id>');
      const r3 = await http('POST', `/api/tracks/${trackId}/entries`, { jar: attacker, body: { data: { secret: 'x' } } });
      check('idor', "Add entry to another user's track", r3.status === 404 || r3.status === 403, SEV.HIGH, `blocked (${r3.status})`, `returned ${r3.status}`, 'POST /api/tracks/<id>/entries');
      const r4 = await http('DELETE', `/api/tracks/${trackId}`, { jar: attacker });
      check('idor', "Delete another user's track", r4.status === 404 || r4.status === 403, SEV.HIGH, `blocked (${r4.status})`, `returned ${r4.status}`, 'DELETE /api/tracks/<id>');
      let leaked = 0;
      for (const g of [1, 2, 3, trackId + 1].filter((n) => n > 0)) {
        const r = await http('GET', `/api/tracks/${g}`, { jar: attacker });
        if (r.status === 200) leaked++;
      }
      check('idor', 'Sequential track-id enumeration', leaked === 0, SEV.MED, "no other user's track returned by guessing ids", `${leaked} track(s) leaked by id guessing`, 'GET /api/tracks/1,2,3…');
    }
    if (boardUuid) {
      const r = await http('GET', `/api/task-boards/${boardUuid}`, { jar: attacker });
      check('idor', "Read another user's task board", r.status === 404 || r.status === 403, SEV.HIGH, `blocked (${r.status})`, `returned ${r.status}`, 'GET /api/task-boards/<uuid>');
      const r2 = await http('POST', `/api/task-boards/${boardUuid}/tasks`, { jar: attacker, body: { title: 'x' } });
      check('idor', "Create task on another user's board", r2.status === 404 || r2.status === 403, SEV.HIGH, `blocked (${r2.status})`, `returned ${r2.status}`, 'POST /api/task-boards/<uuid>/tasks');
    }
    if (codeUuid) {
      const r = await http('GET', `/api/code/${codeUuid}`, { jar: attacker });
      check('idor', "Read another user's saved code", r.status === 404 || r.status === 403, SEV.HIGH, `blocked (${r.status})`, `returned ${r.status}`, 'GET /api/code/<uuid>');
    }
    if (victimId) {
      const r = await http('PATCH', `/api/users/${victimId}`, { jar: attacker, body: { name: 'pwned' } });
      check('idor', "Edit an account you didn't create", r.status === 403 || r.status === 404, SEV.HIGH, `blocked (${r.status})`, `returned ${r.status}`, 'PATCH /api/users/<id>');
    }
  }

  // ---- INJECTION ----
  if (wants('injection')) {
    const inj = await http('POST', '/api/auth/login', { jar: makeJar(), body: { email: "' OR '1'='1' -- ", password: "' OR '1'='1", photo: TEST_PHOTO } });
    check('injection', 'SQLi login bypass', inj.status !== 200, SEV.CRIT, `rejected (${inj.status})`, 'login returned 200 for an injection string — auth bypass!', `POST /api/auth/login {"email":"' OR '1'='1' -- "}`);
    const s1 = await http('GET', `/api/pexels/search?q=${encodeURIComponent("' OR 1=1--")}&page=1`, { jar: attacker });
    check('injection', 'Injection string in search params handled', s1.status !== 500, SEV.MED, `no server error (${s1.status})`, '500 on injection string — unhandled input reaching a query/parse', "GET /api/pexels/search?q=' OR 1=1--");
    const payload = `<img src=x onerror="alert(document.cookie)">XSS${tag}`;
    await http('POST', '/api/tracks', { jar: victim, body: { name: payload, columns: [] } });
    const page = await http('GET', '/dashboard', { jar: victim });
    const raw = page.text.includes('onerror="alert(document.cookie)"') && page.text.includes('<img src=x');
    check('injection', 'Stored XSS via track name', !raw, SEV.HIGH, 'payload is HTML-escaped in the rendered page', 'raw <img onerror> reflected unescaped — stored XSS', 'create a track named <img src=x onerror=alert(1)>');
    const tb = await http('POST', '/api/task-boards', { jar: victim, body: { name: 'xss-board' } });
    if (tb.json?.uuid) {
      await http('POST', `/api/task-boards/${tb.json.uuid}/tasks`, { jar: victim, body: { title: payload } });
      const bp = await http('GET', `/dashboard/tasks/${tb.json.uuid}`, { jar: victim });
      check('injection', 'Stored XSS via task title', !bp.text.includes('onerror="alert(document.cookie)"'), SEV.HIGH, 'task title is HTML-escaped', 'raw onerror reflected — stored XSS', 'create a task titled <img src=x onerror=alert(1)>');
    }
  }

  // ---- SSRF ----
  if (wants('ssrf')) {
    for (const [label, src] of [
      ['loopback', 'http://127.0.0.1:3000/api/auth/me'],
      ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
      ['file scheme', 'file:///etc/passwd'],
      ['host suffix trick', 'https://images.pexels.com.evil.example/x.jpg'],
      ['userinfo trick', 'https://images.pexels.com@169.254.169.254/x.jpg'],
      ['non-image host', 'https://example.com/robots.txt'],
    ]) {
      const r = await http('GET', `/api/pexels/image?src=${encodeURIComponent(src)}`, { jar: attacker });
      check('ssrf', `Image proxy blocks ${label}`, r.status >= 400, SEV.HIGH, `blocked (${r.status})`, `returned ${r.status} — proxy fetched an attacker URL (SSRF)`, `GET /api/pexels/image?src=${src}`);
    }
  }

  // ---- CALENDAR ----
  if (wants('calendar')) {
    const noAuth = await http('GET', '/api/calendar?from=2026-01-01&to=2026-01-31', { jar: makeJar() });
    check('calendar', 'Calendar requires a session', noAuth.status === 401, SEV.HIGH, 'returns 401 without a cookie', `returned ${noAuth.status}`, 'GET /api/calendar with no cookie');

    for (const bad of ["2026-01-01' OR '1'='1", "2026-01-01; DROP TABLE users; --", '2026-13-45', '../../etc']) {
      const r = await http('GET', `/api/calendar?from=${encodeURIComponent(bad)}&to=2026-12-31`, { jar: victim });
      check('calendar', `Date param rejects ${JSON.stringify(bad)}`, r.status === 400, SEV.HIGH, 'rejected as an invalid date (400)', `returned ${r.status} — the value may have reached SQL`, `GET /api/calendar?from=${bad}`);
    }
    const t0 = Date.now();
    const slow = await http('GET', `/api/calendar?from=${encodeURIComponent("2026-01-01' OR SLEEP(3) -- ")}&to=2026-12-31`, { jar: victim });
    check('calendar', 'Time-based blind SQLi (SLEEP) has no effect', Date.now() - t0 < 2500 && slow.status < 500, SEV.CRIT, `answered in ${Date.now() - t0} ms (${slow.status})`, `took ${Date.now() - t0} ms — SLEEP() may have executed`, "from=2026-01-01' OR SLEEP(3) -- ");

    const sqli = "Robert'); DROP TABLE users; -- \" OR \"1\"=\"1";
    const act = await http('POST', '/api/calendar/activities', { jar: victim, body: { activity_date: '2026-01-15', title: sqli, details: '<script>alert(1)</script>' } });
    const list = await http('GET', '/api/calendar?from=2026-01-01&to=2026-01-31', { jar: victim });
    const stored = list.json?.activities?.find((x) => x.id === act.json?.id);
    check('calendar', 'SQLi in activity title is stored as plain text', act.status === 200 && stored?.title === sqli, SEV.CRIT, 'saved and read back exactly as typed — never executed', `create returned ${act.status}; stored value ${JSON.stringify(stored?.title)}`, `POST /api/calendar/activities {"title":"${sqli}"}`);
    const users = await http('GET', '/api/auth/me', { jar: victim });
    check('calendar', 'Database intact after DROP TABLE payload', users.status === 200, SEV.CRIT, 'users table still answers', `GET /api/auth/me returned ${users.status}`, 'check the users table after the payload');

    const lv = await http('POST', '/api/calendar/leaves', { jar: victim, body: { start_date: '2026-01-20', end_date: '2026-01-21', leave_type: 'sick', note: 'victim secret' } });
    if (act.json?.id && lv.json?.id) {
      const peek = await http('GET', '/api/calendar?from=2026-01-01&to=2026-01-31', { jar: attacker });
      const leaked = (peek.json?.activities || []).some((x) => x.id === act.json.id) || (peek.json?.leaves || []).some((x) => x.id === lv.json.id);
      check('calendar', "Another user's calendar is not visible", !leaked, SEV.HIGH, "attacker's range query returned none of the victim's rows", "victim's rows came back to the attacker", 'GET /api/calendar as a different user');
      for (const [m, url, body] of [
        ['PATCH', `/api/calendar/activities/${act.json.id}`, { title: 'hacked' }],
        ['DELETE', `/api/calendar/activities/${act.json.id}`],
        ['PATCH', `/api/calendar/leaves/${lv.json.id}`, { note: 'hacked' }],
        ['DELETE', `/api/calendar/leaves/${lv.json.id}`],
      ]) {
        const r = await http(m, url, { jar: attacker, body });
        check('calendar', `${m} another user's ${url.includes('leaves') ? 'leave' : 'activity'}`, r.status === 404, SEV.HIGH, `blocked (${r.status})`, `returned ${r.status}`, `${m} ${url} as a different user`);
      }
      const inj = await http('DELETE', `/api/calendar/leaves/${encodeURIComponent(`${lv.json.id} OR 1=1`)}`, { jar: attacker });
      check('calendar', 'Id param "1 OR 1=1" does not widen a delete', inj.status === 404, SEV.CRIT, `treated as a bad id (${inj.status})`, `returned ${inj.status}`, 'DELETE /api/calendar/leaves/1%20OR%201=1');
    }
    const mass = await http('POST', '/api/calendar/activities', { jar: attacker, body: { activity_date: '2026-01-16', title: 'x', user_id: 1 } });
    const mine = await http('GET', '/api/calendar?from=2026-01-16&to=2026-01-16', { jar: attacker });
    check('calendar', 'Mass assignment of user_id ignored', mass.status === 200 && (mine.json?.activities || []).some((x) => x.id === mass.json?.id), SEV.HIGH, 'row was created for the caller, not user 1', `created ${mass.status}; not found under the caller`, 'POST /api/calendar/activities {"user_id":1}');
    const bigNote = await http('POST', '/api/calendar/leaves', { jar: attacker, body: { start_date: '2026-02-01', end_date: '2026-02-01', note: 'x'.repeat(100000) } });
    check('calendar', 'Oversized note handled (no 500)', bigNote.status < 500, SEV.LOW, `handled (${bigNote.status})`, `returned ${bigNote.status}`, 'POST a 100 KB leave note');
    const badRange = await http('POST', '/api/calendar/leaves', { jar: attacker, body: { start_date: '2026-03-10', end_date: '2026-03-01' } });
    check('calendar', 'End date before start date rejected', badRange.status === 400, SEV.LOW, 'rejected (400)', `returned ${badRange.status}`, 'POST leave with end < start');
  }

  // ---- IMAGE DOWNLOADER ----
  if (wants('downloader')) {
    const noAuth = await http('GET', '/api/downloader/albums', { jar: makeJar() });
    check('downloader', 'Downloader API requires a session', noAuth.status === 401, SEV.HIGH, 'returns 401 without a cookie', `returned ${noAuth.status}`, 'GET /api/downloader/albums with no cookie');

    for (const [label, url] of [
      ['loopback', 'http://127.0.0.1:3000/api/auth/me'],
      ['localhost name', 'http://localhost:3000/'],
      ['decimal IP 2130706433', 'http://2130706433/'],
      ['IPv4-mapped IPv6', 'http://[::ffff:127.0.0.1]:3000/'],
      ['0.0.0.0', 'http://0.0.0.0:3000/'],
      ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
      ['private LAN', 'http://192.168.1.1/'],
      ['file scheme', 'file:///etc/passwd'],
      ['javascript scheme', 'javascript:alert(1)'],
    ]) {
      const r = await http('POST', '/api/downloader/webpage/scan', { jar: attacker, body: { url } });
      check('downloader', `Page scan blocks ${label}`, r.status >= 400 && r.status < 500, SEV.HIGH, `blocked (${r.status} ${r.json?.error?.code || ''})`, `returned ${r.status} — the server fetched an internal URL (SSRF)`, `POST /api/downloader/webpage/scan {"url":"${url}"}`);
    }
    const job = await http('POST', '/api/downloader/urls/download', { jar: attacker, body: { urls: ['http://127.0.0.1:3000/api/auth/me', 'http://169.254.169.254/latest/meta-data/'] } });
    let saved = null;
    if (job.json?.id) {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const j = await http('GET', `/api/downloader/jobs/${job.json.id}`, { jar: attacker });
        if (['completed', 'failed', 'cancelled'].includes(j.json?.status)) {
          saved = j.json.completed;
          break;
        }
      }
    }
    check('downloader', 'Image-URL download refuses internal addresses', job.status === 400 || saved === 0, SEV.HIGH, job.status === 400 ? 'rejected up front (400)' : 'job ran but saved nothing (every URL blocked)', `saved ${saved} file(s) from internal addresses`, 'POST /api/downloader/urls/download {"urls":["http://127.0.0.1/…"]}');

    for (const p of ['/etc', '/private/etc', '~/../../etc', '~/.ssh', 'relative/dir', '/tmp']) {
      const r = await http('POST', '/api/downloader/paths/check', { jar: attacker, body: { path: p } });
      check('downloader', `Save-to folder rejects ${p}`, r.status === 400 || r.status === 403, SEV.HIGH, `rejected (${r.status} ${r.json?.error?.code || ''})`, `accepted (${r.status}) — files could be written outside the allowed folders`, `POST /api/downloader/paths/check {"path":"${p}"}`);
    }
    const dl = await http('POST', '/api/downloader/urls/download', { jar: attacker, body: { urls: ['https://example.com/x.jpg'], saveTo: '/etc' } });
    check('downloader', 'Download with saveTo=/etc refused before starting', dl.status === 403 || dl.status === 400, SEV.HIGH, `refused (${dl.status})`, `returned ${dl.status}`, 'POST /api/downloader/urls/download {"saveTo":"/etc"}');

    for (const [label, path] of [
      ['album ../', '/api/downloader/albums/..%2F..%2F'],
      ['album .env', '/api/downloader/albums/..%2F.env'],
      ['image ../../.env', '/api/downloader/albums/x/images/..%2F..%2F.env'],
      ['image /etc/passwd', '/api/downloader/albums/x/images/%2Fetc%2Fpasswd'],
      ['unknown external album', '/api/downloader/albums/%40deadbeef00'],
    ]) {
      const r = await http('GET', path, { jar: attacker });
      check('downloader', `Path traversal blocked: ${label}`, r.status === 404 || r.status === 400, SEV.CRIT, `not found (${r.status})`, `returned ${r.status} — a file outside downloads/ may be readable`, `GET ${path}`);
    }
    const crlf = await http('GET', '/api/downloader/albums/x/images/a%0d%0aSet-Cookie%3Apwned%3D1.jpg?download=1', { jar: attacker });
    check('downloader', 'CRLF header injection via file name', !(crlf.setCookie || []).some((c) => c.startsWith('pwned')), SEV.MED, `no injected header (${crlf.status})`, 'response carried an injected Set-Cookie header', 'GET …/images/a%0d%0aSet-Cookie:pwned=1.jpg');
  }

  // ---- UPLOAD ----
  if (wants('upload')) {
    const big = await http('POST', '/api/tracks', { jar: attacker, body: { name: 'iconbomb', icon_type: 'image', icon: 'data:image/png;base64,' + 'A'.repeat(3_000_000), columns: [] } });
    check('upload', 'Oversized icon image rejected', big.status === 400, SEV.LOW, `rejected (${big.status})`, `accepted a ~3MB inline icon (${big.status})`, 'POST /api/tracks with a huge icon data: URL');
    const notImg = await http('POST', '/api/tracks', { jar: attacker, body: { name: 'faketype', icon_type: 'image', icon: 'data:text/html,<script>alert(1)</script>', columns: [] } });
    check('upload', 'Non-image icon data URL rejected', notImg.status === 400, SEV.MED, `rejected (${notImg.status})`, `accepted a text/html data: URL as an image (${notImg.status})`, 'icon = data:text/html,<script>…');
    const c = await http('POST', '/api/code', { jar: attacker, body: { name: 'big.txt' } });
    if (c.json?.uuid) {
      const r = await http('PATCH', `/api/code/${c.json.uuid}`, { jar: attacker, body: { content: 'x'.repeat(6_000_000) } });
      check('upload', 'Oversized code content rejected', r.status === 413 || r.status === 400, SEV.LOW, `rejected (${r.status})`, `accepted a 6MB code body (${r.status})`, 'PATCH /api/code/<uuid> with 6MB content');
    }
  }

  // ---- HEADERS ----
  if (wants('headers')) {
    const r = await http('GET', '/login', { jar: makeJar() });
    const h = (k) => r.res.headers.get(k);
    check('headers', 'Clickjacking protection', Boolean(h('x-frame-options') || (h('content-security-policy') || '').includes('frame-ancestors')), SEV.MED, 'present', 'missing — pages can be framed for clickjacking', "X-Frame-Options: DENY or CSP frame-ancestors 'none'");
    check('headers', 'Content-Security-Policy', Boolean(h('content-security-policy')), SEV.MED, 'present', 'no CSP — an injected script would run unrestricted', 'add a Content-Security-Policy header');
    check('headers', 'X-Content-Type-Options: nosniff', (h('x-content-type-options') || '').toLowerCase() === 'nosniff', SEV.LOW, 'present', 'missing — browsers may MIME-sniff responses', 'add X-Content-Type-Options: nosniff');
    check('headers', 'Referrer-Policy', Boolean(h('referrer-policy')), SEV.LOW, 'present', 'missing — full URLs may leak in the Referer header', 'add Referrer-Policy: strict-origin-when-cross-origin');
    check('headers', 'X-Powered-By hidden', !h('x-powered-by'), SEV.INFO, 'hidden', `X-Powered-By: ${h('x-powered-by')} leaks the framework`, 'poweredByHeader: false in next.config.js');
  }

  // ---- COOKIES ----
  if (wants('cookies')) {
    const jar = makeJar();
    const login = await http('POST', '/api/auth/login', { jar, body: { email: a.email, password: 'Passw0rd!sec', photo: TEST_PHOTO } });
    const sc = (login.setCookie || []).find((c) => c.startsWith('mytrack_session=')) || '';
    check('cookies', 'Session cookie is HttpOnly', /httponly/i.test(sc), SEV.HIGH, 'HttpOnly set — JS cannot read the session', 'HttpOnly missing — XSS could steal the session', 'inspect Set-Cookie on login');
    check('cookies', 'Session cookie SameSite', /samesite/i.test(sc), SEV.MED, 'SameSite set (CSRF mitigation)', 'SameSite missing — cross-site requests may send the cookie', 'inspect Set-Cookie on login');
    // Browsers refuse Secure cookies over plain http://localhost, so the app
    // only sets it in production (NODE_ENV=production). Judge accordingly.
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base);
    check('cookies', 'Session cookie Secure flag', /secure/i.test(sc) || local, SEV.MED, /secure/i.test(sc) ? 'Secure set' : 'not set on http://localhost by design — set automatically in production', 'Secure missing on a non-local server — cookie can travel over plain HTTP', "secure: process.env.NODE_ENV === 'production'");
  }

  // ---- RATE LIMITING ----
  if (wants('ratelimit')) {
    let blocked = false;
    let n = 0;
    for (; n < ratelimitAttempts; n++) {
      const r = await http('POST', '/api/auth/login', { jar: makeJar(), body: { email: a.email, password: 'wrong-' + n, photo: TEST_PHOTO } });
      if (r.status === 429) { blocked = true; break; }
    }
    check('ratelimit', 'Login rate limiting / lockout', blocked, SEV.MED, `throttled after ${n} attempts (429)`, `made ${n} failed logins with no 429/lockout — password brute force is possible`, 'POST /api/auth/login repeatedly with wrong passwords');
  }

  // ---- MISC ----
  if (wants('misc')) {
    const r = await http('POST', '/api/tracks', { jar: attacker, body: '{not valid json', headers: { 'Content-Type': 'application/json' } });
    check('misc', 'Malformed JSON handled gracefully', r.status < 500 || (r.json && !/(at\s+\/|\.js:\d+)/.test(JSON.stringify(r.json))), SEV.LOW, `handled without a stack trace (${r.status})`, 'malformed body caused a 500 that may leak internals', 'POST a broken JSON body');
    const be = await http('POST', '/api/backup/database', { jar: makeJar() });
    check('misc', 'Backup endpoint requires auth', be.status === 401 || be.status === 302 || be.status === 307, SEV.HIGH, `requires a session (${be.status})`, `returned ${be.status} without auth — DB backup may be downloadable anonymously`, 'POST /api/backup/database with no session');
  }

  return { results, tag };
}

export function summarize(results) {
  const fails = results.filter((r) => !r.ok).sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  const passes = results.filter((r) => r.ok);
  const bySeverity = {};
  for (const r of fails) bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
  return { total: results.length, passed: passes.length, failed: fails.length, bySeverity, fails, passes };
}

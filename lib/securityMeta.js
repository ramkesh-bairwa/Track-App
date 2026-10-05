// Client-safe metadata for the security self-test (no server-only code here,
// so it is safe to import into the browser bundle). lib/securityChecks.js
// (server) re-exports these.
export const SEV = { CRIT: 'CRITICAL', HIGH: 'HIGH', MED: 'MEDIUM', LOW: 'LOW', INFO: 'INFO' };
export const SEV_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
export const CATS = ['auth', 'idor', 'injection', 'ssrf', 'calendar', 'downloader', 'upload', 'headers', 'cookies', 'ratelimit', 'misc'];
// Run only by the CLI (they drive a real Chrome): npm run security-test
export const BROWSER_CATS = ['forms'];
export const CAT_LABELS = {
  auth: 'Authentication',
  idor: 'Access control (IDOR)',
  injection: 'Injection (SQLi / XSS)',
  ssrf: 'SSRF (image proxy)',
  calendar: 'Calendar API (SQLi / IDOR / validation)',
  downloader: 'Image downloader (SSRF / path traversal)',
  forms: 'Forms in a real browser (XSS / SQLi typed into every form)',
  upload: 'Uploads & limits',
  headers: 'Security headers',
  cookies: 'Cookie flags',
  ratelimit: 'Rate limiting',
  misc: 'Misc',
};
export const INJECTION_CHEATSHEET = [
  { label: 'SQL injection', items: ["' OR '1'='1' -- ", '1; DROP TABLE users--', '" UNION SELECT ...--'], where: 'every text field, login, search, and numeric id' },
  { label: 'Stored XSS', items: ['<img src=x onerror=alert(document.cookie)>', '<svg onload=alert(1)>', '"><script>alert(1)</script>', 'javascript:alert(1)'], where: 'names, titles, notes, link fields, imported Markdown' },
  { label: 'IDOR', items: ['/api/tracks/<id>', '/api/code/<uuid>', 'ids 1,2,3…'], where: 'replay every :id / :uuid route with a second account' },
  { label: 'SSRF', items: ['http://169.254.169.254/', 'http://localhost/', 'file:///etc/passwd', 'https://trusted@attacker/', 'https://trusted.attacker/'], where: 'any URL the server fetches' },
  { label: 'Auth', items: ['no cookie', 'tampered JWT signature', '{"alg":"none"}', 'expired token'], where: 'every protected endpoint' },
  { label: 'Uploads', items: ['oversized files', 'text/html dressed as image', 'data:text/html,<script>', '../../ in filenames'], where: 'icon, avatar, task file, code content' },
  { label: 'Rate limiting', items: ['25× wrong password'], where: 'login / register / password reset' },
  { label: 'Time-based blind SQLi', items: ["' OR SLEEP(3) -- ", "1 AND SLEEP(3)"], where: 'login, search, ids — a slow reply means the SQL ran' },
  { label: 'Path traversal', items: ['../../.env', '..%2F..%2Fetc%2Fpasswd', '~/../../etc', '~/.ssh'], where: 'album / file names, Save-to folder, screenshot paths' },
  { label: 'SSRF tricks', items: ['http://2130706433/ (decimal 127.0.0.1)', 'http://[::ffff:127.0.0.1]/', 'http://0.0.0.0:3000/', 'http://localhost./'], where: 'Image downloader page scan / image URLs' },
  { label: 'Header / CRLF injection', items: ['name%0d%0aSet-Cookie:x=1', 'file"; x=".jpg'], where: 'download file names, Content-Disposition' },
  { label: 'Dangerous links', items: ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', ' javascript:alert(1) (leading space)'], where: 'link fields, file fields, note links' },
];

// Small in-memory rate limiter (per server process) for login and sign-up —
// enough to stop password guessing against a single MyTrack server.
// Kept on globalThis so every route bundle / hot reload shares one table.

const buckets = (globalThis.__myTrackRateLimits ||= new Map());

function sweep(now) {
  if (buckets.size < 5000) return;
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}

// Counts one hit against `key`. Returns { limited, retryAfter } — limited once
// more than `max` hits land inside `windowMs`.
export function hit(key, { max, windowMs }) {
  const now = Date.now();
  sweep(now);
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  return { limited: b.count > max, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
}

// True if `key` is already over `max` (without counting a new hit).
export function isLimited(key, max) {
  const b = buckets.get(key);
  return Boolean(b && b.resetAt > Date.now() && b.count >= max);
}

export function retryAfter(key) {
  const b = buckets.get(key);
  return b ? Math.max(1, Math.ceil((b.resetAt - Date.now()) / 1000)) : 1;
}

export function reset(key) {
  buckets.delete(key);
}

// Best-effort client address. Behind a proxy, set it to pass X-Forwarded-For.
export function clientIp(request) {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') || request.ip || 'local';
}

// Access control for the Testing-feedback API. Two kinds of callers:
//   * the browser (a logged-in MyTrack user, via the session cookie)
//   * an outside tool (automation/ui_test.py) sending a static token
//
// The token is TESTER_API_TOKEN (falls back to DOWNLOADER_API_TOKEN so one
// token can cover both). Send it as x-api-key, Authorization: Bearer, or
// ?token=... — the same convention the downloader API already uses.
import { getCurrentUser } from './auth';

export function readToken(request) {
  const auth = request.headers.get('authorization') || '';
  const bearer = auth.replace(/^Bearer\s+/i, '');
  return (
    request.headers.get('x-api-key') ||
    (bearer !== auth ? bearer : '') ||
    new URL(request.url).searchParams.get('token') ||
    ''
  );
}

export function configuredToken() {
  return process.env.TESTER_API_TOKEN || process.env.DOWNLOADER_API_TOKEN || '';
}

export function tokenValid(request) {
  const expected = configuredToken();
  return Boolean(expected) && readToken(request) === expected;
}

// Returns { user } for a logged-in browser call, { token: true } for a valid
// token call, or null when neither checks out.
export async function resolveAccess(request) {
  const user = await getCurrentUser();
  if (user) return { user };
  if (tokenValid(request)) return { token: true };
  return null;
}

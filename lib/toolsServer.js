// Server helpers for the Tools API routes (app/api/tools/*).
import { NextResponse } from 'next/server';
import { getCurrentUser } from './auth';
import { HttpError } from './downloader/errors';
import { safeFetch } from './downloader/netguard';
import { readTextLimited } from './downloader/webpage';
import { withTimeout } from './downloader/pool';

export { HttpError, safeFetch, readTextLimited, withTimeout };

// Wraps a tool route: needs a MyTrack login, and turns errors into
// `{ error: "message" }` with the right status (HttpError keeps its own).
export function toolRoute(handler) {
  return async (request, context) => {
    try {
      const user = await getCurrentUser();
      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      return await handler(request, { ...context, user });
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
      if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
        return NextResponse.json({ error: 'The site took too long to answer.' }, { status: 504 });
      }
      console.error('Tool route error:', err);
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }
  };
}

export async function readBody(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'Send a JSON body.');
  }
}

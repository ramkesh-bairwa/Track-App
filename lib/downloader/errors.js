import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { config } from './config';
import { trackRequest } from '@/lib/activityLog';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, 'BAD_REQUEST', message, details);
export const notFound = (message = 'Not found') => new HttpError(404, 'NOT_FOUND', message);

const sameToken = (a, b) => {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
};

// A MyTrack login is enough; outside tools can use DOWNLOADER_API_TOKEN instead.
async function authorize(request) {
  if (config.apiToken) {
    const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const token = request.headers.get('x-api-key') || bearer || new URL(request.url).searchParams.get('token') || '';
    if (token && sameToken(token, config.apiToken)) return true;
  }
  return Boolean(await getCurrentUser());
}

// Wraps a route handler: checks access, and turns thrown errors into the
// API's `{ error: { code, message } }` shape.
export function downloaderRoute(handler, { isPublic = false } = {}) {
  return async (request, context) => {
    try {
      if (!isPublic && !(await authorize(request))) {
        throw new HttpError(401, 'UNAUTHORIZED', 'Log in to MyTrack or send a valid API token');
      }
      const after = await trackRequest(request, context);
      const response = await handler(request, context);
      if (after) await after(response);
      return response;
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
      }
      console.error('Downloader API error:', err);
      return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } }, { status: 500 });
    }
  };
}

export async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  }
}

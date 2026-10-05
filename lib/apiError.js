import { NextResponse } from 'next/server';
import { trackRequest } from './activityLog';

// Wraps a route handler so any thrown error (DB down, bad query, etc.) always
// comes back as JSON instead of Next's default HTML error page — a fetch()
// call doing res.json() on an HTML response fails with a cryptic
// "Unexpected token '<'" error, so this keeps failures readable client-side.
// Successful changes are also written to the activity log (lib/activityLog.js).
export function withApiErrors(handler) {
  return async (...args) => {
    try {
      const after = await trackRequest(args[0], args[1]);
      const response = await handler(...args);
      if (after) await after(response);
      return response;
    } catch (err) {
      console.error('API route error:', err);
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }
  };
}

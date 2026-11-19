// "Ask for my password before deleting": when the account has it on, every
// delete of a track, sub-track, column or record must carry the privacy
// password in the X-Privacy-Password header. Checked here on the server, so
// it holds no matter which screen the delete comes from.
import { NextResponse } from 'next/server';
import { query } from './db';
import { verifyPassword } from './auth';

export const DELETE_PASSWORD_HEADER = 'x-privacy-password';

// Returns a response to send back when the delete isn't allowed, else null.
export async function checkDeletePassword(request, user) {
  if (!user?.require_password_delete) return null;
  const row = (await query('SELECT action_password FROM users WHERE id = ?', [user.id]))[0];
  if (!row?.action_password) return null;
  let given = request.headers.get(DELETE_PASSWORD_HEADER) || '';
  try {
    given = decodeURIComponent(given); // sent URI-encoded (headers are Latin-1 only)
  } catch {
    // use as-is
  }
  if (given && (await verifyPassword(given, row.action_password))) return null;
  return NextResponse.json(
    { error: given ? 'Incorrect privacy password.' : 'Enter your privacy password to delete this.', needPassword: true },
    { status: 403 }
  );
}

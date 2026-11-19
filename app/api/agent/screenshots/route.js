import { NextResponse } from 'next/server';
import { withApiErrors } from '@/lib/apiError';
import { requireDevice } from '@/lib/agent';
import { isShotName, saveUploadedShot, shotOwner } from '@/lib/screenshots';
import { isDate } from '@/lib/calendarServer';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 15 * 1024 * 1024;

// One screenshot from the device's tracker: ?date=YYYY-MM-DD&file=HH-MM-SS.jpg,
// body = the JPEG. Filed under the device's user, like local ones.
export const POST = withApiErrors(async (request) => {
  const { device, error } = await requireDevice(request);
  if (error) return error;
  const q = new URL(request.url).searchParams;
  const date = q.get('date') || '';
  const file = q.get('file') || '';
  if (!isDate(date) || !isShotName(file)) return NextResponse.json({ error: 'Bad screenshot name.' }, { status: 400 });
  const buf = Buffer.from(await request.arrayBuffer());
  if (!buf.length || buf.length > MAX_BYTES) return NextResponse.json({ error: 'Bad screenshot size.' }, { status: 400 });
  const isImage = (buf[0] === 0xff && buf[1] === 0xd8) || (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG');
  if (!isImage) return NextResponse.json({ error: 'Not an image.' }, { status: 400 });
  const owner = await shotOwner(device.user_id);
  if (!owner || !(await saveUploadedShot(owner, date, file, buf))) return NextResponse.json({ error: 'Could not save it.' }, { status: 400 });
  return NextResponse.json({ ok: true });
});

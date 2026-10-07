import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { withApiErrors } from '@/lib/apiError';
import { parseJson } from '@/lib/taskServer';
import { loadEntryForComment } from '@/lib/taskComments';

// Raster images are always shown inline. With ?preview=1 a few more inert
// types are too: PDF, common audio/video, and text-like files (sent as
// text/plain so they display as source). Everything else — including
// SVG/HTML, which can carry script — is only ever sent as a download.
const INLINE = /^image\/(png|jpeg|gif|webp)$/i;
const PREVIEW_MEDIA = /^(application\/pdf|video\/(mp4|webm|ogg)|audio\/(mpeg|mp3|wav|x-wav|ogg|webm|mp4|aac))$/i;
const TEXT_TYPES = /^(text\/(plain|csv|markdown|tab-separated-values)|application\/json)$/i;
const TEXT_EXT = /\.(txt|csv|tsv|json|md|log)$/i;

function servedAs(type, name, preview) {
  if (INLINE.test(type)) return { type, inline: true };
  if (preview && PREVIEW_MEDIA.test(type)) return { type, inline: true };
  if (preview && (TEXT_TYPES.test(type) || TEXT_EXT.test(name))) return { type: 'text/plain; charset=utf-8', inline: true };
  return { type: 'application/octet-stream', inline: false };
}

// Serves one comment attachment to anyone who can see the log entry.
export const GET = withApiErrors(async (request, { params }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { entry, error } = await loadEntryForComment(params, user);
  if (error) return error;

  const rows = await query('SELECT attachments FROM task_comments WHERE id = ? AND activity_id = ? AND deleted_at IS NULL', [
    params.commentId,
    entry.id,
  ]);
  const file = (parseJson(rows[0]?.attachments, []) || [])[Number(params.index)];
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(file.data);
  if (!match) return NextResponse.json({ error: 'File not found' }, { status: 404 });
  const bytes = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
  const preview = new URL(request.url).searchParams.get('preview') === '1';
  const served = servedAs(file.type || match[1] || '', file.name, preview);
  const inline = served.inline;
  const name = encodeURIComponent(file.name);

  return new Response(bytes, {
    headers: {
      'Content-Type': served.type,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`,
      'Content-Length': String(bytes.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=300',
    },
  });
});

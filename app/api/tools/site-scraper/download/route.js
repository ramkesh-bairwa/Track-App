import { toolRoute, HttpError } from '@/lib/toolsServer';
import { takeJob } from '@/lib/tools/siteScraper';

export const dynamic = 'force-dynamic';

// GET ?id= → the zip a finished crawl left behind (kept for 10 minutes).
export const GET = toolRoute(async (request, { user }) => {
  const id = new URL(request.url).searchParams.get('id') || '';
  const job = takeJob(user.id, id);
  if (!job) throw new HttpError(404, 'EXPIRED', 'That download has expired — scrape the site again.');
  return new Response(job.zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${job.name}"`,
      'Content-Length': String(job.zip.length),
      'Cache-Control': 'no-store',
    },
  });
});

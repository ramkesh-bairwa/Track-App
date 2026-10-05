// Phase 4 — live progress as Server-Sent Events:
//   `progress` job summary on every change · `items` the whole queue (sent first)
//   `item` one image's new status · `file` each saved image · `done` once, then the stream closes.
import { downloaderRoute, notFound } from '@/lib/downloader/errors';
import { getJob } from '@/lib/downloader/jobs';

export const dynamic = 'force-dynamic';

export const GET = downloaderRoute(async (request, { params }) => {
  const job = getJob(params.id);
  if (!job) throw notFound(`Job "${params.id}" not found`);

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const write = (text) => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      const send = (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const onUpdate = () => send('progress', job.summary());
      const onItems = (items) => send('items', items);
      const onItem = (item) => send('item', item);
      const onFile = (file) => send('file', file);
      const onDone = () => {
        send('done', job.summary());
        cleanup();
        controller.close();
      };
      const heartbeat = setInterval(() => write(': ping\n\n'), 15000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        job.events.off('update', onUpdate).off('items', onItems).off('item', onItem).off('file', onFile).off('done', onDone);
      };

      send('progress', job.summary());
      if (job.items.length) send('items', job.items);
      if (job.finished) return onDone();
      job.events.on('update', onUpdate).on('items', onItems).on('item', onItem).on('file', onFile).on('done', onDone);
      request.signal.addEventListener('abort', () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

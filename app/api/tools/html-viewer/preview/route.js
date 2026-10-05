// HTML viewer preview frame. A fixed shell with no user input in it:
// next.config.js serves this path with `Content-Security-Policy: sandbox …`,
// so it runs in an opaque origin (no MyTrack cookies, storage or DOM). The
// shell tells its parent it's ready, takes one HTML document by postMessage —
// only from the window that framed it — and writes it in. document.open()
// drops the listener, so every update loads a fresh shell.
//
// No login check: the response is the same constant bytes for everyone and
// carries no data, and frame-ancestors 'self' already stops other sites from
// framing it.
export const dynamic = 'force-static';

const SHELL = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Preview</title></head>
<body><script>
(function () {
  var host = window.parent;
  if (!host || host === window) {
    document.body.textContent = 'This page only works inside the MyTrack HTML Viewer.';
    return;
  }
  window.addEventListener('message', function (e) {
    if (e.source !== host) return;
    var d = e.data;
    if (!d || d.type !== 'mytrack-html-preview' || typeof d.html !== 'string') return;
    document.open();
    document.write(d.html);
    document.close();
  });
  host.postMessage({ type: 'mytrack-html-preview-ready' }, '*');
})();
</script></body></html>
`;

export function GET() {
  return new Response(SHELL, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

// Swagger UI for the downloader API. "Try it out" calls go out with your
// MyTrack login cookie, so they work while you're signed in.
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Image Downloader API · MyTrack</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>body { margin: 0; background: #fff; }</style>
</head>
<body>
  <div id="swagger"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: '/api/downloader/docs.json', dom_id: '#swagger', withCredentials: true, persistAuthorization: true });
  </script>
</body>
</html>`;

export const GET = () => new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

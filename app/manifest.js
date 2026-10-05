// Lets phones install MyTrack to the home screen and open it full-screen, like an app.
export default function manifest() {
  return {
    name: 'MyTrack',
    short_name: 'MyTrack',
    description: 'Keep a record of everything you build and do.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#12151a',
    theme_color: '#181c24',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}

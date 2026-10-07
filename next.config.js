const isDev = process.env.NODE_ENV !== 'production';

// Content-Security-Policy: scripts only from this app (Next's own inline
// bootstrap needs 'unsafe-inline'; dev mode also needs eval + the HMR socket),
// styles/fonts only from the two CDNs the layout loads, no plugins, no
// framing by other sites, and forms can only post back here. Images may come
// from any https host because the Image downloader previews remote photos.
function csp({ extraScript = '', extraStyle = '', extraFrame = '' } = {}) {
  return [
    "default-src 'self'",
    // 'wasm-unsafe-eval' lets WebAssembly compile (Text Extractor's OCR engine) without allowing eval().
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}${extraScript}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com${extraStyle}`,
    "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    "worker-src 'self' blob:",
    `frame-src 'self' blob: data:${extraFrame}`,
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

const baseHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
];
const withHeader = (key, value) => [...baseHeaders.filter((h) => h.key !== key), { key, value }];

// Tools that need more than the default policy get their own entry below, and
// are left out of the catch-all so exactly one policy applies to each path.
const SPECIAL = [
  'api/downloader/docs',
  'api/tools/html-viewer/preview',
  'dashboard/tools/responsive-tester',
  'dashboard/tools/screen-recorder',
  'dashboard/tools/ip-locator',
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emits .next/standalone: a self-contained server with only the
  // node_modules it actually uses. The Docker image is built from it.
  output: 'standalone',
  // Don't advertise the framework in every response.
  poweredByHeader: false,
  // archiver (used by the Backup feature) has a nested dependency with a
  // package.json `exports` map webpack's resolver rejects — keeping it out
  // of the bundle and requiring it natively at runtime avoids that entirely.
  // cheerio (Image downloader's page scanner) pulls in undici, which is
  // Node-only — same treatment.
  experimental: {
    serverComponentsExternalPackages: ['archiver', 'cheerio'],
  },
  async headers() {
    return [
      {
        // Everything except the SPECIAL paths.
        source: `/((?!${SPECIAL.map((p) => `${p}$`).join('|')}).*)`,
        headers: [...baseHeaders, { key: 'Content-Security-Policy', value: csp() }],
      },
      {
        // Responsive tester: previews any site in frames.
        source: '/dashboard/tools/responsive-tester',
        headers: [...baseHeaders, { key: 'Content-Security-Policy', value: csp({ extraFrame: ' https: http:' }) }],
      },
      {
        // Screen recorder: may add your microphone to the recording.
        source: '/dashboard/tools/screen-recorder',
        headers: [
          ...withHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(), payment=()'),
          { key: 'Content-Security-Policy', value: csp() },
        ],
      },
      {
        // IP locator: "Use this device's GPS" asks the browser for its location.
        source: '/dashboard/tools/ip-locator',
        headers: [
          ...withHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=()'),
          { key: 'Content-Security-Policy', value: csp() },
        ],
      },
      {
        // HTML viewer preview: the pasted page runs in a sandbox with its own
        // opaque origin, so it can load what it likes but can't reach MyTrack
        // (no cookies, no access to the parent page).
        source: '/api/tools/html-viewer/preview',
        headers: [
          ...baseHeaders,
          {
            key: 'Content-Security-Policy',
            value: "sandbox allow-scripts allow-forms allow-popups allow-modals; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'self'; form-action 'none'",
          },
        ],
      },
      {
        source: '/api/downloader/docs',
        headers: [
          ...baseHeaders,
          { key: 'Content-Security-Policy', value: csp({ extraScript: ' https://cdn.jsdelivr.net', extraStyle: ' https://cdn.jsdelivr.net' }) },
        ],
      },
    ];
  },
};

module.exports = nextConfig;

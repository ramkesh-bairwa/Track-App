// The Tools menu (registry): one page per tool at /dashboard/tools/<slug>. The sidebar's
// Tools section, the /dashboard/tools hub and profile → Accessibility all read
// this list. Each tool's menu id is `tool-<slug>`.
export const TOOLS = [
  { slug: 'screen-recorder', label: 'Screen Recorder', icon: 'fa-circle-dot', description: 'Record your screen, a window or a tab, with optional mic audio, and download the video.' },
  { slug: 'qr-generator', label: 'QR Generator', icon: 'fa-qrcode', description: 'Make QR codes for links, text, Wi‑Fi, email or phone, and download them as PNG or SVG.' },
  { slug: 'text-extractor', label: 'Text Extractor', icon: 'fa-file-lines', description: 'Pull the text out of images (OCR) and PDFs, then copy or download it.' },
  { slug: 'html-viewer', label: 'HTML Viewer', icon: 'fa-code', description: 'Paste or upload HTML and preview it safely in a sandbox, side by side with the source.' },
  { slug: 'page-inspector', label: 'Page Inspector', icon: 'fa-magnifying-glass', description: 'See a web page’s title, meta and social tags, headings, links, images, scripts and response headers.' },
  { slug: 'responsive-tester', label: 'Responsive Tester', icon: 'fa-mobile-screen', description: 'Preview a page at phone, tablet and desktop sizes at the same time.' },
  { slug: 'url-checker', label: 'URL Checker', icon: 'fa-link', description: 'Check many URLs at once: status, redirects, response time and broken links.' },
  { slug: 'gif-maker', label: 'GIF Maker', icon: 'fa-film', description: 'Turn images or a short video clip into an animated GIF.' },
  { slug: 'image-compressor', label: 'Image Compressor', icon: 'fa-compress', description: 'Shrink images in your browser: pick quality, size and format, then download.' },
  { slug: 'asset-downloader', label: 'Asset Downloader', icon: 'fa-box-archive', description: 'List a page’s images, styles, scripts, fonts and media, and download the ones you pick as a zip.' },
  { slug: 'site-scraper', label: 'Website Scraper', icon: 'fa-spider', description: 'Crawl a site’s pages and download their HTML, CSS and JS as an offline copy with the same folder structure.' },
  { slug: 'ip-locator', label: 'IP Locator', icon: 'fa-location-dot', description: 'Look up where an IP address is (approximate coordinates, city, ISP, on a map), read a device’s GPS, or check an IMEI and block a lost phone.' },
];

export const toolBySlug = (slug) => TOOLS.find((t) => t.slug === slug);

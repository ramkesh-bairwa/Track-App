// QR-maker file-tools: build a QR payload from a few fields and render a real,
// downloadable QR code (qrcode lib) in the browser. Payloads reuse the shared
// buildPayload encodings in components/tools/qrPayload.js.

export const QR_TOOLS = {
  'qr-and-barcodes-url-qr-maker': {
    type: 'url',
    blurb: 'Make a QR code that opens a link.',
    inputs: [{ key: 'url', label: 'URL', default: 'https://example.com' }],
  },
  'qr-and-barcodes-wi-fi-qr-maker': {
    type: 'wifi',
    blurb: 'A QR that joins a Wi-Fi network when scanned.',
    inputs: [
      { key: 'ssid', label: 'Network name (SSID)', default: 'MyWiFi' },
      { key: 'password', label: 'Password', default: '' },
      { key: 'security', label: 'Security', type: 'select', options: ['WPA', 'WEP', 'none'], default: 'WPA' },
    ],
  },
  'qr-and-barcodes-contact-qr-maker': {
    type: 'contact',
    blurb: 'A vCard QR that adds a contact.',
    inputs: [
      { key: 'first', label: 'First name', default: 'Amit' },
      { key: 'last', label: 'Last name', default: 'Kumar' },
      { key: 'phone', label: 'Phone', default: '+919000000000' },
      { key: 'email', label: 'Email', default: 'amit@example.com' },
      { key: 'org', label: 'Organisation', default: '' },
      { key: 'url', label: 'Website', default: '' },
    ],
  },
  'qr-and-barcodes-email-qr-maker': {
    type: 'email',
    blurb: 'A QR that starts an email.',
    inputs: [
      { key: 'to', label: 'To', default: 'hello@example.com' },
      { key: 'subject', label: 'Subject', default: '' },
      { key: 'body', label: 'Body', default: '' },
    ],
  },
  'qr-and-barcodes-sms-qr-maker': {
    type: 'sms',
    blurb: 'A QR that composes a text message.',
    inputs: [
      { key: 'number', label: 'Phone number', default: '+919000000000' },
      { key: 'message', label: 'Message', default: '' },
    ],
  },
  'qr-and-barcodes-location-qr-maker': {
    type: 'geo',
    blurb: 'A QR that opens a map location.',
    inputs: [
      { key: 'lat', label: 'Latitude', default: '28.6139' },
      { key: 'lng', label: 'Longitude', default: '77.2090' },
    ],
  },
};

export const QR_TOOL_SLUGS = new Set(Object.keys(QR_TOOLS));
export const qrToolBySlug = (slug) => QR_TOOLS[slug] || null;

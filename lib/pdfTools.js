'use client';

// PDF editor helpers. pdf.js (served from /public/pdfjs, see
// scripts/copy-pdfjs.js) renders pages; pdf-lib writes the edited file.
// Everything runs in the browser — PDFs are never uploaded.

let pdfjsPromise = null;

export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* webpackIgnore: true */ '/pdfjs/pdf.min.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      return lib;
    });
  }
  return pdfjsPromise;
}

export async function openPdfForView(bytes) {
  const pdfjs = await loadPdfjs();
  // pdf.js transfers the buffer to its worker, so hand it a copy.
  return pdfjs.getDocument({
    data: bytes.slice(),
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
  }).promise;
}

export async function renderPageToCanvas(pdfPage, { scale = 1, rotation = 0, canvas } = {}) {
  const viewport = pdfPage.getViewport({ scale, rotation: (pdfPage.rotate + rotation + 360) % 360 });
  const c = canvas || document.createElement('canvas');
  c.width = Math.max(1, Math.floor(viewport.width));
  c.height = Math.max(1, Math.floor(viewport.height));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  return c;
}

// Annotations are stored as fractions (0..1, top-left origin) of the page *as
// displayed* (after rotation). This maps such a point onto the unrotated
// page's PDF user space (points, bottom-left origin) for a rotation of
// 0 / 90 / 180 / 270 degrees clockwise.
export function displayToPdf(u, v, W, H, rotation) {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: v * W, y: u * H };
    case 180:
      return { x: W - u * W, y: v * H };
    case 270:
      return { x: W - v * W, y: H - u * H };
    default:
      return { x: u * W, y: H - v * H };
  }
}

// Size of the page as displayed (rotation swaps width/height).
export function displaySize(W, H, rotation) {
  const r = ((rotation % 360) + 360) % 360;
  return r === 90 || r === 270 ? { w: H, h: W } : { w: W, h: H };
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

async function dataUrlBytes(dataUrl) {
  const res = await fetch(dataUrl);
  return new Uint8Array(await res.arrayBuffer());
}

// Draws text into a transparent PNG — used for text the built-in PDF fonts
// can't encode (Hindi, emoji, CJK…), so nothing is ever silently dropped.
function textToPng(text, color, fontPx, bold) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `${bold ? '700 ' : ''}${fontPx}px "IBM Plex Sans", "Noto Sans", "Segoe UI", sans-serif`;
  ctx.font = font;
  const lines = String(text).split('\n');
  const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width), 1)) + 4;
  const lh = Math.ceil(fontPx * 1.25);
  c.width = w;
  c.height = lh * lines.length;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, 2, i * lh + fontPx * 0.08));
  return c.toDataURL('image/png');
}

/**
 * Builds the output PDF.
 *  sources: Map(id → Uint8Array) of original PDFs
 *  pages:   [{ kind: 'pdf'|'blank'|'image', sourceId, pageIndex, width, height,
 *             baseRotation, rotation, image (dataURL), annotations: [...] }]
 *  options: { pageNumbers, watermark, title, author }
 */
export async function buildPdf(sources, pages, options = {}) {
  const { PDFDocument, StandardFonts, rgb, degrees } = await import('pdf-lib');
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const loaded = new Map();
  const imageCache = new Map();

  async function embedImage(dataUrl) {
    if (imageCache.has(dataUrl)) return imageCache.get(dataUrl);
    const bytes = await dataUrlBytes(dataUrl);
    const isPng = dataUrl.startsWith('data:image/png');
    let img;
    if (isPng) img = await out.embedPng(bytes);
    else if (/^data:image\/jpe?g/.test(dataUrl)) img = await out.embedJpg(bytes);
    else {
      // WEBP / GIF etc. → re-encode as PNG through a canvas.
      const el = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = dataUrl;
      });
      const c = document.createElement('canvas');
      c.width = el.naturalWidth;
      c.height = el.naturalHeight;
      c.getContext('2d').drawImage(el, 0, 0);
      img = await out.embedPng(await dataUrlBytes(c.toDataURL('image/png')));
    }
    imageCache.set(dataUrl, img);
    return img;
  }

  for (const p of pages) {
    let page;
    if (p.kind === 'pdf') {
      if (!loaded.has(p.sourceId)) {
        loaded.set(p.sourceId, await PDFDocument.load(sources.get(p.sourceId), { ignoreEncryption: true }));
      }
      const [copied] = await out.copyPages(loaded.get(p.sourceId), [p.pageIndex]);
      page = out.addPage(copied);
    } else if (p.kind === 'image') {
      page = out.addPage([p.width, p.height]);
      const img = await embedImage(p.image);
      const k = Math.min(p.width / img.width, p.height / img.height);
      page.drawImage(img, { x: (p.width - img.width * k) / 2, y: (p.height - img.height * k) / 2, width: img.width * k, height: img.height * k });
    } else {
      page = out.addPage([p.width, p.height]);
    }

    const rotation = (((p.baseRotation || 0) + (p.rotation || 0)) % 360 + 360) % 360;
    page.setRotation(degrees(rotation));
    const { width: W, height: H } = page.getSize();
    const disp = displaySize(W, H, rotation);
    const map = (u, v) => displayToPdf(u, v, W, H, rotation);

    for (const a of p.annotations || []) {
      const color = rgb(...hexToRgb(a.color || '#000000'));
      if (a.type === 'highlight' || a.type === 'whiteout' || a.type === 'rect') {
        const p1 = map(a.x, a.y);
        const p2 = map(a.x + a.w, a.y + a.h);
        const box = { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y) };
        if (a.type === 'highlight') page.drawRectangle({ ...box, color, opacity: 0.35 });
        else if (a.type === 'whiteout') page.drawRectangle({ ...box, color: rgb(1, 1, 1) });
        else page.drawRectangle({ ...box, borderColor: color, borderWidth: Math.max(0.5, (a.stroke || 0.004) * disp.w) });
      } else if (a.type === 'ink') {
        const thickness = Math.max(0.5, (a.stroke || 0.004) * disp.w);
        for (let i = 1; i < a.points.length; i++) {
          page.drawLine({ start: map(a.points[i - 1].x, a.points[i - 1].y), end: map(a.points[i].x, a.points[i].y), thickness, color, opacity: a.opacity ?? 1 });
        }
      } else if (a.type === 'image') {
        const img = await embedImage(a.image);
        const anchor = map(a.x, a.y + a.h); // display bottom-left
        page.drawImage(img, { ...anchor, width: a.w * disp.w, height: a.h * disp.h, rotate: degrees(rotation) });
      } else if (a.type === 'text' && a.text) {
        const size = Math.max(4, a.size * disp.h);
        const f = a.bold ? bold : font;
        let encodable = true;
        try {
          f.encodeText(a.text.replace(/\n/g, ' '));
        } catch {
          encodable = false;
        }
        if (encodable) {
          a.text.split('\n').forEach((line, i) => {
            const anchor = map(a.x, a.y + (size * 0.85 + i * size * 1.25) / disp.h);
            page.drawText(line, { ...anchor, size, font: f, color, rotate: degrees(rotation) });
          });
        } else {
          const png = textToPng(a.text, a.color || '#000', Math.round(size * 3), a.bold);
          const img = await embedImage(png);
          const w = img.width / 3;
          const h = img.height / 3;
          const anchor = map(a.x, a.y + h / disp.h);
          page.drawImage(img, { ...anchor, width: w, height: h, rotate: degrees(rotation) });
        }
      }
    }
  }

  const total = out.getPageCount();
  if (options.pageNumbers || options.watermark) {
    out.getPages().forEach((page, i) => {
      const rotation = page.getRotation().angle;
      const { width: W, height: H } = page.getSize();
      const disp = displaySize(W, H, rotation);
      const map = (u, v) => displayToPdf(u, v, W, H, rotation);
      if (options.watermark) {
        const size = Math.min(disp.w, disp.h) / 9;
        const text = options.watermark.slice(0, 60);
        let safe = text;
        try {
          bold.encodeText(text);
        } catch {
          safe = text.replace(/[^\x20-\x7E]/g, '?');
        }
        const tw = bold.widthOfTextAtSize(safe, size);
        const angle = 35;
        const rad = (angle * Math.PI) / 180;
        const cx = 0.5 - (Math.cos(rad) * tw) / 2 / disp.w;
        const cy = 0.5 + (Math.sin(rad) * tw) / 2 / disp.h;
        page.drawText(safe, { ...map(cx, cy), size, font: bold, color: rgb(0.6, 0.6, 0.6), opacity: 0.25, rotate: degrees(rotation + angle) });
      }
      if (options.pageNumbers) {
        const label = options.pageNumbers === 'n-of-total' ? `Page ${i + 1} of ${total}` : String(i + 1);
        const size = Math.max(8, disp.h / 70);
        const tw = font.widthOfTextAtSize(label, size);
        page.drawText(label, { ...map(0.5 - tw / 2 / disp.w, 1 - 0.035), size, font, color: rgb(0.35, 0.35, 0.35), rotate: degrees(rotation) });
      }
    });
  }

  if (options.title) out.setTitle(options.title);
  if (options.author) out.setAuthor(options.author);
  out.setProducer('MyTrack PDF editor');
  out.setModificationDate(new Date());
  return out.save();
}

export async function extractText(pdfDoc) {
  const parts = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    let line = '';
    const lines = [];
    let lastY = null;
    for (const item of content.items) {
      const y = item.transform?.[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(line);
        line = '';
      }
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = '';
      }
      lastY = y;
    }
    if (line) lines.push(line);
    parts.push(`--- Page ${i} ---\n${lines.join('\n').trim()}`);
  }
  return parts.join('\n\n');
}

export const PAGE_SIZES = [
  { id: 'a4', label: 'A4', w: 595.28, h: 841.89 },
  { id: 'letter', label: 'Letter', w: 612, h: 792 },
  { id: 'legal', label: 'Legal', w: 612, h: 1008 },
  { id: 'a5', label: 'A5', w: 419.53, h: 595.28 },
  { id: 'a3', label: 'A3', w: 841.89, h: 1190.55 },
];

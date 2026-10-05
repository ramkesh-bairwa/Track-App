// A minimal PDF writer for photo pages: each page shows JPEG images at given
// positions. PDF can embed JPEG bytes as-is (DCTDecode), so no library or
// re-compression is needed. Units are PDF points (1/72 inch).

const enc = new TextEncoder();

// Physical page sizes in points.
export const PAGE_SIZES = {
  a4: { w: 595.28, h: 841.89, label: 'A4' },
  letter: { w: 612, h: 792, label: 'Letter' },
  legal: { w: 612, h: 1008, label: 'Legal' },
  a3: { w: 841.89, h: 1190.55, label: 'A3' },
};

export const MM = 72 / 25.4;

// Reads width/height from a JPEG's SOF marker.
export function jpegSize(bytes) {
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + len;
  }
  return null;
}

const num = (n) => (Math.round(n * 100) / 100).toString();

/**
 * pages: [{ width, height, images: [{ jpeg: Uint8Array, x, y, w, h }], background?: [r,g,b] 0..1 }]
 * x/y are measured from the page's top-left corner (converted to PDF's
 * bottom-left origin here).
 * → Uint8Array of a complete PDF file
 */
export function buildPdf(pages, { title = 'Photos' } = {}) {
  const chunks = [];
  const offsets = [];
  let length = 0;
  const write = (data) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  let objCount = 0;
  const newObj = () => ++objCount;
  const begin = (id) => {
    offsets[id] = length;
    write(`${id} 0 obj\n`);
  };

  const catalogId = newObj();
  const pagesId = newObj();
  const infoId = newObj();
  const pageIds = [];

  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  for (const page of pages) {
    const imageIds = [];
    for (const img of page.images) {
      const size = jpegSize(img.jpeg);
      if (!size) throw new Error('A photo could not be converted for the PDF.');
      const id = newObj();
      begin(id);
      write(
        `<< /Type /XObject /Subtype /Image /Width ${size.w} /Height ${size.h} /ColorSpace /DeviceRGB ` +
          `/BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`
      );
      write(img.jpeg);
      write('\nendstream\nendobj\n');
      imageIds.push(id);
    }

    let content = '';
    if (page.background) {
      content += `${page.background.map(num).join(' ')} rg 0 0 ${num(page.width)} ${num(page.height)} re f\n`;
    }
    page.images.forEach((img, k) => {
      const y = page.height - img.y - img.h; // top-left → PDF bottom-left
      content += `q ${num(img.w)} 0 0 ${num(img.h)} ${num(img.x)} ${num(y)} cm /Im${k} Do Q\n`;
    });
    const contentBytes = enc.encode(content);
    const contentId = newObj();
    begin(contentId);
    write(`<< /Length ${contentBytes.length} >>\nstream\n`);
    write(contentBytes);
    write('\nendstream\nendobj\n');

    const pageId = newObj();
    begin(pageId);
    const xobjects = imageIds.map((id, k) => `/Im${k} ${id} 0 R`).join(' ');
    write(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] ` +
        `/Resources << /XObject << ${xobjects} >> >> /Contents ${contentId} 0 R >>\nendobj\n`
    );
    pageIds.push(pageId);
  }

  begin(pagesId);
  write(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>\nendobj\n`);
  begin(catalogId);
  write(`<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`);
  begin(infoId);
  const safeTitle = String(title).replace(/[()\\]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '');
  write(`<< /Title (${safeTitle}) /Producer (MyTrack) >>\nendobj\n`);

  const xrefAt = length;
  let xref = `xref\n0 ${objCount + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objCount; id += 1) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  write(xref);
  write(`trailer\n<< /Size ${objCount + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

// Canvas → JPEG bytes (transparent areas become `background`).
export async function canvasToJpeg(canvas, quality = 0.92, background = '#ffffff') {
  let source = canvas;
  if (background) {
    source = document.createElement('canvas');
    source.width = canvas.width;
    source.height = canvas.height;
    const ctx = source.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, source.width, source.height);
    ctx.drawImage(canvas, 0, 0);
  }
  const blob = await new Promise((resolve) => source.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Your browser could not create the image.');
  return new Uint8Array(await blob.arrayBuffer());
}

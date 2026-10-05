'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { openPdfForView, renderPageToCanvas } from '@/lib/pdfTools';
import './text-extractor.css';

// Everything tesseract needs is self-hosted (scripts/copy-tesseract.js):
// the site's CSP only allows same-origin fetches.
const TESS = {
  workerPath: '/tesseract/worker.min.js',
  corePath: '/tesseract/core',
  langPath: '/tesseract/lang',
  workerBlobURL: false,
};
const LANGS = [
  { id: 'eng', label: 'English' },
  { id: 'hin', label: 'Hindi' },
  { id: 'eng+hin', label: 'English + Hindi' },
];
const MAX_IMAGE = 25 * 1024 * 1024;
const MAX_PDF = 100 * 1024 * 1024;
// OCR is most accurate around 300 dpi; pdf.js scale 1 is 72 dpi. Capped so a
// huge page doesn't exhaust memory.
const PDF_OCR_SCALE = 300 / 72;
const PDF_OCR_MAX_SIDE = 3500;

let nextId = 1;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const baseName = (name) => name.replace(/\.[^.]+$/, '') || 'text';

// "1-3, 5, 9-" → sorted page numbers within 1..total; blank means all.
export function parseRange(spec, total) {
  const s = spec.trim();
  if (!s) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set();
  for (const part of s.split(',')) {
    const m = /^\s*(\d*)\s*(?:(-)\s*(\d*))?\s*$/.exec(part);
    if (!m || (!m[1] && !m[3])) throw new Error(`“${part.trim()}” isn’t a page or range (try 1-3, 5).`);
    const a = m[1] ? Number(m[1]) : 1;
    const b = m[2] ? (m[3] ? Number(m[3]) : total) : a;
    for (let n = Math.max(1, Math.min(a, b)); n <= Math.min(total, Math.max(a, b)); n++) pages.add(n);
  }
  if (!pages.size) throw new Error(`None of those pages exist — this PDF has ${plural(total, 'page')}.`);
  return [...pages].sort((x, y) => x - y);
}

// Joins lines broken mid-paragraph, rejoins hyphenated words and collapses
// runs of spaces; blank lines stay as paragraph breaks.
export function cleanUp(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .split(/\n\s*\n+/)
    .map((para) => para
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .reduce((acc, line) => {
        if (!acc) return line;
        if (/[A-Za-z]-$/.test(acc) && /^[a-z]/.test(line)) return acc.slice(0, -1) + line;
        return `${acc} ${line}`;
      }, ''))
    .filter(Boolean)
    .join('\n\n');
}

function pdfPageText(content) {
  let out = '';
  for (const item of content.items) {
    if (typeof item.str !== 'string') continue;
    out += item.str;
    if (item.hasEOL) out += '\n';
  }
  return out.replace(/[ \t]+\n/g, '\n').trim();
}

async function imageToCanvas(file) {
  const bmp = await createImageBitmap(file);
  // Small images OCR better when enlarged.
  const k = Math.max(bmp.width, bmp.height) < 1200 ? 2 : 1;
  const c = document.createElement('canvas');
  c.width = bmp.width * k;
  c.height = bmp.height * k;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

function saveText(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const confClass = (c) => (c >= 85 ? 'ok' : c >= 60 ? 'warn' : 'bad');

function ResultCard({ item, onChange, onReset, onRemove, onCopy }) {
  const busy = item.status === 'queued' || item.status === 'working';
  return (
    <section className="tool-panel te-card" aria-busy={busy}>
      <div className="te-card-head">
        {item.thumb ? <img className="te-thumb" src={item.thumb} alt="" /> : <span className="te-thumb te-thumb-icon"><i className={`fa-solid ${item.kind === 'pdf' ? 'fa-file-pdf' : 'fa-image'}`} /></span>}
        <div className="te-card-title">
          <strong title={item.name}>{item.name}</strong>
          <div className="tool-row te-badges">
            {item.status === 'queued' && <span className="tool-badge">Waiting</span>}
            {item.status === 'working' && <span className="tool-badge">{item.stage || 'Working'}…</span>}
            {item.status === 'error' && <span className="tool-badge bad">Failed</span>}
            {item.status === 'done' && item.confidence != null && (
              <span className={`tool-badge ${confClass(item.confidence)}`} title="Average OCR confidence">{Math.round(item.confidence)}% confidence</span>
            )}
            {item.status === 'done' && item.summary && <span className="tool-muted">{item.summary}</span>}
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} aria-label={`Remove ${item.name}`} title="Remove"><i className="fa-solid fa-xmark" /></button>
      </div>

      {busy && (
        <div className="te-progress" role="progressbar" aria-label={`Progress for ${item.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)}>
          <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
        </div>
      )}
      {item.status === 'error' && <div className="top-error te-error">{item.error}</div>}

      {item.status === 'done' && (
        <>
          <label className="sr-only-te" htmlFor={`te-text-${item.id}`}>Text from {item.name}</label>
          <textarea id={`te-text-${item.id}`} className="input te-text" value={item.text} onChange={(e) => onChange(e.target.value)} spellCheck={false} placeholder="No text found." />
          <div className="tool-row te-actions">
            <button type="button" className="btn btn-sm" onClick={() => onCopy(item.text)} disabled={!item.text}><i className="fa-regular fa-copy" /> Copy</button>
            <button type="button" className="btn btn-sm" onClick={() => saveText(item.text, `${baseName(item.name)}.txt`)} disabled={!item.text}><i className="fa-solid fa-download" /> .txt</button>
            <button type="button" className="btn btn-sm" onClick={() => onChange(cleanUp(item.text))} disabled={!item.text} title="Join broken lines and collapse whitespace"><i className="fa-solid fa-broom" /> Clean up</button>
            {item.text !== item.raw && <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}><i className="fa-solid fa-rotate-left" /> Original</button>}
            <span className="tool-muted te-count">{item.text.length.toLocaleString()} chars</span>
          </div>
          {item.pages?.some((p) => p.method === 'ocr') && item.pages.some((p) => p.method === 'text') && (
            <p className="tool-muted te-note">Pages {item.pages.filter((p) => p.method === 'ocr').map((p) => p.n).join(', ')} had no text layer and were read with OCR.</p>
          )}
        </>
      )}
    </section>
  );
}

export default function TextExtractor() {
  const [lang, setLang] = useState('eng');
  const [range, setRange] = useState('');
  const [ocrScanned, setOcrScanned] = useState(true);
  const [forceOcr, setForceOcr] = useState(false);
  const [items, setItems] = useState([]);
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [combined, setCombined] = useState(null); // user edits to the combined text

  const workerRef = useRef(null); // Promise<{ worker, lang }>
  const onLog = useRef(null);
  const queue = useRef(Promise.resolve());
  const alive = useRef(true);
  const removed = useRef(new Set());
  const settings = useRef({});
  settings.current = { lang, range, ocrScanned, forceOcr };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const w = workerRef.current;
      workerRef.current = null;
      w?.then(({ worker }) => worker.terminate()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  const patch = useCallback((id, p) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it))), []);

  // One worker for every file; switching language re-initialises it.
  const getWorker = useCallback(async (want) => {
    if (!workerRef.current) {
      workerRef.current = (async () => {
        const { createWorker } = await import('tesseract.js');
        const worker = await createWorker(want, 1, { ...TESS, logger: (m) => onLog.current?.(m) });
        return { worker, lang: want };
      })();
      workerRef.current.catch(() => { workerRef.current = null; });
    }
    const w = await workerRef.current;
    if (w.lang !== want) {
      await w.worker.reinitialize(want, 1);
      w.lang = want;
    }
    return w.worker;
  }, []);

  const ocr = useCallback(async (source, lng, report) => {
    onLog.current = (m) => {
      if (m.status === 'recognizing text') report('Reading text', m.progress);
      else if (/loading|initializ/.test(m.status)) report('Loading OCR', 0);
    };
    const worker = await getWorker(lng);
    const { data } = await worker.recognize(source);
    onLog.current = null;
    return { text: (data.text || '').replace(/\n+$/, ''), confidence: data.confidence };
  }, [getWorker]);

  const processImage = useCallback(async (item) => {
    const { lang: lng } = settings.current;
    patch(item.id, { status: 'working', stage: 'Preparing', progress: 0 });
    const canvas = await imageToCanvas(item.file);
    const res = await ocr(canvas, lng, (stage, p) => patch(item.id, { stage, progress: p }));
    return { text: res.text, confidence: res.confidence, summary: `OCR · ${LANGS.find((l) => l.id === lng).label}` };
  }, [ocr, patch]);

  const processPdf = useCallback(async (item) => {
    const { lang: lng, range: spec, ocrScanned: doOcr, forceOcr: always } = settings.current;
    patch(item.id, { status: 'working', stage: 'Opening PDF', progress: 0 });
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    const doc = await openPdfForView(bytes);
    try {
      const nums = parseRange(spec, doc.numPages);
      const pages = [];
      const texts = [];
      const confs = [];
      for (let i = 0; i < nums.length; i++) {
        if (!alive.current) throw new Error('Stopped.');
        const n = nums[i];
        const report = (stage, p) => patch(item.id, { stage: `${stage} · page ${n}`, progress: (i + p) / nums.length });
        report('Reading', 0);
        const page = await doc.getPage(n);
        let text = always ? '' : pdfPageText(await page.getTextContent());
        let method = 'text';
        // A page with (almost) no text layer is probably a scan.
        if (text.replace(/\s/g, '').length < 3 && (doOcr || always)) {
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(PDF_OCR_SCALE, PDF_OCR_MAX_SIDE / Math.max(base.width, base.height));
          const canvas = await renderPageToCanvas(page, { scale });
          const res = await ocr(canvas, lng, report);
          canvas.width = 0;
          text = res.text;
          method = 'ocr';
          confs.push(res.confidence);
        }
        page.cleanup();
        pages.push({ n, method });
        texts.push(nums.length > 1 ? `--- Page ${n} ---\n${text}` : text);
      }
      const ocrCount = pages.filter((p) => p.method === 'ocr').length;
      const summary = `${plural(nums.length, 'page')} of ${doc.numPages}${ocrCount ? ` · ${ocrCount} by OCR` : ' · text layer'}`;
      return {
        text: texts.join('\n\n'),
        confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
        pages,
        summary,
      };
    } finally {
      // pdf.js 6 moved destroy() onto the loading task.
      (doc.loadingTask || doc).destroy?.();
    }
  }, [ocr, patch]);

  const enqueue = useCallback((item) => {
    queue.current = queue.current.then(async () => {
      if (!alive.current || removed.current.has(item.id)) return;
      try {
        const res = await (item.kind === 'pdf' ? processPdf(item) : processImage(item));
        patch(item.id, { ...res, raw: res.text, status: 'done', progress: 1 });
      } catch (err) {
        const msg = /password/i.test(err?.message || '') ? 'This PDF is password-protected.'
          : err?.name === 'InvalidPDFException' ? 'That file isn’t a valid PDF.'
            : err?.message && err.message.length < 200 ? err.message : 'Couldn’t read this file.';
        patch(item.id, { status: 'error', error: msg });
      }
    });
  }, [patch, processImage, processPdf]);

  const addFiles = useCallback((fileList) => {
    const skipped = [];
    const added = [];
    for (const file of fileList) {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      const isImage = file.type.startsWith('image/');
      if (!isPdf && !isImage) { skipped.push(`${file.name} (not an image or PDF)`); continue; }
      if (file.size > (isPdf ? MAX_PDF : MAX_IMAGE)) { skipped.push(`${file.name} (over ${isPdf ? 100 : 25} MB)`); continue; }
      added.push({
        id: nextId++,
        file,
        name: file.name || `pasted-image-${nextId}.png`,
        kind: isPdf ? 'pdf' : 'image',
        thumb: isImage ? URL.createObjectURL(file) : null,
        status: 'queued',
        progress: 0,
        text: '',
        raw: '',
      });
    }
    setError(skipped.length ? `Skipped: ${skipped.join(', ')}.` : '');
    if (!added.length) return;
    setCombined(null);
    setItems((list) => [...list, ...added]);
    added.forEach(enqueue);
  }, [enqueue]);

  // Paste an image from the clipboard anywhere on the page.
  useEffect(() => {
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf');
      if (!files.length) return;
      e.preventDefault();
      addFiles(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `pasted-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}${i ? `-${i}` : ''}.png`, { type: f.type }))));
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addFiles]);

  // Free thumbnails of removed items.
  const thumbs = useRef(new Set());
  useEffect(() => {
    const now = new Set(items.map((i) => i.thumb).filter(Boolean));
    thumbs.current.forEach((u) => { if (!now.has(u)) URL.revokeObjectURL(u); });
    thumbs.current = now;
  }, [items]);

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Copied to the clipboard.');
    } catch {
      setNotice('Couldn’t copy — select the text and copy it yourself.');
    }
  };

  const done = items.filter((i) => i.status === 'done');
  const busy = items.some((i) => i.status === 'queued' || i.status === 'working');
  const autoCombined = done.map((i) => `===== ${i.name} =====\n${i.text}`).join('\n\n');
  const combinedText = combined ?? autoCombined;

  return (
    <div className="tool-split te-tool">
      <div>
        <section className="tool-panel">
          <h2>Files</h2>
          <label
            className={`tool-drop${over ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); addFiles([...e.dataTransfer.files]); }}
          >
            <i className="fa-solid fa-file-arrow-up te-drop-icon" />
            <span><strong>Drop images or PDFs</strong> or click to choose</span>
            <span className="tool-muted">You can also paste an image (Ctrl/⌘+V)</span>
            <input type="file" multiple accept="image/*,application/pdf,.pdf" aria-label="Choose images or PDFs" onChange={(e) => { addFiles([...e.target.files]); e.target.value = ''; }} />
          </label>
          <p className="tool-muted te-privacy"><i className="fa-solid fa-lock" /> Files are read in your browser and never uploaded.</p>
        </section>

        <section className="tool-panel">
          <h2>Options</h2>
          <div className="field-group te-field">
            <label className="field-label" htmlFor="te-lang">OCR language</label>
            <select id="te-lang" className="input" value={lang} onChange={(e) => setLang(e.target.value)}>
              {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <div className="field-hint te-hint">Used for images and scanned PDF pages. Applies to files you add next.</div>
          </div>
          <div className="field-group te-field">
            <label className="field-label" htmlFor="te-range">PDF pages</label>
            <input id="te-range" className="input" value={range} onChange={(e) => setRange(e.target.value)} placeholder="All pages — or e.g. 1-3, 5, 10-" />
          </div>
          <label className="te-check">
            <input type="checkbox" checked={ocrScanned} onChange={(e) => setOcrScanned(e.target.checked)} />
            OCR PDF pages that have no text layer (scans)
          </label>
          <label className="te-check">
            <input type="checkbox" checked={forceOcr} onChange={(e) => setForceOcr(e.target.checked)} />
            Always OCR PDF pages (ignore the text layer)
          </label>
        </section>
      </div>

      <div className="te-results">
        {error && <div className="top-error" role="alert">{error}</div>}
        {notice && <p className="te-notice" role="status">{notice}</p>}
        {!items.length && (
          <section className="tool-panel">
            <div className="tool-empty">
              <i className="fa-solid fa-file-lines te-empty-icon" />
              <p>Add a photo, screenshot or PDF to pull the text out of it.</p>
            </div>
          </section>
        )}

        {done.length > 1 && (
          <section className="tool-panel te-card">
            <div className="te-card-head">
              <span className="te-thumb te-thumb-icon"><i className="fa-solid fa-layer-group" /></span>
              <div className="te-card-title">
                <strong>All files</strong>
                <div className="tool-muted">{plural(done.length, 'file')} combined{busy ? ' · more on the way' : ''}</div>
              </div>
            </div>
            <label className="sr-only-te" htmlFor="te-combined">Combined text</label>
            <textarea id="te-combined" className="input te-text" value={combinedText} onChange={(e) => setCombined(e.target.value)} spellCheck={false} />
            <div className="tool-row te-actions">
              <button type="button" className="btn btn-sm" onClick={() => copy(combinedText)}><i className="fa-regular fa-copy" /> Copy all</button>
              <button type="button" className="btn btn-sm" onClick={() => saveText(combinedText, 'extracted-text.txt')}><i className="fa-solid fa-download" /> .txt</button>
              <button type="button" className="btn btn-sm" onClick={() => setCombined(cleanUp(combinedText))}><i className="fa-solid fa-broom" /> Clean up</button>
              {combined != null && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCombined(null)}><i className="fa-solid fa-rotate-left" /> Rebuild</button>}
            </div>
          </section>
        )}

        {items.map((it) => (
          <ResultCard
            key={it.id}
            item={it}
            onChange={(text) => { patch(it.id, { text }); setCombined(null); }}
            onReset={() => patch(it.id, { text: it.raw })}
            onRemove={() => { removed.current.add(it.id); setItems((list) => list.filter((x) => x.id !== it.id)); }}
            onCopy={copy}
          />
        ))}
        {items.length > 1 && !busy && (
          <div className="tool-row te-clear">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { items.forEach((x) => removed.current.add(x.id)); setItems([]); setCombined(null); }}><i className="fa-solid fa-trash-can" /> Clear all</button>
          </div>
        )}
      </div>
    </div>
  );
}

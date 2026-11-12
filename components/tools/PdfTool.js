'use client';

import { useState } from 'react';
import { pdfToolBySlug } from '@/lib/pdfFileTools';
import { openPdfForView, renderPageToCanvas, extractText } from '@/lib/pdfTools';

// Runs a PDF operation entirely in the browser (pdf-lib for editing, pdf.js for
// reading/rendering). Takes uploaded file(s), processes them, and either shows
// the result (metadata, extracted text, a page image) or downloads a new PDF.
export default function PdfTool({ slug }) {
  const cfg = pdfToolBySlug(slug);
  const [files, setFiles] = useState([]);
  const [opts, setOpts] = useState(() => {
    const o = {};
    for (const i of cfg?.inputs || []) o[i.key] = i.default ?? '';
    return o;
  });
  const [status, setStatus] = useState(null);
  const [output, setOutput] = useState('');
  const [image, setImage] = useState('');

  if (!cfg) return null;
  const setOpt = (k, v) => setOpts((o) => ({ ...o, [k]: v }));
  const loadImageEl = (f) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(f); });

  const run = async () => {
    if (!files.length) { setStatus({ kind: 'err', msg: 'Choose a file first.' }); return; }
    setStatus({ kind: 'busy', msg: 'Processing…' });
    setOutput(''); setImage('');
    try {
      const { PDFDocument, degrees, rgb, StandardFonts } = await import('pdf-lib');

      if (cfg.action === 'merge') {
        const out = await PDFDocument.create();
        for (const f of files) {
          const src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
          (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
        }
        return finishPdf(out, `Merged ${files.length} files → ${out.getPageCount()} pages.`);
      }

      if (cfg.action === 'imgtopdf') {
        const out = await PDFDocument.create();
        for (const f of files) {
          const bytes = new Uint8Array(await f.arrayBuffer());
          let img;
          if (f.type === 'image/png') img = await out.embedPng(bytes);
          else if (/jpe?g/.test(f.type)) img = await out.embedJpg(bytes);
          else {
            const el = await loadImageEl(f);
            const c = document.createElement('canvas'); c.width = el.naturalWidth; c.height = el.naturalHeight;
            c.getContext('2d').drawImage(el, 0, 0);
            const png = await new Promise((r) => c.toBlob((b) => b.arrayBuffer().then((ab) => r(new Uint8Array(ab))), 'image/png'));
            img = await out.embedPng(png);
          }
          const page = out.addPage([img.width, img.height]);
          page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
        }
        return finishPdf(out, `Made a ${files.length}-page PDF from your images.`);
      }

      // text / image conversions read with pdf.js
      if (cfg.action === 'totext' || cfg.action === 'toimage') {
        const bytes = new Uint8Array(await files[0].arrayBuffer());
        const doc = await openPdfForView(bytes);
        if (cfg.action === 'totext') {
          const text = await extractText(doc);
          setOutput(text || '(no selectable text — this PDF may be scanned images)');
          setStatus({ kind: 'ok', msg: 'Extracted text.' });
          return;
        }
        const pageNo = Math.min(Math.max(1, parseInt(opts.page) || 1), doc.numPages);
        const canvas = await renderPageToCanvas(await doc.getPage(pageNo), { scale: 2 });
        const ext = cfg.imgMime === 'image/png' ? 'png' : 'jpg';
        canvas.toBlob((blob) => {
          const url = URL.createObjectURL(blob);
          setImage(url);
          const a = document.createElement('a'); a.href = url; a.download = `page-${pageNo}.${ext}`; a.click();
          setStatus({ kind: 'ok', msg: `Page ${pageNo} of ${doc.numPages} saved — downloaded.` });
        }, cfg.imgMime, 0.92);
        return;
      }

      // remaining actions edit a single PDF with pdf-lib
      const src = await PDFDocument.load(await files[0].arrayBuffer(), { ignoreEncryption: true });
      const total = src.getPageCount();

      if (cfg.action === 'meta') {
        const d = (fn) => { try { return fn() || '—'; } catch { return '—'; } };
        setOutput(
          `File: ${files[0].name}\nSize: ${(files[0].size / 1024).toFixed(1)} KB\nPages: ${total}\n` +
          `Title: ${d(() => src.getTitle())}\nAuthor: ${d(() => src.getAuthor())}\nSubject: ${d(() => src.getSubject())}\n` +
          `Keywords: ${d(() => src.getKeywords())}\nCreator: ${d(() => src.getCreator())}\nProducer: ${d(() => src.getProducer())}\n` +
          `Created: ${d(() => src.getCreationDate()?.toISOString())}\nModified: ${d(() => src.getModificationDate()?.toISOString())}`
        );
        setStatus({ kind: 'ok', msg: 'Read metadata.' });
        return;
      }
      if (cfg.action === 'compress') {
        const bytes = await src.save({ useObjectStreams: true });
        const before = files[0].size, after = bytes.length;
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'compressed.pdf'; a.click();
        const pct = before ? Math.round((1 - after / before) * 100) : 0;
        setStatus({ kind: 'ok', msg: `${(before / 1024).toFixed(1)} KB → ${(after / 1024).toFixed(1)} KB` + (pct > 0 ? ` (−${pct}%). Downloaded.` : ' — already optimal (no reduction possible). Downloaded.') });
        return;
      }
      if (cfg.action === 'pagenum') {
        const font = await src.embedFont(StandardFonts.Helvetica);
        const pages = src.getPages();
        pages.forEach((p, i) => {
          const { width, height } = p.getSize();
          const label = `${i + 1} / ${pages.length}`;
          const size = 10, tw = font.widthOfTextAtSize(label, size);
          let x = width / 2 - tw / 2, y = 18;
          if (opts.pos === 'Bottom right') { x = width - tw - 24; y = 18; }
          else if (opts.pos === 'Top right') { x = width - tw - 24; y = height - 24; }
          p.drawText(label, { x, y, size, font, color: rgb(0.3, 0.3, 0.3) });
        });
        return finishPdf(src, 'Added page numbers.');
      }
      if (cfg.action === 'delete') {
        const remove = new Set(parsePages(opts.pages, total));
        const keep = src.getPageIndices().filter((i) => !remove.has(i));
        if (!keep.length) { setStatus({ kind: 'err', msg: 'That would delete every page.' }); return; }
        const out = await PDFDocument.create();
        (await out.copyPages(src, keep)).forEach((p) => out.addPage(p));
        return finishPdf(out, `Deleted ${remove.size} page(s).`);
      }
      if (cfg.action === 'strip') {
        ['Title', 'Author', 'Subject', 'Keywords', 'Producer', 'Creator'].forEach((k) => { try { src[`set${k}`](k === 'Keywords' ? [] : ''); } catch {} });
        return finishPdf(src, 'Metadata cleared.');
      }
      if (cfg.action === 'rotate') {
        const deg = parseInt(opts.deg) || 90;
        const idx = opts.pages?.trim() ? parsePages(opts.pages, total) : src.getPageIndices();
        idx.forEach((i) => { const p = src.getPage(i); p.setRotation(degrees((p.getRotation().angle + deg) % 360)); });
        return finishPdf(src, `Rotated ${idx.length} page(s) by ${deg}°.`);
      }
      if (cfg.action === 'watermark') {
        const text = opts.text || 'CONFIDENTIAL';
        const font = await src.embedFont(StandardFonts.HelveticaBold);
        src.getPages().forEach((p) => {
          const { width, height } = p.getSize();
          p.drawText(text, { x: width * 0.15, y: height * 0.45, size: Math.min(60, (width * 1.2) / text.length), font, color: rgb(0.6, 0.6, 0.6), opacity: 0.3, rotate: degrees(45) });
        });
        return finishPdf(src, 'Watermark added to every page.');
      }

      // split / reorder
      const order = cfg.action === 'reorder'
        ? (opts.order?.trim() ? parsePages(opts.order, total) : src.getPageIndices())
        : parsePages(opts.range, total);
      if (!order.length) { setStatus({ kind: 'err', msg: 'No valid pages selected.' }); return; }
      const out = await PDFDocument.create();
      (await out.copyPages(src, order)).forEach((p) => out.addPage(p));
      return finishPdf(out, `${cfg.action === 'split' ? 'Extracted' : 'Reordered to'} ${order.length} page(s).`);
    } catch (e) {
      setStatus({ kind: 'err', msg: 'Could not process: ' + (e.message || e) });
    }
  };

  const finishPdf = async (doc, msg) => {
    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = cfg.download || 'output.pdf'; a.click();
    URL.revokeObjectURL(a.href);
    setStatus({ kind: 'ok', msg: `${msg} Downloaded.` });
  };

  const downloadText = () => {
    const blob = new Blob([output], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = cfg.textDownload || 'text.txt'; a.click();
    URL.revokeObjectURL(a.href);
  };

  const isText = cfg.output;
  return (
    <div className="mini-tool filetool">
      <div className="mini-fields">
        <p className="filetool-blurb">{cfg.blurb}</p>
        <label className="mini-field">
          <span className="mini-field-label">{cfg.accept === 'image/*' ? 'Image file' : 'PDF file'}{cfg.multiple ? 's' : ''}</span>
          <input type="file" accept={cfg.accept || 'application/pdf'} multiple={!!cfg.multiple} className="input" onChange={(e) => { setFiles([...e.target.files]); setOutput(''); setImage(''); }} />
        </label>
        {files.length > 1 && <p className="mini-note">{files.length} files.</p>}
        {cfg.inputs.map((i) => (
          <label key={i.key} className="mini-field">
            <span className="mini-field-label">{i.label}</span>
            {i.type === 'select' ? (
              <select className="input" value={opts[i.key]} onChange={(e) => setOpt(i.key, e.target.value)}>
                {i.options.map((o) => <option key={o} value={o}>{o}°</option>)}
              </select>
            ) : (
              <input type={i.type || 'text'} className="input" value={opts[i.key]} onChange={(e) => setOpt(i.key, e.target.value)} />
            )}
          </label>
        ))}
        <button type="button" className="btn btn-primary" onClick={run} disabled={status?.kind === 'busy'}>
          {status?.kind === 'busy' ? 'Processing…' : isText ? 'Read file' : 'Process & download'}
        </button>
      </div>

      <div className="mini-output">
        <div className="mini-output-head">
          <span>Result</span>
          {isText && output ? <button type="button" className="btn btn-small" onClick={cfg.textDownload ? downloadText : () => navigator.clipboard.writeText(output)}>{cfg.textDownload ? 'Download .txt' : 'Copy'}</button> : null}
        </div>
        {status?.kind === 'err' ? <p className="mini-error">{status.msg}</p> : null}
        {status?.kind === 'ok' && !isText ? <p className="filetool-ok">✓ {status.msg}</p> : null}
        {isText ? (
          <textarea className="input mini-result mono" readOnly rows={12} value={output || 'Choose a PDF and press “Read file”.'} />
        ) : image ? (
          <img src={image} alt="page" className="imgtool-preview" />
        ) : (
          <p className="mini-note">Everything runs in your browser — your file never leaves this device.</p>
        )}
      </div>
    </div>
  );
}

function parsePages(str, total) {
  const out = [];
  for (const part of String(str || '').split(',')) {
    const t = part.trim(); if (!t) continue;
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(t);
    if (m) { let a = +m[1], b = +m[2]; if (a > b) [a, b] = [b, a]; for (let i = a; i <= b; i++) if (i >= 1 && i <= total) out.push(i - 1); }
    else { const n = +t; if (n >= 1 && n <= total) out.push(n - 1); }
  }
  return out;
}

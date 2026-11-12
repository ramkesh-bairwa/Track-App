'use client';

import { useState } from 'react';
import { imageToolBySlug } from '@/lib/imageTools';

// Canvas-based image editing in the browser — no upload, no library. Loads the
// chosen image, applies the operation, previews it and downloads the result.
export default function ImageTool({ slug }) {
  const cfg = imageToolBySlug(slug);
  const [file, setFile] = useState(null);
  const [opts, setOpts] = useState(() => {
    const o = {};
    for (const i of cfg?.inputs || []) o[i.key] = i.default ?? '';
    return o;
  });
  const [status, setStatus] = useState(null);
  const [preview, setPreview] = useState('');
  const [info, setInfo] = useState('');

  if (!cfg) return null;
  const setOpt = (k, v) => setOpts((o) => ({ ...o, [k]: v }));

  const loadImage = (f) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = URL.createObjectURL(f);
  });

  const run = async () => {
    if (!file) { setStatus({ kind: 'err', msg: 'Choose an image first.' }); return; }
    setStatus({ kind: 'busy', msg: 'Processing…' });
    try {
      const img = await loadImage(file);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      let mime = 'image/png';
      const n = (k, d) => { const v = parseFloat(opts[k]); return Number.isFinite(v) ? v : d; };

      switch (cfg.action) {
        case 'convert': {
          mime = { PNG: 'image/png', JPEG: 'image/jpeg', WEBP: 'image/webp' }[opts.fmt] || 'image/png';
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          if (mime === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
          ctx.drawImage(img, 0, 0);
          break;
        }
        case 'resize': {
          let w = n('w', 0), h = n('h', 0);
          if (!w && !h) { setStatus({ kind: 'err', msg: 'Enter a width or height.' }); return; }
          if (!w) w = Math.round(img.naturalWidth * (h / img.naturalHeight));
          if (!h) h = Math.round(img.naturalHeight * (w / img.naturalWidth));
          canvas.width = w; canvas.height = h;
          ctx.drawImage(img, 0, 0, w, h);
          break;
        }
        case 'crop': {
          const x = n('x', 0), y = n('y', 0);
          const w = n('w', img.naturalWidth - x), h = n('h', img.naturalHeight - y);
          canvas.width = w; canvas.height = h;
          ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
          break;
        }
        case 'watermark': {
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          ctx.drawImage(img, 0, 0);
          const text = opts.text || '© MyTrack';
          ctx.font = `bold ${Math.max(16, canvas.width / 16)}px sans-serif`;
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.textAlign = 'center';
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate(-Math.PI / 6);
          ctx.strokeText(text, 0, 0); ctx.fillText(text, 0, 0);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          break;
        }
        case 'strip': {
          mime = file.type || 'image/png';
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          ctx.drawImage(img, 0, 0);
          break;
        }
        case 'blur': {
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          ctx.filter = `blur(${n('px', 6)}px)`;
          ctx.drawImage(img, 0, 0);
          ctx.filter = 'none';
          break;
        }
        case 'border': {
          const b = n('size', 20);
          canvas.width = img.naturalWidth + b * 2; canvas.height = img.naturalHeight + b * 2;
          ctx.fillStyle = opts.color || '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, b, b);
          break;
        }
        case 'rotate': {
          mime = file.type || 'image/png';
          const deg = parseInt(opts.deg) || 90;
          if (deg === 90 || deg === 270) { canvas.width = img.naturalHeight; canvas.height = img.naturalWidth; }
          else { canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; }
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate((deg * Math.PI) / 180);
          ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          break;
        }
        case 'flip': {
          mime = file.type || 'image/png';
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          if (opts.dir === 'Vertical') { ctx.translate(0, canvas.height); ctx.scale(1, -1); }
          else { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
          ctx.drawImage(img, 0, 0);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          break;
        }
        case 'grayscale': {
          mime = file.type || 'image/png';
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          ctx.filter = 'grayscale(1)';
          ctx.drawImage(img, 0, 0);
          ctx.filter = 'none';
          break;
        }
        case 'round': {
          const r = Math.min(n('radius', 40), img.naturalWidth / 2, img.naturalHeight / 2);
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          ctx.beginPath();
          ctx.moveTo(r, 0);
          ctx.arcTo(canvas.width, 0, canvas.width, canvas.height, r);
          ctx.arcTo(canvas.width, canvas.height, 0, canvas.height, r);
          ctx.arcTo(0, canvas.height, 0, 0, r);
          ctx.arcTo(0, 0, canvas.width, 0, r);
          ctx.closePath(); ctx.clip();
          ctx.drawImage(img, 0, 0);
          break;
        }
        default: break;
      }

      const ext = mime.split('/')[1].replace('jpeg', 'jpg');
      canvas.toBlob((blob) => {
        if (!blob) { setStatus({ kind: 'err', msg: 'Could not export the image.' }); return; }
        setPreview(URL.createObjectURL(blob));
        setInfo(`${canvas.width}×${canvas.height}px · ${(blob.size / 1024).toFixed(1)} KB · ${ext.toUpperCase()}`);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `output.${ext}`;
        a.click();
        setStatus({ kind: 'ok', msg: 'Done — downloaded.' });
      }, mime, mime === 'image/jpeg' ? 0.92 : undefined);
    } catch (e) {
      setStatus({ kind: 'err', msg: 'Could not process: ' + (e.message || e) });
    }
  };

  return (
    <div className="mini-tool filetool">
      <div className="mini-fields">
        <p className="filetool-blurb">{cfg.blurb}</p>
        <label className="mini-field">
          <span className="mini-field-label">Image file</span>
          <input type="file" accept="image/*" className="input" onChange={(e) => { setFile(e.target.files[0] || null); setPreview(''); }} />
        </label>
        {cfg.inputs.map((i) => (
          <label key={i.key} className="mini-field">
            <span className="mini-field-label">{i.label}</span>
            {i.type === 'select' ? (
              <select className="input" value={opts[i.key]} onChange={(e) => setOpt(i.key, e.target.value)}>
                {i.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input type={i.type || 'text'} className="input" value={opts[i.key]} onChange={(e) => setOpt(i.key, e.target.value)} />
            )}
          </label>
        ))}
        <button type="button" className="btn btn-primary" onClick={run} disabled={status?.kind === 'busy'}>
          {status?.kind === 'busy' ? 'Processing…' : 'Process & download'}
        </button>
      </div>

      <div className="mini-output">
        <div className="mini-output-head"><span>Result</span></div>
        {status?.kind === 'err' ? <p className="mini-error">{status.msg}</p> : null}
        {status?.kind === 'ok' ? <p className="filetool-ok">✓ {status.msg}</p> : null}
        {preview ? <img src={preview} alt="result" className="imgtool-preview" /> : <p className="mini-note">Runs in your browser — the image never leaves your device.</p>}
        {info ? <p className="mini-note">{info}</p> : null}
      </div>
    </div>
  );
}

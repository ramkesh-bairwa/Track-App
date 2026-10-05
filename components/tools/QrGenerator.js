'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { QR_TYPES, EMPTY_FORMS, buildPayload, colourCheck } from './qrPayload';
import './qr-generator.css';

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
// The logo box (logo + padding) is at most this share of the code's width;
// with level H (30% recovery) that still scans reliably.
const LOGO_SHARE = 0.22;
const HEX = /^#[0-9a-f]{6}$/i;

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Where the logo goes on a square of side `total`: a padded box in the
// middle, with the image fitted inside it keeping its aspect ratio.
function logoBox(total, img) {
  const box = total * LOGO_SHARE;
  const pad = box * 0.12;
  const inner = box - pad * 2;
  const k = Math.min(inner / img.width, inner / img.height);
  const w = img.width * k;
  const h = img.height * k;
  const bx = (total - box) / 2;
  return { bx, box, r: box * 0.14, ix: (total - w) / 2, iy: (total - h) / 2, w, h };
}

function Field({ label, id, hint, children }) {
  return (
    <div className="field-group qr-field">
      <label className="field-label" htmlFor={id}>{label}</label>
      {children}
      {hint && <div className="field-hint qr-hint">{hint}</div>}
    </div>
  );
}

function ColourInput({ id, label, value, onChange }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Field label={label} id={id}>
      <div className="qr-colour">
        <input type="color" aria-label={`${label} picker`} value={value} onChange={(e) => onChange(e.target.value)} />
        <input
          id={id}
          className="input input-mono"
          value={text}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value.trim();
            setText(v);
            if (HEX.test(v)) onChange(v.toLowerCase());
          }}
          onBlur={() => setText(value)}
        />
      </div>
    </Field>
  );
}

function ContentForm({ type, form, set }) {
  const input = (key, label, props = {}) => (
    <Field label={label} id={`qr-${type}-${key}`} hint={props.hint}>
      <input id={`qr-${type}-${key}`} className="input" value={form[key]} onChange={(e) => set(key, e.target.value)} {...props} hint={undefined} />
    </Field>
  );
  const area = (key, label, rows = 4, placeholder = '') => (
    <Field label={label} id={`qr-${type}-${key}`}>
      <textarea id={`qr-${type}-${key}`} className="input" rows={rows} placeholder={placeholder} value={form[key]} onChange={(e) => set(key, e.target.value)} />
    </Field>
  );

  switch (type) {
    case 'url':
      return input('url', 'Link', { placeholder: 'https://example.com', inputMode: 'url', hint: 'https:// is added if you leave it out.' });
    case 'text':
      return area('text', 'Text', 6, 'Anything you like…');
    case 'wifi':
      return (
        <>
          {input('ssid', 'Network name (SSID)', { autoComplete: 'off' })}
          <Field label="Security" id="qr-wifi-security">
            <select id="qr-wifi-security" className="input" value={form.security} onChange={(e) => set('security', e.target.value)}>
              <option value="WPA">WPA / WPA2 / WPA3</option>
              <option value="WEP">WEP</option>
              <option value="none">None (open network)</option>
            </select>
          </Field>
          {form.security !== 'none' && input('password', 'Password', { autoComplete: 'off' })}
          <label className="qr-check">
            <input type="checkbox" checked={form.hidden} onChange={(e) => set('hidden', e.target.checked)} /> Hidden network
          </label>
        </>
      );
    case 'email':
      return (
        <>
          {input('to', 'To', { type: 'email', multiple: true, placeholder: 'name@example.com' })}
          {input('subject', 'Subject')}
          {area('body', 'Message')}
        </>
      );
    case 'phone':
      return input('number', 'Phone number', { type: 'tel', placeholder: '+91 98765 43210' });
    case 'sms':
      return (
        <>
          {input('number', 'Phone number', { type: 'tel', placeholder: '+91 98765 43210' })}
          {area('message', 'Message', 3)}
        </>
      );
    case 'contact':
      return (
        <>
          <div className="qr-two">
            {input('first', 'First name')}
            {input('last', 'Last name')}
          </div>
          {input('phone', 'Phone', { type: 'tel' })}
          {input('email', 'Email', { type: 'email' })}
          {input('org', 'Organisation')}
          {input('url', 'Website', { inputMode: 'url' })}
        </>
      );
    default:
      return null;
  }
}

export default function QrGenerator() {
  const [type, setType] = useState('url');
  const [forms, setForms] = useState(EMPTY_FORMS);
  const [fg, setFg] = useState('#000000');
  const [bg, setBg] = useState('#ffffff');
  const [size, setSize] = useState(512);
  const [margin, setMargin] = useState(4);
  const [level, setLevel] = useState('M');
  const [logo, setLogo] = useState(null); // { src, img, name }
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [info, setInfo] = useState(null); // { version, modules }
  const canvasRef = useRef(null);

  const payload = useMemo(() => buildPayload(type, forms[type]), [type, forms]);
  const ecl = logo ? 'H' : level;
  const safeSize = Math.min(2048, Math.max(64, Number(size) || 512));
  const safeMargin = Math.min(16, Math.max(0, Number(margin) || 0));
  const colours = colourCheck(fg, bg);
  const bytes = useMemo(() => new TextEncoder().encode(payload).length, [payload]);

  const set = (key, value) => setForms((f) => ({ ...f, [type]: { ...f[type], [key]: value } }));
  const options = { errorCorrectionLevel: ecl, margin: safeMargin, width: safeSize, color: { dark: `${fg}ff`, light: `${bg}ff` } };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!payload) {
      setInfo(null);
      setError('');
      return;
    }
    let qr;
    try {
      qr = QRCode.create(payload, { errorCorrectionLevel: ecl });
    } catch (err) {
      setInfo(null);
      setError(/too big/i.test(err.message)
        ? `That’s too much data for a QR code at level ${ecl}. Shorten it${ecl !== 'L' && !logo ? ' or pick a lower error correction level' : ''}.`
        : err.message);
      return;
    }
    setError('');
    setInfo({ version: qr.version, modules: qr.modules.size });
    QRCode.toCanvas(canvas, payload, options, (err) => {
      if (err) return setError(err.message);
      if (logo) {
        const ctx = canvas.getContext('2d');
        const b = logoBox(canvas.width, logo.img);
        ctx.fillStyle = bg;
        roundRect(ctx, b.bx, b.bx, b.box, b.box, b.r);
        ctx.fill();
        ctx.drawImage(logo.img, b.ix, b.iy, b.w, b.h);
      }
    });
    // options is derived from the values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, ecl, safeMargin, safeSize, fg, bg, logo]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  const ready = Boolean(payload) && !error && info;
  const baseName = `qr-${type}`;

  const pickLogo = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('The logo must be an image file.');
    if (file.size > LOGO_MAX_BYTES) return setError('Pick a logo under 2 MB.');
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => setLogo({ src: reader.result, img, name: file.name });
      img.onerror = () => setError('That image could not be read.');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const downloadPng = () => canvasRef.current.toBlob((blob) => blob && downloadBlob(blob, `${baseName}.png`), 'image/png');

  const downloadSvg = async () => {
    let svg = await QRCode.toString(payload, { ...options, type: 'svg' });
    if (logo) {
      const vb = /viewBox="0 0 (\d+(?:\.\d+)?) /.exec(svg);
      const total = vb ? Number(vb[1]) : safeSize;
      const b = logoBox(total, logo.img);
      const n = (v) => Number(v.toFixed(3));
      svg = svg.replace('</svg>',
        `<rect x="${n(b.bx)}" y="${n(b.bx)}" width="${n(b.box)}" height="${n(b.box)}" rx="${n(b.r)}" fill="${bg}"/>`
        + `<image x="${n(b.ix)}" y="${n(b.iy)}" width="${n(b.w)}" height="${n(b.h)}" href="${logo.src}" preserveAspectRatio="xMidYMid meet"/></svg>`);
    }
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${baseName}.svg`);
  };

  const copyImage = async () => {
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('unsupported');
      const blob = new Promise((resolve, reject) => canvasRef.current.toBlob((b) => (b ? resolve(b) : reject(new Error('empty'))), 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setNotice('Image copied to the clipboard.');
    } catch {
      setNotice('This browser can’t copy images — use Download PNG instead.');
    }
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(payload);
      setNotice('Encoded text copied.');
    } catch {
      setNotice('Couldn’t copy — select the text and copy it yourself.');
    }
  };

  return (
    <div className="tool-split qr-tool">
      <div>
        <section className="tool-panel">
          <h2>Content</h2>
          <div className="qr-types" role="tablist" aria-label="Content type">
            {QR_TYPES.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={type === t.id} className={`qr-type${type === t.id ? ' active' : ''}`} onClick={() => setType(t.id)}>
                <i className={`fa-solid ${t.icon}`} /> {t.label}
              </button>
            ))}
          </div>
          <ContentForm type={type} form={forms[type]} set={set} />
        </section>

        <section className="tool-panel">
          <h2>Style</h2>
          <div className="qr-two">
            <ColourInput id="qr-fg" label="Foreground" value={fg} onChange={setFg} />
            <ColourInput id="qr-bg" label="Background" value={bg} onChange={setBg} />
          </div>
          {colours.inverted ? (
            <p className="qr-warn"><i className="fa-solid fa-triangle-exclamation" /> Light code on a dark background — some scanners can’t read inverted codes.</p>
          ) : colours.ratio < 4 ? (
            <p className="qr-warn"><i className="fa-solid fa-triangle-exclamation" /> Low contrast ({colours.ratio.toFixed(1)}:1) — the code may not scan. Aim for 4:1 or more.</p>
          ) : null}
          <div className="qr-two">
            <Field label="Size (px)" id="qr-size">
              <input id="qr-size" className="input" type="number" min={64} max={2048} step={16} value={size} onChange={(e) => setSize(e.target.value)} onBlur={() => setSize(safeSize)} />
            </Field>
            <Field label="Margin (modules)" id="qr-margin">
              <input id="qr-margin" className="input" type="number" min={0} max={16} value={margin} onChange={(e) => setMargin(e.target.value)} onBlur={() => setMargin(safeMargin)} />
            </Field>
          </div>
          <Field label="Error correction" id="qr-level" hint={logo ? 'A logo needs level H, so it’s locked while one is set.' : 'Higher levels survive damage but hold less data.'}>
            <select id="qr-level" className="input" value={ecl} disabled={Boolean(logo)} onChange={(e) => setLevel(e.target.value)}>
              <option value="L">L — 7% recovery</option>
              <option value="M">M — 15% recovery</option>
              <option value="Q">Q — 25% recovery</option>
              <option value="H">H — 30% recovery</option>
            </select>
          </Field>
          <div className="field-group qr-field">
            <span className="field-label qr-label">Centre logo</span>
            {logo ? (
              <div className="qr-logo">
                <img src={logo.src} alt="" />
                <span className="tool-muted">{logo.name}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLogo(null)}><i className="fa-solid fa-xmark" /> Remove</button>
              </div>
            ) : (
              <label className="btn btn-sm qr-logo-pick">
                <i className="fa-solid fa-image" /> Add a logo…
                <input type="file" accept="image/*" onChange={(e) => { pickLogo(e.target.files[0]); e.target.value = ''; }} />
              </label>
            )}
          </div>
        </section>
      </div>

      <section className="tool-panel qr-output">
        <h2>Preview</h2>
        {error && <div className="top-error" role="alert">{error}</div>}
        <div className="qr-stage" style={{ display: ready ? undefined : 'none' }}>
          <canvas ref={canvasRef} className="qr-canvas" role="img" aria-label="QR code preview" />
        </div>
        {!payload && <div className="tool-empty">Fill in the form to see your QR code.</div>}
        {ready && (
          <>
            <div className="tool-row qr-actions">
              <button type="button" className="btn btn-primary" onClick={downloadPng}><i className="fa-solid fa-download" /> PNG</button>
              <button type="button" className="btn" onClick={downloadSvg}><i className="fa-solid fa-download" /> SVG</button>
              <button type="button" className="btn" onClick={copyImage}><i className="fa-regular fa-copy" /> Copy image</button>
            </div>
            <p className="tool-muted qr-meta">
              {safeSize} × {safeSize} px · version {info.version} ({info.modules} × {info.modules} modules) · level {ecl}
            </p>
          </>
        )}
        {notice && <p className="qr-notice" role="status">{notice}</p>}
        {payload && (
          <div className="qr-encoded">
            <div className="tool-row qr-encoded-head">
              <span className="field-label qr-label">Encoded text</span>
              <span className="tool-muted">{payload.length} characters · {bytes} bytes</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={copyText}><i className="fa-regular fa-copy" /> Copy</button>
            </div>
            <pre className="tool-mono qr-payload" data-testid="qr-payload">{payload}</pre>
          </div>
        )}
      </section>
    </div>
  );
}

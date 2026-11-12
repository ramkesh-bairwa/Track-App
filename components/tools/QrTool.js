'use client';

import { useEffect, useState } from 'react';
import { qrToolBySlug } from '@/lib/qrTools';
import { buildPayload } from './qrPayload';

// Builds a QR payload from the fields and renders a live, downloadable QR code
// with the qrcode library (loaded on demand). Pure client-side.
export default function QrTool({ slug }) {
  const cfg = qrToolBySlug(slug);
  const [vals, setVals] = useState(() => {
    const o = {};
    for (const i of cfg?.inputs || []) o[i.key] = i.default ?? '';
    return o;
  });
  const [dataUrl, setDataUrl] = useState('');
  const [payload, setPayload] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!cfg) return;
    const p = cfg.type === 'geo'
      ? (vals.lat && vals.lng ? `geo:${vals.lat},${vals.lng}` : '')
      : buildPayload(cfg.type, vals);
    setPayload(p);
    if (!p) { setDataUrl(''); setErr(''); return; }
    let alive = true;
    import('qrcode')
      .then((QR) => QR.toDataURL(p, { width: 320, margin: 2, errorCorrectionLevel: 'M' }))
      .then((url) => { if (alive) { setDataUrl(url); setErr(''); } })
      .catch((e) => { if (alive) setErr(e.message || 'Could not render QR.'); });
    return () => { alive = false; };
  }, [cfg, vals]);

  if (!cfg) return null;
  const set = (k, v) => setVals((o) => ({ ...o, [k]: v }));
  const download = () => { const a = document.createElement('a'); a.href = dataUrl; a.download = 'qr.png'; a.click(); };

  return (
    <div className="mini-tool filetool">
      <div className="mini-fields">
        <p className="filetool-blurb">{cfg.blurb}</p>
        {cfg.inputs.map((i) => (
          <label key={i.key} className="mini-field">
            <span className="mini-field-label">{i.label}</span>
            {i.type === 'select' ? (
              <select className="input" value={vals[i.key]} onChange={(e) => set(i.key, e.target.value)}>
                {i.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input className="input" value={vals[i.key]} onChange={(e) => set(i.key, e.target.value)} />
            )}
          </label>
        ))}
      </div>

      <div className="mini-output">
        <div className="mini-output-head">
          <span>QR code</span>
          {dataUrl ? <button type="button" className="btn btn-small" onClick={download}>Download PNG</button> : null}
        </div>
        {err ? <p className="mini-error">{err}</p> : null}
        {dataUrl ? <img src={dataUrl} alt="QR code" className="qrtool-img" /> : <p className="mini-note">Fill the fields to generate a QR code.</p>}
      </div>
    </div>
  );
}

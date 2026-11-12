'use client';

import { useEffect, useMemo, useState } from 'react';
import { miniToolBySlug } from '@/lib/miniTools';

// Generic renderer for a mini-tool spec (lib/miniTools.js): draws the input
// fields, runs the spec on every change, and shows the result. Works entirely
// in the browser — no network calls.
export default function MiniTool({ slug }) {
  const spec = miniToolBySlug(slug);

  // Seed state from each field's default.
  const initial = useMemo(() => {
    const o = {};
    for (const f of spec?.fields || []) {
      // A select with no explicit default must start on its first option, not ''
      // (otherwise the dropdown shows option 1 but the tool computes nothing).
      if (f.type === 'select') o[f.key] = f.default ?? (f.options?.[0] ?? '');
      else if (f.type === 'checkbox') o[f.key] = f.default ?? false;
      else o[f.key] = f.default ?? '';
    }
    return o;
  }, [spec]);

  const [values, setValues] = useState(initial);
  const [result, setResult] = useState({ out: '' });
  const [copied, setCopied] = useState(false);

  useEffect(() => { setValues(initial); }, [initial]);

  // Recompute whenever the inputs change (handles async runs too).
  useEffect(() => {
    if (!spec) return;
    let alive = true;
    try {
      const r = spec.run(values);
      if (r && typeof r.then === 'function') {
        r.then((res) => { if (alive) setResult(normalize(res)); }).catch((e) => { if (alive) setResult({ error: String(e.message || e) }); });
      } else {
        setResult(normalize(r));
      }
    } catch (e) {
      setResult({ error: String(e.message || e) });
    }
    return () => { alive = false; };
  }, [spec, values]);

  if (!spec) return null;

  const set = (key, val) => setValues((v) => ({ ...v, [key]: val }));
  const copy = async () => {
    try { await navigator.clipboard.writeText(result.out || ''); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  const download = () => {
    const d = result.download;
    const blob = new Blob([d.text], { type: d.mime || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = d.name || 'output.txt'; a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="mini-tool">
      <div className="mini-fields">
        {spec.fields.map((f) => (
          <label key={f.key} className={`mini-field mini-field-${f.type}`}>
            <span className="mini-field-label">{f.label}</span>
            {f.type === 'textarea' ? (
              <textarea className="input mini-area" rows={f.rows || 6} placeholder={f.placeholder || ''} value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
            ) : f.type === 'select' ? (
              <select className="input" value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === 'checkbox' ? (
              <input type="checkbox" className="mini-check" checked={Boolean(values[f.key])} onChange={(e) => set(f.key, e.target.checked)} />
            ) : (
              <input type={f.type} className="input" placeholder={f.placeholder || ''} value={values[f.key] ?? ''} min={f.min} max={f.max} step={f.step} onChange={(e) => set(f.key, e.target.value)} />
            )}
          </label>
        ))}
      </div>

      <div className="mini-output">
        <div className="mini-output-head">
          <span>Result</span>
          {result.out ? <button type="button" className="btn btn-small" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button> : null}
        </div>

        {result.error ? (
          <p className="mini-error">{result.error}</p>
        ) : (
          <>
            <textarea className={`input mini-result${result.mono ? ' mono' : ''}`} readOnly rows={Math.min(16, Math.max(3, String(result.out || '').split('\n').length + 1))} value={result.out || ''} />
            {result.note ? <p className="mini-note">{result.note}</p> : null}
            {result.swatches ? (
              <div className="mini-swatches">
                {result.swatches.map((c, i) => <span key={i} className="mini-swatch" style={{ background: c }} title={c}>{c}</span>)}
              </div>
            ) : null}
            {result.preview ? (
              <div className="mini-preview">
                {result.preview.label ? <span className="mini-preview-label">{result.preview.label}</span> : null}
                <div className="mini-preview-box" style={result.preview.style}>{result.preview.style.color ? 'Sample text' : ''}</div>
              </div>
            ) : null}
            {result.download ? <button type="button" className="btn" onClick={download}>Download</button> : null}
          </>
        )}
      </div>
    </div>
  );
}

function normalize(r) {
  if (r == null) return { out: '' };
  if (typeof r === 'string') return { out: r };
  return r;
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import './html-viewer.css';

// The preview runs in /api/tools/html-viewer/preview, which is served with a
// CSP sandbox (opaque origin). The iframe's own sandbox matches it and must
// never get allow-same-origin: that sandbox is the security boundary.
const PREVIEW_SRC = '/api/tools/html-viewer/preview';
const SANDBOX = 'allow-scripts allow-forms allow-popups allow-modals';
const DRAFT_KEY = 'mytrack_html_viewer_draft';
const MAX_FILE = 2 * 1024 * 1024;

const EXAMPLES = [
  {
    id: 'card',
    label: 'Styled page (CDN stylesheet)',
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Hello</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/water.css@2/out/water.css">
</head>
<body>
  <h1>Hello from the sandbox</h1>
  <p>This page is styled by <code>water.css</code>, loaded from a CDN.</p>
  <blockquote>Edit the HTML on the left and the preview updates as you type.</blockquote>
  <button onclick="alert('Clicked!')">Click me</button>
</body>
</html>
`,
  },
  {
    id: 'script',
    label: 'Counter (inline script)',
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    body { font: 16px/1.5 system-ui, sans-serif; display: grid; place-items: center; min-height: 90vh; margin: 0; }
    button { font-size: 20px; padding: 10px 22px; border-radius: 8px; border: 0; background: #35c2a6; color: #06231c; cursor: pointer; }
  </style>
</head>
<body>
  <div>
    <p id="out">Clicked 0 times</p>
    <button id="btn">+1</button>
  </div>
  <script>
    let n = 0;
    document.getElementById('btn').addEventListener('click', () => {
      n += 1;
      document.getElementById('out').textContent = 'Clicked ' + n + ' time' + (n === 1 ? '' : 's');
    });
  </script>
</body>
</html>
`,
  },
  {
    id: 'blank',
    label: 'Blank HTML5 page',
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Untitled</title>
</head>
<body>

</body>
</html>
`,
  },
];

const WIDTHS = [
  { id: 'full', label: 'Full', icon: 'fa-display', px: null },
  { id: '1024', label: '1024', icon: 'fa-laptop', px: 1024 },
  { id: '768', label: '768', icon: 'fa-tablet-screen-button', px: 768 },
  { id: '390', label: '390', icon: 'fa-mobile-screen', px: 390 },
];

const LAYOUTS = [
  { id: 'split', label: 'Split', icon: 'fa-table-columns' },
  { id: 'editor', label: 'Editor', icon: 'fa-code' },
  { id: 'preview', label: 'Preview', icon: 'fa-eye' },
];

// "Scripts off" is a convenience for reading a page without its behaviour —
// not a security measure (the sandbox is). Drops <script>, inline handlers,
// javascript: URLs and meta refreshes.
function stripScripts(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, meta[http-equiv="refresh" i]').forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(name) && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
      else if (name === 'srcdoc') el.setAttribute('srcdoc', stripScripts(attr.value));
    }
  });
  const doctype = doc.doctype ? `<!doctype ${doc.doctype.name}>\n` : '';
  return doctype + doc.documentElement.outerHTML;
}

function Segmented({ label, items, value, onChange, iconsOnlyNarrow }) {
  return (
    <div className={`hv-seg${iconsOnlyNarrow ? ' hv-seg-compact' : ''}`} role="group" aria-label={label}>
      {items.map((it) => (
        <button key={it.id} type="button" className={value === it.id ? 'active' : ''} aria-pressed={value === it.id} title={it.title || it.label} onClick={() => onChange(it.id)}>
          <i className={`fa-solid ${it.icon}`} /> <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}

export default function HtmlViewer() {
  const [html, setHtml] = useState(EXAMPLES[0].html);
  const [layout, setLayout] = useState('split');
  const [width, setWidth] = useState('full');
  const [scripts, setScripts] = useState(true);
  const [frameKey, setFrameKey] = useState(0);
  const [status, setStatus] = useState('loading'); // loading | shown
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('page.html');
  const frameRef = useRef(null);
  const escRef = useRef(false);
  const htmlRef = useRef(html);
  const scriptsRef = useRef(scripts);
  const loaded = useRef(false);

  htmlRef.current = html;
  scriptsRef.current = scripts;

  // Restore the last draft once, after hydration.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) setHtml(saved);
    } catch {
      // storage blocked — start from the example
    }
    loaded.current = true;
  }, []);

  // Every change reloads the shell (debounced); the shell asks for the HTML.
  useEffect(() => {
    if (!loaded.current) return undefined;
    const t = setTimeout(() => {
      setStatus('loading');
      setFrameKey((k) => k + 1);
      try {
        localStorage.setItem(DRAFT_KEY, html);
      } catch {
        // too big or blocked; the draft just isn't kept
      }
    }, 300);
    return () => clearTimeout(t);
  }, [html]);

  useEffect(() => {
    setStatus('loading');
    setFrameKey((k) => k + 1);
  }, [scripts]);

  useEffect(() => {
    const onMessage = (e) => {
      const frame = frameRef.current;
      if (!frame || e.source !== frame.contentWindow) return;
      if (e.data?.type !== 'mytrack-html-preview-ready') return;
      let out = htmlRef.current;
      if (!scriptsRef.current) {
        try {
          out = stripScripts(out);
        } catch {
          out = '';
        }
      }
      // The frame's origin is opaque, so '*' is the only target that works;
      // the message is the user's own HTML, going to the frame we made.
      frame.contentWindow.postMessage({ type: 'mytrack-html-preview', html: out }, '*');
      setStatus('shown');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      escRef.current = true;
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && !escRef.current && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const el = e.target;
      const { selectionStart: s, selectionEnd: end } = el;
      const next = `${el.value.slice(0, s)}  ${el.value.slice(end)}`;
      setHtml(next);
      requestAnimationFrame(() => {
        el.selectionStart = s + 2;
        el.selectionEnd = s + 2;
      });
    }
    escRef.current = false;
  };

  const loadFile = (file) => {
    if (!file) return;
    if (file.size > MAX_FILE) return setError('Pick an HTML file under 2 MB.');
    if (!/\.html?$/i.test(file.name) && file.type !== 'text/html') return setError('Pick an .html or .htm file.');
    setError('');
    file.text().then((text) => {
      setHtml(text);
      setFileName(file.name);
    }, () => setError('That file could not be read.'));
  };

  const pasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return setError('The clipboard is empty.');
      setError('');
      setHtml(text);
    } catch {
      setError('The browser didn’t allow reading the clipboard — click in the editor and press Ctrl/⌘+V instead.');
    }
  };

  const download = useCallback(() => {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = /\.html?$/i.test(fileName) ? fileName : `${fileName}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [html, fileName]);

  const lines = html ? html.split('\n').length : 0;
  const px = WIDTHS.find((w) => w.id === width).px;

  return (
    <div className="hv-tool">
      <div className="tool-panel hv-toolbar">
        <div className="tool-row">
          <label className="btn btn-sm hv-file">
            <i className="fa-solid fa-upload" /> Upload
            <input type="file" accept=".html,.htm,text/html" onChange={(e) => { loadFile(e.target.files[0]); e.target.value = ''; }} />
          </label>
          <button type="button" className="btn btn-sm" onClick={pasteClipboard}><i className="fa-solid fa-paste" /> Paste</button>
          <select
            className="input hv-examples"
            aria-label="Load an example"
            value=""
            onChange={(e) => {
              const ex = EXAMPLES.find((x) => x.id === e.target.value);
              if (ex) {
                setHtml(ex.html);
                setFileName(`${ex.id}.html`);
              }
            }}
          >
            <option value="">Examples…</option>
            {EXAMPLES.map((ex) => <option key={ex.id} value={ex.id}>{ex.label}</option>)}
          </select>
          <button type="button" className="btn btn-sm" onClick={download} disabled={!html}><i className="fa-solid fa-download" /> Download .html</button>
        </div>
        <div className="tool-row">
          <Segmented label="Layout" items={LAYOUTS} value={layout} onChange={setLayout} />
          <Segmented label="Preview width" items={WIDTHS} value={width} onChange={setWidth} iconsOnlyNarrow />
          <label className="hv-switch">
            <input type="checkbox" checked={scripts} onChange={(e) => setScripts(e.target.checked)} />
            <span>Scripts</span>
          </label>
        </div>
      </div>

      {error && <div className="top-error" role="alert">{error}</div>}

      <div className={`hv-main hv-${layout}`}>
        <section className="tool-panel hv-pane hv-editor-pane" hidden={layout === 'preview'}>
          <div className="hv-pane-head">
            <label htmlFor="hv-source">HTML</label>
            <span className="tool-muted">{lines} line{lines === 1 ? '' : 's'} · {html.length.toLocaleString()} chars</span>
          </div>
          <textarea
            id="hv-source"
            className="hv-editor"
            value={html}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-describedby="hv-editor-hint"
            onChange={(e) => setHtml(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Paste or type HTML here…"
          />
          <p id="hv-editor-hint" className="hv-hint">Tab inserts two spaces · press Esc then Tab to move on</p>
        </section>

        <section className="tool-panel hv-pane hv-preview-pane" hidden={layout === 'editor'}>
          <div className="hv-pane-head">
            <span className="hv-pane-title">Preview</span>
            <span className="tool-muted">
              {px ? `${px}px` : 'Full width'}{!scripts && ' · scripts off'}
              {status === 'loading' && <> · <i className="fa-solid fa-spinner fa-spin" aria-label="Updating" /></>}
            </span>
          </div>
          <div className="hv-stage">
            <div className="hv-frame-wrap" style={px ? { width: px } : undefined}>
              <iframe
                key={frameKey}
                ref={frameRef}
                src={PREVIEW_SRC}
                title="HTML preview"
                sandbox={SANDBOX}
                referrerPolicy="no-referrer"
                className="hv-frame"
              />
            </div>
          </div>
          <p className="hv-hint">
            <i className="fa-solid fa-shield-halved" /> Runs in an isolated sandbox: the page can load files from the web but can’t see your MyTrack session or this page.
            {!scripts && ' Scripts off just hides scripts for convenience — the sandbox is what keeps you safe.'}
          </p>
        </section>
      </div>
    </div>
  );
}

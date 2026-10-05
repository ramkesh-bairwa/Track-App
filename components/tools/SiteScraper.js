'use client';

import { useEffect, useRef, useState } from 'react';
import './site-scraper.css';

const MAX_PAGES = 300;
const MAX_DEPTH = 10;

const withScheme = (raw) => {
  const v = raw.trim();
  return /^[a-z][a-z\d+.-]*:\/\/|^(file|data|javascript|mailto|about|blob):/i.test(v) ? v : `https://${v}`;
};

function formatBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const clamp = (v, min, max, fallback) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

// Saves a finished crawl's zip from /api/tools/site-scraper/download.
async function saveZip(id, name) {
  const res = await fetch(`/api/tools/site-scraper/download?id=${encodeURIComponent(id)}`);
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || 'Could not download the zip.');
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10000);
}

export default function SiteScraper() {
  const [url, setUrl] = useState('');
  const [maxPages, setMaxPages] = useState(50);
  const [maxDepth, setMaxDepth] = useState(3);
  const [stayUnder, setStayUnder] = useState(false);
  const [running, setRunning] = useState(null); // { started, pages, limit, phase, assets, last }
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const abortRef = useRef(null);
  const [, tick] = useState(0);

  // Re-render once a second so the elapsed time moves while crawling.
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  async function start(e) {
    e.preventDefault();
    if (!url.trim() || running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const limit = clamp(maxPages, 1, MAX_PAGES, 50);
    setError('');
    setResult(null);
    setRunning({ started: Date.now(), pages: 0, limit, phase: 'pages', assets: 0, last: '' });
    let done = null;
    try {
      const res = await fetch('/api/tools/site-scraper/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: withScheme(url), maxPages: limit, maxDepth: clamp(maxDepth, 0, MAX_DEPTH, 3), stayUnderPath: stayUnder }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Something went wrong.');
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === 'page') setRunning((r) => r && { ...r, pages: ev.done, last: ev.url });
          else if (ev.type === 'assets') setRunning((r) => r && { ...r, phase: 'assets', assets: ev.count, last: '' });
          else if (ev.type === 'zipping') setRunning((r) => r && { ...r, phase: 'zip' });
          else if (ev.type === 'error') throw new Error(ev.error);
          else if (ev.type === 'done') done = ev;
        }
      }
      if (!done) throw new Error('The crawl stopped before it finished.');
      setResult(done);
      setSaving(true);
      await saveZip(done.id, done.name);
    } catch (err) {
      if (err.name === 'AbortError') setError('Cancelled.');
      else setError(err.message);
    } finally {
      abortRef.current = null;
      setRunning(null);
      setSaving(false);
    }
  }

  async function downloadAgain() {
    if (!result || saving) return;
    setSaving(true);
    setError('');
    try {
      await saveZip(result.id, result.name);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const elapsed = running ? Math.round((Date.now() - running.started) / 1000) : 0;
  const phaseText = running && {
    pages: `Crawling pages… ${running.pages} of up to ${running.limit}`,
    assets: `Downloading ${running.assets} stylesheet${running.assets === 1 ? '' : 's'} and script${running.assets === 1 ? '' : 's'}…`,
    zip: 'Building the zip…',
  }[running.phase];

  return (
    <div className="ss">
      <form className="tool-panel" onSubmit={start}>
        <div className="ss-row">
          <div className="ss-url">
            <label className="field-label" htmlFor="ss-url">Site URL</label>
            <input
              id="ss-url"
              className="input"
              type="text"
              inputMode="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={!!running}
            />
          </div>
          <div className="ss-num">
            <label className="field-label" htmlFor="ss-pages">Max pages</label>
            <input id="ss-pages" className="input" type="number" min={1} max={MAX_PAGES} value={maxPages} onChange={(e) => setMaxPages(e.target.value)} disabled={!!running} />
          </div>
          <div className="ss-num">
            <label className="field-label" htmlFor="ss-depth">Link depth</label>
            <input id="ss-depth" className="input" type="number" min={0} max={MAX_DEPTH} value={maxDepth} onChange={(e) => setMaxDepth(e.target.value)} disabled={!!running} />
          </div>
          {running ? (
            <button type="button" className="btn btn-danger" onClick={() => abortRef.current?.abort()}>
              <i className="fa-solid fa-xmark" aria-hidden="true" /> Cancel
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={!url.trim()}>
              <i className="fa-solid fa-spider" aria-hidden="true" /> Scrape site
            </button>
          )}
        </div>
        <label className="ss-check">
          <input type="checkbox" checked={stayUnder} onChange={(e) => setStayUnder(e.target.checked)} disabled={!!running} />
          Only pages under the starting folder (e.g. just /docs/…)
        </label>
        <p className="tool-muted ss-hint">
          Follows links on the same site and saves each page as an <code>.html</code> file in the site’s folder structure, with stylesheets in <code>css/</code> and
          scripts in <code>js/</code>. Links between saved pages are made relative, so <code>index.html</code> opens offline. Images and fonts aren’t
          downloaded; they still load from the live site. Content that scripts load later isn’t captured.
        </p>
      </form>

      {running && (
        <div className="tool-panel ss-progress" aria-live="polite">
          <div className="ss-progress-head">
            <span><i className="fa-solid fa-spinner fa-spin" aria-hidden="true" /> {phaseText}</span>
            <span className="tool-muted">{elapsed}s</span>
          </div>
          <div className="ss-meter">
            <span style={{ width: `${running.phase === 'pages' ? Math.min(100, (running.pages / running.limit) * 100) : 100}%` }} />
          </div>
          {running.last && <div className="tool-mono tool-muted ss-last">{running.last}</div>}
        </div>
      )}

      {error && <div className="top-error" role="alert">{error}</div>}

      {result && (
        <div className="tool-panel">
          <div className="ss-summary">
            <div className="ss-summary-text">
              <strong>{result.title || new URL(result.root).hostname}</strong>
              <a href={result.root} target="_blank" rel="noopener noreferrer" className="tool-mono ss-root">{result.root}</a>
            </div>
            <button type="button" className="btn btn-sm btn-primary" onClick={downloadAgain} disabled={saving}>
              <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-file-zipper'}`} aria-hidden="true" /> Download ZIP ({formatBytes(result.bytes)})
            </button>
          </div>
          <div className="ss-stats">
            <span className="tool-badge ok">{result.stats.pages} page{result.stats.pages === 1 ? '' : 's'}</span>
            <span className="tool-badge">{result.stats.css} CSS</span>
            <span className="tool-badge">{result.stats.js} JS</span>
            {result.stats.failed > 0 && <span className="tool-badge bad">{result.stats.failed} failed</span>}
          </div>
          {result.warnings.length > 0 && (
            <ul className="ss-warnings">
              {result.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}

          <h2 className="ss-h">Saved pages</h2>
          <div className="tool-table-wrap">
            <table className="tool-table">
              <thead>
                <tr><th>File</th><th>Title</th><th>URL</th></tr>
              </thead>
              <tbody>
                {result.pages.map((p) => (
                  <tr key={p.path}>
                    <td className="tool-mono">{p.path}</td>
                    <td>{p.title || <span className="tool-muted">—</span>}</td>
                    <td className="tool-mono"><a href={p.url} target="_blank" rel="noopener noreferrer">{p.url}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.failed.length > 0 && (
            <details className="ss-failed">
              <summary>{result.failed.length} URL{result.failed.length === 1 ? '' : 's'} not saved</summary>
              <ul>
                {result.failed.map((f) => (
                  <li key={f.url}><span className="tool-mono">{f.url}</span> <span className="tool-muted">— {f.reason}</span></li>
                ))}
              </ul>
            </details>
          )}
          <p className="tool-muted ss-hint">The zip stays available for 10 minutes. It also has manifest.json (original URL → file) and errors.txt.</p>
        </div>
      )}
    </div>
  );
}

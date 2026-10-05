'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import './asset-downloader.css';

const TYPES = [
  { id: 'image', label: 'Images', icon: 'fa-image' },
  { id: 'css', label: 'Stylesheets', icon: 'fa-palette' },
  { id: 'js', label: 'Scripts', icon: 'fa-code' },
  { id: 'font', label: 'Fonts', icon: 'fa-font' },
  { id: 'icon', label: 'Icons', icon: 'fa-icons' },
  { id: 'media', label: 'Media', icon: 'fa-film' },
  { id: 'document', label: 'Documents', icon: 'fa-file-lines' },
  { id: 'other', label: 'Other', icon: 'fa-file' },
];
const typeMeta = (id) => TYPES.find((t) => t.id === id) || TYPES[TYPES.length - 1];
const MAX_ZIP_FILES = 300;
const VIEW_KEY = 'mytrack.assetDownloader.view';

async function api(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Something went wrong.');
  return json;
}

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

const hasThumb = (a) => (a.type === 'image' || a.type === 'icon') && a.url.startsWith('https:');

function Thumb({ asset, broken, onBroken }) {
  if (hasThumb(asset) && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={asset.url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={onBroken} />;
  }
  return <i className={`fa-solid ${typeMeta(asset.type).icon}`} aria-hidden="true" />;
}

export default function AssetDownloader() {
  const [url, setUrl] = useState('');
  const [includeDocs, setIncludeDocs] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState('list');
  const [broken, setBroken] = useState(() => new Set());
  const [sizes, setSizes] = useState({});
  const [sizing, setSizing] = useState(false);
  const [download, setDownload] = useState(null); // { received, started } while busy
  const [notice, setNotice] = useState(null); // { text, bad } shown in the action bar
  const abortRef = useRef(null);
  const [, tick] = useState(0);

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === 'grid' || v === 'list') setView(v);
    } catch {}
  }, []);
  const changeView = (v) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };

  // Re-render once a second so the elapsed time moves while zipping.
  useEffect(() => {
    if (!download) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [download]);

  const assets = useMemo(() => result?.assets || [], [result]);
  const counts = useMemo(() => {
    const c = {};
    for (const a of assets) c[a.type] = (c[a.type] || 0) + 1;
    return c;
  }, [assets]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => (filter === 'all' || a.type === filter) && (!q || a.url.toLowerCase().includes(q) || a.source.toLowerCase().includes(q)));
  }, [assets, filter, query]);
  const selectedAssets = useMemo(() => assets.filter((a) => selected.has(a.url)), [assets, selected]);
  const knownBytes = selectedAssets.reduce((sum, a) => sum + (sizes[a.url]?.size || 0), 0);
  const shownSelected = shown.filter((a) => selected.has(a.url)).length;

  async function scan(e) {
    e.preventDefault();
    if (!url.trim() || scanning) return;
    setScanning(true);
    setError('');
    setNotice(null);
    try {
      const target = withScheme(url);
      const json = await api('/api/tools/asset-downloader/scan', { url: target, includeDocuments: includeDocs });
      setResult(json);
      setSelected(new Set());
      setSizes({});
      setBroken(new Set());
      setFilter('all');
      setQuery('');
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  }

  const toggle = (href) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
  const selectMany = (list, on) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const a of list) (on ? next.add(a.url) : next.delete(a.url));
      return next;
    });
  const markBroken = (href) => setBroken((prev) => new Set(prev).add(href));

  async function getSizes() {
    const urls = selectedAssets.map((a) => a.url).filter((u) => !sizes[u]).slice(0, MAX_ZIP_FILES);
    if (!urls.length) return;
    setSizing(true);
    setError('');
    try {
      const { results } = await api('/api/tools/asset-downloader/sizes', { urls });
      setSizes((prev) => {
        const next = { ...prev };
        for (const r of results) next[r.url] = r;
        return next;
      });
    } catch (err) {
      setNotice({ bad: true, text: err.message });
    } finally {
      setSizing(false);
    }
  }

  async function downloadZip() {
    if (!selectedAssets.length || download) return;
    if (selectedAssets.length > MAX_ZIP_FILES) {
      setNotice({ bad: true, text: `A zip can hold at most ${MAX_ZIP_FILES} files — you have ${selectedAssets.length} selected.` });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setNotice(null);
    setDownload({ received: 0, started: Date.now() });
    try {
      const res = await fetch('/api/tools/asset-downloader/zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageUrl: result.finalUrl, assets: selectedAssets.map((a) => ({ url: a.url, type: a.type })) }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Could not build the zip.');
      }
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        setDownload((d) => (d ? { ...d, received } : d));
      }
      const blob = new Blob(chunks, { type: 'application/zip' });
      let host = 'page';
      try {
        host = new URL(result.finalUrl).hostname.replace(/^www\./, '');
      } catch {}
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `assets-${host}-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10000);
      const files = Number(res.headers.get('X-Asset-Files')) || 0;
      const skipped = Number(res.headers.get('X-Asset-Skipped')) || 0;
      setNotice({
        text: `Saved ${files} file${files === 1 ? '' : 's'} (${formatBytes(blob.size)} zip).` +
          (skipped ? ` ${skipped} could not be downloaded — they're listed in errors.txt and manifest.json inside the zip.` : ''),
      });
    } catch (err) {
      setNotice(err.name === 'AbortError' ? { text: 'Download cancelled.' } : { bad: true, text: err.message });
    } finally {
      abortRef.current = null;
      setDownload(null);
    }
  }

  const perTypeSelect = (e) => {
    const t = e.target.value;
    e.target.value = '';
    if (t) selectMany(assets.filter((a) => a.type === t), true);
  };

  return (
    <div className="ad">
      <form className="tool-panel" onSubmit={scan}>
        <div className="ad-scan-row">
          <div className="ad-url">
            <label className="field-label" htmlFor="ad-url">Page URL</label>
            <input
              id="ad-url"
              className="input"
              type="text"
              inputMode="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={scanning || !url.trim()}>
            <i className={`fa-solid ${scanning ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'}`} /> {scanning ? 'Scanning…' : 'Scan page'}
          </button>
        </div>
        <label className="ad-check">
          <input type="checkbox" checked={includeDocs} onChange={(e) => setIncludeDocs(e.target.checked)} />
          Also list linked documents (PDF, ZIP, Office files…)
        </label>
        <p className="tool-muted ad-hint">
          Reads the page’s HTML and up to 20 of its stylesheets (for fonts and background images). Assets added later by scripts aren’t seen.
        </p>
      </form>

      {error && <div className="top-error" role="alert">{error}</div>}

      {result && (
        <div className="tool-panel ad-results">
          <div className="ad-summary">
            <div className="ad-summary-text">
              <strong>{result.title || new URL(result.finalUrl).hostname}</strong>
              <a href={result.finalUrl} target="_blank" rel="noopener noreferrer" className="tool-mono ad-final">{result.finalUrl}</a>
            </div>
            <span className="tool-muted">
              {assets.length} asset{assets.length === 1 ? '' : 's'} · {result.cssScanned} stylesheet{result.cssScanned === 1 ? '' : 's'} read
            </span>
          </div>
          {(result.truncated || result.warnings?.length > 0) && (
            <ul className="ad-warnings">
              {result.truncated && <li>Only the first 1000 assets are listed.</li>}
              {result.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}

          {assets.length === 0 ? (
            <div className="tool-empty">No assets found on this page.</div>
          ) : (
            <>
              <div className="ad-chips" role="group" aria-label="Filter by type">
                <button type="button" className={`ad-chip${filter === 'all' ? ' active' : ''}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                  All <span>{assets.length}</span>
                </button>
                {TYPES.filter((t) => counts[t.id]).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`ad-chip${filter === t.id ? ' active' : ''}`}
                    aria-pressed={filter === t.id}
                    onClick={() => setFilter(t.id)}
                  >
                    <i className={`fa-solid ${t.icon}`} aria-hidden="true" /> {t.label} <span>{counts[t.id]}</span>
                  </button>
                ))}
              </div>

              <div className="ad-toolbar">
                <input
                  className="input ad-search"
                  type="search"
                  placeholder="Search URLs…"
                  aria-label="Search assets"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div className="tool-row">
                  <button type="button" className="btn btn-sm" onClick={() => selectMany(shown, true)} disabled={!shown.length}>
                    Select shown
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())} disabled={!selected.size}>
                    Select none
                  </button>
                  <select className="input ad-type-select" aria-label="Select every asset of a type" defaultValue="" onChange={perTypeSelect}>
                    <option value="">Select type…</option>
                    {TYPES.filter((t) => counts[t.id]).map((t) => (
                      <option key={t.id} value={t.id}>All {t.label.toLowerCase()} ({counts[t.id]})</option>
                    ))}
                  </select>
                  <div className="ad-seg" role="group" aria-label="View">
                    <button type="button" className={view === 'list' ? 'active' : ''} aria-pressed={view === 'list'} onClick={() => changeView('list')} title="List view" aria-label="List view">
                      <i className="fa-solid fa-list" aria-hidden="true" />
                    </button>
                    <button type="button" className={view === 'grid' ? 'active' : ''} aria-pressed={view === 'grid'} onClick={() => changeView('grid')} title="Grid view" aria-label="Grid view">
                      <i className="fa-solid fa-table-cells-large" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>

              {shown.length === 0 ? (
                <div className="tool-empty">Nothing matches that filter.</div>
              ) : view === 'list' ? (
                <div className="ad-list" role="list">
                  <label className="ad-list-head">
                    <input
                      type="checkbox"
                      checked={shownSelected === shown.length}
                      ref={(el) => {
                        if (el) el.indeterminate = shownSelected > 0 && shownSelected < shown.length;
                      }}
                      onChange={(e) => selectMany(shown, e.target.checked)}
                    />
                    <span>{shownSelected ? `${shownSelected} of ${shown.length} shown selected` : `${shown.length} shown`}</span>
                  </label>
                  {shown.map((a) => {
                    const info = sizes[a.url];
                    return (
                      <div key={a.url} role="listitem" className={`ad-item${selected.has(a.url) ? ' on' : ''}`}>
                        <input type="checkbox" checked={selected.has(a.url)} onChange={() => toggle(a.url)} aria-label={`Select ${a.name}`} />
                        <span className="ad-thumb" onClick={() => toggle(a.url)}>
                          <Thumb asset={a} broken={broken.has(a.url)} onBroken={() => markBroken(a.url)} />
                        </span>
                        <div className="ad-item-main" onClick={() => toggle(a.url)}>
                          <div className="ad-name" title={a.name}>{a.name}</div>
                          <div className="ad-url-line tool-mono" title={a.url}>{a.url}</div>
                          <div className="ad-meta">
                            <span className="tool-badge">{typeMeta(a.type).label.replace(/s$/, '')}</span>
                            <span className="tool-muted">{a.source}</span>
                            {info && (info.error ? (
                              <span className="tool-badge bad">{info.error}</span>
                            ) : (
                              <>
                                {info.status >= 400 && <span className="tool-badge bad">HTTP {info.status}</span>}
                                {info.size != null && <span className="tool-badge ok">{formatBytes(info.size)}</span>}
                                {info.contentType && <span className="tool-muted tool-mono">{info.contentType}</span>}
                              </>
                            ))}
                          </div>
                        </div>
                        <a className="btn btn-sm btn-ghost" href={a.url} target="_blank" rel="noopener noreferrer" title="Open original" aria-label={`Open ${a.name}`}>
                          <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
                        </a>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="ad-grid" role="list">
                  {shown.map((a) => {
                    const info = sizes[a.url];
                    return (
                      <div key={a.url} role="listitem" className={`ad-card${selected.has(a.url) ? ' on' : ''}`}>
                        <button type="button" className="ad-card-thumb" onClick={() => toggle(a.url)} aria-pressed={selected.has(a.url)} aria-label={`Select ${a.name}`}>
                          <Thumb asset={a} broken={broken.has(a.url)} onBroken={() => markBroken(a.url)} />
                          <span className="ad-card-check" aria-hidden="true"><i className="fa-solid fa-check" /></span>
                        </button>
                        <div className="ad-card-body">
                          <div className="ad-name" title={a.url}>{a.name}</div>
                          <div className="ad-card-foot">
                            <span className="tool-muted">
                              {typeMeta(a.type).label.replace(/s$/, '')}
                              {info?.size != null && ` · ${formatBytes(info.size)}`}
                              {info?.error && ' · failed'}
                            </span>
                            <a href={a.url} target="_blank" rel="noopener noreferrer" title="Open original" aria-label={`Open ${a.name}`}>
                              <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
                            </a>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {result && assets.length > 0 && (
        <div className="ad-bar" aria-live="polite">
          {notice && <div className={`ad-bar-msg${notice.bad ? ' bad' : ''}`} role={notice.bad ? 'alert' : 'status'}>{notice.text}</div>}
          <div className="ad-bar-text">
            <strong>{selected.size}</strong> selected
            {knownBytes > 0 && <span className="tool-muted"> · {formatBytes(knownBytes)} known</span>}
            {selected.size > MAX_ZIP_FILES && <span className="ad-over"> · max {MAX_ZIP_FILES} per zip</span>}
            {download && (
              <span className="tool-muted">
                {' '}· {download.received ? `receiving ${formatBytes(download.received)}` : 'fetching files'}… {Math.round((Date.now() - download.started) / 1000)}s
              </span>
            )}
          </div>
          <div className="tool-row">
            <button type="button" className="btn btn-sm" onClick={getSizes} disabled={!selected.size || sizing || !!download}>
              <i className={`fa-solid ${sizing ? 'fa-spinner fa-spin' : 'fa-weight-hanging'}`} aria-hidden="true" /> {sizing ? 'Checking…' : 'Get sizes'}
            </button>
            {download ? (
              <button type="button" className="btn btn-sm btn-danger" onClick={() => abortRef.current?.abort()}>
                <i className="fa-solid fa-xmark" aria-hidden="true" /> Cancel
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={downloadZip}
                disabled={!selected.size || selected.size > MAX_ZIP_FILES}
              >
                <i className="fa-solid fa-file-zipper" aria-hidden="true" /> Download ZIP
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

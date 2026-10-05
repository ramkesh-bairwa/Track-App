'use client';

import { useMemo, useRef, useState } from 'react';
import './url-checker.css';

const MAX_URLS = 50;
const FILTERS = [
  ['all', 'All'],
  ['ok', 'OK'],
  ['redirect', 'Redirected'],
  ['broken', 'Broken'],
  ['error', 'Error'],
  ['pending', 'Pending'],
];
const SORTS = [
  ['order', 'Original order'],
  ['status', 'Status'],
  ['time', 'Slowest first'],
];

const kindOf = (r) => {
  if (r.pending) return 'pending';
  if (r.error) return 'error';
  if (r.status >= 400) return 'broken';
  if (r.status >= 300 || r.redirects?.length) return 'redirect';
  return 'ok';
};
const isFailed = (r) => ['broken', 'error'].includes(kindOf(r));
const isWebUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
const fmtMs = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const fmtBytes = (n) => {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
const shortType = (t) => (t ? t.split(';')[0].trim() : '—');

function parseLines(text) {
  const seen = new Set();
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const v = line.trim();
    if (!v) continue;
    // Same rule as the server: bare domains get https://, so "a.com" and "https://a.com" are one URL.
    const key = (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[\w.-]+:\d/.test(v) ? v : `https://${v}`).replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

// Quotes when needed and defuses spreadsheet formulas.
const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function StatusBadge({ row }) {
  const kind = kindOf(row);
  if (kind === 'pending') return <span className="tool-badge uc-pending"><i className="fa-solid fa-spinner fa-spin" aria-hidden="true" /> Checking</span>;
  if (kind === 'error') return <span className="tool-badge bad" title={row.error.message}><i className="fa-solid fa-circle-exclamation" aria-hidden="true" /> {row.error.label}</span>;
  const cls = kind === 'ok' ? 'ok' : kind === 'redirect' ? 'warn' : 'bad';
  return <span className={`tool-badge ${cls}`}>{row.status} {row.statusText}</span>;
}

// Reads an NDJSON response line by line.
async function readLines(res, onLine) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onLine(JSON.parse(line));
    }
  }
  if (buf.trim()) onLine(JSON.parse(buf));
}

export default function UrlChecker() {
  const [mode, setMode] = useState('list');
  const [text, setText] = useState('');
  const [pageUrl, setPageUrl] = useState('');
  const [rows, setRows] = useState([]);
  const [source, setSource] = useState(null);
  const [elapsed, setElapsed] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('order');
  const [note, setNote] = useState('');
  const abortRef = useRef(null);

  const lines = useMemo(() => parseLines(text), [text]);

  // Sends one request and streams results into rows; `slots` maps response index → row index.
  const stream = async (payload, slots, signal) => {
    const res = await fetch('/api/tools/url-checker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || 'Something went wrong.');
    }
    let startMsg = null;
    await readLines(res, (msg) => {
      if (msg.type === 'start') {
        startMsg = msg;
        if (!slots) {
          setSource(msg.source);
          setRows(msg.items.map((url, i) => ({ id: i, url, pending: true })));
        }
      } else if (msg.type === 'result') {
        const at = slots ? slots[msg.index] : msg.index;
        setRows((prev) => prev.map((r) => (r.id === at ? { ...msg, id: at, type: undefined } : r)));
      } else if (msg.type === 'done' && !slots) {
        setElapsed(msg.elapsedMs);
      }
    });
    return startMsg;
  };

  const start = async (e) => {
    e?.preventDefault();
    if (running) return;
    setError('');
    setNote('');
    let payload;
    if (mode === 'list') {
      if (!lines.length) return setError('Paste at least one URL.');
      if (lines.length > MAX_URLS) return setError(`You can check up to ${MAX_URLS} URLs at a time — you have ${lines.length}.`);
      payload = { urls: lines };
    } else {
      if (!pageUrl.trim()) return setError('Enter the page to take links from.');
      payload = { pageUrl: pageUrl.trim() };
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setRows([]);
    setSource(null);
    setElapsed(null);
    setFilter('all');
    try {
      await stream(payload, null, ctrl.signal);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setRunning(false);
      abortRef.current = null;
      markStopped();
    }
  };

  // Rows still pending after a stop never got a result.
  const markStopped = () => {
    setRows((prev) => prev.map((r) => (r.pending ? { ...r, pending: false, status: null, redirects: [], error: { category: 'stopped', label: 'Stopped', message: 'Check was stopped' } } : r)));
  };

  const recheckFailed = async () => {
    const failed = rows.filter(isFailed);
    if (!failed.length || running) return;
    setError('');
    setNote('');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setFilter('all');
    const ids = new Set(failed.map((r) => r.id));
    setRows((prev) => prev.map((r) => (ids.has(r.id) ? { id: r.id, url: r.url, input: r.input, pending: true } : r)));
    try {
      for (let i = 0; i < failed.length && !ctrl.signal.aborted; i += MAX_URLS) {
        const chunk = failed.slice(i, i + MAX_URLS);
        await stream({ urls: chunk.map((r) => r.url) }, chunk.map((r) => r.id), ctrl.signal);
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setRunning(false);
      abortRef.current = null;
      markStopped();
    }
  };

  const counts = useMemo(() => {
    const c = { all: rows.length, ok: 0, redirect: 0, broken: 0, error: 0, pending: 0 };
    for (const r of rows) c[kindOf(r)] += 1;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const list = filter === 'all' ? [...rows] : rows.filter((r) => kindOf(r) === filter);
    if (sort === 'status') list.sort((a, b) => (a.status ?? 1000) - (b.status ?? 1000) || a.id - b.id);
    else if (sort === 'time') list.sort((a, b) => (b.timeMs ?? -1) - (a.timeMs ?? -1));
    return list;
  }, [rows, filter, sort]);

  const done = rows.length - counts.pending;

  const exportCsv = () => {
    const head = ['url', 'final_url', 'result', 'status', 'status_text', 'time_ms', 'content_type', 'content_length', 'https', 'redirects', 'error_type', 'error'];
    const body = rows.map((r) => [
      r.url, r.finalUrl, kindOf(r), r.status, r.statusText, r.timeMs, r.contentType, r.contentLength,
      r.https == null ? '' : r.https ? 'yes' : 'no',
      (r.redirects || []).map((h) => `${h.status} ${h.url}`).join(' -> '),
      r.error?.label, r.error?.message,
    ].map(csvCell).join(','));
    const blob = new Blob([`${[head.join(','), ...body].join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `url-check-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const copyBroken = async () => {
    const list = rows.filter(isFailed).map((r) => r.url);
    try {
      await navigator.clipboard.writeText(list.join('\n'));
      setNote(`Copied ${list.length} URL${list.length === 1 ? '' : 's'}.`);
    } catch {
      setError('Could not copy to the clipboard.');
    }
  };

  const failedCount = counts.broken + counts.error;

  return (
    <div className="tool-split uc">
      <form className="tool-panel" onSubmit={start}>
        <div className="uc-modes" role="radiogroup" aria-label="What to check">
          {[['list', 'List of URLs', 'fa-list'], ['page', 'All links on a page', 'fa-file-lines']].map(([id, label, icon]) => (
            <button key={id} type="button" role="radio" aria-checked={mode === id} className={`uc-mode${mode === id ? ' active' : ''}`} onClick={() => setMode(id)} disabled={running}>
              <i className={`fa-solid ${icon}`} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>

        {mode === 'list' ? (
          <div className="field-group">
            <label className="field-label" htmlFor="uc-urls">URLs, one per line</label>
            <textarea
              id="uc-urls"
              className="input input-mono uc-textarea"
              rows={10}
              spellCheck={false}
              placeholder={'https://example.com\nexample.org/about\nhttps://httpbin.org/status/404'}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <p className={`field-hint${lines.length > MAX_URLS ? ' uc-over' : ''}`}>
              {lines.length} unique URL{lines.length === 1 ? '' : 's'} · up to {MAX_URLS}. Bare domains get https://.
            </p>
          </div>
        ) : (
          <div className="field-group">
            <label className="field-label" htmlFor="uc-page">Page URL</label>
            <input
              id="uc-page"
              className="input"
              type="text"
              inputMode="url"
              spellCheck={false}
              placeholder="https://example.com"
              value={pageUrl}
              onChange={(e) => setPageUrl(e.target.value)}
            />
            <p className="field-hint">Checks every http(s) link on the page (first 100, duplicates removed).</p>
          </div>
        )}

        <div className="tool-row">
          <button type="submit" className="btn btn-primary" disabled={running}>
            {running ? <><i className="fa-solid fa-spinner fa-spin" /> Checking…</> : <><i className="fa-solid fa-play" /> Check</>}
          </button>
          {running && (
            <button type="button" className="btn btn-danger" onClick={() => abortRef.current?.abort()}>
              <i className="fa-solid fa-stop" /> Stop
            </button>
          )}
        </div>
        <p className="tool-muted uc-note">Checked from the MyTrack server: HEAD first (GET if the site refuses HEAD), 10 s per URL, 5 at a time. Private and local addresses are blocked.</p>
      </form>

      <div className="uc-results">
        {error && <div className="top-error" role="alert">{error}</div>}

        {!rows.length && !running && <div className="tool-panel tool-empty">Results appear here as each URL finishes.</div>}
        {!rows.length && running && <div className="tool-panel tool-empty"><i className="fa-solid fa-spinner fa-spin" /> {mode === 'page' ? 'Reading the page’s links…' : 'Starting…'}</div>}

        {rows.length > 0 && (
          <div className="tool-panel">
            {source && (
              <p className="tool-muted uc-source">
                {source.linksFound} link{source.linksFound === 1 ? '' : 's'} found on <span className="tool-mono">{source.pageUrl}</span>
                {source.truncated && ` — checking the first ${rows.length}`}.
              </p>
            )}
            <div className="uc-progress" aria-live="polite">
              <div className="uc-progress-bar" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={rows.length} aria-valuenow={done}>
                <span style={{ width: `${rows.length ? (done / rows.length) * 100 : 0}%` }} />
              </div>
              <span className="tool-muted">
                {done} / {rows.length} checked{elapsed != null && !running ? ` in ${fmtMs(elapsed)}` : ''}
              </span>
            </div>

            <div className="uc-summary">
              <div><strong className="uc-n-ok">{counts.ok}</strong><span>OK</span></div>
              <div><strong className="uc-n-redirect">{counts.redirect}</strong><span>Redirected</span></div>
              <div><strong className="uc-n-bad">{counts.broken}</strong><span>Broken</span></div>
              <div><strong className="uc-n-bad">{counts.error}</strong><span>Errors</span></div>
            </div>

            <div className="uc-toolbar">
              <div className="uc-chips" role="group" aria-label="Filter results">
                {FILTERS.filter(([id]) => id === 'all' || counts[id] || filter === id).map(([id, label]) => (
                  <button key={id} type="button" className={`uc-chip${filter === id ? ' active' : ''}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                    {label} <span>{counts[id]}</span>
                  </button>
                ))}
              </div>
              <label className="uc-sort">
                <span className="tool-muted">Sort</span>
                <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
                  {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
            </div>

            <div className="tool-row uc-actions">
              <button type="button" className="btn btn-sm" onClick={recheckFailed} disabled={running || !failedCount}>
                <i className="fa-solid fa-rotate-right" /> Re-check failed{failedCount ? ` (${failedCount})` : ''}
              </button>
              <button type="button" className="btn btn-sm" onClick={copyBroken} disabled={!failedCount}>
                <i className="fa-solid fa-copy" /> Copy broken URLs
              </button>
              <button type="button" className="btn btn-sm" onClick={exportCsv} disabled={!done}>
                <i className="fa-solid fa-file-csv" /> Export CSV
              </button>
              {note && <span className="tool-muted" role="status">{note}</span>}
            </div>

            {shown.length ? (
              <div className="tool-table-wrap">
                <table className="tool-table uc-table">
                  <thead>
                    <tr>
                      <th>URL</th>
                      <th>Status</th>
                      <th>Time</th>
                      <th>Type</th>
                      <th>Size</th>
                      <th><span className="uc-sr">HTTPS</span><i className="fa-solid fa-lock" aria-hidden="true" title="Ends on HTTPS" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.id} className={`uc-row uc-${kindOf(r)}`}>
                        <td data-label="URL" className="uc-url">
                          {isWebUrl(r.url) ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.url}</a> : <span className="tool-mono">{r.url}</span>}
                          {r.redirects?.length > 0 && (
                            <details className="uc-chain">
                              <summary>{r.redirects.length} redirect{r.redirects.length > 1 ? 's' : ''} → <span className="tool-mono">{r.finalUrl}</span></summary>
                              <ol>
                                {r.redirects.map((h, i) => <li key={i}><span className="tool-badge warn">{h.status}</span> <span className="tool-mono">{h.url}</span></li>)}
                                <li><span className="tool-badge">{r.status}</span> <span className="tool-mono">{r.finalUrl}</span></li>
                              </ol>
                            </details>
                          )}
                          {r.error && r.error.category !== 'stopped' && <div className="uc-err">{r.error.message}</div>}
                        </td>
                        <td data-label="Status"><StatusBadge row={r} />{r.method === 'GET' && <span className="uc-method" title="HEAD was refused, checked with GET">GET</span>}</td>
                        <td data-label="Time" className={r.timeMs > 3000 ? 'uc-slow' : undefined}>{r.pending ? '…' : fmtMs(r.timeMs)}</td>
                        <td data-label="Type" className="tool-mono">{shortType(r.contentType)}</td>
                        <td data-label="Size">{fmtBytes(r.contentLength)}</td>
                        <td data-label="HTTPS">
                          {r.https == null ? <span className="tool-muted">—</span> : r.https
                            ? <i className="fa-solid fa-lock uc-https" title="Ends on HTTPS" aria-label="Ends on HTTPS" />
                            : <i className="fa-solid fa-lock-open uc-http" title="Ends on plain HTTP" aria-label="Ends on plain HTTP" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="tool-empty">No results match this filter.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './downloader.css';
import { safeLink } from '@/lib/safeUrl';
import ConfirmModal from '@/components/ConfirmModal';
import { DATE_LOCALE } from '@/lib/dateLocale';

const BASE = '/api/downloader';
const COUNT_PRESETS = [5, 10, 25, 50, 100];
const TABS = [
  { key: 'search', label: 'Search & download', icon: 'fa-solid fa-magnifying-glass' },
  { key: 'urls', label: 'From image URL', icon: 'fa-solid fa-link' },
  { key: 'webpage', label: 'From a web page', icon: 'fa-solid fa-globe' },
  { key: 'albums', label: 'Albums', icon: 'fa-solid fa-images' },
];
const TYPE_LABEL = { pexels: 'Pexels search', webpage: 'Web page', url: 'Image URLs' };
const SAVE_KEY = 'mytrack_downloader_save';
const STATUS_LABEL = {
  pending: 'Waiting',
  downloading: 'Downloading…',
  done: 'Saved',
  failed: 'Failed',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
};

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message || 'Something went wrong.'), { code: data.error?.code, status: res.status });
  return data;
}

const enc = encodeURIComponent;
function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}
const albumTitle = (a) => (a.title || a.name).replace(/_/g, ' ');

// ---------- "Save to": the project's downloads folder, or a pasted path ----------
function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY)) || {};
  } catch {
    return {};
  }
}

// Remembers the last choice in this browser. Returns the request fields
// ({ saveTo, subfolder } or {}) through onChange, plus whether it's usable.
function SaveTo({ config, onChange }) {
  const [state, setState] = useState(() => ({ mode: 'default', path: '', subfolder: true, ...loadSaved() }));
  const [check, setCheck] = useState(null); // { ok, text }
  const [checking, setChecking] = useState(false);
  const { mode, path, subfolder } = state;
  const set = (patch) => setState((s) => ({ ...s, ...patch }));

  useEffect(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch {}
    const custom = mode === 'custom';
    onChange({ fields: custom ? { saveTo: path.trim(), subfolder } : {}, ready: !custom || Boolean(path.trim()) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, path, subfolder]);
  useEffect(() => setCheck(null), [path]);

  async function checkPath() {
    setChecking(true);
    try {
      const r = await api('/paths/check', { method: 'POST', body: { path: path.trim() } });
      setCheck(
        !r.writable
          ? { ok: false, text: `Can’t write to ${r.path}` }
          : { ok: true, text: r.exists ? `✓ ${r.path}` : `✓ ${r.path} (will be created)` }
      );
    } catch (err) {
      setCheck({ ok: false, text: err.message });
    } finally {
      setChecking(false);
    }
  }

  return (
    <fieldset className="dl-saveto">
      <legend className="field-label">Save to</legend>
      <label className="dl-radio">
        <input type="radio" checked={mode === 'default'} onChange={() => set({ mode: 'default' })} />
        <span>
          This project’s downloads folder <span className="dl-muted">(default)</span>
          {config?.save?.defaultDir && <code className="dl-path">{config.save.defaultDir}</code>}
        </span>
      </label>
      <label className="dl-radio">
        <input type="radio" checked={mode === 'custom'} onChange={() => set({ mode: 'custom' })} />
        <span>A folder of my choice</span>
      </label>
      {mode === 'custom' && (
        <div className="dl-saveto-custom">
          <div className="dl-url-row">
            <input className="input input-mono" value={path} placeholder="Paste a folder path, e.g. ~/Pictures/wallpapers"
              onChange={(e) => set({ path: e.target.value })} spellCheck={false} />
            <button type="button" className="btn btn-sm" onClick={checkPath} disabled={!path.trim() || checking}>{checking ? 'Checking…' : 'Check'}</button>
          </div>
          {check && <p className={`field-hint ${check.ok ? 'dl-ok' : 'dl-bad'}`}>{check.text}</p>}
          <label className="checkbox-row">
            <input type="checkbox" checked={subfolder} onChange={(e) => set({ subfolder: e.target.checked })} />
            Put this download in its own new subfolder (date + title)
          </label>
          <p className="field-hint">
            Tip: in Finder, right-click a folder, hold ⌥ Option and choose “Copy … as Pathname”. Missing folders are created.
            {config?.save?.allowedRoots && ` Must be inside ${config.save.allowedRoots.join(' or ')}.`}
          </p>
        </div>
      )}
    </fieldset>
  );
}

function SavedTo({ album, path }) {
  const [copied, setCopied] = useState(false);
  if (!path) return null;
  async function copy() {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <div className="dl-savedto">
      <i className="fa-regular fa-folder-open" />
      <code className="dl-path" title={path}>{path}</code>
      <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>{copied ? 'Copied' : 'Copy path'}</button>
      {album && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => api(`/albums/${enc(album)}/reveal`, { method: 'POST' }).catch(() => {})}>
          Open folder
        </button>
      )}
    </div>
  );
}

function Modal({ children, onClose, wide }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal${wide ? ' dl-modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body
  );
}

// ---------- live progress for one job ----------
function useJob(jobId) {
  const [job, setJob] = useState(null);
  const [items, setItems] = useState([]);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    if (!jobId) return undefined;
    setJob(null);
    setItems([]);
    setLost(false);
    const es = new EventSource(`${BASE}/jobs/${jobId}/events`);
    const parse = (e) => JSON.parse(e.data);
    es.addEventListener('progress', (e) => setJob(parse(e)));
    es.addEventListener('items', (e) => setItems(parse(e)));
    es.addEventListener('item', (e) => {
      const item = parse(e);
      setItems((list) => {
        const next = list.slice();
        next[item.index] = item;
        return next;
      });
    });
    es.addEventListener('done', (e) => {
      es.close();
      // Final state straight from the job record, so nothing sent while
      // the stream was reconnecting is missed.
      api(`/jobs/${jobId}`)
        .then((full) => {
          setJob(full);
          if (full.items?.length) setItems(full.items);
        })
        .catch(() => setJob(parse(e)));
    });
    es.onerror = () => {
      // EventSource retries by itself; stop only if the job is gone (server restarted).
      api(`/jobs/${jobId}`).catch((err) => {
        if (err.status === 404) {
          es.close();
          setLost(true);
        }
      });
    };
    return () => es.close();
  }, [jobId]);

  return { job, items, lost };
}

function JobProgress({ jobId, onOpenAlbum, onNew }) {
  const { job, items, lost } = useJob(jobId);
  const listRef = useRef(null);
  const [cancelling, setCancelling] = useState(false);
  const [filter, setFilter] = useState('all');
  const finished = job && ['completed', 'failed', 'cancelled'].includes(job.status);

  // Keep the image currently downloading in view, like a download manager.
  const activeIndex = items.findIndex((i) => i?.status === 'downloading');
  useEffect(() => {
    if (activeIndex < 0 || filter !== 'all') return;
    // Scroll only the queue itself, never the page around it.
    const list = listRef.current;
    const row = list?.querySelector(`[data-index="${activeIndex}"]`);
    if (!row) return;
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTo({ top: top - list.clientHeight / 2 + row.offsetHeight / 2, behavior: 'smooth' });
    }
  }, [activeIndex, filter]);

  async function cancel() {
    setCancelling(true);
    await api(`/jobs/${jobId}/cancel`, { method: 'POST' }).catch(() => {});
  }

  if (lost) {
    return (
      <div className="dl-card">
        <p className="dl-muted">This download is no longer tracked (the server restarted). Images it already saved are in <strong>Albums</strong>.</p>
        <button type="button" className="btn btn-primary" onClick={onNew}>Start a new download</button>
      </div>
    );
  }
  if (!job) return <div className="dl-card dl-muted">Connecting…</div>;

  const title =
    job.type === 'pexels' ? job.params?.query
      : job.type === 'url' ? `${job.params?.imageCount || ''} image URL${job.params?.imageCount === 1 ? '' : 's'}`
      : job.info?.pageTitle || job.params?.url || 'Web page';
  const shown = items.filter((i) => i && (filter === 'all' || (filter === 'failed' ? i.status === 'failed' || i.status === 'skipped' : i.status === filter)));
  const bytes = items.reduce((n, i) => n + (i?.bytes || 0), 0);
  const phase =
    job.status === 'queued' ? 'Starting…'
      : job.status === 'running' && !job.total ? (job.type === 'pexels' ? 'Finding photos on Pexels…' : job.type === 'url' ? 'Starting…' : 'Reading the page…')
      : job.status === 'running' ? `Downloading ${Math.min(job.completed + job.failed + job.skipped + 1, job.total)} of ${job.total}`
      : job.status === 'completed' ? 'Finished'
      : job.status === 'cancelled' ? 'Cancelled'
      : 'Failed';

  return (
    <div className="dl-card dl-progress">
      <div className="dl-progress-head">
        <div>
          <div className="dl-kicker">{TYPE_LABEL[job.type] || job.type}</div>
          <h2>{title}</h2>
          <p className="dl-muted">
            {phase}
            {job.message && ` · ${job.message}`}
          </p>
        </div>
        <div className="dl-actions">
          {!finished && (
            <button type="button" className="btn btn-danger btn-sm" onClick={cancel} disabled={cancelling}>
              {cancelling ? 'Stopping…' : 'Stop'}
            </button>
          )}
          {finished && job.album && (
            <>
              <button type="button" className="btn btn-sm" onClick={() => onOpenAlbum(job.album)}><i className="fa-solid fa-images" /> Open album</button>
              <a className="btn btn-sm" href={`${BASE}/albums/${enc(job.album)}/zip`}><i className="fa-solid fa-file-zipper" /> ZIP</a>
            </>
          )}
          {finished && <button type="button" className="btn btn-primary btn-sm" onClick={onNew}>＋ New download</button>}
        </div>
      </div>

      <SavedTo album={finished ? job.album : null} path={job.info?.savedTo} />

      <div className={`dl-bar ${job.status}`} role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${job.progress}%` }} />
      </div>
      <div className="dl-counts">
        <strong>{job.progress}%</strong>
        <span className="ok">{job.completed} saved</span>
        {job.failed > 0 && <span className="bad">{job.failed} failed</span>}
        {job.skipped > 0 && <span>{job.skipped} skipped</span>}
        <span>{job.total ? `${job.total} total` : ''}</span>
        {bytes > 0 && <span>{formatBytes(bytes)}</span>}
        {items.length > 0 && (
          <select className="input input-sm dl-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All images</option>
            <option value="downloading">Downloading</option>
            <option value="pending">Waiting</option>
            <option value="done">Saved</option>
            <option value="failed">Failed / skipped</option>
          </select>
        )}
      </div>

      <ol className="dl-queue" ref={listRef}>
        {shown.map((item) => (
          <li key={item.index} data-index={item.index} className={`dl-row ${item.status}`}>
            <span className="dl-row-num">{item.index + 1}</span>
            <span className="dl-thumb">
              {item.fileUrl ? <img src={item.fileUrl} alt="" loading="lazy" /> : item.preview ? <img src={item.preview} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <i className="fa-regular fa-image" />}
            </span>
            <span className="dl-row-body">
              <span className="dl-row-name">{item.name || item.label || item.url.split('/').pop().split('?')[0] || item.url}</span>
              <span className="dl-row-sub">{item.error || (item.bytes ? formatBytes(item.bytes) : new URL(item.url).hostname)}</span>
            </span>
            <span className={`dl-status ${item.status}`}>
              {item.status === 'downloading' && <span className="dl-spin" />}
              {STATUS_LABEL[item.status] || item.status}
            </span>
          </li>
        ))}
        {!items.length && !finished && <li className="dl-muted dl-queue-empty">Preparing the list of images…</li>}
      </ol>
    </div>
  );
}

// ---------- Search (Pexels): title → how many → download ----------
function SearchFlow({ config, onStarted }) {
  const [step, setStep] = useState('start');
  const [title, setTitle] = useState('');
  const [count, setCount] = useState(10);
  const [quality, setQuality] = useState('large2x');
  const [orientation, setOrientation] = useState('');
  const [save, setSave] = useState({ fields: {}, ready: true });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const max = config?.pexels?.maxCount || 1000;

  async function toCount(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setError('');
    setBusy(true);
    try {
      const r = await api(`/pexels/search?${new URLSearchParams({ query: title.trim(), perPage: '8', ...(orientation && { orientation }) })}`);
      setPreview(r);
      if (!r.totalResults) setError(`Pexels has no photos for "${title.trim()}". Try another title.`);
      else {
        setCount((c) => Math.min(c, r.totalResults, max));
        setStep('count');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function start(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const job = await api('/pexels/download', { method: 'POST', body: { query: title.trim(), count: Number(count), quality, ...(orientation && { orientation }), ...save.fields } });
      onStarted(job.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (config && !config.pexels.configured) {
    return (
      <div className="dl-card">
        <h2>Pexels key needed</h2>
        <p className="dl-muted">Add <code>PEXELS_API_KEY=…</code> to <code>.env</code> (free at pexels.com/api) and restart the server.</p>
      </div>
    );
  }

  if (step === 'start') {
    return (
      <div className="dl-card dl-hero">
        <i className="fa-solid fa-cloud-arrow-down dl-hero-icon" />
        <h2>Download images by title</h2>
        <p className="dl-muted">Type what you want pictures of, say how many, and they download one by one into a new album.</p>
        <button type="button" className="btn btn-primary" onClick={() => setStep('title')}>Start</button>
      </div>
    );
  }

  const maxCount = Math.min(max, preview?.totalResults || max);
  return (
    <div className="dl-card dl-wizard">
      <ol className="dl-steps">
        <li className={step === 'title' ? 'active' : 'done'}>1 · Title</li>
        <li className={step === 'count' ? 'active' : ''}>2 · Number of images</li>
        <li>3 · Download</li>
      </ol>

      {step === 'title' && (
        <form onSubmit={toCount}>
          <div className="field-group">
            <label className="field-label" htmlFor="dl-title">What should the images be of?</label>
            <input id="dl-title" className="input dl-big-input" value={title} maxLength={200} autoFocus required
              placeholder="e.g. mountains at sunset, office desk, golden retriever" onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="dl-orient">Shape (optional)</label>
            <select id="dl-orient" className="input" value={orientation} onChange={(e) => setOrientation(e.target.value)}>
              <option value="">Any</option>
              {(config?.pexels.orientations || []).map((o) => <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>)}
            </select>
          </div>
          {error && <div className="top-error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setStep('start')}>Back</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !title.trim()}>{busy ? 'Checking…' : 'Next →'}</button>
          </div>
        </form>
      )}

      {step === 'count' && (
        <form onSubmit={start}>
          <p className="dl-muted">
            <strong className="dl-strong">{preview.totalResults.toLocaleString()}</strong> photos found for “{title.trim()}”.
          </p>
          <div className="dl-preview-strip">
            {preview.photos.map((p) => <img key={p.id} src={p.src.tiny} alt={p.alt || ''} referrerPolicy="no-referrer" />)}
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="dl-count">How many images do you want?</label>
            <div className="dl-count-row">
              <input id="dl-count" type="number" className="input dl-count-input" min={1} max={maxCount} value={count} autoFocus required
                onChange={(e) => setCount(e.target.value)} />
              {COUNT_PRESETS.filter((n) => n <= maxCount).map((n) => (
                <button key={n} type="button" className={`btn btn-sm${Number(count) === n ? ' btn-primary' : ''}`} onClick={() => setCount(n)}>{n}</button>
              ))}
            </div>
            <p className="field-hint">Up to {maxCount.toLocaleString()}.</p>
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="dl-quality">Quality</label>
            <select id="dl-quality" className="input" value={quality} onChange={(e) => setQuality(e.target.value)}>
              {(config?.pexels.qualities || []).map((q) => <option key={q.key} value={q.key}>{q.label}</option>)}
            </select>
          </div>
          <SaveTo config={config} onChange={setSave} />
          {error && <div className="top-error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setStep('title')} disabled={busy}>← Back</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !save.ready || !(Number(count) >= 1 && Number(count) <= maxCount)}>
              {busy ? 'Starting…' : `Download ${count} image${Number(count) === 1 ? '' : 's'}`}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------- From image URL: paste links → download ----------
function UrlFlow({ config, onStarted }) {
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [save, setSave] = useState({ fields: {}, ready: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const urls = useMemo(() => [...new Set(text.split(/\s+/).map((u) => u.trim()).filter(Boolean))], [text]);
  const bad = urls.filter((u) => !/^https?:\/\/\S+$/i.test(u));
  const max = config?.webpage?.maxImages || 500;

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const job = await api('/urls/download', { method: 'POST', body: { urls, albumName: name.trim() || undefined, ...save.fields } });
      onStarted(job.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="dl-card dl-wizard" onSubmit={submit}>
      <h2>Download images from their URLs</h2>
      <p className="dl-muted" style={{ marginBottom: 14 }}>Paste direct links to image files — one per line. Each one downloads in turn.</p>
      <div className="field-group">
        <label className="field-label" htmlFor="dl-urls">Image URLs</label>
        <textarea id="dl-urls" className="input input-mono dl-urls" rows={5} value={text} autoFocus spellCheck={false}
          placeholder={'https://images.pexels.com/photos/417074/pexels-photo-417074.jpeg\nhttps://example.com/pictures/cat.png'}
          onChange={(e) => setText(e.target.value)} />
        <p className={`field-hint${bad.length ? ' dl-bad' : ''}`}>
          {bad.length
            ? `Not a web link: ${bad.slice(0, 2).join(', ')}${bad.length > 2 ? ` and ${bad.length - 2} more` : ''}`
            : `${urls.length} URL${urls.length === 1 ? '' : 's'}${urls.length > max ? ` — only ${max} allowed at once` : ''}`}
        </p>
      </div>
      <div className="field-group">
        <label className="field-label" htmlFor="dl-urls-name">Name (optional)</label>
        <input id="dl-urls-name" className="input" value={name} maxLength={80} placeholder="Used for the new folder’s name" onChange={(e) => setName(e.target.value)} />
      </div>
      <SaveTo config={config} onChange={setSave} />
      {error && <div className="top-error">{error}</div>}
      <div className="modal-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !urls.length || bad.length > 0 || urls.length > max || !save.ready}>
          {busy ? 'Starting…' : `Download ${urls.length || ''} image${urls.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </form>
  );
}

// ---------- From a web page: scan → pick → download ----------
function WebpageFlow({ config, onStarted }) {
  const [url, setUrl] = useState('');
  const [scan, setScan] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [hideIcons, setHideIcons] = useState(true);
  const [minKb, setMinKb] = useState(5);
  const [save, setSave] = useState({ fields: {}, ready: true });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const visible = useMemo(() => (scan?.images || []).filter((i) => !hideIcons || i.source !== 'icon'), [scan, hideIcons]);

  async function doScan(e) {
    e.preventDefault();
    setError('');
    setBusy('scan');
    try {
      const r = await api('/webpage/scan', { method: 'POST', body: { url: url.trim() } });
      setScan(r);
      setPicked(new Set(r.images.filter((i) => i.source !== 'icon').map((i) => i.url)));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function download() {
    setError('');
    setBusy('download');
    try {
      const imageUrls = visible.map((i) => i.url).filter((u) => picked.has(u));
      const job = await api('/webpage/download', {
        method: 'POST',
        body: { url: scan.finalUrl, imageUrls, minBytes: Math.max(0, Math.round(Number(minKb) * 1024)) || 0, albumName: scan.title || undefined, ...save.fields },
      });
      onStarted(job.id);
    } catch (err) {
      setError(err.message);
      setBusy('');
    }
  }

  const toggle = (u) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(u)) n.delete(u);
    else n.add(u);
    return n;
  });
  const pickedCount = visible.filter((i) => picked.has(i.url)).length;

  return (
    <div className="dl-card">
      <form className="dl-url-row" onSubmit={doScan}>
        <input className="input" type="url" value={url} required placeholder="https://example.com/gallery" onChange={(e) => setUrl(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={busy === 'scan'}>{busy === 'scan' ? 'Scanning…' : 'Find images'}</button>
      </form>
      <p className="field-hint">Finds images the page’s HTML links to (not ones added later by JavaScript). Up to {config?.webpage.maxImages || 500}.</p>
      {error && <div className="top-error">{error}</div>}

      {scan && (
        <>
          <div className="dl-scan-head">
            <div>
              <strong>{scan.title || scan.finalUrl}</strong>
              <span className="dl-muted"> · {scan.total} found{scan.truncated ? ` (showing first ${scan.images.length})` : ''}</span>
            </div>
            <div className="dl-actions">
              <label className="checkbox-row"><input type="checkbox" checked={hideIcons} onChange={(e) => setHideIcons(e.target.checked)} /> Hide icons</label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set(visible.map((i) => i.url)))}>Select all</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>None</button>
            </div>
          </div>
          <div className="dl-pick-grid">
            {visible.map((img) => (
              <button key={img.url} type="button" className={`dl-pick${picked.has(img.url) ? ' on' : ''}`} onClick={() => toggle(img.url)} title={img.alt || img.url}>
                <img src={img.url} alt={img.alt || ''} loading="lazy" referrerPolicy="no-referrer" />
                <span className="dl-pick-check">{picked.has(img.url) ? '✓' : ''}</span>
                <span className="dl-pick-src">{img.source}</span>
              </button>
            ))}
          </div>
          <SaveTo config={config} onChange={setSave} />
          <div className="dl-scan-foot">
            <label className="dl-minsize">
              Skip files smaller than
              <input type="number" className="input input-sm" min={0} value={minKb} onChange={(e) => setMinKb(e.target.value)} /> KB
            </label>
            <button type="button" className="btn btn-primary" disabled={!pickedCount || !save.ready || busy === 'download'} onClick={download}>
              {busy === 'download' ? 'Starting…' : `Download ${pickedCount} image${pickedCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Albums ----------
function AlbumView({ name, onBack }) {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const [ask, setAsk] = useState(null); // pending delete: { title, message, label, run }

  const load = useCallback(() => {
    api(`/albums/${enc(name)}?page=${page}&limit=60`).then(setData).catch((err) => setError(err.message));
  }, [name, page]);
  useEffect(() => { load(); }, [load]);

  function removeImage(img) {
    setAsk({
      title: `Delete ${img.name}?`,
      message: 'The image file is deleted from disk. This can’t be undone.',
      label: 'Delete image',
      run: async () => {
        await api(`/albums/${enc(name)}/images/${enc(img.name)}`, { method: 'DELETE' });
        setOpen(null);
        load();
      },
    });
  }
  function removeAlbum() {
    setAsk({
      title: data?.external ? 'Delete these downloaded images?' : `Delete the album “${albumTitle(data || { name })}”?`,
      message: data?.external
        ? `The ${data.imageCount} images this tool downloaded into ${data.path} are deleted. Other files in that folder are left alone. This can’t be undone.`
        : `All ${data?.imageCount ?? ''} images in it are deleted from disk. This can’t be undone.`,
      label: data?.external ? 'Delete images' : 'Delete album',
      run: async () => {
        await api(`/albums/${enc(name)}`, { method: 'DELETE' });
        onBack(true);
      },
    });
  }

  const images = data?.images || [];
  const i = open ? images.findIndex((x) => x.name === open.name) : -1;
  return (
    <div className="dl-card">
      <div className="dl-progress-head">
        <div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onBack(false)}>← All albums</button>
          <h2>{data ? albumTitle(data) : name}</h2>
          {data && <p className="dl-muted">{data.imageCount} images · {formatBytes(data.totalBytes)} · {data.source}</p>}
        </div>
        <div className="dl-actions">
          <a className="btn btn-sm" href={`${BASE}/albums/${enc(name)}/zip`}><i className="fa-solid fa-file-zipper" /> Download ZIP</a>
          <button type="button" className="btn btn-danger btn-sm" onClick={removeAlbum}>Delete album</button>
        </div>
      </div>
      <SavedTo album={name} path={data?.path} />
      {error && <div className="top-error">{error}</div>}
      <div className="dl-gallery">
        {images.map((img) => (
          <button key={img.name} type="button" className="dl-gallery-item" onClick={() => setOpen(img)} title={img.meta?.alt || img.name}>
            <img src={img.url} alt={img.meta?.alt || ''} loading="lazy" />
          </button>
        ))}
      </div>
      {data?.pagination.totalPages > 1 && (
        <div className="dl-pager">
          <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
          <span>Page {page} of {data.pagination.totalPages}</span>
          <button type="button" className="btn btn-sm" disabled={!data.pagination.hasNextPage} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}
      {open && (
        <Modal wide onClose={() => setOpen(null)}>
          <div className="dl-lightbox">
            <img src={open.url} alt={open.meta?.alt || ''} />
            <div className="dl-lightbox-meta">
              <strong>{open.name}</strong> · {formatBytes(open.bytes)}
              {open.meta?.photographer && <> · Photo by <a href={safeLink(open.meta.photographerUrl) || undefined} target="_blank" rel="noreferrer">{open.meta.photographer}</a> on Pexels</>}
              {open.meta?.alt && <div className="dl-muted">{open.meta.alt}</div>}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-sm" disabled={i <= 0} onClick={() => setOpen(images[i - 1])}>←</button>
              <button type="button" className="btn btn-sm" disabled={i >= images.length - 1} onClick={() => setOpen(images[i + 1])}>→</button>
              <a className="btn btn-sm" href={open.downloadUrl}>Save</a>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => removeImage(open)}>Delete</button>
            </div>
          </div>
        </Modal>
      )}
      {/* Portaled after the lightbox so it opens on top of it. */}
      {ask &&
        createPortal(
          <ConfirmModal title={ask.title} message={ask.message} confirmLabel={ask.label} danger onConfirm={ask.run} onClose={() => setAsk(null)} />,
          document.body
        )}
    </div>
  );
}

function AlbumList({ onOpen }) {
  const [albums, setAlbums] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/albums').then((r) => setAlbums(r.albums)).catch((err) => setError(err.message));
  }, []);
  if (error) return <div className="top-error">{error}</div>;
  if (!albums) return <div className="dl-card dl-muted">Loading albums…</div>;
  if (!albums.length) return <div className="dl-card dl-muted">No albums yet — download some images first.</div>;
  return (
    <div className="dl-album-grid">
      {albums.map((a) => (
        <button key={a.name} type="button" className="dl-album" onClick={() => onOpen(a.name)}>
          <span className="dl-album-cover">{a.coverUrl ? <img src={a.coverUrl} alt="" loading="lazy" /> : <i className="fa-regular fa-images" />}</span>
          <span className="dl-album-title">{albumTitle(a)}</span>
          {a.external && <span className="dl-album-path" title={a.path}><i className="fa-regular fa-folder" /> {a.path}</span>}
          <span className="dl-muted">
            {a.imageCount} images · {formatBytes(a.totalBytes)} · {new Date(a.createdAt).toLocaleDateString(DATE_LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------- page ----------
export default function ImageDownloader() {
  const [config, setConfig] = useState(null);
  const [tab, setTab] = useState('search');
  const [jobId, setJobId] = useState(null);
  const [album, setAlbum] = useState(null);
  const [albumsKey, setAlbumsKey] = useState(0);
  const [running, setRunning] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/config').then(setConfig).catch((err) => setError(err.message));
  }, []);
  // Downloads keep going on the server if you leave this page — offer to reattach.
  useEffect(() => {
    if (jobId) return;
    Promise.all([api('/jobs?status=running'), api('/jobs?status=queued')])
      .then(([a, b]) => setRunning([...a.jobs, ...b.jobs]))
      .catch(() => {});
  }, [jobId, tab]);

  function started(id) {
    setJobId(id);
  }
  function openAlbum(name) {
    setJobId(null);
    setTab('albums');
    setAlbum(name);
  }

  return (
    <div className="dl-page">
      <div className="page-head">
        <div>
          <h1>Image downloader</h1>
          <p>Download photos by title from Pexels, from image links, or from a web page — into this project or any folder you choose.</p>
        </div>
        <div className="page-head-actions">
          <a className="btn btn-ghost btn-sm" href={`${BASE}/docs`} target="_blank" rel="noreferrer"><i className="fa-solid fa-book" /> API docs</a>
        </div>
      </div>

      <div className="dl-tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`dl-tab${tab === t.key && !jobId ? ' active' : ''}`}
            onClick={() => { setJobId(null); setTab(t.key); setAlbum(null); }}>
            <i className={t.icon} /> {t.label}
          </button>
        ))}
      </div>

      {error && <div className="top-error">{error}</div>}

      {!jobId && running.length > 0 && (
        <div className="dl-running">
          {running.map((j) => (
            <button key={j.id} type="button" className="dl-running-item" onClick={() => setJobId(j.id)}>
              <span className="dl-spin" />
              <span>Downloading “{j.type === 'pexels' ? j.params?.query : j.type === 'url' ? `${j.params?.imageCount} image URLs` : j.info?.pageTitle || j.params?.url}” — {j.progress}%</span>
              <span className="dl-link">View progress →</span>
            </button>
          ))}
        </div>
      )}

      {jobId ? (
        <JobProgress jobId={jobId} onOpenAlbum={openAlbum} onNew={() => setJobId(null)} />
      ) : tab === 'search' ? (
        <SearchFlow config={config} onStarted={started} />
      ) : tab === 'urls' ? (
        <UrlFlow config={config} onStarted={started} />
      ) : tab === 'webpage' ? (
        <WebpageFlow config={config} onStarted={started} />
      ) : album ? (
        <AlbumView name={album} onBack={(deleted) => { setAlbum(null); if (deleted) setAlbumsKey((k) => k + 1); }} />
      ) : (
        <AlbumList key={albumsKey} onOpen={setAlbum} />
      )}
    </div>
  );
}

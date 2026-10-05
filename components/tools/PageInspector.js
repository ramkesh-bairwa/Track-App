'use client';

import { useMemo, useState } from 'react';
import './page-inspector.css';

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'fa-circle-info' },
  { id: 'social', label: 'Social', icon: 'fa-share-nodes' },
  { id: 'headings', label: 'Headings', icon: 'fa-heading' },
  { id: 'links', label: 'Links', icon: 'fa-link' },
  { id: 'images', label: 'Images', icon: 'fa-image' },
  { id: 'resources', label: 'Resources', icon: 'fa-code' },
  { id: 'structured', label: 'Structured data', icon: 'fa-sitemap' },
  { id: 'headers', label: 'Headers', icon: 'fa-list' },
  { id: 'text', label: 'Text', icon: 'fa-align-left' },
];
const HTML_ONLY = new Set(['social', 'headings', 'links', 'images', 'resources', 'structured', 'text']);
const LINK_FILTERS = [
  ['all', 'All'], ['internal', 'Internal'], ['external', 'External'], ['nofollow', 'Nofollow'],
  ['empty', 'Empty / #'], ['javascript', 'javascript:'], ['mailto', 'mailto:'], ['tel', 'tel:'], ['other', 'Other'],
];
const PAGE = 200;

async function api(url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Something went wrong.');
  return json;
}

const fmtBytes = (n) => {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};
const fmtMs = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`);
const isWebUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
const statusClass = (s) => (s >= 200 && s < 300 ? 'ok' : s >= 300 && s < 400 ? 'warn' : 'bad');

function Ext({ href, children }) {
  if (!isWebUrl(href)) return <span className="tool-mono">{children ?? href}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="pi-link">
      {children ?? href}
    </a>
  );
}

function Missing({ children = 'Missing' }) {
  return <span className="tool-badge bad">{children}</span>;
}

function Row({ label, children }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function Thumb({ src, alt = '', className = 'pi-thumb' }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <span className={`${className} pi-thumb-empty`} aria-hidden="true"><i className="fa-solid fa-image" /></span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}

function Stat({ label, value, tone }) {
  return (
    <div className="pi-stat">
      <span className="pi-stat-label">{label}</span>
      <strong className={tone ? `pi-tone-${tone}` : undefined}>{value}</strong>
    </div>
  );
}

// ---------- tabs ----------

function Overview({ r }) {
  const o = r.overview;
  return (
    <dl className="pi-kv">
      <Row label="Requested URL"><span className="tool-mono">{r.requestedUrl}</span></Row>
      <Row label="Final URL"><Ext href={r.finalUrl} /></Row>
      <Row label="Status">
        <span className={`tool-badge ${statusClass(r.status)}`}>{r.status}</span> {r.statusText}
      </Row>
      <Row label="Redirects">
        {r.redirects.length ? (
          <ol className="pi-chain">
            {r.redirects.map((h, i) => (
              <li key={i}><span className="tool-badge warn">{h.status}</span> <span className="tool-mono">{h.url}</span></li>
            ))}
            <li><span className={`tool-badge ${statusClass(r.status)}`}>{r.status}</span> <span className="tool-mono">{r.finalUrl}</span></li>
          </ol>
        ) : 'None'}
      </Row>
      <Row label="Response time">
        {fmtMs(r.ttfbMs)} to first byte · {fmtMs(r.totalMs)} total
      </Row>
      <Row label="Page size">
        {fmtBytes(r.bytes)}
        {r.truncated && <> <span className="tool-badge warn">Cut at 5 MB</span></>}
      </Row>
      <Row label="Content type"><span className="tool-mono">{r.contentType || '—'}</span></Row>
      <Row label="Charset">
        {r.charset || '—'}
        {o?.metaCharset && <span className="tool-muted"> · meta: {o.metaCharset}</span>}
      </Row>
      {o && (
        <>
          <Row label="Language">{o.lang ? <span className="tool-mono">{o.lang}</span> : <Missing>No lang on &lt;html&gt;</Missing>}</Row>
          <Row label="Title">
            {o.title ? (
              <>
                <div>{o.title}</div>
                <LengthHint len={o.titleLength} max={60} />
              </>
            ) : <Missing />}
          </Row>
          <Row label="Meta description">
            {o.description ? (
              <>
                <div>{o.description}</div>
                <LengthHint len={o.descriptionLength} max={160} />
              </>
            ) : <Missing />}
          </Row>
          <Row label="Canonical">
            {o.canonical ? (
              <>
                <Ext href={o.canonical} />
                {o.canonical !== r.finalUrl && <div className="tool-muted">Differs from the final URL.</div>}
              </>
            ) : <span className="tool-muted">Not set</span>}
          </Row>
          <Row label="Robots">
            <RobotsValue label="meta robots" value={o.robots} />
            {o.googlebot && <RobotsValue label="googlebot" value={o.googlebot} />}
            <RobotsValue label="X-Robots-Tag" value={r.headers.xRobotsTag} />
          </Row>
          <Row label="Viewport">{o.viewport ? <span className="tool-mono">{o.viewport}</span> : <Missing>Missing — page may not be mobile friendly</Missing>}</Row>
          <Row label="Favicon">
            <div className="pi-favicon">
              <Thumb src={o.favicon.href} className="pi-favicon-img" />
              <span className="tool-mono">{o.favicon.href.startsWith('data:') ? `${o.favicon.href.slice(0, 30)} (inline)` : o.favicon.href}</span>
            </div>
            {!o.favicon.declared && <div className="tool-muted">Not declared — browsers try /favicon.ico.</div>}
          </Row>
          <Row label="Generator">{o.generator || <span className="tool-muted">Not set</span>}</Row>
          {o.themeColor && (
            <Row label="Theme color">
              <span className="pi-swatch" style={{ background: o.themeColor }} /> <span className="tool-mono">{o.themeColor}</span>
            </Row>
          )}
          {o.refresh && <Row label="Meta refresh"><span className="tool-mono">{o.refresh}</span></Row>}
          {o.baseHref && <Row label="Base href"><span className="tool-mono">{o.baseHref}</span></Row>}
        </>
      )}
    </dl>
  );
}

function LengthHint({ len, max }) {
  const over = len > max;
  return (
    <div className="pi-hint">
      <span className={`tool-badge ${over ? 'warn' : 'ok'}`}>{len} chars</span>
      {over && <span className="tool-muted"> Longer than ~{max}; search results may cut it off.</span>}
    </div>
  );
}

function RobotsValue({ label, value }) {
  const noindex = /noindex|none/i.test(value || '');
  return (
    <div>
      <span className="tool-muted">{label}: </span>
      {value ? <span className="tool-mono">{value}</span> : <span className="tool-muted">not set</span>}
      {noindex && <> <span className="tool-badge bad">noindex</span></>}
    </div>
  );
}

function Social({ r }) {
  const { og, twitter } = r.social;
  const get = (list, key, field) => list.find((t) => t[field] === key)?.content;
  const title = get(og, 'og:title', 'property') || get(twitter, 'twitter:title', 'name') || r.overview.title;
  const desc = get(og, 'og:description', 'property') || get(twitter, 'twitter:description', 'name') || r.overview.description;
  const rawImage = get(og, 'og:image', 'property') || get(og, 'og:image:url', 'property') || get(og, 'og:image:secure_url', 'property') || get(twitter, 'twitter:image', 'name') || get(twitter, 'twitter:image:src', 'name');
  let image = null;
  try {
    image = rawImage ? new URL(rawImage, r.finalUrl).href : null;
  } catch {
    image = null;
  }
  const site = get(og, 'og:site_name', 'property') || new URL(r.finalUrl).hostname;
  const card = get(twitter, 'twitter:card', 'name');
  const missing = ['og:title', 'og:description', 'og:image', 'og:url'].filter((k) => !get(og, k, 'property'));

  return (
    <div className="pi-social">
      <div>
        <h3 className="pi-h3">Link preview</h3>
        <div className={`pi-card${card === 'summary' ? ' small' : ''}`}>
          <div className="pi-card-img">
            {image ? <Thumb src={image} className="pi-card-photo" /> : <span className="pi-thumb-empty"><i className="fa-solid fa-image" /> No og:image</span>}
          </div>
          <div className="pi-card-body">
            <span className="pi-card-site">{site}</span>
            <strong>{title || 'No title'}</strong>
            {desc && <p>{desc}</p>}
          </div>
        </div>
        <p className="tool-muted">Roughly how chat apps and social sites show a link to this page. {card && <>Twitter card: <span className="tool-mono">{card}</span>.</>}</p>
        {missing.length > 0 && (
          <p className="pi-warn"><i className="fa-solid fa-triangle-exclamation" /> Missing: {missing.join(', ')}</p>
        )}
      </div>
      <div>
        <TagTable title="Open Graph" rows={og.map((t) => [t.property, t.content])} />
        <TagTable title="Twitter" rows={twitter.map((t) => [t.name, t.content])} />
      </div>
    </div>
  );
}

function TagTable({ title, rows }) {
  return (
    <>
      <h3 className="pi-h3">{title} <span className="tool-muted">({rows.length})</span></h3>
      {rows.length ? (
        <div className="tool-table-wrap">
          <table className="tool-table">
            <tbody>
              {rows.map(([k, v], i) => (
                <tr key={i}>
                  <td className="tool-mono pi-key">{k}</td>
                  <td>{isWebUrl(v) ? <Ext href={v} /> : v || <span className="tool-muted">(empty)</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="tool-muted">No {title} tags.</p>}
    </>
  );
}

function Headings({ r }) {
  const { items, counts, warnings, truncated } = r.headings;
  return (
    <>
      <div className="pi-stats">
        {counts.map((n, i) => <Stat key={i} label={`H${i + 1}`} value={n} tone={i === 0 && n !== 1 ? 'warn' : undefined} />)}
      </div>
      {warnings.length > 0 && (
        <ul className="pi-warnings">
          {warnings.map((w, i) => <li key={i}><i className="fa-solid fa-triangle-exclamation" /> {w.message}</li>)}
        </ul>
      )}
      {items.length ? (
        <ul className="pi-outline">
          {items.map((h, i) => (
            <li key={i} style={{ paddingLeft: `${(h.level - 1) * 18}px` }} className={h.skipped ? 'skipped' : undefined}>
              <span className={`pi-hl pi-hl-${h.level}`}>H{h.level}</span>
              <span className={h.empty ? 'tool-muted' : undefined}>{h.text || '(empty)'}</span>
            </li>
          ))}
        </ul>
      ) : <p className="tool-empty">No headings on this page.</p>}
      {truncated && <p className="tool-muted">Showing the first {items.length} headings.</p>}
    </>
  );
}

function Links({ r }) {
  const { counts, items, truncated } = r.links;
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((l) => {
      if (filter === 'nofollow' ? !l.nofollow : filter !== 'all' && l.kind !== filter) return false;
      if (!needle) return true;
      return (l.text || '').toLowerCase().includes(needle) || (l.href || '').toLowerCase().includes(needle);
    });
  }, [items, filter, q]);
  const countFor = (id) => (id === 'all' ? counts.total : counts[id]);

  return (
    <>
      <div className="pi-stats">
        <Stat label="Total" value={counts.total} />
        <Stat label="Internal" value={counts.internal} />
        <Stat label="External" value={counts.external} />
        <Stat label="Nofollow" value={counts.nofollow} />
        <Stat label="Empty / JS" value={counts.empty + counts.javascript} tone={counts.empty + counts.javascript ? 'warn' : undefined} />
        <Stat label="Open in new tab" value={counts.newTab} />
      </div>
      <div className="pi-toolbar">
        <div className="pi-chips" role="group" aria-label="Filter links">
          {LINK_FILTERS.filter(([id]) => id === 'all' || countFor(id)).map(([id, label]) => (
            <button key={id} type="button" className={`pi-chip${filter === id ? ' active' : ''}`} aria-pressed={filter === id} onClick={() => { setFilter(id); setLimit(PAGE); }}>
              {label} <span>{countFor(id)}</span>
            </button>
          ))}
        </div>
        <input className="input pi-search" type="search" placeholder="Search text or URL" aria-label="Search links" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
      </div>
      {shown.length ? (
        <div className="tool-table-wrap">
          <table className="tool-table pi-links">
            <thead>
              <tr><th>Anchor text</th><th>URL</th><th>Type</th></tr>
            </thead>
            <tbody>
              {shown.slice(0, limit).map((l, i) => (
                <tr key={i}>
                  <td>{l.text || <span className="tool-muted">(no text)</span>}</td>
                  <td>{l.url ? <Ext href={l.url} /> : <span className="tool-mono">{l.href ?? '(no href)'}</span>}</td>
                  <td>
                    <span className={`tool-badge${l.kind === 'empty' || l.kind === 'javascript' ? ' warn' : ''}`}>{l.kind}</span>
                    {l.nofollow && <> <span className="tool-badge">{l.rel}</span></>}
                    {l.target === '_blank' && <> <i className="fa-solid fa-arrow-up-right-from-square tool-muted" title="Opens in a new tab" aria-label="Opens in a new tab" /></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="tool-empty">No links match.</p>}
      {shown.length > limit && <button type="button" className="btn btn-sm pi-more" onClick={() => setLimit((n) => n + PAGE)}>Show more ({shown.length - limit} left)</button>}
      {truncated && <p className="tool-muted">The list holds the first {items.length} of {counts.total} links; counts include all of them.</p>}
    </>
  );
}

function Images({ r }) {
  const { total, missingAlt, emptyAlt, items, truncated } = r.images;
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [limit, setLimit] = useState(60);
  const shown = onlyMissing ? items.filter((i) => i.alt == null) : items;
  return (
    <>
      <div className="pi-stats">
        <Stat label="Images" value={total} />
        <Stat label="Missing alt" value={missingAlt} tone={missingAlt ? 'bad' : 'ok'} />
        <Stat label='Empty alt=""' value={emptyAlt} />
        <Stat label="Lazy-loaded" value={items.filter((i) => i.loading === 'lazy').length} />
      </div>
      {missingAlt > 0 && (
        <label className="pi-check">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Only images without alt
        </label>
      )}
      {shown.length ? (
        <div className="pi-images">
          {shown.slice(0, limit).map((img, i) => (
            <figure key={i} className="pi-image">
              <a href={img.src || undefined} target="_blank" rel="noopener noreferrer" className="pi-image-box" aria-label={`Open image ${i + 1}`}>
                <Thumb src={img.src} alt="" className="pi-image-thumb" />
              </a>
              <figcaption>
                {img.alt == null ? <span className="tool-badge bad">No alt</span> : img.alt === '' ? <span className="tool-badge">alt=""</span> : <span className="pi-alt">{img.alt}</span>}
                <span className="tool-mono pi-src" title={img.src || img.rawSrc}>{img.dataUri ? 'data: URI' : img.rawSrc || '(no src)'}</span>
                <span className="tool-muted">
                  {img.width || img.height ? `${img.width || '?'} × ${img.height || '?'}` : 'No size attrs'}
                  {img.loading && ` · ${img.loading}`}
                  {img.srcset && ' · srcset'}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : <p className="tool-empty">No images{onlyMissing ? ' without alt' : ''}.</p>}
      {shown.length > limit && <button type="button" className="btn btn-sm pi-more" onClick={() => setLimit((n) => n + 60)}>Show more ({shown.length - limit} left)</button>}
      {truncated && <p className="tool-muted">Showing the first {items.length} of {total} images.</p>}
    </>
  );
}

function UrlList({ title, rows, columns, empty }) {
  return (
    <section className="pi-section">
      <h3 className="pi-h3">{title} <span className="tool-muted">({rows.length})</span></h3>
      {rows.length ? (
        <div className="tool-table-wrap">
          <table className="tool-table">
            <thead><tr>{columns.map((c) => <th key={c.label}>{c.label}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>{columns.map((c) => <td key={c.label}>{c.render(row)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="tool-muted">{empty}</p>}
    </section>
  );
}

function Resources({ r }) {
  const s = r.resources;
  const flag = (on, label) => (on ? <span className="tool-badge ok">{label}</span> : null);
  return (
    <>
      <div className="pi-stats">
        <Stat label="Stylesheets" value={s.stylesheets.length} />
        <Stat label="Inline <style>" value={s.inlineStyles} />
        <Stat label="External scripts" value={s.scripts.length} />
        <Stat label="Inline scripts" value={s.inlineScripts} />
        <Stat label="async / defer / module" value={`${s.asyncScripts} / ${s.deferScripts} / ${s.moduleScripts}`} />
        <Stat label="Iframes" value={s.iframes.length} />
      </div>
      {s.inlineScripts > 0 && <p className="tool-muted">Inline scripts total {fmtBytes(s.inlineScriptBytes)}.</p>}
      <UrlList
        title="Scripts"
        rows={s.scripts}
        empty="No external scripts."
        columns={[
          { label: 'Source', render: (x) => <Ext href={x.src} /> },
          { label: 'Loading', render: (x) => (x.async || x.defer || x.module ? <>{flag(x.async, 'async')} {flag(x.defer, 'defer')} {flag(x.module, 'module')}</> : <span className="tool-badge warn">blocking</span>) },
        ]}
      />
      <UrlList
        title="Stylesheets"
        rows={s.stylesheets}
        empty="No linked stylesheets."
        columns={[
          { label: 'Href', render: (x) => <Ext href={x.href} /> },
          { label: 'Media', render: (x) => x.media || <span className="tool-muted">all</span> },
        ]}
      />
      <UrlList
        title="Preload & resource hints"
        rows={s.hints}
        empty="No preload, preconnect or prefetch hints."
        columns={[
          { label: 'Rel', render: (x) => <span className="tool-mono">{x.rel}</span> },
          { label: 'Href', render: (x) => <Ext href={x.href} /> },
          { label: 'As', render: (x) => x.as || '—' },
        ]}
      />
      <UrlList
        title="Iframes"
        rows={s.iframes}
        empty="No iframes."
        columns={[
          { label: 'Src', render: (x) => <Ext href={x.src} /> },
          { label: 'Title', render: (x) => x.title || <span className="tool-badge warn">No title</span> },
          { label: 'Loading', render: (x) => x.loading || '—' },
        ]}
      />
      {s.manifest && <p className="tool-muted">Web app manifest: <Ext href={s.manifest} /></p>}
    </>
  );
}

function Structured({ r }) {
  const { jsonLd, microdata } = r.structured;
  return (
    <>
      <h3 className="pi-h3">JSON-LD <span className="tool-muted">({jsonLd.length})</span></h3>
      {jsonLd.length ? jsonLd.map((b, i) => (
        <details key={i} className="pi-details" open={i === 0}>
          <summary>
            {b.valid ? <span className="tool-badge ok">Valid JSON</span> : <span className="tool-badge bad">Invalid JSON</span>}{' '}
            {b.valid ? (b.types.length ? b.types.join(', ') : 'No @type') : b.error}
          </summary>
          <pre className="pi-pre">{b.valid ? b.json : b.raw}</pre>
        </details>
      )) : <p className="tool-muted">No JSON-LD blocks.</p>}
      <h3 className="pi-h3">Microdata <span className="tool-muted">({microdata.length} types)</span></h3>
      {microdata.length ? (
        <div className="tool-table-wrap">
          <table className="tool-table">
            <thead><tr><th>Item type</th><th>Items</th><th>Top-level</th></tr></thead>
            <tbody>
              {microdata.map((m) => (
                <tr key={m.type}>
                  <td className="tool-mono">{m.type}</td>
                  <td>{m.count}</td>
                  <td>{m.topLevel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="tool-muted">No microdata (itemscope) found.</p>}
    </>
  );
}

function Headers({ r }) {
  const { list, cookies, security } = r.headers;
  return (
    <>
      <h3 className="pi-h3">Security headers</h3>
      <ul className="pi-security">
        {security.map((h) => (
          <li key={h.key} className={h.ok ? 'ok' : 'missing'}>
            <i className={`fa-solid ${h.ok ? 'fa-circle-check' : 'fa-circle-xmark'}`} aria-hidden="true" />
            <div>
              <strong>{h.label}</strong> <span className="pi-sr">{h.ok ? 'present' : 'missing'}</span>
              <div className="tool-muted">{h.hint}</div>
              {h.value && <div className="tool-mono pi-header-value">{h.value}</div>}
            </div>
          </li>
        ))}
      </ul>
      <h3 className="pi-h3">Cookies set <span className="tool-muted">({cookies.length}, values hidden)</span></h3>
      {cookies.length ? (
        <div className="tool-table-wrap">
          <table className="tool-table">
            <thead><tr><th>Name</th><th>Flags</th><th>Scope</th><th>Expires</th></tr></thead>
            <tbody>
              {cookies.map((c, i) => (
                <tr key={i}>
                  <td className="tool-mono">{c.name}</td>
                  <td>
                    <span className={`tool-badge ${c.secure ? 'ok' : 'warn'}`}>{c.secure ? 'Secure' : 'Not Secure'}</span>{' '}
                    <span className={`tool-badge ${c.httpOnly ? 'ok' : ''}`}>{c.httpOnly ? 'HttpOnly' : 'JS-readable'}</span>{' '}
                    <span className="tool-badge">SameSite: {c.sameSite || 'unset'}</span>
                    {c.partitioned && <> <span className="tool-badge">Partitioned</span></>}
                  </td>
                  <td className="tool-mono">{c.domain || '(host)'}{c.path || ''}</td>
                  <td>{c.maxAge ? `max-age ${c.maxAge}` : c.expires || 'Session'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="tool-muted">No cookies set by this response.</p>}
      <h3 className="pi-h3">All response headers <span className="tool-muted">({list.length})</span></h3>
      <div className="tool-table-wrap">
        <table className="tool-table">
          <tbody>
            {list.map((h, i) => (
              <tr key={i}>
                <td className="tool-mono pi-key">{h.name}</td>
                <td className="tool-mono pi-header-value">{h.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TextTab({ r }) {
  const t = r.text;
  return (
    <>
      <div className="pi-stats">
        <Stat label="Words" value={t.words.toLocaleString()} />
        <Stat label="Characters" value={t.characters.toLocaleString()} />
        <Stat label="Reading time" value={t.readingMinutes ? `${t.readingMinutes} min` : '—'} />
      </div>
      <p className="tool-muted">Counted from the HTML the server returned, without scripts and styles; text added later by JavaScript is not included. Reading time assumes 230 words a minute.</p>
      {t.sample && <blockquote className="pi-sample">{t.sample}</blockquote>}
    </>
  );
}

const PANELS = { overview: Overview, social: Social, headings: Headings, links: Links, images: Images, resources: Resources, structured: Structured, headers: Headers, text: TextTab };

// ---------- main ----------

export default function PageInspector() {
  const [url, setUrl] = useState('');
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [copied, setCopied] = useState(false);

  const inspect = async (e) => {
    e?.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api('/api/tools/page-inspector', 'POST', { url: url.trim() });
      setReport(r);
      setTab('overview');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const json = () => JSON.stringify(report, null, 2);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy to the clipboard.');
    }
  };
  const download = () => {
    const blob = new Blob([json()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    let host = 'page';
    try {
      host = new URL(report.finalUrl).hostname;
    } catch {
      // keep default
    }
    a.download = `inspect-${host}-${report.fetchedAt.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const tabs = report ? TABS.filter((t) => report.isHtml || !HTML_ONLY.has(t.id)) : [];
  const onTabKey = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = tabs.findIndex((t) => t.id === tab);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    setTab(next.id);
    document.getElementById(`pi-tab-${next.id}`)?.focus();
  };
  const Panel = PANELS[tab];
  const badgeFor = (id) => {
    if (!report?.isHtml) return null;
    if (id === 'headings') return report.headings.warnings.length || null;
    if (id === 'images') return report.images.missingAlt || null;
    if (id === 'headers') return report.headers.security.filter((h) => !h.ok).length || null;
    return null;
  };

  return (
    <div className="pi">
      <form className="tool-panel pi-form" onSubmit={inspect}>
        <label className="field-label" htmlFor="pi-url">Page URL</label>
        <div className="pi-form-row">
          <input
            id="pi-url"
            className="input"
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !url.trim()}>
            {busy ? <><i className="fa-solid fa-spinner fa-spin" /> Inspecting…</> : <><i className="fa-solid fa-magnifying-glass" /> Inspect</>}
          </button>
        </div>
        <p className="field-hint">The page is fetched by the MyTrack server (no cookies, no JavaScript run), so you see what search engines and link previews see.</p>
      </form>

      {error && <div className="top-error" role="alert">{error}</div>}

      {!report && !busy && !error && <div className="tool-panel tool-empty">Enter a URL to see its SEO tags, social preview, headings, links, images, scripts and headers.</div>}

      {report && (
        <>
          <div className="tool-panel pi-summary">
            <div className="pi-summary-main">
              <Thumb src={report.overview?.favicon?.href} className="pi-summary-icon" />
              <div className="pi-summary-text">
                <strong>{report.overview?.title || new URL(report.finalUrl).hostname}</strong>
                <Ext href={report.finalUrl} />
              </div>
            </div>
            <div className="pi-summary-stats">
              <span className={`tool-badge ${statusClass(report.status)}`}>{report.status} {report.statusText}</span>
              {report.redirects.length > 0 && <span className="tool-badge warn">{report.redirects.length} redirect{report.redirects.length > 1 ? 's' : ''}</span>}
              <span className="tool-muted"><i className="fa-solid fa-clock" /> {fmtMs(report.totalMs)}</span>
              <span className="tool-muted"><i className="fa-solid fa-weight-hanging" /> {fmtBytes(report.bytes)}</span>
            </div>
            <div className="pi-summary-actions">
              <button type="button" className="btn btn-sm" onClick={copy}><i className={`fa-solid ${copied ? 'fa-check' : 'fa-copy'}`} /> {copied ? 'Copied' : 'Copy JSON'}</button>
              <button type="button" className="btn btn-sm" onClick={download}><i className="fa-solid fa-download" /> Download JSON</button>
            </div>
          </div>

          {report.notice && <div className="pi-notice" role="status"><i className="fa-solid fa-circle-info" /> {report.notice}</div>}
          {report.status >= 400 && report.isHtml && (
            <div className="pi-notice" role="status"><i className="fa-solid fa-triangle-exclamation" /> The server answered {report.status}; the report below describes the error page it returned.</div>
          )}

          <div className="tool-panel pi-tabs-panel">
            <div className="pi-tabs" role="tablist" aria-label="Report sections" onKeyDown={onTabKey}>
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`pi-tab-${t.id}`}
                  aria-selected={tab === t.id}
                  tabIndex={tab === t.id ? 0 : -1}
                  aria-controls="pi-tabpanel"
                  className={`pi-tab${tab === t.id ? ' active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  <i className={`fa-solid ${t.icon}`} aria-hidden="true" /> {t.label}
                  {badgeFor(t.id) && <span className="pi-tab-count" aria-label={`${badgeFor(t.id)} issues`}>{badgeFor(t.id)}</span>}
                </button>
              ))}
            </div>
            <div className="pi-tabpanel" role="tabpanel" id="pi-tabpanel" aria-labelledby={`pi-tab-${tab}`}>
              {Panel && (report.isHtml || !HTML_ONLY.has(tab)) && <Panel key={`${tab}-${report.fetchedAt}`} r={report} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

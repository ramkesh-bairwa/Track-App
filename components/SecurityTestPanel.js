'use client';

import { useState } from 'react';
import { CATS, CAT_LABELS, INJECTION_CHEATSHEET } from '@/lib/securityMeta';

const SEV_CLASS = { CRITICAL: 'sev-crit', HIGH: 'sev-high', MEDIUM: 'sev-med', LOW: 'sev-low', INFO: 'sev-info' };

function Badge({ sev, children }) {
  return <span className={`sectest-badge ${SEV_CLASS[sev]}`}>{children || sev}</span>;
}

// Table of failing findings (shared by both modes).
function FailTable({ fails, areaOf }) {
  return (
    <div className="table-panel" style={{ marginBottom: 16 }}>
      <div className="table-toolbar"><strong>Weaknesses to review</strong></div>
      <div className="task-table-wrap">
        <table className="data-table sectest-table">
          <thead><tr><th>Severity</th>{areaOf && <th>Area</th>}<th>Check</th><th>What was observed</th><th>How to fix</th></tr></thead>
          <tbody>
            {fails.map((r, i) => (
              <tr key={i}>
                <td><Badge sev={r.severity} /></td>
                {areaOf && <td className="task-muted">{areaOf(r)}</td>}
                <td><strong>{r.name}</strong></td>
                <td>{r.detail}</td>
                <td><code className="sectest-repro">{r.fix || r.howToInject}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SecurityTestPanel() {
  const [mode, setMode] = useState('app');
  // deep scan (own app)
  const [running, setRunning] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState(new Set());
  // url posture check
  const [url, setUrl] = useState('');
  const [urlRunning, setUrlRunning] = useState(false);
  const [urlData, setUrlData] = useState(null);
  const [urlError, setUrlError] = useState('');

  async function run() {
    setRunning(true);
    setError('');
    try {
      const res = await fetch('/api/security-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categories: [...picked] }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'The scan could not run.');
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  async function checkUrl(e) {
    e?.preventDefault();
    setUrlRunning(true);
    setUrlError('');
    setUrlData(null);
    try {
      const res = await fetch('/api/security-test/url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not check that URL.');
      setUrlData(json);
    } catch (err) {
      setUrlError(err.message);
    } finally {
      setUrlRunning(false);
    }
  }

  function toggle(cat) {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(cat)) n.delete(cat);
      else n.add(cat);
      return n;
    });
  }

  const s = data?.summary;
  const byCat = {};
  for (const r of data?.results || []) (byCat[r.cat] ||= []).push(r);
  const us = urlData?.summary;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Test my site</h1>
          <p>Check the security of your web apps. <strong>Deep scan</strong> actively probes this MyTrack app (a site you own). <strong>URL check</strong> does a read-only review of any site’s HTTPS, TLS, headers and cookies — it sends no attack payloads.</p>
        </div>
      </div>

      <div className="tabs track-type-tabs" style={{ marginBottom: 16 }}>
        <button type="button" className={`tab-btn${mode === 'app' ? ' active' : ''}`} onClick={() => setMode('app')}>
          <i className="fa-solid fa-shield-halved" /> This app — deep scan
        </button>
        <button type="button" className={`tab-btn${mode === 'url' ? ' active' : ''}`} onClick={() => setMode('url')}>
          <i className="fa-solid fa-globe" /> Any URL — safe check
        </button>
      </div>

      {mode === 'app' && (
        <>
          <div className="sectest-cats">
            <span className="task-muted">Scope:</span>
            <button type="button" className={`sectest-chip${picked.size === 0 ? ' active' : ''}`} onClick={() => setPicked(new Set())}>All</button>
            {CATS.map((c) => (
              <button key={c} type="button" className={`sectest-chip${picked.has(c) ? ' active' : ''}`} onClick={() => toggle(c)}>{CAT_LABELS[c]}</button>
            ))}
            <button type="button" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={run} disabled={running}>
              {running ? 'Scanning…' : '▶ Run deep scan'}
            </button>
          </div>
          <p className="field-hint" style={{ marginTop: -8 }}>Actively probes auth, access control, injection, SSRF and more against this MyTrack instance. Creates two throwaway accounts and deletes them afterwards.</p>
          {error && <div className="top-error">{error}</div>}
          {running && !data && <div className="empty-state"><span className="photo-spinner" style={{ margin: '0 auto 12px' }} /><p>Probing the running app…</p></div>}
          {s && (
            <>
              <div className="sectest-summary">
                <div className="sectest-score"><strong className={s.failed === 0 ? 'ok' : ''}>{s.passed}</strong><span>defended</span></div>
                <div className="sectest-score"><strong className={s.failed ? 'bad' : 'ok'}>{s.failed}</strong><span>to review</span></div>
                {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].filter((k) => s.bySeverity[k]).map((k) => <Badge key={k} sev={k}>{s.bySeverity[k]} {k}</Badge>)}
                <span className="task-muted sectest-when">{data.base} · {new Date(data.ranAt).toLocaleTimeString()} · cleaned {data.cleaned} test account{data.cleaned === 1 ? '' : 's'}</span>
              </div>
              {s.failed > 0 && <FailTable fails={s.fails} areaOf={(r) => CAT_LABELS[r.cat]} />}
              {CATS.filter((c) => byCat[c]).map((c) => (
                <div key={c} className="sectest-group">
                  <div className="photo-section-label">{CAT_LABELS[c]}</div>
                  <div className="sectest-checks">
                    {byCat[c].map((r, i) => (
                      <div key={i} className={`sectest-check${r.ok ? '' : ' fail'}`}>
                        <span className={`sectest-dot ${r.ok ? 'ok' : SEV_CLASS[r.severity]}`}>{r.ok ? '✓' : '✗'}</span>
                        <span className="sectest-name">{r.name}</span>
                        <span className="task-muted sectest-detail">{r.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {mode === 'url' && (
        <>
          <form className="sectest-url-form" onSubmit={checkUrl}>
            <input className="input" placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
            <button type="submit" className="btn btn-primary" disabled={urlRunning || !url.trim()}>{urlRunning ? 'Checking…' : '🔍 Check URL'}</button>
          </form>
          <p className="field-hint" style={{ marginTop: 0 }}>
            Read-only: one page request + a TLS handshake. No payloads are sent, nothing is injected. Use it on sites you own or are responsible for — the results tell you what to harden.
          </p>
          {urlError && <div className="top-error">{urlError}</div>}
          {urlRunning && <div className="empty-state"><span className="photo-spinner" style={{ margin: '0 auto 12px' }} /><p>Fetching headers and inspecting TLS…</p></div>}
          {us && (
            <>
              <div className="sectest-summary">
                <div className="sectest-score"><strong className={us.failed === 0 ? 'ok' : ''}>{us.passed}</strong><span>good</span></div>
                <div className="sectest-score"><strong className={us.failed ? 'bad' : 'ok'}>{us.failed}</strong><span>to improve</span></div>
                <span className="task-muted sectest-when">
                  {urlData.finalUrl}{urlData.redirects.length > 1 ? ` (via ${urlData.redirects.length} hops)` : ''}
                  {urlData.tls?.protocol ? ` · ${urlData.tls.protocol}` : ''}{urlData.server ? ` · ${urlData.server}` : ''}
                </span>
              </div>
              <div className="sectest-legend">
                <span><i className="sectest-swatch line-ok" /> Good</span>
                <span><i className="sectest-swatch line-low" /> Low</span>
                <span><i className="sectest-swatch line-med" /> Medium</span>
                <span><i className="sectest-swatch line-high" /> High</span>
                <span><i className="sectest-swatch line-info" /> Info</span>
              </div>
              {(urlData.phases || []).map((p) => {
                const items = urlData.findings.filter((f) => f.phase === p.id);
                return (
                  <div key={p.id} className="sectest-phase">
                    <div className="sectest-phase-head">
                      <span className="sectest-phase-title">{p.label}</span>
                      <span className={`sectest-phase-count${p.failed ? ' has-fail' : ''}`}>{p.passed}/{p.total} ok{p.failed ? ` · ${p.failed} to improve` : ''}</span>
                    </div>
                    <div className="sectest-lines">
                      {items.map((r, i) => {
                        const line = r.ok ? 'line-ok' : r.severity === 'HIGH' ? 'line-high' : r.severity === 'MEDIUM' ? 'line-med' : r.severity === 'LOW' ? 'line-low' : 'line-info';
                        return (
                          <div key={i} className={`sectest-line ${line}`}>
                            <div className="sectest-line-head">
                              <span className="sectest-line-mark">{r.ok ? '✓' : '✗'}</span>
                              <span className="sectest-line-name">{r.name}</span>
                              {!r.ok && <Badge sev={r.severity} />}
                              <span className="sectest-line-detail">{r.detail}</span>
                            </div>
                            {!r.ok && (r.impact || r.fix) && (
                              <div className="sectest-line-body">
                                {r.impact && <p><span className="sectest-tag risk">Risk</span> {r.impact}</p>}
                                {r.fix && <p><span className="sectest-tag fix">Fix</span> {r.fix}</p>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      <div className="sectest-cheat">
        <div className="photo-section-label">Injection cheat-sheet — for testing sites you own or are authorized to test</div>
        <div className="sectest-cheat-grid">
          {INJECTION_CHEATSHEET.map((c) => (
            <div key={c.label} className="sectest-cheat-card">
              <strong>{c.label}</strong>
              <div className="sectest-cheat-items">{c.items.map((it) => <code key={it}>{it}</code>)}</div>
              <small className="task-muted">in {c.where}</small>
            </div>
          ))}
        </div>
        <p className="field-hint">Terminal version of the deep scan: <code>npm run security-test</code> (writes <code>security-report.md</code>). Only run active tests against systems you own or have written permission to test.</p>
      </div>
    </>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';

// Desktop app: link this computer to the MyTrack server. Once linked, it
// syncs its user's data every minute, uploads screenshots and system photos,
// and follows what an admin sets on the server.
export default function ServerConnectionModal({ user, onClose }) {
  const [st, setSt] = useState(null);
  const [serverUrl, setServerUrl] = useState('');
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/agent-local/status', { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setSt(json);
      if (json.serverUrl) setServerUrl((v) => v || json.serverUrl);
      if (json.email) setEmail((v) => (json.linked ? json.email : v));
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  async function post(url, body, label) {
    setBusy(label);
    setError('');
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Something went wrong.');
      if (json.error) throw new Error(json.error);
      if (json.tick?.error) setError(`Linked, but the first sync failed: ${json.tick.error}`);
      setPassword('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  const r = st?.lastResult;
  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h2>Server connection</h2>
        {!st ? (
          <p className="field-hint">Loading…</p>
        ) : st.desktop === false ? (
          <p className="field-hint">This is only used in the MyTrack desktop app.</p>
        ) : st.linked ? (
          <>
            <div className="task-notice" style={{ marginBottom: 12 }}>
              ✅ Linked to <strong>{st.serverUrl}</strong> as <strong>{st.name || st.email}</strong> ({st.email}).
            </div>
            <p className="field-hint">
              Every minute this computer syncs {st.email}’s tracks, records, tasks, notes and activity with the server, uploads new screenshots and system photos,
              and follows what an admin sets there (screenshots on/off and interval, system photos, lock, sign out).
            </p>
            <ul className="data-transfer-counts">
              <li>
                <span>Last sync</span>
                <strong>{st.lastOkAt ? new Date(st.lastOkAt).toLocaleString() : 'not yet'}</strong>
              </li>
              {r && (
                <>
                  <li>
                    <span>Received / sent</span>
                    <strong>
                      {r.pulled?.received ?? 0} / {r.pushed?.sent ?? 0}
                    </strong>
                  </li>
                  <li>
                    <span>Screenshots uploaded last time</span>
                    <strong>{r.screenshots ?? 0}</strong>
                  </li>
                </>
              )}
              {st.settings && (
                <li>
                  <span>Set by admin</span>
                  <strong>
                    Screenshots {st.settings.screenshots ? `on, every ${st.settings.screenshotMinutes} min` : 'off'} · system photos {st.settings.systemPhotos ? 'on' : 'off'}
                  </strong>
                </li>
              )}
            </ul>
            {st.lastError && <div className="top-error">Last attempt: {st.lastError}</div>}
            {error && <div className="top-error">{error}</div>}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost btn-danger"
                disabled={Boolean(busy)}
                onClick={() => window.confirm('Stop syncing this computer with the server? Data here stays.') && post('/api/agent-local/unlink', null, 'unlink')}
              >
                Disconnect
              </button>
              <button type="button" className="btn" onClick={() => post('/api/agent-local/tick', null, 'sync')} disabled={Boolean(busy)}>
                {busy === 'sync' ? 'Syncing…' : 'Sync now'}
              </button>
              <button type="button" className="btn btn-primary" onClick={onClose} disabled={Boolean(busy)}>Close</button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              post('/api/agent-local/link', { serverUrl, email, password }, 'link');
            }}
          >
            <p className="field-hint" style={{ marginTop: 0 }}>
              Sign this computer in to your company’s MyTrack server. Your data then syncs every minute, and your admin can see your screenshots, system photos and
              activity there. Use your account on that server.
            </p>
            <div className="field-group">
              <label className="field-label" htmlFor="srv-url">Server address</label>
              <input id="srv-url" className="input" placeholder="https://mytrack.example.com" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} autoFocus />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="srv-email">Email on the server</label>
              <input id="srv-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="srv-pw">Password on the server</label>
              <input id="srv-pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <span className="field-hint">Sent to the server once to link this computer; it isn’t stored here.</span>
            </div>
            {st.lastError && <div className="top-error">{st.lastError}</div>}
            {error && <div className="top-error">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={Boolean(busy)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={Boolean(busy) || !serverUrl || !email || !password}>
                {busy === 'link' ? 'Linking…' : 'Link this computer'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

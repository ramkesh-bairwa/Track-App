'use client';

import { useCallback, useEffect, useState } from 'react';

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

const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

function ResultLine({ label, r }) {
  if (!r) return null;
  const parts = [`${r.inserted} added`, `${r.updated} updated`, `${r.deleted} deleted`];
  if (r.skipped) parts.push(`${r.skipped} skipped`);
  return (
    <div className="sync-result-line">
      <strong>{label}</strong>
      <span>{parts.join(' · ')}</span>
    </div>
  );
}

// Two-way sync with another MyTrack (the website ↔ the desktop app).
//   1. On the other app: Sync → "Sync keys" → create a key.
//   2. Here: enter the other app's address + that key → Sync now.
// Both sides end up with everything; when the same thing changed on both,
// the newer change wins.
export default function SyncModal({ onClose }) {
  const [state, setState] = useState(null);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteKey, setRemoteKey] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [keys, setKeys] = useState(null);
  const [keyName, setKeyName] = useState('');
  const [newKey, setNewKey] = useState(null); // { key, name } — shown once
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(null); // key id awaiting "Yes, revoke"

  const load = useCallback(async () => {
    try {
      const [s, k] = await Promise.all([api('/api/sync/settings'), api('/api/sync/keys')]);
      setState(s);
      setRemoteUrl((u) => u || s.remoteUrl);
      setKeys(k.keys);
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function run(label, fn) {
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  const saveConnection = () =>
    api('/api/sync/settings', 'PUT', { remoteUrl, remoteKey }).then((s) => {
      setState(s);
      setRemoteKey('');
      return s;
    });

  const changed = state && (remoteUrl.trim().replace(/\/+$/, '') !== state.remoteUrl || remoteKey.trim());

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal sync-modal" onClick={(e) => e.stopPropagation()}>
        <div className="new-track-head">
          <div>
            <h2>Sync</h2>
            <p className="new-track-steps">Keep the website and the desktop app in step — changes made on either side show up on both.</p>
          </div>
          <button type="button" className="new-track-close" onClick={onClose} disabled={Boolean(busy)} title="Close">×</button>
        </div>

        {error && <div className="top-error">{error}</div>}
        {notice && <div className="sync-notice">{notice}</div>}

        <section className="sync-section">
          <h3>Sync with another MyTrack</h3>
          <p className="field-hint">
            Enter the <strong>other</strong> app’s address and a sync key created <strong>there</strong> (its Sync → Sync keys). One
            “Sync now” moves changes both ways — you only need to set this up on one side.
          </p>
          <label className="field-label" htmlFor="sync-url">Other app’s address</label>
          <input
            id="sync-url"
            className="input"
            placeholder="http://localhost:3000  or  https://mytrack.yourcompany.com"
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
          />
          <label className="field-label" htmlFor="sync-key" style={{ marginTop: 10 }}>
            Sync key {state?.keyHint && <span className="sync-muted">(saved: {state.keyHint} — leave empty to keep it)</span>}
          </label>
          <input
            id="sync-key"
            className="input"
            type="password"
            autoComplete="off"
            placeholder={state?.keyHint ? 'Paste a new key to replace it' : 'mts_…'}
            value={remoteKey}
            onChange={(e) => setRemoteKey(e.target.value)}
          />

          <div className="sync-actions">
            <button
              type="button"
              className="btn"
              disabled={Boolean(busy) || !remoteUrl.trim()}
              onClick={() =>
                run('test', async () => {
                  if (changed) await saveConnection();
                  const r = await api('/api/sync/run?test=1', 'POST');
                  setNotice(`Connected to the ${r.kind === 'desktop' ? 'desktop app' : 'website'} (key created by ${r.keyOwner}).`);
                })
              }
            >
              {busy === 'test' ? 'Testing…' : 'Test connection'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={Boolean(busy) || !remoteUrl.trim() || (!state?.keyHint && !remoteKey.trim())}
              onClick={() =>
                run('sync', async () => {
                  if (changed) await saveConnection();
                  const r = await api('/api/sync/run', 'POST');
                  setNotice(`Synced with the ${r.other === 'desktop' ? 'desktop app' : 'website'} in ${r.seconds}s.`);
                  await load();
                })
              }
            >
              {busy === 'sync' ? 'Syncing…' : '⇅ Sync now'}
            </button>
          </div>
          {busy === 'sync' && !state?.everSynced && (
            <p className="field-hint">The first sync merges everything from both sides, so it can take a little while.</p>
          )}

          {state?.lastRunAt && (
            <div className={`sync-last${state.lastError ? ' bad' : ''}`}>
              <div className="sync-last-head">
                {state.lastError ? 'Last sync failed' : 'Last sync'} · {when(state.lastRunAt)}
              </div>
              {state.lastError ? (
                <p>{state.lastError}</p>
              ) : (
                <>
                  <ResultLine label="Brought here" r={state.lastResult?.pulled} />
                  <ResultLine label="Sent there" r={state.lastResult?.pushed} />
                </>
              )}
            </div>
          )}
        </section>

        <section className="sync-section">
          <h3>Sync keys</h3>
          <p className="field-hint">
            These are keys for the <strong>other</strong> app to connect to <strong>this</strong> one: create one here, then paste it into the
            other app’s “Sync key” field. Revoke it any time.
          </p>
          {typeof window !== 'undefined' && (
            <p className="sync-self">
              In the other app, use this app’s address: <code>{window.location.origin}</code>
            </p>
          )}

          {newKey && (
            <div className="sync-newkey">
              <strong>New key “{newKey.name}” — copy it now, it won’t be shown again:</strong>
              <div className="sync-newkey-row">
                <code>{newKey.key}</code>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(newKey.key).then(() => setCopied(true));
                  }}
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          <form
            className="sync-key-form"
            onSubmit={(e) => {
              e.preventDefault();
              run('key', async () => {
                const r = await api('/api/sync/keys', 'POST', { name: keyName || 'Sync key' });
                setNewKey({ key: r.key, name: r.name });
                setCopied(false);
                setKeyName('');
                await load();
              });
            }}
          >
            <input className="input" placeholder="Name, e.g. “My laptop”" value={keyName} onChange={(e) => setKeyName(e.target.value)} maxLength={100} />
            <button type="submit" className="btn" disabled={Boolean(busy)}>{busy === 'key' ? 'Creating…' : '＋ Create key'}</button>
          </form>

          {keys && keys.length > 0 && (
            <ul className="sync-keys">
              {keys.map((k) => (
                <li key={k.id}>
                  <span>
                    <strong>{k.name}</strong> <span className="sync-muted">…{k.key_hint}</span>
                    <small>
                      by {k.created_by} · {k.last_used_at ? `last used ${when(k.last_used_at)}` : 'not used yet'}
                    </small>
                  </span>
                  {confirmRevoke === k.id ? (
                    <span className="sync-revoke-confirm">
                      <span className="sync-muted">The app using it stops syncing.</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          run('revoke', async () => {
                            await api(`/api/sync/keys/${k.id}`, 'DELETE');
                            setConfirmRevoke(null);
                            await load();
                          })
                        }
                      >
                        Yes, revoke
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmRevoke(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button type="button" className="btn btn-sm btn-ghost" disabled={Boolean(busy)} onClick={() => setConfirmRevoke(k.id)}>
                      Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {keys && keys.length === 0 && !newKey && <p className="sync-muted">No keys yet.</p>}
        </section>
      </div>
    </div>
  );
}

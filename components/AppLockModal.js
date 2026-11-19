'use client';

import { useEffect, useState } from 'react';
import { APP_LOCK_EVENT } from '@/components/AppLock';

// Set, change or turn off the app lock password (separate from the login
// and privacy passwords).
export default function AppLockModal({ onClose }) {
  const [enabled, setEnabled] = useState(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    fetch('/api/auth/app-lock')
      .then((res) => res.json())
      .then((json) => setEnabled(Boolean(json.enabled)))
      .catch(() => setEnabled(false));
  }, []);

  async function save(body, message) {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/auth/app-lock', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not save the app lock.');
      setEnabled(json.enabled);
      window.dispatchEvent(new CustomEvent(APP_LOCK_EVENT, { detail: { enabled: json.enabled } }));
      setCurrent('');
      setNext('');
      setConfirm('');
      setNotice(message);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (next.length < 4) {
      setError('App lock password must be at least 4 characters.');
      return;
    }
    if (next !== confirm) {
      setError('The two passwords don’t match.');
      return;
    }
    if (enabled && !current) {
      setError('Enter your current app lock password to change it.');
      return;
    }
    save({ currentPassword: current, newPassword: next }, enabled ? 'App lock password changed.' : 'App lock is on.');
  }

  function turnOff() {
    if (!current) {
      setError('Enter your current app lock password to turn the lock off.');
      return;
    }
    save({ currentPassword: current, disable: true }, 'App lock is off.');
  }

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <form className="modal modal-sm" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>App lock</h2>
        <p className="field-hint" style={{ marginBottom: 14 }}>
          A separate password (not your login password) that MyTrack asks for every time you open it, and whenever you come
          back to it from another app, window or tab.
        </p>
        {enabled !== null && (
          <p className="field-hint" style={{ marginBottom: 14 }}>
            Status: <strong>{enabled ? 'On' : 'Off'}</strong>
          </p>
        )}
        {error && <div className="top-error">{error}</div>}
        {notice && <div className="top-notice">{notice}</div>}

        {enabled !== null && (
          <>
            {enabled && (
              <div className="field-group">
                <label className="field-label" htmlFor="app-lock-current">Current app lock password</label>
                <input id="app-lock-current" className="input" type="password" autoComplete="off" value={current} onChange={(e) => setCurrent(e.target.value)} />
              </div>
            )}
            <div className="field-group">
              <label className="field-label" htmlFor="app-lock-new">{enabled ? 'New app lock password' : 'App lock password'}</label>
              <input
                id="app-lock-new"
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder="At least 4 characters"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="app-lock-confirm">Confirm password</label>
              <input id="app-lock-confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <p className="field-hint">Forgot it? The lock screen also accepts your login password.</p>
          </>
        )}

        <div className="modal-actions">
          {enabled && (
            <button type="button" className="btn btn-ghost task-modal-delete" onClick={turnOff} disabled={saving} style={{ marginRight: 'auto' }}>
              Turn off
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Close</button>
          {enabled !== null && (
            <button type="submit" className="btn btn-primary" disabled={saving || !next}>
              {saving ? 'Saving…' : enabled ? 'Change password' : 'Turn on app lock'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

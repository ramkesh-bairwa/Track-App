'use client';

import { useState } from 'react';

// Shown inside delete confirmations: turns on "ask for my privacy password
// before deleting" (tracks, sub-tracks, columns, records) right there — and
// creates the privacy password first if there isn't one yet. Once on, the
// server refuses any delete without the password.
export default function DeletePasswordOption({ required, hasPassword, onChange }) {
  const [ticked, setTicked] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (required) {
    return (
      <p className="field-hint" style={{ margin: '4px 0 0' }}>
        🔒 Your privacy password will be asked before deleting. (Turn this off in Profile → Privacy.)
      </p>
    );
  }

  async function turnOn(body) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/privacy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, requireDelete: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not turn this on.');
      onChange({ required: true, hasPassword: true });
    } catch (err) {
      setError(err.message);
      setTicked(false);
    } finally {
      setBusy(false);
    }
  }

  function onTick(e) {
    const on = e.target.checked;
    setTicked(on);
    setError('');
    if (on && hasPassword) turnOn({});
  }

  function createAndTurnOn(e) {
    e.preventDefault();
    if (pw.length < 6) return setError('Use at least 6 characters.');
    if (pw !== pw2) return setError('The passwords don’t match.');
    turnOn({ newPassword: pw });
  }

  return (
    <div className="delete-pw-option" style={{ marginTop: 8 }}>
      <label className="checkbox-row">
        <input type="checkbox" checked={ticked} disabled={busy} onChange={onTick} />
        <span style={{ fontSize: 13 }}>🔒 Always ask for my password before deleting tracks, sub-tracks or records</span>
      </label>
      {ticked && !hasPassword && (
        <form onSubmit={createAndTurnOn} style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          <span className="field-hint" style={{ margin: 0 }}>
            Create a privacy password (separate from your login password):
          </span>
          <input className="input input-sm" type="password" autoComplete="new-password" placeholder="Privacy password (6+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          <input className="input input-sm" type="password" autoComplete="new-password" placeholder="Repeat it" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          <button type="submit" className="btn btn-sm" disabled={busy || !pw}>
            {busy ? 'Saving…' : 'Save & turn on'}
          </button>
        </form>
      )}
      {busy && hasPassword && <span className="field-hint">Turning on…</span>}
      {error && <div className="top-error" style={{ marginTop: 6 }}>{error}</div>}
    </div>
  );
}

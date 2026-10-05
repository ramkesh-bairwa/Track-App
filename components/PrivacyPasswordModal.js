'use client';

import { useState } from 'react';

// Verifies the account's privacy password, then hands control back to the
// caller via onVerified. Used to gate delete/edit actions when the user has
// turned that requirement on in Privacy settings.
export default function PrivacyPasswordModal({
  title = 'Enter your privacy password',
  message,
  onVerified,
  onCancel,
}) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/verify-privacy-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Incorrect password.');
        setLoading(false);
        return;
      }
      await onVerified();
    } catch (err) {
      setError(err?.message || 'Something went wrong. Try again.');
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={loading ? undefined : onCancel}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {message && <p className="confirm-message">{message}</p>}
        {error && <div className="top-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field-group">
            <label className="field-label" htmlFor="privacy-gate-password">Privacy password</label>
            <input
              id="privacy-gate-password"
              className="input"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading || !password}>
              {loading ? 'Checking…' : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

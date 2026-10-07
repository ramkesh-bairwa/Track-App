'use client';

import { useEffect, useState } from 'react';

// Confirms a delete with a password (see lib/deletePassword.js): the privacy
// password when one is set (Settings → Privacy), else the login password.
// `onConfirm(password)` does the delete; if it throws, its message is shown
// and the dialog stays open so the password can be retyped.
export default function PasswordConfirmModal({ title, message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [privacy, setPrivacy] = useState(null); // null = still checking

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/privacy')
      .then((res) => res.json())
      .then((json) => !cancelled && setPrivacy(Boolean(json.hasActionPassword)))
      .catch(() => !cancelled && setPrivacy(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await onConfirm(password);
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
            <label className="field-label" htmlFor="delete-password">
              {privacy ? 'Privacy password' : 'Account password'}
            </label>
            <input
              id="delete-password"
              className="input"
              type="password"
              autoFocus
              autoComplete="current-password"
              placeholder={privacy === false ? 'The password you log in with' : ''}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-danger" disabled={loading || !password}>
              {loading ? 'Deleting…' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

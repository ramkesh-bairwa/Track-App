'use client';

import { useEffect, useState } from 'react';

// Deleting a note needs a password, checked by DELETE /api/notes/:id: the
// privacy password when one is set (Settings → Privacy), else the login password.
export default function NoteDeleteModal({ note, hasSubnotes, onDeleted, onCancel }) {
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
      const res = await fetch(`/api/notes/${note.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Could not delete this note.');
        setLoading(false);
        return;
      }
      onDeleted();
    } catch {
      setError('Something went wrong. Try again.');
      setLoading(false);
    }
  }

  const label = privacy ? 'Privacy password' : 'Account password';

  return (
    <div className="modal-overlay" onClick={loading ? undefined : onCancel}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <h2>Delete &ldquo;{note.title}&rdquo;?</h2>
        <p className="confirm-message">
          {hasSubnotes
            ? 'Everything in it — including all its sub-notes — will be deleted. This cannot be undone.'
            : 'This cannot be undone.'}
        </p>
        {error && <div className="top-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field-group">
            <label className="field-label" htmlFor="note-delete-password">
              {label}
            </label>
            <input
              id="note-delete-password"
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
              {loading ? 'Deleting…' : 'Delete note'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

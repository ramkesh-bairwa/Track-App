'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { generatePassword } from '@/components/tasks/CreateUserForm';

// Add a new account (user = null) or edit one you created (user = {...}).
// When adding, it can optionally drop the person straight onto one of your
// task boards with chosen permissions.
export default function UserFormModal({ user, onClose, onSaved }) {
  const isEdit = Boolean(user);
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState(isEdit ? '' : generatePassword());
  const [showPassword, setShowPassword] = useState(true);
  const [boards, setBoards] = useState([]);
  const [boardUuid, setBoardUuid] = useState('');
  const [perms, setPerms] = useState({ can_add: false, can_edit: false, can_delete: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (isEdit) return;
    fetch('/api/users')
      .then((r) => (r.ok ? r.json() : { boards: [] }))
      .then((j) => setBoards(j.boards || []))
      .catch(() => {});
  }, [isEdit]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !saving) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Enter the person’s name.');
    if (!email.trim()) return setError('Enter their email address.');
    if (!isEdit && password.length < 6) return setError('The password must be at least 6 characters.');
    if (isEdit && password && password.length < 6) return setError('The new password must be at least 6 characters.');
    setSaving(true);
    try {
      const res = await fetch(isEdit ? `/api/users/${user.id}` : '/api/users', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isEdit
            ? { name, email, password }
            : { name, email, password, board_uuid: boardUuid || null, ...perms }
        ),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not save.');
      onSaved?.();
      if (isEdit && !password) {
        onClose();
      } else {
        setCreated({ name: name.trim(), email: email.trim().toLowerCase(), password, reset: isEdit });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="new-track-head">
          <h2>{isEdit ? `Edit ${user.name}` : 'Add user'}</h2>
          <button type="button" className="new-track-close" onClick={onClose} title="Close">×</button>
        </div>

        {created ? (
          <>
            <div className="task-notice">
              {created.reset ? 'Password reset' : 'Account created'} for <strong>{created.name}</strong>. Share these sign-in details:
              <span className="create-user-creds" style={{ display: 'flex', margin: '8px 0' }}>
                {created.email} · <code>{created.password}</code>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => navigator.clipboard?.writeText(`Email: ${created.email}\nPassword: ${created.password}`)}
                >
                  Copy
                </button>
              </span>
              They can change the password from their profile after signing in.
            </div>
            <div className="modal-actions">
              {!isEdit && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setCreated(null);
                    setName('');
                    setEmail('');
                    setPassword(generatePassword());
                  }}
                >
                  Add another
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div className="field-group">
              <label className="field-label">Full name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="field-group">
              <label className="field-label">Email (they sign in with this)</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field-group">
              <label className="field-label">{isEdit ? 'New password (leave blank to keep the current one)' : 'Starting password'}</label>
              <div className="create-user-password">
                <input
                  className="input input-mono"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder={isEdit ? 'Unchanged' : ''}
                />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? '🙈' : '👁'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPassword(generatePassword())} title="Generate">↻</button>
              </div>
            </div>
            {!isEdit && boards.length > 0 && (
              <div className="field-group">
                <label className="field-label">Add to a task board (optional)</label>
                <select className="input" value={boardUuid} onChange={(e) => setBoardUuid(e.target.value)}>
                  <option value="">Don’t add to a board</option>
                  {boards.map((b) => (
                    <option key={b.uuid} value={b.uuid}>{b.name}</option>
                  ))}
                </select>
                {boardUuid && (
                  <div className="task-perm-row" style={{ marginTop: 8 }}>
                    <span className="task-muted">Can:</span>
                    <label className="checkbox-row"><input type="checkbox" checked disabled /><span>View</span></label>
                    {[
                      ['can_add', 'Add'],
                      ['can_edit', 'Edit'],
                      ['can_delete', 'Delete'],
                    ].map(([key, label]) => (
                      <label key={key} className="checkbox-row">
                        <input type="checkbox" checked={perms[key]} onChange={(e) => setPerms((p) => ({ ...p, [key]: e.target.checked }))} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
            {error && <div className="top-error">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>,
    document.body
  );
}

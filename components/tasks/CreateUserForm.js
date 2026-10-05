'use client';

import { useState } from 'react';

export function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

// Admin sets up a new account and adds it to the board in one go. Used from
// Settings → Members, the board header, and inline in the task form's
// "Assign to" picker. `onCreate(values)` resolves with the API result.
export default function CreateUserForm({ onCreate, onCancel, submitLabel = 'Create user', compact }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(() => generatePassword());
  const [showPassword, setShowPassword] = useState(true);
  const [perms, setPerms] = useState({ can_add: false, can_edit: false, can_delete: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  async function submit() {
    setError('');
    if (!name.trim()) return setError('Enter the person’s name.');
    if (!email.trim()) return setError('Enter their email address.');
    if (password.length < 6) return setError('The password must be at least 6 characters.');
    setBusy(true);
    try {
      const result = await onCreate({ name: name.trim(), email: email.trim(), password, ...perms, create: true });
      setDone({ ...result, email: email.trim(), password });
      setName('');
      setEmail('');
      setPassword(generatePassword());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // A <div>, not a <form>: this sits inside the task form, and nested forms
  // would submit the task instead.
  return (
    <div className={`create-user-form${compact ? ' compact' : ''}`}>
      {done && (
        <div className="task-notice">
          {done.existingAccount ? (
            <>{done.name} already had an account, so they were added to the board. Their password was not changed.</>
          ) : done.alreadyMember ? (
            <>{done.name} is already a member of this board.</>
          ) : (
            <>
              Account created for <strong>{done.name}</strong>. Share these sign-in details with them:
              <span className="create-user-creds">
                {done.email} · <code>{done.password}</code>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => navigator.clipboard?.writeText(`Email: ${done.email}\nPassword: ${done.password}`)}
                >
                  Copy
                </button>
              </span>
              They can change the password from their profile after signing in.
            </>
          )}
        </div>
      )}
      <div className="create-user-grid">
        <input
          className="input"
          placeholder="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}
        />
        <input
          className="input"
          type="email"
          placeholder="Email (they sign in with this)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}
        />
        <div className="create-user-password">
          <input
            className="input input-mono"
            type={showPassword ? 'text' : 'password'}
            placeholder="Starting password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPassword((v) => !v)} title={showPassword ? 'Hide' : 'Show'}>
            {showPassword ? '🙈' : '👁'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPassword(generatePassword())} title="Generate a new password">
            ↻
          </button>
        </div>
      </div>
      <div className="create-user-foot">
        <div className="task-perm-row">
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
        <div style={{ display: 'flex', gap: 8 }}>
          {onCancel && <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>Cancel</button>}
          <button type="button" className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>
            {busy ? 'Creating…' : submitLabel}
          </button>
        </div>
      </div>
      {error && <div className="top-error" style={{ marginTop: 10, marginBottom: 0 }}>{error}</div>}
    </div>
  );
}

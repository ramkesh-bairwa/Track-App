'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import UserFormModal from '@/components/users/UserFormModal';
import { languageForName, languageLabel } from '@/lib/codeLanguages';

// Asks for a file name, creates the code file, and opens it in the editor.
export function NewCodeFileModal({ onClose }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not create the file.');
      router.push(`/dashboard/code/${json.uuid}`);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  if (!mounted) return null;
  const detected = name.trim() ? languageLabel(languageForName(name.trim())) : null;
  return createPortal(
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <form className="modal modal-sm" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Save code</h2>
        <div className="field-group">
          <label className="field-label" htmlFor="code-file-name">File name</label>
          <input
            id="code-file-name"
            className="input input-mono"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. helpers.js, query.sql, notes.md"
            autoFocus
            required
          />
          <p className="field-hint">{detected ? `Language: ${detected} (from the extension)` : 'The extension sets the language.'}</p>
        </div>
        {error && <div className="top-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Open editor'}</button>
        </div>
      </form>
    </div>,
    document.body
  );
}

// Add user · Users · Photo editor · Code — in the desktop topbar, and as a
// list in the sidebar (the topbar is hidden on phones).
export default function TopbarTools({ variant = 'topbar', hidden = [] }) {
  const router = useRouter();
  const pathname = usePathname() || '';
  const [addUser, setAddUser] = useState(false);
  const [newCode, setNewCode] = useState(false);
  const cls = variant === 'topbar' ? 'tasks-menu-trigger' : 'sidebar-tasks-link';
  const active = (p) => (pathname.startsWith(p) ? ' active' : '');
  const shows = (id) => !hidden.includes(id); // profile → Accessibility

  return (
    <>
      {shows('add-user') && (
        <button type="button" className={cls} onClick={() => setAddUser(true)} title="Create a user account">
          <i className="fa-solid fa-user-plus" />
          <span>Add user</span>
        </button>
      )}
      {shows('users') && (
        <Link href="/dashboard/users" className={`${cls}${active('/dashboard/users')}`} title="All users">
          <i className="fa-solid fa-users" />
          <span>Users</span>
        </Link>
      )}
      {shows('photo-editor') && (
        <Link href="/dashboard/photo-editor" className={`${cls}${active('/dashboard/photo-editor')}`} title="Photo editor, collage maker & PDF editor">
          <i className="fa-solid fa-wand-magic-sparkles" />
          <span>Photo editor</span>
        </Link>
      )}
      {shows('code') && (
        <span className="topbar-code-group">
          <button type="button" className={`${cls}${active('/dashboard/code')}`} onClick={() => setNewCode(true)} title="Save a new code file">
            <i className="fa-solid fa-code" />
            <span>Save code</span>
          </button>
          <Link href="/dashboard/code" className={`${cls} topbar-code-list`} title="Your saved code files">
            <i className="fa-solid fa-folder-open" />
            {variant !== 'topbar' && <span>Saved code</span>}
          </Link>
        </span>
      )}
      {shows('security-test') && (
        <Link href="/dashboard/security-test" className={`${cls}${active('/dashboard/security-test')}`} title="Run a security self-scan of this site">
          <i className="fa-solid fa-shield-halved" />
          <span>Test site</span>
        </Link>
      )}
      {addUser && (
        <UserFormModal
          user={null}
          onClose={() => setAddUser(false)}
          onSaved={() => {
            if (pathname.startsWith('/dashboard/users')) router.refresh();
          }}
        />
      )}
      {newCode && <NewCodeFileModal onClose={() => setNewCode(false)} />}
    </>
  );
}

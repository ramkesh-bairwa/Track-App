'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// "Before start that note it will ask title of note" — this is the only
// thing asked up front; everything else (content, styling) happens in the
// editor once the note exists.
export default function NewNoteModal({ parentId, onClose }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Give this note a title.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), parent_id: parentId || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not create the note.');
      router.push(`/dashboard/notes/${json.noteUuid}`);
      router.refresh();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <h2>{parentId ? 'New sub-note' : 'New note'}</h2>
        {error && <div className="top-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field-group" style={{ marginBottom: 0 }}>
            <label className="field-label" htmlFor="new-note-title">Title</label>
            <input
              id="new-note-title"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Meeting notes, Recipe, Project plan"
              autoFocus
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create note'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

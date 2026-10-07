'use client';

import { useMemo, useState } from 'react';
import NoteCard from '@/components/NoteCard';
import NewNoteModal from '@/components/NewNoteModal';

function pathLabel(byId, note) {
  const parts = [];
  let current = note.parent_id ? byId.get(note.parent_id) : null;
  while (current) {
    parts.unshift(current.title);
    current = current.parent_id ? byId.get(current.parent_id) : null;
  }
  return parts.join(' / ');
}

export default function NotesDashboard({ notes }) {
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const q = search.trim();
  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);

  const visibleNotes = useMemo(() => {
    if (!q) return notes.filter((n) => n.parent_id == null);
    const ql = q.toLowerCase();
    return notes.filter((n) => n.title.toLowerCase().includes(ql));
  }, [notes, q]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notes</h1>
          <p>Freeform notes — text, lists, tables, images — organized into as many levels as you like.</p>
        </div>
        <div className="page-head-actions">
          <button className="btn" onClick={() => setShowNew('plain')}>{'</>'} New code note</button>
          <button className="btn btn-primary" onClick={() => setShowNew('rich')}>＋ New note</button>
        </div>
      </div>

      {notes.length > 0 && (
        <input
          type="search"
          className="input dashboard-search-input"
          placeholder="Search all notes, at every level…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      {notes.length === 0 ? (
        <div className="empty-state">
          <h3>Nothing here yet</h3>
          <p>Create your first note — free-form text, a checklist, a table, anything.</p>
          <button className="btn btn-primary" onClick={() => setShowNew('rich')}>＋ New note</button>
        </div>
      ) : q && visibleNotes.length === 0 ? (
        <div className="empty-state">
          <h3>No matches</h3>
          <p>No notes match “{q}”, at any level.</p>
        </div>
      ) : (
        <div className="track-grid">
          {visibleNotes.map((n) => (
            <NoteCard key={n.id} note={n} query={q} trail={q ? pathLabel(byId, n) : ''} />
          ))}
        </div>
      )}

      {showNew && <NewNoteModal defaultMode={showNew} onClose={() => setShowNew(false)} />}
    </>
  );
}

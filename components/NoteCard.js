'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DATE_LOCALE } from '@/lib/dateLocale';

function snippet(html) {
  if (!html) return 'Empty note.';
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text || 'Empty note.';
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString(DATE_LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function NoteCard({ note, query, trail }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [draft, setDraft] = useState(note.title);
  const [saving, setSaving] = useState(false);

  async function saveTitle() {
    const trimmed = draft.trim();
    setRenaming(false);
    if (!trimmed || trimmed === title) {
      setDraft(title);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (res.ok) {
        setTitle(trimmed);
        router.refresh();
      } else {
        setDraft(title);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Link href={`/dashboard/notes/${note.uuid}`} className="track-card note-card">
      {trail && <span className="track-card-path">{trail}</span>}
      <div className="track-card-top">
        <span className="track-card-icon note-card-icon">📝</span>
        {renaming ? (
          <input
            className="input input-sm"
            value={draft}
            autoFocus
            disabled={saving}
            onClick={(e) => e.preventDefault()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); saveTitle(); }
              if (e.key === 'Escape') { setDraft(title); setRenaming(false); }
            }}
          />
        ) : (
          <h3
            onClick={(e) => e.preventDefault()}
            onDoubleClick={(e) => {
              e.preventDefault();
              setRenaming(true);
            }}
            title="Double-click to rename"
          >
            {title}
          </h3>
        )}
      </div>
      <p>{snippet(note.content)}</p>
      <div className="track-card-meta">
        <span>{formatDate(note.updated_at || note.created_at)}</span>
        {note.child_count > 0 && <span>{note.child_count} sub-note{note.child_count === 1 ? '' : 's'}</span>}
      </div>
    </Link>
  );
}

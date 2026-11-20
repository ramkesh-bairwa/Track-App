'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const TITLES = { tracks: 'Tracks & records', notes: 'Notes', tasks: 'Tasks assigned', boards: 'Task boards' };

function fmt(v) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Read-only look at one user's data for an admin — opened from the count tiles,
// no impersonation. `section`: tracks | notes | tasks | boards.
export default function UserDataModal({ userId, section, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [openTrack, setOpenTrack] = useState(null); // { id, name }
  const [track, setTrack] = useState(null);

  const base = `/api/admin/users/${userId}/data`;

  const load = useCallback(async (url, set) => {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load.');
      set(json);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(`${base}?section=${section}`, setData); }, [base, section, load]);
  useEffect(() => {
    if (!openTrack) { setTrack(null); return; }
    setTrack(null);
    load(`${base}?section=track&trackId=${openTrack.id}`, setTrack);
  }, [openTrack, base, load]);

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal data-view-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ua-section-head">
          <h2>{openTrack ? openTrack.name : TITLES[section] || 'Data'}</h2>
          {openTrack && <button type="button" className="btn btn-sm" onClick={() => setOpenTrack(null)}>← All tracks</button>}
        </div>
        {error && <div className="top-error">{error}</div>}

        <div className="data-view-body">
          {/* TRACK DETAIL */}
          {openTrack ? (
            !track ? <p className="ua-muted">Loading…</p> : (
              track.entries.length === 0 ? <p className="ua-muted">No records in this track.</p> : (
                <table className="data-table">
                  <thead><tr>{track.columns.map((c) => <th key={c.id}>{c.label}</th>)}<th>Added</th></tr></thead>
                  <tbody>
                    {track.entries.map((e) => (
                      <tr key={e.id}>
                        {track.columns.map((c) => <td key={c.id}>{cell(e.data[c.field_key])}</td>)}
                        <td className="ua-muted">{fmt(e.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )
          ) : !data ? (
            <p className="ua-muted">Loading…</p>
          ) : section === 'tracks' ? (
            data.tracks.length === 0 ? <p className="ua-muted">No tracks.</p> : (
              <ul className="data-view-list">
                {data.tracks.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="data-view-row" onClick={() => setOpenTrack({ id: t.id, name: t.name })}>
                      <span className="dot" style={{ background: t.color || 'var(--accent)' }} />
                      <span className="data-view-name">{t.parent_id ? '↳ ' : ''}{t.name}</span>
                      <span className="ua-muted">{t.entries} record{t.entries === 1 ? '' : 's'} →</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : section === 'notes' ? (
            data.notes.length === 0 ? <p className="ua-muted">No notes.</p> : (
              <ul className="data-view-notes">
                {data.notes.map((n) => (
                  <li key={n.id}>
                    <strong>{n.parent_id ? '↳ ' : ''}{n.title || 'Untitled'}</strong>
                    <span className="ua-muted"> · {fmt(n.updated_at)}</span>
                    {n.preview && <p className="data-view-preview">{n.preview}</p>}
                  </li>
                ))}
              </ul>
            )
          ) : section === 'tasks' ? (
            data.tasks.length === 0 ? <p className="ua-muted">No tasks assigned.</p> : (
              <table className="data-table">
                <thead><tr><th>Task</th><th>Board</th><th>Status</th><th>Priority</th><th>Due</th></tr></thead>
                <tbody>
                  {data.tasks.map((t) => (
                    <tr key={t.id}>
                      <td>{t.title}</td>
                      <td className="ua-muted">{t.board}</td>
                      <td>{t.status}</td>
                      <td>{t.priority}</td>
                      <td className="ua-muted">{t.due_date ? new Date(t.due_date).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : section === 'boards' ? (
            data.boards.length === 0 ? <p className="ua-muted">No task boards.</p> : (
              <ul className="data-view-list">
                {data.boards.map((b) => (
                  <li key={b.id}>
                    <div className="data-view-row" style={{ cursor: 'default' }}>
                      <span className="data-view-name">{b.name}</span>
                      <span className="ua-muted">{b.tasks} task{b.tasks === 1 ? '' : 's'} · {b.visibility}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function cell(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

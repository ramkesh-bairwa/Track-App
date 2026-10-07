'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import TaskColumnBuilder, { blankColumn } from '@/components/tasks/TaskColumnBuilder';

function NewBoardModal({ onClose }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [showSerial, setShowSerial] = useState(true);
  const [columnMode, setColumnMode] = useState('default');
  const [customColumns, setCustomColumns] = useState([blankColumn()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    const payload = { name, description, visibility, show_serial: showSerial };
    // Uploading starts the board with no extra columns — the file's own
    // headers become the columns on the upload page.
    if (columnMode === 'upload') payload.columns = [];
    if (columnMode === 'custom') {
      payload.columns = customColumns.filter((c) => c.label.trim());
      if (payload.columns.length === 0) {
        setError('Name at least one column, or choose “Default columns”.');
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/task-boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not create the board.');
      router.push(`/dashboard/tasks/${json.uuid}${columnMode === 'upload' ? '?import=1' : ''}`);
      router.refresh();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <form className="modal modal-lg" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>New task board</h2>
        <div className="field-group">
          <label className="field-label">Board name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Website launch, Support team" autoFocus required />
        </div>
        <div className="field-group">
          <label className="field-label">Description (optional)</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label">Who sees which tasks</label>
          <div className="task-visibility-options">
            <label className={`task-visibility${visibility === 'private' ? ' selected' : ''}`}>
              <input type="radio" checked={visibility === 'private'} onChange={() => setVisibility('private')} />
              <span>
                <strong>🔒 Private</strong>
                <small>Members only see tasks assigned to or created by them.</small>
              </span>
            </label>
            <label className={`task-visibility${visibility === 'public' ? ' selected' : ''}`}>
              <input type="radio" checked={visibility === 'public'} onChange={() => setVisibility('public')} />
              <span>
                <strong>🌐 Public</strong>
                <small>Every member sees every task.</small>
              </span>
            </label>
          </div>
        </div>
        <div className="field-group">
          <label className="field-label">Columns</label>
          <p className="field-hint" style={{ marginTop: 0 }}>
            Every task always has Title, Status, Priority, Assignee, Due date and Description.
          </p>
          <div className="task-visibility-options three">
            <label className={`task-visibility${columnMode === 'default' ? ' selected' : ''}`}>
              <input type="radio" checked={columnMode === 'default'} onChange={() => setColumnMode('default')} />
              <span>
                <strong>Default columns</strong>
                <small>The built-in fields plus an Attachment column.</small>
              </span>
            </label>
            <label className={`task-visibility${columnMode === 'custom' ? ' selected' : ''}`}>
              <input type="radio" checked={columnMode === 'custom'} onChange={() => setColumnMode('custom')} />
              <span>
                <strong>Custom columns</strong>
                <small>The built-in fields plus the columns you define now.</small>
              </span>
            </label>
            <label className={`task-visibility${columnMode === 'upload' ? ' selected' : ''}`}>
              <input type="radio" checked={columnMode === 'upload'} onChange={() => setColumnMode('upload')} />
              <span>
                <strong>⬆ Upload task file</strong>
                <small>Next, upload an Excel or CSV file — its headers become the columns and its rows become tasks.</small>
              </span>
            </label>
          </div>
        </div>
        {columnMode === 'custom' && (
          <div className="field-group">
            <TaskColumnBuilder columns={customColumns} onChange={setCustomColumns} disabled={saving} />
          </div>
        )}
        <div className="field-group">
          <label className="checkbox-row">
            <input type="checkbox" checked={showSerial} onChange={(e) => setShowSerial(e.target.checked)} />
            <span>Add a <strong>Sr. No.</strong> column — numbers every task 1, 2, 3… at the start of the list.</span>
          </label>
        </div>
        <p className="field-hint">You&apos;ll be the admin. You can add or change columns later with “＋ Column” on the board.</p>
        {error && <div className="top-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : columnMode === 'upload' ? 'Create & upload file' : 'Create board'}</button>
        </div>
      </form>
    </div>
  );
}

export default function TaskBoardsDashboard({ boards }) {
  const router = useRouter();
  const [showNew, setShowNew] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null); // board pending deletion
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const mine = boards.filter((b) => b.is_admin);
  const shared = boards.filter((b) => !b.is_admin);

  async function deleteBoard(board) {
    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`/api/task-boards/${board.uuid}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not delete the board.');
      setConfirmDel(null);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  function renderBoards(list) {
    return (
      <div className="track-grid">
        {list.map((b) => (
          <div key={b.id} className="board-card-wrap">
            <Link href={`/dashboard/tasks/${b.uuid}`} className="track-card">
              <div className="track-card-top">
                <span className="track-card-icon" style={{ background: '#35C2A622', color: '#35C2A6' }}>
                  <i className="fa-solid fa-list-check" />
                </span>
                <h3 style={{ cursor: 'pointer' }}>{b.name}</h3>
              </div>
              <p>{b.description || (b.is_admin ? 'You are the admin.' : `Admin: ${b.owner_name}`)}</p>
              <div className="track-card-meta">
                <span>{b.visibility === 'public' ? '🌐 Public' : '🔒 Private'}</span>
                <span>{b.member_count} people</span>
                <span>{Number(b.my_task_count) > 0 ? `${b.my_task_count} mine` : `${b.task_count} tasks`}</span>
              </div>
            </Link>
            {b.is_admin && (
              <button
                type="button"
                className="board-del"
                title="Delete this board"
                aria-label={`Delete board ${b.name}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setConfirmDel(b);
                }}
              >
                <i className="fa-solid fa-trash" />
              </button>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Task assigner</h1>
          <p>Create boards, assign tasks to people, and see every change in the activity log.</p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>＋ New board</button>
        </div>
      </div>

      {boards.length === 0 ? (
        <div className="empty-state">
          <h3>No task boards yet</h3>
          <p>Create a board, add people by email, and start assigning tasks. Boards other people add you to show up here too.</p>
          <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>＋ New board</button>
        </div>
      ) : (
        <>
          {mine.length > 0 && (
            <>
              <h2 className="task-section-title">Boards you manage</h2>
              {renderBoards(mine)}
            </>
          )}
          {shared.length > 0 && (
            <>
              <h2 className="task-section-title">Shared with you</h2>
              {renderBoards(shared)}
            </>
          )}
        </>
      )}

      {showNew && <NewBoardModal onClose={() => setShowNew(false)} />}

      {confirmDel && (
        <div className="modal-overlay" onClick={deleting ? undefined : () => setConfirmDel(null)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <h2>Delete “{confirmDel.name}”?</h2>
            <p className="confirm-message">
              This permanently removes the board, all {confirmDel.task_count} task{Number(confirmDel.task_count) === 1 ? '' : 's'}, its members and its activity log. This cannot be undone.
            </p>
            {error && <div className="top-error">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDel(null)} disabled={deleting}>Cancel</button>
              <button type="button" className="btn btn-danger" onClick={() => deleteBoard(confirmDel)} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete board'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

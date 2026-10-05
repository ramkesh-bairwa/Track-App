'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar, formatDateTime, timeAgo } from '@/components/tasks/taskUi';
import ExportMenu from '@/components/ExportMenu';
import { ACTIVITY_COLUMNS, activityRows } from '@/lib/taskExport';

const ACTION_LABELS = {
  board_create: 'Board created',
  board_update: 'Board settings',
  column_add: 'Column added',
  column_update: 'Column edited',
  column_remove: 'Column removed',
  member_add: 'Member added',
  member_update: 'Permissions',
  member_remove: 'Member removed',
  task_create: 'Task created',
  task_update: 'Task edited',
  task_delete: 'Task deleted',
  task_restore: 'Task restored',
  task_import: 'Tasks imported',
};

const ACTION_TONE = {
  task_create: 'good',
  task_restore: 'good',
  task_import: 'good',
  task_delete: 'bad',
  member_remove: 'bad',
  column_remove: 'bad',
};

// The activity log — the whole board's, or one task's (`task` set). Everyone
// on the board can read it; only the admin gets the Revert buttons.
export default function TaskActivity({ boardUuid, task, people, onClose, onReverted }) {
  const [activity, setActivity] = useState(null);
  const [canRevert, setCanRevert] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/task-boards/${boardUuid}/activity${task ? `?task=${task.id}` : ''}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not load the activity log.');
      setActivity(json.activity);
      setCanRevert(json.canRevert);
    } catch (err) {
      setError(err.message);
    }
  }, [boardUuid, task]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function revert(entry) {
    setBusyId(entry.id);
    setError('');
    try {
      const res = await fetch(`/api/task-boards/${boardUuid}/activity/${entry.id}/revert`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not revert that change.');
      setConfirmId(null);
      await load();
      onReverted?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const authors = useMemo(() => {
    const map = new Map();
    (activity || []).forEach((a) => map.set(a.user_id, a.user_name));
    return [...map.entries()];
  }, [activity]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (activity || []).filter((a) => {
      if (userFilter && String(a.user_id) !== userFilter) return false;
      if (!q) return true;
      return (
        a.summary.toLowerCase().includes(q) ||
        (a.task_title || '').toLowerCase().includes(q) ||
        a.changes.some((c) => `${c.label} ${c.oldText} ${c.newText}`.toLowerCase().includes(q))
      );
    });
  }, [activity, search, userFilter]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg task-activity-modal" onClick={(e) => e.stopPropagation()}>
        <div className="new-track-head">
          <div>
            <h2>{task ? `History — ${task.title}` : 'Activity log'}</h2>
            <p className="new-track-steps">
              Every change, who made it and what it was before.{canRevert ? ' As admin you can revert task changes.' : ''}
            </p>
          </div>
          <button type="button" className="new-track-close" onClick={onClose} title="Close">×</button>
        </div>

        <div className="task-activity-filters">
          <input
            type="search"
            className="input input-sm"
            placeholder="Search the log — field, value, file name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input input-sm" value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
            <option value="">Everyone</option>
            {authors.map(([id, name]) => (
              <option key={id} value={String(id)}>{name}</option>
            ))}
          </select>
          <ExportMenu
            className="btn btn-sm"
            getTable={() => ({
              title: task ? `History - ${task.title}` : 'Activity log',
              columns: ACTIVITY_COLUMNS,
              rows: activityRows(shown),
            })}
            note="Exports the entries currently shown, one row per changed field."
          />
        </div>

        {error && <div className="top-error">{error}</div>}

        <div className="task-activity-list">
          {activity === null ? (
            <p className="task-muted">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="task-muted">{activity.length === 0 ? 'No activity yet.' : 'Nothing matches.'}</p>
          ) : (
            shown.map((a) => {
              const person = people.find((p) => p.id === a.user_id) || { name: a.user_name };
              return (
                <div key={a.id} className={`task-log${a.reverted_at ? ' task-log-reverted' : ''}`}>
                  <Avatar person={person} size={28} />
                  <div className="task-log-body">
                    <div className="task-log-head">
                      <strong>{a.user_name}</strong>
                      <span className={`task-log-badge ${ACTION_TONE[a.action] || ''}`}>{ACTION_LABELS[a.action] || a.action}</span>
                      <span className="task-log-time" title={formatDateTime(a.created_at)}>
                        #{a.id} · {timeAgo(a.created_at)}
                      </span>
                    </div>
                    <div className="task-log-summary">
                      {a.summary}
                      {!task && a.task_title && a.summary.indexOf(a.task_title) === -1 && (
                        <span className="task-muted"> — {a.task_title}</span>
                      )}
                    </div>
                    {a.changes.length > 0 && (
                      <table className="task-log-changes">
                        <thead>
                          <tr><th>Field</th><th>Old</th><th /><th>New</th></tr>
                        </thead>
                        <tbody>
                          {a.changes.map((c) => (
                            <tr key={c.key}>
                              <td className="task-log-field">{c.label}</td>
                              <td className="task-log-old">{c.oldText || <em>empty</em>}</td>
                              <td className="task-log-arrow">→</td>
                              <td className="task-log-new">{c.newText || <em>empty</em>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {a.reverted_at && (
                      <div className="task-log-reverted-note">
                        ↺ Reverted by {a.reverted_by_name || 'admin'} · {formatDateTime(a.reverted_at)}
                      </div>
                    )}
                    {a.revert_of && <div className="task-log-reverted-note">↺ This undid change #{a.revert_of}</div>}
                    {canRevert && a.revertible && (
                      <div className="task-log-actions">
                        {confirmId === a.id ? (
                          <>
                            <span className="task-muted">Undo this change?</span>
                            <button type="button" className="btn btn-sm btn-danger" disabled={busyId === a.id} onClick={() => revert(a)}>
                              {busyId === a.id ? 'Reverting…' : 'Yes, revert'}
                            </button>
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmId(null)}>Cancel</button>
                          </>
                        ) : (
                          <button type="button" className="btn btn-sm" onClick={() => setConfirmId(a.id)}>↺ Revert</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

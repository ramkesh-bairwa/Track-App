'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ExportMenu from '@/components/ExportMenu';
import ActivityEntry, { Pager, DayHeading, withDayHeadings } from '@/components/tasks/ActivityEntry';
import { entryTaskProps } from '@/components/tasks/BoardHistory';
import { ACTIVITY_COLUMNS, activityRows } from '@/lib/taskExport';

// The activity log — the whole board's, or one task's (`task` set). Everyone
// on the board can read it; only the admin gets the Revert buttons.
export default function TaskActivity({ boardUuid, task, people, onClose, onReverted, taskActions }) {
  const [activity, setActivity] = useState(null);
  const [canRevert, setCanRevert] = useState(false);
  const [meId, setMeId] = useState(null);
  const [hideViews, setHideViews] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/task-boards/${boardUuid}/activity${task ? `?task=${task.id}` : ''}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not load the activity log.');
      setActivity(json.activity);
      setCanRevert(json.canRevert);
      setMeId(json.me);
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
    setError('');
    try {
      const res = await fetch(`/api/task-boards/${boardUuid}/activity/${entry.id}/revert`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not revert that change.');
      await load();
      onReverted?.();
    } catch (err) {
      setError(err.message);
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
      if (onlyMine && !a.mine) return false;
      if (hideViews && a.action === 'task_view') return false;
      if (!q) return true;
      return (
        a.summary.toLowerCase().includes(q) ||
        (a.task_title || '').toLowerCase().includes(q) ||
        (a.note || '').toLowerCase().includes(q) ||
        a.changes.some((c) => `${c.label} ${c.oldText} ${c.newText}`.toLowerCase().includes(q))
      );
    });
  }, [activity, search, userFilter, onlyMine, hideViews]);

  // Filters change the list, so start again from the first page.
  useEffect(() => setPage(1), [search, userFilter, onlyMine, hideViews]);
  const PER = 10;
  const pageCount = Math.max(1, Math.ceil(shown.length / PER));
  const current = Math.min(page, pageCount);
  const pageItems = shown.slice((current - 1) * PER, current * PER);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg task-activity-modal" onClick={(e) => e.stopPropagation()}>
        <div className="new-track-head">
          <div>
            <h2>{task ? `History — ${task.title}` : 'Activity log'}</h2>
            <p className="new-track-steps">
              Every change and view, who made it and what it was before. Add a note to any entry — notes are logged too.
              {canRevert ? ' As admin you can revert task changes.' : ''}
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
          {!task && (
            <label className="checkbox-row" title="Changes you made, plus anyone's changes to tasks assigned to, created by or shared with you">
              <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
              <span style={{ fontSize: 13 }}>Only my tasks</span>
            </label>
          )}
          <label className="checkbox-row" title="Leave out who-opened-which-task entries">
            <input type="checkbox" checked={hideViews} onChange={(e) => setHideViews(e.target.checked)} />
            <span style={{ fontSize: 13 }}>Hide views</span>
          </label>
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
            withDayHeadings(pageItems).map(({ heading, entry: a, key }) => heading ? (
              <DayHeading key={key}>{heading}</DayHeading>
            ) : (
              <ActivityEntry
                key={key}
                entry={a}
                people={people}
                boardUuid={boardUuid}
                meId={meId}
                isAdmin={canRevert}
                showTask={!task}
                canRevert={canRevert}
                onRevert={revert}
                onChanged={load}
                {...entryTaskProps(taskActions, a)}
              />
            ))
          )}
        </div>
        <Pager page={current} per={PER} total={shown.length} onPage={setPage} noun="entries" />
      </div>
    </div>
  );
}

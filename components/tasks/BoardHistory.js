'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ActivityEntry, { Pager, DayHeading, withDayHeadings } from '@/components/tasks/ActivityEntry';

const PER = 10;

// Props that let an entry show and change its task — spread onto ActivityEntry.
export function entryTaskProps(taskActions, entry) {
  if (!taskActions) return {};
  const { tasksById, ...rest } = taskActions;
  return { task: (entry.task_id && tasksById.get(entry.task_id)) || null, ...rest };
}

// The board's history under the task list: one readable card per log entry,
// newest first, 10 per page (paged on the server). `refreshKey` changes
// whenever the board reloads, so new activity shows up without a refresh.
// `taskActions` ({ tasksById, statuses, canChangeStatus, canEdit,
// onStatusChange, onOpenTask }) lets each entry update its task in place.
export default function BoardHistory({ boardUuid, people, refreshKey, onOpenFullLog, onReverted, taskActions }) {
  const [page, setPage] = useState(1);
  const [hideViews, setHideViews] = useState(false);
  const [state, setState] = useState({ activity: null, total: 0, canRevert: false, me: null });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/task-boards/${boardUuid}/activity?page=${page}&per=${PER}${hideViews ? '&views=0' : ''}`
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not load the history.');
      setError('');
      setState({ activity: json.activity, total: json.total, canRevert: json.canRevert, me: json.me });
    } catch (err) {
      setError(err.message);
    }
  }, [boardUuid, page, hideViews]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Opened from a notification (…#log-123): scroll to that entry and flash it.
  const flashed = useRef(false);
  useEffect(() => {
    if (flashed.current || !state.activity) return;
    const id = window.location.hash.match(/^#log-(\d+)$/)?.[1];
    if (!id) return;
    const el = document.getElementById(`log-${id}`);
    if (!el) return;
    flashed.current = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('log-flash');
    setTimeout(() => el.classList.remove('log-flash'), 2600);
  }, [state.activity]);

  async function revert(entry) {
    const res = await fetch(`/api/task-boards/${boardUuid}/activity/${entry.id}/revert`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || 'Could not revert that change.');
      return;
    }
    await load();
    onReverted?.();
  }

  const { activity, total, canRevert, me } = state;

  return (
    <section className="table-panel board-history">
      <div className="table-toolbar">
        <div>
          <h3 className="board-history-title">History</h3>
          <span className="task-muted" style={{ fontSize: 12.5 }}>
            {activity === null ? 'Loading…' : `${total} entr${total === 1 ? 'y' : 'ies'} · every change, view and note on this board`}
          </span>
        </div>
        <div className="table-toolbar-actions">
          <label className="checkbox-row" title="Leave out who-opened-which-task entries">
            <input
              type="checkbox"
              checked={hideViews}
              onChange={(e) => {
                setHideViews(e.target.checked);
                setPage(1);
              }}
            />
            <span style={{ fontSize: 13 }}>Hide views</span>
          </label>
          <button type="button" className="btn btn-sm" onClick={onOpenFullLog} title="Search, filter and export the whole log">
            🔎 Search &amp; export
          </button>
        </div>
      </div>

      {error && <div className="top-error" style={{ margin: '0 16px' }}>{error}</div>}

      <div className="board-history-list">
        {activity === null ? null : activity.length === 0 ? (
          <p className="task-muted" style={{ padding: '20px 16px' }}>No activity yet.</p>
        ) : (
          withDayHeadings(activity).map(({ heading, entry: a, key }) => heading ? (
              <DayHeading key={key}>{heading}</DayHeading>
            ) : (
            <ActivityEntry
              key={key}
              entry={a}
              people={people}
              boardUuid={boardUuid}
              meId={me}
              isAdmin={canRevert}
              canRevert={canRevert}
              onRevert={revert}
              onChanged={load}
              {...entryTaskProps(taskActions, a)}
            />
          ))
        )}
      </div>

      <Pager page={page} per={PER} total={total} onPage={setPage} noun="entries" />
    </section>
  );
}

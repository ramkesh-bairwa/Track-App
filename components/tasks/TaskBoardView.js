'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { statusColor, priorityColor, PRIORITIES, orderTaskColumns } from '@/lib/taskConfig';
import { Avatar, Pill, ColumnValue, formatDay, timeAgo, formatDateTime, isOverdue } from '@/components/tasks/taskUi';
import TaskModal, { ColumnInput } from '@/components/tasks/TaskModal';
import TaskColumnBuilder, { blankColumn } from '@/components/tasks/TaskColumnBuilder';
import TaskActivity from '@/components/tasks/TaskActivity';
import TaskImportModal from '@/components/tasks/TaskImportModal';
import TaskBoardSettings from '@/components/tasks/TaskBoardSettings';
import CreateUserForm from '@/components/tasks/CreateUserForm';
import ExportMenu from '@/components/ExportMenu';
import ConfirmModal from '@/components/ConfirmModal';
import { taskBoardExportTable } from '@/lib/taskExport';

function blankDraft(board) {
  return { title: '', description: '', status: board.statuses[0]?.name, priority: 'Medium', assignee_id: '', due_date: '', data: {} };
}

async function api(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Something went wrong.');
  return json;
}

export default function TaskBoardView({ initial, me, startWithImport = false }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [modal, setModal] = useState(null); // { mode: 'new' | 'edit' | 'view', task }
  const [editCell, setEditCell] = useState(null); // { taskId, key } being edited inline
  const [editValue, setEditValue] = useState(null); // in-progress value for a custom-column cell
  const [renameCol, setRenameCol] = useState(null); // custom column id being renamed from its header
  const [deleteCol, setDeleteCol] = useState(null); // custom column pending delete confirmation
  const [history, setHistory] = useState(null); // { task } | { task: null } for the whole board
  const [showSettings, setShowSettings] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // Board created via "Upload task file": open on a plain upload page.
  const [uploadPage, setUploadPage] = useState(startWithImport);
  const [notice, setNotice] = useState('');
  const [renameTo, setRenameTo] = useState(null); // board name suggested by an imported file
  const [sort, setSort] = useState(null); // { key, dir: 1 | -1 }
  const [dragKey, setDragKey] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [draft, setDraft] = useState(null); // quick-row values while adding inline
  const [draftSaving, setDraftSaving] = useState(false);
  const [hiddenCols, setHiddenCols] = useState(() => new Set()); // column keys this viewer hid from the listing
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  const { board, access, columns, people, tasks } = data;
  const base = `/api/task-boards/${board.uuid}`;

  const reload = useCallback(async () => {
    try {
      const res = await fetch(base);
      if (res.status === 404) {
        router.push('/dashboard/tasks');
        return;
      }
      const json = await res.json();
      if (res.ok) setData(json);
    } catch {
      // offline — keep showing what we have
    }
  }, [base, router]);

  // Other people change tasks too — refresh when the tab regains focus and
  // every 30 seconds while it's visible.
  useEffect(() => {
    const onFocus = () => reload();
    window.addEventListener('focus', onFocus);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, 30000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(timer);
    };
  }, [reload]);

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const tableCols = useMemo(() => orderTaskColumns(board.column_order, columns), [board.column_order, columns]);
  // The admin's board-wide choice (Settings → Columns) comes first; each
  // viewer can then hide more of what's left with "☰ Columns".
  const boardCols = useMemo(() => {
    const boardHidden = new Set(board.hidden_columns || []);
    return tableCols.filter((c) => !boardHidden.has(c.key));
  }, [tableCols, board.hidden_columns]);
  const visibleCols = useMemo(() => boardCols.filter((c) => !hiddenCols.has(c.key)), [boardCols, hiddenCols]);

  // Which columns show is a per-viewer preference, so it lives in this
  // browser rather than on the board. Loaded after mount to avoid a
  // server/client render mismatch.
  const hiddenColsKey = `task-board-hidden-cols:${board.uuid}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(hiddenColsKey) || '[]');
      setHiddenCols(new Set(Array.isArray(saved) ? saved : []));
    } catch {
      setHiddenCols(new Set());
    }
  }, [hiddenColsKey]);

  function updateHiddenCols(next) {
    setHiddenCols(next);
    try {
      localStorage.setItem(hiddenColsKey, JSON.stringify([...next]));
    } catch {
      // storage blocked (private window) — the choice still applies until reload
    }
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (assigneeFilter === 'me' && t.assignee_id !== me.id) return false;
      if (assigneeFilter === 'none' && t.assignee_id) return false;
      if (assigneeFilter && !['me', 'none'].includes(assigneeFilter) && String(t.assignee_id) !== assigneeFilter) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        Object.values(t.data || {}).some((v) =>
          (v && typeof v === 'object' ? v.name || '' : String(v ?? '')).toLowerCase().includes(q)
        )
      );
    });
  }, [tasks, search, statusFilter, priorityFilter, assigneeFilter, me.id]);

  const sorted = useMemo(() => {
    if (!sort) return shown;
    const col = tableCols.find((c) => c.key === sort.key);
    if (!col) return shown;
    const value = (t) => {
      switch (col.key) {
        case 'title': return t.title.toLowerCase();
        case 'status': return board.statuses.findIndex((s) => s.name === t.status);
        case 'priority': return PRIORITIES.findIndex((p) => p.name === t.priority);
        case 'assignee': return peopleById.get(t.assignee_id)?.name.toLowerCase() ?? null;
        case 'due': return t.due_date || null;
        case 'updated': return t.updated_at;
        default: {
          const v = t.data?.[col.custom.field_key];
          if (v === '' || v === null || v === undefined) return null;
          if (col.custom.field_type === 'number') return Number(v);
          if (col.custom.field_type === 'checkbox') return v ? 1 : 0;
          if (col.custom.field_type === 'file') return v?.name?.toLowerCase() ?? null;
          return String(v).toLowerCase();
        }
      }
    };
    // Empty values always sink to the bottom, whichever direction.
    return shown
      .map((t) => ({ t, v: value(t) }))
      .sort((a, b) => {
        if (a.v === null) return b.v === null ? 0 : 1;
        if (b.v === null) return -1;
        return (a.v < b.v ? -1 : a.v > b.v ? 1 : 0) * sort.dir;
      })
      .map((x) => x.t);
  }, [shown, sort, tableCols, board.statuses, peopleById]);

  // Header click: ascending → descending → back to the board's own order.
  function toggleSort(key) {
    setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));
  }

  function handleColDrop(e, targetKey) {
    e.preventDefault();
    setDragOverKey(null);
    const from = e.dataTransfer.getData('text/plain');
    if (!from || from === targetKey) return;
    const keys = tableCols.map((c) => c.key);
    const fromIndex = keys.indexOf(from);
    const toIndex = keys.indexOf(targetKey);
    if (fromIndex === -1 || toIndex === -1) return;
    keys.splice(toIndex, 0, keys.splice(fromIndex, 1)[0]);
    setData((d) => ({ ...d, board: { ...d.board, column_order: keys } }));
    api(base, 'PATCH', { column_order: keys }).catch((err) => setError(err.message));
  }

  async function saveDraft() {
    if (!draft.title.trim()) {
      setError('A task needs a title.');
      return;
    }
    setDraftSaving(true);
    setError('');
    try {
      await api(`${base}/tasks`, 'POST', {
        ...draft,
        title: draft.title.trim(),
        assignee_id: draft.assignee_id === '' ? null : Number(draft.assignee_id),
        due_date: draft.due_date || null,
      });
      // Keep the quick row open with a fresh line for the next task.
      setDraft(blankDraft(board));
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setDraftSaving(false);
    }
  }

  function draftKeyDown(e) {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      saveDraft();
    } else if (e.key === 'Escape') {
      setDraft(null);
    }
  }

  async function importTasks(list, fileName, newColumns) {
    await api(`${base}/tasks/import`, 'POST', { tasks: list, fileName, newColumns });
    await reload();
  }

  // After an import the admin is offered the file's title as the board name.
  function afterImport(count, title) {
    if (!count) return;
    setNotice(`Imported ${count} task${count === 1 ? '' : 's'}.`);
    if (access.isAdmin && title && title !== board.name) setRenameTo(title);
  }

  function leaveUploadPage(count, title) {
    setUploadPage(false);
    router.replace(`/dashboard/tasks/${board.uuid}`);
    afterImport(count, title);
  }

  async function renameBoard() {
    const name = renameTo;
    setRenameTo(null);
    try {
      await api(base, 'PATCH', { name });
      setNotice(`Board renamed to “${name}”.`);
      await reload();
      router.refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function addColumns(defs) {
    for (const def of defs) await api(`${base}/columns`, 'POST', def);
    await reload();
  }

  // Rename / delete a custom column straight from its header (admin only).
  async function renameColumn(column, label) {
    const name = String(label ?? '').trim();
    setRenameCol(null);
    if (!name || name === column.label) return;
    setError('');
    try {
      await api(`${base}/columns/${column.id}`, 'PATCH', { label: name });
      await reload();
    } catch (err) {
      setError(err.message);
    }
  }
  // Called from the confirm modal, which shows any error itself.
  async function removeColumn(column) {
    setError('');
    await api(`${base}/columns/${column.id}`, 'DELETE');
    await reload();
  }

  const counts = useMemo(() => {
    const map = new Map(board.statuses.map((s) => [s.name, 0]));
    tasks.forEach((t) => map.set(t.status, (map.get(t.status) || 0) + 1));
    return map;
  }, [tasks, board.statuses]);

  const canChangeStatus = (task) => access.canEdit || task.assignee_id === me.id;

  async function saveTask(task, values) {
    if (task) await api(`${base}/tasks/${task.id}`, 'PATCH', values);
    else await api(`${base}/tasks`, 'POST', values);
    await reload();
  }

  // Admin creates an account and adds it to the board; the fresh people list
  // is loaded before resolving so the new person is immediately assignable.
  async function createUser(values) {
    const result = await api(`${base}/members`, 'POST', values);
    await reload();
    return result;
  }

  async function quickStatus(task, status) {
    setError('');
    setData((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === task.id ? { ...t, status } : t)) }));
    try {
      await api(`${base}/tasks/${task.id}`, 'PATCH', { status });
    } catch (err) {
      setError(err.message);
    }
    reload();
  }

  async function deleteTask(task) {
    setError('');
    await api(`${base}/tasks/${task.id}`, 'DELETE');
    await reload();
  }

  async function leaveBoard() {
    await api(`${base}/members/${me.id}`, 'DELETE');
    router.push('/dashboard/tasks');
    router.refresh();
  }

  function openTask(task) {
    setModal({ mode: access.canEdit ? 'edit' : 'view', task });
  }

  // ---- inline cell editing (double-click a cell to edit it in place) ----
  const isEditing = (task, key) => editCell && editCell.taskId === task.id && editCell.key === key;
  function startEdit(task, key, initial) {
    if (!access.canEdit) return;
    setEditValue(initial);
    setEditCell({ taskId: task.id, key });
  }
  function cancelEdit() {
    setEditCell(null);
    setEditValue(null);
  }
  async function commitCell(task, key, rawValue) {
    let patch;
    let optimistic;
    if (key === 'title') {
      const v = String(rawValue ?? '').trim();
      if (!v || v === task.title) return cancelEdit();
      patch = { title: v };
      optimistic = { title: v };
    } else if (key === 'priority') {
      if (rawValue === task.priority) return cancelEdit();
      patch = { priority: rawValue };
      optimistic = { priority: rawValue };
    } else if (key === 'assignee') {
      const id = rawValue === '' || rawValue == null ? null : Number(rawValue);
      if (id === (task.assignee_id ?? null)) return cancelEdit();
      patch = { assignee_id: id };
      optimistic = { assignee_id: id };
    } else if (key === 'due') {
      const v = rawValue || null;
      if ((v || null) === (task.due_date || null)) return cancelEdit();
      patch = { due_date: v };
      optimistic = { due_date: v };
    } else {
      // custom column: key is the column's field_key
      const cur = task.data?.[key];
      if (JSON.stringify(cur ?? null) === JSON.stringify(rawValue ?? null)) return cancelEdit();
      const data = { ...(task.data || {}), [key]: rawValue };
      patch = { data };
      optimistic = { data };
    }
    cancelEdit();
    setData((d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === task.id ? { ...x, ...optimistic } : x)) }));
    try {
      await api(`${base}/tasks/${task.id}`, 'PATCH', patch);
    } catch (err) {
      setError(err.message);
    }
    reload();
  }

  const admin = people.find((p) => p.is_admin);

  function renderCell(col, t) {
    const editTitle = access.canEdit ? 'Double-click to edit' : undefined;
    const escKey = (e) => {
      if (e.key === 'Escape') cancelEdit();
    };
    switch (col.key) {
      case 'title':
        return (
          <td key={col.key} className="task-title-cell" onDoubleClick={(e) => e.stopPropagation()}>
            {isEditing(t, 'title') ? (
              <input
                className="input input-sm"
                defaultValue={t.title}
                autoFocus
                onBlur={(e) => commitCell(t, 'title', e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.target.blur();
                  else escKey(e);
                }}
              />
            ) : (
              <>
                <span className="task-title-text" onDoubleClick={() => startEdit(t, 'title')} title={editTitle} role="button">{t.title}</span>
                {t.description && <div className="task-desc">{t.description}</div>}
              </>
            )}
          </td>
        );
      case 'status':
        return (
          <td key={col.key} onDoubleClick={(e) => e.stopPropagation()}>
            {canChangeStatus(t) ? (
              <select
                className="task-status-select"
                style={{ '--pill': statusColor(board.statuses, t.status) }}
                value={t.status}
                onChange={(e) => quickStatus(t, e.target.value)}
              >
                {board.statuses.map((s) => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            ) : (
              <Pill color={statusColor(board.statuses, t.status)}>{t.status}</Pill>
            )}
          </td>
        );
      case 'priority':
        return (
          <td key={col.key} onDoubleClick={(e) => e.stopPropagation()}>
            {isEditing(t, 'priority') ? (
              <select className="input input-sm" defaultValue={t.priority} autoFocus onChange={(e) => commitCell(t, 'priority', e.target.value)} onBlur={cancelEdit} onKeyDown={escKey}>
                {PRIORITIES.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            ) : (
              <span onDoubleClick={() => startEdit(t, 'priority')} title={editTitle}>
                <Pill color={priorityColor(t.priority)}>{t.priority}</Pill>
              </span>
            )}
          </td>
        );
      case 'assignee': {
        const assignee = peopleById.get(t.assignee_id);
        return (
          <td key={col.key} onDoubleClick={(e) => e.stopPropagation()}>
            {isEditing(t, 'assignee') ? (
              <select className="input input-sm" defaultValue={t.assignee_id ?? ''} autoFocus onChange={(e) => commitCell(t, 'assignee', e.target.value)} onBlur={cancelEdit} onKeyDown={escKey}>
                <option value="">Unassigned</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.id === me.id ? 'You' : p.name}</option>
                ))}
              </select>
            ) : (
              <span onDoubleClick={() => startEdit(t, 'assignee')} title={editTitle}>
                {assignee ? (
                  <span className="task-assignee">
                    <Avatar person={assignee} size={22} />
                    {assignee.id === me.id ? 'You' : assignee.name}
                  </span>
                ) : t.assignee_id ? (
                  <span className="task-muted">Former member</span>
                ) : (
                  <span className="cell-empty">Unassigned</span>
                )}
              </span>
            )}
          </td>
        );
      }
      case 'due': {
        const overdue = isOverdue(t, board.statuses);
        return (
          <td key={col.key} className={overdue ? 'task-overdue' : undefined} onDoubleClick={(e) => e.stopPropagation()}>
            {isEditing(t, 'due') ? (
              <input
                type="date"
                className="input input-sm"
                defaultValue={t.due_date || ''}
                autoFocus
                onBlur={(e) => commitCell(t, 'due', e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.target.blur();
                  else escKey(e);
                }}
              />
            ) : (
              <span onDoubleClick={() => startEdit(t, 'due')} title={editTitle}>
                {t.due_date ? `${overdue ? '⚠ ' : ''}${formatDay(t.due_date)}` : <span className="cell-empty">—</span>}
              </span>
            )}
          </td>
        );
      }
      case 'updated': {
        const updater = peopleById.get(t.updated_by);
        return (
          <td key={col.key} className="task-muted" title={formatDateTime(t.updated_at)}>
            {timeAgo(t.updated_at)}
            {updater && <div style={{ fontSize: 11 }}>by {updater.id === me.id ? 'you' : updater.name}</div>}
          </td>
        );
      }
      default: {
        const fk = col.custom.field_key;
        return (
          <td key={col.key} onDoubleClick={(e) => e.stopPropagation()}>
            {isEditing(t, fk) ? (
              <div className="task-draft-field" onBlur={() => commitCell(t, fk, editValue)} onKeyDown={escKey}>
                <ColumnInput column={col.custom} value={editValue} onChange={setEditValue} autoFocus />
              </div>
            ) : (
              <span onDoubleClick={() => startEdit(t, fk, t.data?.[fk])} title={editTitle}>
                <ColumnValue column={col.custom} value={t.data?.[fk]} />
              </span>
            )}
          </td>
        );
      }
    }
  }

  function renderDraftCell(col) {
    const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
    switch (col.key) {
      case 'title':
        return (
          <input className="input input-sm" placeholder="Task title" value={draft.title} onChange={(e) => set('title', e.target.value)} autoFocus />
        );
      case 'status':
        return (
          <select className="input input-sm" value={draft.status} onChange={(e) => set('status', e.target.value)}>
            {board.statuses.map((s) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
        );
      case 'priority':
        return (
          <select className="input input-sm" value={draft.priority} onChange={(e) => set('priority', e.target.value)}>
            {PRIORITIES.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        );
      case 'assignee':
        return (
          <select className="input input-sm" value={draft.assignee_id} onChange={(e) => set('assignee_id', e.target.value)}>
            <option value="">Unassigned</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.id === me.id ? 'You' : p.name}</option>
            ))}
          </select>
        );
      case 'due':
        return <input type="date" className="input input-sm" value={draft.due_date} onChange={(e) => set('due_date', e.target.value)} />;
      case 'updated':
        return <span className="cell-empty">New</span>;
      default:
        return (
          <div className="task-draft-field">
            <ColumnInput
              column={col.custom}
              value={draft.data[col.custom.field_key]}
              onChange={(v) => setDraft((d) => ({ ...d, data: { ...d.data, [col.custom.field_key]: v } }))}
            />
          </div>
        );
    }
  }

  return (
    <>
      <div className="track-breadcrumbs">
        <Link href="/dashboard/tasks">Task assigner</Link>
        <span className="track-breadcrumb-sep">/</span>
      </div>

      <div className="page-head">
        <div>
          <h1 className="task-board-title">
            {board.name}
            <span className={`task-role-badge${access.isAdmin ? ' admin' : ''}`}>{access.isAdmin ? 'Admin' : 'Member'}</span>
            <span className="task-role-badge" title={board.visibility === 'public' ? 'Every member sees every task' : 'Members only see their own tasks'}>
              {board.visibility === 'public' ? '🌐 Public' : '🔒 Private'}
            </span>
          </h1>
          <p>
            {board.description || 'No description.'}
            {admin && !access.isAdmin && <span className="task-muted"> · Admin: {admin.name}</span>}
          </p>
          {!access.isAdmin && (
            <p className="task-muted" style={{ marginTop: 4, fontSize: 12 }}>
              Your permissions: View{access.canAdd ? ' · Add' : ''}{access.canEdit ? ' · Edit' : ''}{access.canDelete ? ' · Delete' : ''}
            </p>
          )}
        </div>
        <div className="page-head-actions">
          {access.canAdd && (
            <>
              <button type="button" className="btn" onClick={() => setDraft((d) => d || blankDraft(board))} title="Type a new task straight into the table">
                ＋ Quick row
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setModal({ mode: 'new', task: null })} title="Open the full task form">
                ＋ Add task
              </button>
              <button type="button" className="btn" onClick={() => setShowImport(true)} title="Create tasks from an Excel or CSV file">
                ⬆ Import
              </button>
            </>
          )}
          {access.isAdmin && (
            <button type="button" className="btn" onClick={() => setShowAddColumn(true)}>＋ Column</button>
          )}
          <button type="button" className="btn" onClick={() => setHistory({ task: null })}>🕘 Activity log</button>
          <ExportMenu
            pickColumns
            getTable={async () => {
              // Fetched at click time so the Excel "Activity log" sheet is current.
              const res = await fetch(`${base}/activity?limit=500`);
              const json = await res.json().catch(() => ({}));
              return taskBoardExportTable({ board, columns, people, tasks: shown, activity: res.ok ? json.activity : null });
            }}
            note={`${shown.length === tasks.length ? `All ${tasks.length}` : `The ${shown.length} filtered`} tasks you can see. Excel also includes the activity log.`}
          />
          {access.isAdmin && (
            <button type="button" className="btn" onClick={() => setShowCreateUser(true)}>👤 Create user</button>
          )}
          {access.isAdmin ? (
            <button type="button" className="btn" onClick={() => setShowSettings(true)}>⚙ Settings</button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmLeave(true)}>Leave board</button>
          )}
        </div>
      </div>

      {error && <div className="top-error">{error}</div>}
      {notice && <div className="task-notice">{notice}</div>}

      {uploadPage && access.canAdd ? (
        <>
          <TaskImportModal
            inline
            createColumns
            allowNewColumns={access.isAdmin}
            board={board}
            columns={columns}
            people={people}
            onImport={importTasks}
            onClose={leaveUploadPage}
          />
          <p className="field-hint" style={{ textAlign: 'center' }}>
            <button type="button" className="link-btn" onClick={() => leaveUploadPage(0)}>
              Skip — start with an empty board
            </button>
          </p>
        </>
      ) : (
        <>
      <div className="task-status-strip">
        <button type="button" className={`task-status-chip${statusFilter === '' ? ' active' : ''}`} onClick={() => setStatusFilter('')}>
          All <span>{tasks.length}</span>
        </button>
        {board.statuses.map((s) => (
          <button
            key={s.name}
            type="button"
            className={`task-status-chip${statusFilter === s.name ? ' active' : ''}`}
            style={{ '--pill': s.color }}
            onClick={() => setStatusFilter(statusFilter === s.name ? '' : s.name)}
          >
            <span className="task-pill-dot" />
            {s.name} <span>{counts.get(s.name) || 0}</span>
          </button>
        ))}
      </div>

      <div className="table-panel">
        <div className="table-toolbar">
          <span className="task-muted" style={{ fontSize: 12.5 }}>
            {shown.length === tasks.length ? `${tasks.length} task${tasks.length === 1 ? '' : 's'}` : `${shown.length} of ${tasks.length} tasks`}
          </span>
          <div className="table-toolbar-actions">
            <select className="input input-sm" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
              <option value="">Anyone</option>
              <option value="me">Assigned to me</option>
              <option value="none">Unassigned</option>
              {people.map((p) => (
                <option key={p.id} value={String(p.id)}>{p.name}</option>
              ))}
            </select>
            <select className="input input-sm" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
              <option value="">Any priority</option>
              {PRIORITIES.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
            <button type="button" className="btn btn-sm" onClick={() => setShowColumnPicker(true)} title="Choose which columns show in the list">
              ☰ Columns{visibleCols.length < boardCols.length ? ` (${visibleCols.length}/${boardCols.length})` : ''}
            </button>
            <div className="search-wrap">
              <span className="search-icon">⌕</span>
              <input type="search" className="input search-input" placeholder="Search tasks…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="task-table-wrap">
          <table className="data-table task-table">
            <thead>
              <tr>
                {board.show_serial && <th className="task-th task-th-serial">Sr. No.</th>}
                {visibleCols.map((col) => (
                  <th
                    key={col.key}
                    className={`task-th${dragKey === col.key ? ' col-dragging' : ''}${dragOverKey === col.key ? ' col-drag-over' : ''}`}
                    draggable={access.isAdmin}
                    onDragStart={(e) => {
                      setDragKey(col.key);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', col.key);
                    }}
                    onDragEnd={() => {
                      setDragKey(null);
                      setDragOverKey(null);
                    }}
                    onDragOver={(e) => {
                      if (!dragKey || dragKey === col.key) return;
                      e.preventDefault();
                      setDragOverKey(col.key);
                    }}
                    onDragLeave={() => setDragOverKey((k) => (k === col.key ? null : k))}
                    onDrop={(e) => handleColDrop(e, col.key)}
                    onClick={() => toggleSort(col.key)}
                    title={access.isAdmin ? 'Click to sort · drag to reorder' : 'Click to sort'}
                    aria-sort={sort?.key === col.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                  >
                    <span className="task-th-inner">
                      {col.custom && renameCol === col.custom.id ? (
                        <input
                          className="input input-sm task-th-rename"
                          defaultValue={col.label}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => renameColumn(col.custom, e.target.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') e.target.blur();
                            else if (e.key === 'Escape') setRenameCol(null);
                          }}
                        />
                      ) : (
                        <>
                          {col.label}
                          <span className={`task-sort-ind${sort?.key === col.key ? ' active' : ''}`}>
                            {sort?.key === col.key ? (sort.dir === 1 ? '▲' : '▼') : '↕'}
                          </span>
                          {col.custom && access.isAdmin && (
                            <span className="task-th-tools" draggable={false} onClick={(e) => e.stopPropagation()}>
                              <button type="button" className="task-th-tool" title="Rename column" onClick={() => setRenameCol(col.custom.id)}>✎</button>
                              <button type="button" className="task-th-tool danger" title="Delete column" onClick={() => setDeleteCol(col.custom)}>×</button>
                            </span>
                          )}
                        </>
                      )}
                    </span>
                  </th>
                ))}
                <th className="task-th-actions" />
              </tr>
            </thead>
            <tbody>
              {draft && (
                <tr className="task-draft-row" onKeyDown={draftKeyDown}>
                  {board.show_serial && <td className="task-td-serial cell-empty">—</td>}
                  {visibleCols.map((col) => (
                    <td key={col.key}>{renderDraftCell(col)}</td>
                  ))}
                  <td>
                    <div className="row-actions task-draft-actions">
                      <button type="button" className="btn btn-primary btn-sm" disabled={draftSaving} onClick={saveDraft} title="Save (Enter)">
                        {draftSaving ? '…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        className="row-action-btn"
                        title="Open in the full form"
                        disabled={draftSaving}
                        onClick={() => {
                          setModal({ mode: 'new', task: null, initial: draft });
                          setDraft(null);
                        }}
                      >
                        ⤢
                      </button>
                      <button type="button" className="row-action-btn" title="Cancel (Esc)" disabled={draftSaving} onClick={() => setDraft(null)}>×</button>
                    </div>
                  </td>
                </tr>
              )}
              {sorted.map((t, i) => (
                <tr key={t.id}>
                  {board.show_serial && <td className="task-td-serial">{i + 1}</td>}
                  {visibleCols.map((col) => renderCell(col, t))}
                  <td onDoubleClick={(e) => e.stopPropagation()}>
                    <div className="row-actions">
                      <button type="button" className="row-action-btn" title="History" onClick={() => setHistory({ task: t })}>🕘</button>
                      <button type="button" className="row-action-btn" title={access.canEdit ? 'Edit' : 'View'} onClick={() => openTask(t)}>
                        {access.canEdit ? '✎' : '👁'}
                      </button>
                      {access.canDelete && (
                        <button type="button" className="row-action-btn danger" title="Delete" onClick={() => setConfirmDelete(t)}>🗑</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && !draft && (
                <tr>
                  <td colSpan={visibleCols.length + 1 + (board.show_serial ? 1 : 0)}>
                    <div className="cell-inner cell-empty" style={{ padding: '24px 14px' }}>
                      {tasks.length === 0
                        ? access.canAdd
                          ? 'No tasks yet — use “＋ Quick row” to type one into the table, or “＋ Add task” for the full form.'
                          : board.visibility === 'private'
                            ? 'No tasks assigned to you yet.'
                            : 'No tasks yet.'
                        : 'No tasks match your filters.'}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}

      {modal && (
        <TaskModal
          board={board}
          columns={columns}
          people={people}
          task={modal.task}
          initial={modal.initial}
          readOnly={modal.mode === 'view'}
          onClose={() => setModal(null)}
          onSave={(values) => saveTask(modal.task, values)}
          onCreateUser={access.isAdmin ? createUser : null}
          onDelete={modal.task && access.canDelete ? () => {
            const t = modal.task;
            setModal(null);
            setConfirmDelete(t);
          } : null}
          onShowHistory={modal.task ? () => {
            const t = modal.task;
            setModal(null);
            setHistory({ task: t });
          } : null}
        />
      )}
      {history && (
        <TaskActivity
          boardUuid={board.uuid}
          task={history.task}
          people={people}
          onClose={() => setHistory(null)}
          onReverted={reload}
        />
      )}
      {showSettings && (
        <TaskBoardSettings
          data={data}
          onClose={() => setShowSettings(false)}
          onChanged={reload}
          onDeleted={() => {
            router.push('/dashboard/tasks');
            router.refresh();
          }}
        />
      )}
      {showImport && (
        <TaskImportModal
          board={board}
          columns={columns}
          people={people}
          allowNewColumns={access.isAdmin}
          createColumns={columns.length === 0}
          onImport={importTasks}
          onClose={(count, title) => {
            setShowImport(false);
            afterImport(count, title);
          }}
        />
      )}
      {showColumnPicker && (
        <div className="modal-overlay" onClick={() => setShowColumnPicker(false)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <h2>Show columns</h2>
            <p className="field-hint">
              Untick a column to hide it from the list. Only you see this choice — it’s saved in this browser.
              {boardCols.length < tableCols.length &&
                ` ${tableCols.length - boardCols.length} more ${tableCols.length - boardCols.length === 1 ? 'is' : 'are'} hidden for everyone by the board admin${access.isAdmin ? ' (⚙ Settings → Columns)' : ''}.`}
            </p>
            <div className="export-columns-toolbar">
              <span>
                {visibleCols.length} of {boardCols.length} shown
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateHiddenCols(new Set())}>Show all</button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => updateHiddenCols(new Set(boardCols.filter((c) => c.key !== 'title').map((c) => c.key)))}
              >
                Hide all
              </button>
            </div>
            <div className="export-columns">
              {boardCols.map((col) => (
                <label key={col.key} className="export-column-option" title={col.key === 'title' ? 'Title always shows' : undefined}>
                  <input
                    type="checkbox"
                    checked={!hiddenCols.has(col.key)}
                    disabled={col.key === 'title'}
                    onChange={() => {
                      const next = new Set(hiddenCols);
                      if (next.has(col.key)) next.delete(col.key);
                      else next.add(col.key);
                      updateHiddenCols(next);
                    }}
                  />
                  <span>{col.label}</span>
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setShowColumnPicker(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
      {showAddColumn && <AddColumnsModal onClose={() => setShowAddColumn(false)} onAdd={addColumns} />}
      {deleteCol && (
        <ConfirmModal
          title={`Delete column “${deleteCol.label}”?`}
          message="The column is removed from every task on this board. Values already entered stay in each task’s history and aren’t lost. This can’t be undone from here."
          confirmLabel="Delete column"
          danger
          onConfirm={() => removeColumn(deleteCol)}
          onClose={() => setDeleteCol(null)}
        />
      )}
      {showCreateUser && (
        <div className="modal-overlay" onClick={() => setShowCreateUser(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="new-track-head">
              <div>
                <h2>Create user</h2>
                <p className="new-track-steps">
                  Makes a MyTrack account and adds it to “{board.name}”. You can then assign tasks to them.
                </p>
              </div>
              <button type="button" className="new-track-close" onClick={() => setShowCreateUser(false)} title="Close">×</button>
            </div>
            <CreateUserForm onCreate={createUser} />
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowCreateUser(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
      {renameTo && (
        <div className="modal-overlay" onClick={() => setRenameTo(null)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <h2>Rename the board?</h2>
            <p className="confirm-message">
              Change the board name from “{board.name}” to the file&apos;s title, “{renameTo}”?
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setRenameTo(null)}>No, keep “{board.name}”</button>
              <button type="button" className="btn btn-primary" onClick={renameBoard} autoFocus>Yes, rename</button>
            </div>
          </div>
        </div>
      )}
      {confirmDelete && (
        <ConfirmModal
          title="Delete this task?"
          message={`“${confirmDelete.title}” will be removed from the board. The deletion is logged${access.isAdmin ? ' and you can revert it from the activity log.' : ' and the admin can revert it.'}`}
          confirmLabel="Delete task"
          danger
          onConfirm={() => deleteTask(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
      {confirmLeave && (
        <ConfirmModal
          title={`Leave “${board.name}”?`}
          message="You’ll lose access to this board until the admin adds you again."
          confirmLabel="Leave board"
          danger
          onConfirm={leaveBoard}
          onClose={() => setConfirmLeave(false)}
        />
      )}
    </>
  );
}

function AddColumnsModal({ onClose, onAdd }) {
  const [defs, setDefs] = useState([blankColumn()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    const list = defs.filter((d) => d.label.trim());
    if (list.length === 0) {
      setError('Give the column a name.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onAdd(list);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <form className="modal modal-lg" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="new-track-head">
          <h2>Add columns</h2>
          <button type="button" className="new-track-close" onClick={onClose} disabled={saving} title="Close">×</button>
        </div>
        <p className="field-hint" style={{ marginTop: 0 }}>
          New columns appear on every task. Rename or remove them later in Settings → Columns; drag a header to move it.
        </p>
        <TaskColumnBuilder columns={defs} onChange={setDefs} disabled={saving} />
        {error && <div className="top-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add columns'}</button>
        </div>
      </form>
    </div>
  );
}

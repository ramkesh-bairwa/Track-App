'use client';

import { useState } from 'react';
import { TASK_FIELD_TYPES, taskFieldTypeMeta, permissionLabel, orderTaskColumns } from '@/lib/taskConfig';
import { Avatar } from '@/components/tasks/taskUi';
import CreateUserForm from '@/components/tasks/CreateUserForm';
import ConfirmModal from '@/components/ConfirmModal';

const TABS = [
  { key: 'general', label: 'General' },
  { key: 'members', label: 'Members & permissions' },
  { key: 'statuses', label: 'Statuses' },
  { key: 'columns', label: 'Columns' },
];

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

// Admin-only board settings. Every save goes through the API, which logs it,
// so members can see exactly what the admin changed.
export default function TaskBoardSettings({ data, onClose, onChanged, onDeleted }) {
  const { board, columns, people } = data;
  const base = `/api/task-boards/${board.uuid}`;
  const [tab, setTab] = useState('general');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // general
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description || '');
  const [visibility, setVisibility] = useState(board.visibility);
  // Every delete / remove here asks first in a confirm modal: { title, message, confirmLabel, onConfirm }.
  const [ask, setAsk] = useState(null);
  // statuses
  const [statuses, setStatuses] = useState(board.statuses.map((s) => ({ ...s })));
  // members
  const [memberMode, setMemberMode] = useState('existing');
  const [email, setEmail] = useState('');
  const [newPerms, setNewPerms] = useState({ can_add: true, can_edit: true, can_delete: false });
  // columns
  const [colLabel, setColLabel] = useState('');
  const [colType, setColType] = useState('text');
  const [colOptions, setColOptions] = useState('');
  const [hiddenCols, setHiddenCols] = useState(() => new Set(board.hidden_columns || []));
  const [showSerial, setShowSerial] = useState(board.show_serial);
  const listingCols = orderTaskColumns(board.column_order, columns);

  function toggleSerial() {
    const next = !showSerial;
    setShowSerial(next);
    run(() => api(base, 'PATCH', { show_serial: next }), 'Listing columns saved.', { rethrow: true }).catch((err) => {
      setShowSerial(!next);
      setError(err.message);
    });
  }

  // Saves straight away, like the other column edits here.
  function toggleListingColumn(key) {
    const next = new Set(hiddenCols);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    const before = hiddenCols;
    setHiddenCols(next);
    run(() => api(base, 'PATCH', { hidden_columns: [...next] }), 'Listing columns saved.', { rethrow: true }).catch((err) => {
      setHiddenCols(before);
      setError(err.message);
    });
  }

  // `rethrow` lets a confirm modal show the error itself instead of the page.
  async function run(fn, successText, { rethrow = false } = {}) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      if (successText) setNotice(successText);
      await onChanged();
    } catch (err) {
      if (rethrow) throw err;
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const members = people.filter((p) => !p.is_admin);
  const admin = people.find((p) => p.is_admin);

  function togglePerm(member, key) {
    const all = key === 'all';
    const everything = member.can_add && member.can_edit && member.can_delete;
    const body = all
      ? { can_add: !everything, can_edit: !everything, can_delete: !everything }
      : { [key]: !member[key] };
    run(() => api(`${base}/members/${member.id}`, 'PATCH', body));
  }

  return (
    <>
    <div className="modal-overlay" onClick={busy || ask ? undefined : onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="new-track-head">
          <h2>Board settings</h2>
          <button type="button" className="new-track-close" onClick={onClose} title="Close">×</button>
        </div>

        <div className="tabs track-type-tabs" style={{ marginBottom: 16 }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`tab-btn${tab === t.key ? ' active' : ''}`}
              onClick={() => {
                setTab(t.key);
                setError('');
                setNotice('');
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && <div className="top-error">{error}</div>}
        {notice && <div className="task-notice">{notice}</div>}

        {tab === 'general' && (
          <>
            <div className="field-group">
              <label className="field-label">Board name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field-group">
              <label className="field-label">Description</label>
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="field-group">
              <label className="field-label">Who sees which tasks</label>
              <div className="task-visibility-options">
                <label className={`task-visibility${visibility === 'private' ? ' selected' : ''}`}>
                  <input type="radio" checked={visibility === 'private'} onChange={() => setVisibility('private')} />
                  <span>
                    <strong>🔒 Private</strong>
                    <small>Members only see tasks assigned to them or created by them.</small>
                  </span>
                </label>
                <label className={`task-visibility${visibility === 'public' ? ' selected' : ''}`}>
                  <input type="radio" checked={visibility === 'public'} onChange={() => setVisibility('public')} />
                  <span>
                    <strong>🌐 Public</strong>
                    <small>Every member of this board sees every task.</small>
                  </span>
                </label>
              </div>
            </div>
            <div className="modal-actions">
              {(
                <>
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ marginRight: 'auto' }}
                    disabled={busy}
                    onClick={() =>
                      setAsk({
                        title: `Delete “${board.name}”?`,
                        message: 'The board, every task on it and its whole activity log will be deleted. This can’t be undone.',
                        confirmLabel: 'Delete board',
                        onConfirm: async () => {
                          await api(base, 'DELETE');
                          onDeleted();
                        },
                      })
                    }
                  >
                    Delete board
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => run(() => api(base, 'PATCH', { name, description, visibility }), 'Saved.')}
                  >
                    Save
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {tab === 'members' && (
          <>
            <div className="tabs track-type-tabs" style={{ marginBottom: 12 }}>
              <button type="button" className={`tab-btn${memberMode === 'existing' ? ' active' : ''}`} onClick={() => setMemberMode('existing')}>
                Add existing user
              </button>
              <button type="button" className={`tab-btn${memberMode === 'create' ? ' active' : ''}`} onClick={() => setMemberMode('create')}>
                ＋ Create new user
              </button>
            </div>
            {memberMode === 'create' ? (
              <CreateUserForm
                onCreate={async (values) => {
                  const result = await api(`${base}/members`, 'POST', values);
                  await onChanged();
                  return result;
                }}
              />
            ) : (
            <form
              className="task-add-member"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api(`${base}/members`, 'POST', { email, ...newPerms });
                  setEmail('');
                }, 'Member added.');
              }}
            >
              <input
                type="email"
                className="input"
                placeholder="Their MyTrack email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <div className="task-perm-row">
                {[
                  ['can_add', 'Add'],
                  ['can_edit', 'Edit'],
                  ['can_delete', 'Delete'],
                ].map(([key, label]) => (
                  <label key={key} className="checkbox-row">
                    <input type="checkbox" checked={newPerms[key]} onChange={(e) => setNewPerms((p) => ({ ...p, [key]: e.target.checked }))} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <button type="submit" className="btn btn-primary" disabled={busy}>Add member</button>
            </form>
            )}
            <p className="field-hint" style={{ marginTop: -4 }}>
              Everyone on the board can view. Assignees can always move the status of their own tasks.
            </p>

            <div className="task-member-list">
              {admin && (
                <div className="task-member">
                  <Avatar person={admin} size={30} />
                  <div className="task-member-name">
                    <strong>{admin.name}</strong>
                    <small>{admin.email}</small>
                  </div>
                  <span className="task-role-badge admin">Admin · everything</span>
                </div>
              )}
              {members.length === 0 && <p className="task-muted">No members yet — add someone above.</p>}
              {members.map((m) => (
                <div key={m.id} className="task-member">
                  <Avatar person={m} size={30} />
                  <div className="task-member-name">
                    <strong>{m.name}</strong>
                    <small>{m.email} · {permissionLabel(m)}</small>
                  </div>
                  <div className="task-perm-row">
                    <label className="checkbox-row"><input type="checkbox" checked disabled /><span>View</span></label>
                    {[
                      ['can_add', 'Add'],
                      ['can_edit', 'Edit'],
                      ['can_delete', 'Delete'],
                    ].map(([key, label]) => (
                      <label key={key} className="checkbox-row">
                        <input type="checkbox" checked={m[key]} disabled={busy} onChange={() => togglePerm(m, key)} />
                        <span>{label}</span>
                      </label>
                    ))}
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={m.can_add && m.can_edit && m.can_delete}
                        disabled={busy}
                        onChange={() => togglePerm(m, 'all')}
                      />
                      <span>All</span>
                    </label>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() =>
                      setAsk({
                        title: `Remove ${m.name}?`,
                        message: `${m.name} will lose access to “${board.name}”. Tasks assigned to them stay on the board.`,
                        confirmLabel: 'Remove member',
                        onConfirm: () => run(() => api(`${base}/members/${m.id}`, 'DELETE'), `${m.name} removed.`, { rethrow: true }),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'statuses' && (
          <>
            <div className="task-status-list">
              {statuses.map((s, i) => (
                <div key={i} className="task-status-row">
                  <input
                    type="color"
                    value={s.color}
                    onChange={(e) => setStatuses((list) => list.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))}
                  />
                  <input
                    className="input"
                    value={s.name}
                    onChange={(e) => setStatuses((list) => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={i === 0}
                    onClick={() => setStatuses((list) => {
                      const next = list.slice();
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      return next;
                    })}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setStatuses((list) => list.filter((_, j) => j !== i))}
                    disabled={statuses.length <= 1}
                    title="Remove status"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <p className="field-hint">The first status is the default for new tasks.</p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                style={{ marginRight: 'auto' }}
                onClick={() => setStatuses((list) => [...list, { name: `Status ${list.length + 1}`, color: '#6C7BFF' }])}
              >
                ＋ Add status
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => api(base, 'PATCH', { statuses }), 'Statuses saved.')}>
                Save statuses
              </button>
            </div>
          </>
        )}

        {tab === 'columns' && (
          <>
            <p className="field-hint" style={{ marginTop: 0 }}>
              Every task has Title, Status, Priority, Assignee, Due date and Description. Add any extra columns here.
            </p>
            <div className="task-status-list">
              {columns.length === 0 && <p className="task-muted">No extra columns.</p>}
              {columns.map((c) => (
                <ColumnRow key={c.id} column={c} busy={busy} base={base} run={run} ask={setAsk} />
              ))}
            </div>
            <form
              className="task-add-column"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api(`${base}/columns`, 'POST', { label: colLabel, field_type: colType, options: colOptions });
                  setColLabel('');
                  setColOptions('');
                }, 'Column added.');
              }}
            >
              <input className="input" placeholder="New column name" value={colLabel} onChange={(e) => setColLabel(e.target.value)} required />
              <select className="input" value={colType} onChange={(e) => setColType(e.target.value)}>
                {TASK_FIELD_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
              {taskFieldTypeMeta(colType).supportsOptions && (
                <input className="input" placeholder="Options, comma separated" value={colOptions} onChange={(e) => setColOptions(e.target.value)} />
              )}
              <button type="submit" className="btn btn-primary" disabled={busy}>＋ Add column</button>
            </form>

            <h3 className="modal-section-title">Show in task listing</h3>
            <p className="field-hint" style={{ marginTop: 0 }}>
              Ticked columns show in the task list for everyone on this board. Unticked ones stay on each task and in exports — they’re just not listed. Members can still hide more for themselves with “☰ Columns”.
            </p>
            <div className="export-columns">
              <label className="export-column-option" title="Numbers every task 1, 2, 3… at the start of the list">
                <input type="checkbox" checked={showSerial} disabled={busy} onChange={toggleSerial} />
                <span>Sr. No.</span>
              </label>
              {listingCols.map((col) => (
                <label key={col.key} className="export-column-option" title={col.key === 'title' ? 'Title always shows' : undefined}>
                  <input
                    type="checkbox"
                    checked={!hiddenCols.has(col.key)}
                    disabled={busy || col.key === 'title'}
                    onChange={() => toggleListingColumn(col.key)}
                  />
                  <span>{col.label}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
    {ask && (
      <ConfirmModal
        title={ask.title}
        message={ask.message}
        confirmLabel={ask.confirmLabel}
        danger
        onConfirm={ask.onConfirm}
        onClose={() => setAsk(null)}
      />
    )}
    </>
  );
}

function ColumnRow({ column, busy, base, run, ask }) {
  const [label, setLabel] = useState(column.label);
  const [options, setOptions] = useState(column.options || '');
  const meta = taskFieldTypeMeta(column.field_type);
  const dirty = label !== column.label || (meta.supportsOptions && options !== (column.options || ''));
  return (
    <div className="task-status-row">
      <span className="task-col-type">{meta.label}</span>
      <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
      {meta.supportsOptions && (
        <input className="input" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Options, comma separated" />
      )}
      {dirty && (
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={busy}
          onClick={() => run(() => api(`${base}/columns/${column.id}`, 'PATCH', { label, options }), 'Column saved.')}
        >
          Save
        </button>
      )}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={busy}
        onClick={() =>
          ask({
            title: `Remove column “${column.label}”?`,
            message: 'It disappears from every task on this board. Values already entered stay in each task’s history.',
            confirmLabel: 'Remove column',
            onConfirm: () => run(() => api(`${base}/columns/${column.id}`, 'DELETE'), `"${column.label}" removed.`, { rethrow: true }),
          })
        }
        title="Remove column (existing values are kept in the log)"
      >
        ×
      </button>
    </div>
  );
}

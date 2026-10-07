'use client';

import { useRef, useState } from 'react';
import { PRIORITIES, MAX_TASK_FILE_BYTES, TASK_IMAGES_KEY, TASK_COLLABORATORS_KEY, taskCollaborators } from '@/lib/taskConfig';
import { ColumnValue, formatDay, Pill } from '@/components/tasks/taskUi';
import { statusColor, priorityColor } from '@/lib/taskConfig';
import CreateUserForm from '@/components/tasks/CreateUserForm';
import { safeFileUrl } from '@/lib/safeUrl';
import TaskImagesInput, { TaskImagesView, imageFilesFrom } from '@/components/tasks/TaskImages';

export function ColumnInput({ column, value, onChange }) {
  const options = (column.options || '').split(',').map((o) => o.trim()).filter(Boolean);
  switch (column.field_type) {
    case 'textarea':
      return <textarea className="input" rows={3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <input type="number" className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return <input type="date" className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'email':
      return <input type="email" className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'link':
      return <input type="url" className="input" placeholder="https://" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'checkbox':
      return (
        <label className="checkbox-row">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          <span style={{ fontSize: 13 }}>{value ? 'Yes' : 'No'}</span>
        </label>
      );
    case 'select':
      return (
        <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    case 'file':
      return <FileInput value={value} onChange={onChange} />;
    default:
      return <input className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

function FileInput({ value, onChange }) {
  const [error, setError] = useState('');
  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_TASK_FILE_BYTES) {
      setError('That file is too large. Please pick one under 2MB.');
      return;
    }
    setError('');
    const reader = new FileReader();
    reader.onload = () => onChange({ name: file.name, type: file.type, size: file.size, data: reader.result });
    reader.readAsDataURL(file);
  }
  return (
    <div>
      <div className="task-file-input">
        {value?.data ? (
          <>
            <a href={safeFileUrl(value.data) || undefined} download={value.name} className="task-file-link">📎 {value.name}</a>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>Remove</button>
          </>
        ) : (
          <span className="cell-empty">No file</span>
        )}
        <label className="btn btn-sm">
          {value?.data ? 'Replace…' : 'Upload…'}
          <input type="file" onChange={handleFile} style={{ display: 'none' }} />
        </label>
      </div>
      {error && <p className="field-hint" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  );
}

// Board members (other than the assignee) the task is shared with.
function CollaboratorsInput({ people, assigneeId, value, onChange }) {
  const ids = Array.isArray(value) ? value : [];
  const options = people.filter((p) => String(p.id) !== String(assigneeId ?? ''));
  if (options.length === 0) return <p className="field-hint">Add more members to the board to share tasks with them.</p>;
  return (
    <div className="task-collab-picker">
      {options.map((p) => (
        <label key={p.id} className={`task-collab-chip${ids.includes(p.id) ? ' selected' : ''}`}>
          <input
            type="checkbox"
            checked={ids.includes(p.id)}
            onChange={(e) => onChange(e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id))}
          />
          {p.name}
        </label>
      ))}
    </div>
  );
}

// Add / edit / view a task. `readOnly` shows the same layout without inputs
// for members who can see a task but not change it. `initial` prefills a new
// task (e.g. a half-typed quick row moved into the full form).
export default function TaskModal({ board, columns, people, task, initial, readOnly, onClose, onSave, onShowHistory, onCreateUser, onDelete }) {
  const isNew = !task;
  const [form, setForm] = useState(() => {
    const src = task || initial;
    return {
      title: src?.title || '',
      description: src?.description || '',
      status: src?.status || board.statuses[0]?.name,
      priority: src?.priority || 'Medium',
      assignee_id: src?.assignee_id ?? '',
      due_date: src?.due_date || '',
      data: { ...(src?.data || {}) },
    };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [newUser, setNewUser] = useState(null);
  const addImagesRef = useRef(null);

  // A screenshot pasted anywhere in the form is attached to the task.
  function handlePaste(e) {
    if (readOnly || !addImagesRef.current) return;
    const files = imageFilesFrom(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    addImagesRef.current(files);
  }

  // Admin only: create an account right here, add it to the board, and
  // assign this task to it.
  async function handleCreateUser(values) {
    const result = await onCreateUser(values);
    setForm((f) => ({ ...f, assignee_id: String(result.userId) }));
    setNewUser({ ...result, email: values.email, password: values.password });
    setCreatingUser(false);
    return result;
  }

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function setData(key, value) {
    setForm((f) => ({ ...f, data: { ...f.data, [key]: value } }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError('A task needs a title.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        ...form,
        title: form.title.trim(),
        assignee_id: form.assignee_id === '' ? null : Number(form.assignee_id),
        due_date: form.due_date || null,
      });
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const assignee = people.find((p) => p.id === task?.assignee_id);

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <form className="modal modal-lg task-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit} onPaste={handlePaste}>
        <div className="new-track-head">
          <h2>{isNew ? 'New task' : readOnly ? task.title : 'Edit task'}</h2>
          <button type="button" className="new-track-close" onClick={onClose} disabled={saving} title="Close">×</button>
        </div>

        {readOnly ? (
          <dl className="task-view-list">
            <div><dt>Status</dt><dd><Pill color={statusColor(board.statuses, task.status)}>{task.status}</Pill></dd></div>
            <div><dt>Priority</dt><dd><Pill color={priorityColor(task.priority)}>{task.priority}</Pill></dd></div>
            <div><dt>Assignee</dt><dd>{assignee?.name || (task.assignee_id ? 'Former member' : 'Unassigned')}</dd></div>
            <div><dt>Due date</dt><dd>{task.due_date ? formatDay(task.due_date) : '—'}</dd></div>
            <div className="task-view-wide"><dt>Description</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{task.description || '—'}</dd></div>
            {taskCollaborators(task).length > 0 && (
              <div className="task-view-wide">
                <dt>Collaborators</dt>
                <dd>{taskCollaborators(task).map((id) => people.find((p) => p.id === id)?.name || 'Former member').join(', ')}</dd>
              </div>
            )}
            {task.data?.[TASK_IMAGES_KEY]?.length > 0 && (
              <div className="task-view-wide"><dt>Images</dt><dd><TaskImagesView images={task.data[TASK_IMAGES_KEY]} /></dd></div>
            )}
            {columns.map((col) => (
              <div key={col.id}><dt>{col.label}</dt><dd><ColumnValue column={col} value={task.data?.[col.field_key]} /></dd></div>
            ))}
          </dl>
        ) : (
          <div className="task-form-grid">
            <div className="field-group task-form-wide">
              <label className="field-label" htmlFor="task-title">Title</label>
              <input id="task-title" className="input" value={form.title} onChange={(e) => set('title', e.target.value)} autoFocus />
            </div>
            <div className="field-group">
              <label className="field-label">Status</label>
              <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {board.statuses.map((s) => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label className="field-label">Priority</label>
              <select className="input" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
                {PRIORITIES.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label className="field-label">Assign to</label>
              <select
                className="input"
                value={creatingUser ? '__new__' : form.assignee_id ?? ''}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setCreatingUser(true);
                    return;
                  }
                  setCreatingUser(false);
                  set('assignee_id', e.target.value);
                }}
              >
                <option value="">Unassigned</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.is_admin ? ' (admin)' : ''} — {p.email}</option>
                ))}
                {onCreateUser && <option value="__new__">＋ Create new user…</option>}
              </select>
            </div>
            {creatingUser && (
              <div className="field-group task-form-wide create-user-inline">
                <label className="field-label">New user — they&apos;ll be added to this board and assigned this task</label>
                <CreateUserForm
                  compact
                  submitLabel="Create & assign"
                  onCreate={handleCreateUser}
                  onCancel={() => setCreatingUser(false)}
                />
              </div>
            )}
            {newUser && !creatingUser && (
              <div className="task-form-wide task-notice">
                {newUser.created ? (
                  <>
                    Created <strong>{newUser.name}</strong> and assigned this task to them. Sign-in details to share:{' '}
                    <span className="create-user-creds">
                      {newUser.email} · <code>{newUser.password}</code>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => navigator.clipboard?.writeText(`Email: ${newUser.email}\nPassword: ${newUser.password}`)}
                      >
                        Copy
                      </button>
                    </span>
                  </>
                ) : (
                  <>{newUser.name} already had an account — added to the board and assigned. Their password was not changed.</>
                )}
                {' '}Click “{isNew ? 'Create task' : 'Save changes'}” to finish.
              </div>
            )}
            <div className="field-group task-form-wide">
              <label className="field-label">Collaborators</label>
              <CollaboratorsInput
                people={people}
                assigneeId={form.assignee_id}
                value={form.data[TASK_COLLABORATORS_KEY]}
                onChange={(v) => setData(TASK_COLLABORATORS_KEY, v)}
              />
              <p className="field-hint">They can see this task and its history even on a private board, and update its status.</p>
            </div>
            <div className="field-group">
              <label className="field-label">Due date</label>
              <input type="date" className="input" value={form.due_date || ''} onChange={(e) => set('due_date', e.target.value)} />
            </div>
            <div className="field-group task-form-wide">
              <label className="field-label">Description</label>
              <textarea className="input" rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} />
            </div>
            <div className="field-group task-form-wide">
              <label className="field-label">Images / screenshots</label>
              <TaskImagesInput value={form.data[TASK_IMAGES_KEY]} onChange={(v) => setData(TASK_IMAGES_KEY, v)} addRef={addImagesRef} />
            </div>
            {columns.map((col) => (
              <div key={col.id} className={`field-group${col.field_type === 'textarea' || col.field_type === 'file' ? ' task-form-wide' : ''}`}>
                <label className="field-label">{col.label}</label>
                <ColumnInput column={col} value={form.data[col.field_key]} onChange={(v) => setData(col.field_key, v)} />
              </div>
            ))}
          </div>
        )}

        {error && <div className="top-error">{error}</div>}

        <div className="modal-actions">
          {!isNew && (onShowHistory || onDelete) && (
            <span className="task-modal-left">
              {onShowHistory && (
                <button type="button" className="btn btn-ghost" onClick={onShowHistory}>
                  🕘 History
                </button>
              )}
              {onDelete && (
                <button type="button" className="btn btn-ghost task-modal-delete" onClick={onDelete} disabled={saving}>
                  🗑 Delete task
                </button>
              )}
            </span>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isNew ? 'Create task' : 'Save changes'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

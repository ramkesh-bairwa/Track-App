'use client';

import { useEffect, useRef, useState } from 'react';
import { Avatar, ColumnValue, formatDateTime, formatDay, timeAgo } from '@/components/tasks/taskUi';
import MentionInput, { MentionText, mentionsIn } from '@/components/tasks/MentionInput';
import AttachmentPreview, { fileSize, dataUrlToBlobUrl } from '@/components/tasks/AttachmentPreview';
import { PRIORITIES, MAX_TASK_FILE_BYTES, statusColor } from '@/lib/taskConfig';
import { ColumnInput } from '@/components/tasks/TaskModal';

export const ACTION_LABELS = {
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
  task_view: 'Viewed',
  log_note: 'Note',
  log_comment: 'Comment',
};

const ACTION_TONE = {
  task_create: 'good',
  task_restore: 'good',
  task_import: 'good',
  task_delete: 'bad',
  member_remove: 'bad',
  column_remove: 'bad',
  log_note: 'info',
  log_comment: 'info',
};

const ACTION_ICON = {
  task_create: '✚',
  task_update: '✎',
  task_delete: '🗑',
  task_restore: '↺',
  task_import: '⬆',
  task_view: '👁',
  log_note: '📝',
  log_comment: '💬',
};

const ACTION_VERB = {
  task_create: 'created',
  task_update: 'edited',
  task_delete: 'deleted',
  task_restore: 'restored',
};

// "Today" / "Yesterday" / "3 Oct 2026" — the day headings between entries.
export function dayHeading(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// Entries with a day heading wherever the day changes.
export function withDayHeadings(entries) {
  const out = [];
  let last = '';
  for (const a of entries) {
    const heading = dayHeading(a.created_at);
    if (heading !== last) out.push({ heading, key: `day-${heading}-${a.id}` });
    last = heading;
    out.push({ entry: a, key: a.id });
  }
  return out;
}

export function DayHeading({ children }) {
  return (
    <div className="log-day">
      <span>{children}</span>
    </div>
  );
}

// Logged values are display text; ISO dates read better as "5 Oct 2026".
function pretty(text) {
  if (!text) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? formatDay(text) : text;
}

// Web links in logged values open in a new tab (http/https only).
function Value({ text, className }) {
  const shown = pretty(text);
  if (/^https?:\/\/\S+$/i.test(text)) {
    return (
      <a className={`${className} log-url`} href={text} target="_blank" rel="noopener noreferrer" onDoubleClick={(e) => e.stopPropagation()}>
        {shown.replace(/^https?:\/\//i, '')}
      </a>
    );
  }
  return <span className={className}>{shown}</span>;
}

// ---------- inline editing (double-click a chip or the task title) ----------

const BUILTIN_KEYS = new Set(['title', 'status', 'priority', 'assignee_id', 'due_date', 'description']);

// Whether a logged field maps to something on the task that can be edited in
// place. Collaborators and images (data._…) need the full form.
function editableKey(key, columns) {
  if (BUILTIN_KEYS.has(key)) return true;
  if (!key.startsWith('data.') || key.startsWith('data._')) return false;
  return columns.some((c) => c.field_key === key.slice(5));
}

function currentValue(task, key) {
  if (key === 'assignee_id') return task.assignee_id ?? '';
  if (key.startsWith('data.')) return task.data?.[key.slice(5)] ?? '';
  return task[key] ?? '';
}

// Edits the task's *current* value for one field, in place. Enter or a click
// outside saves; Esc cancels. Selects save as soon as a value is picked.
function InlineEditor({ fieldKey, label, task, columns, people, statuses, onSave, onCancel }) {
  const [value, setValue] = useState(() => currentValue(task, fieldKey));
  const ref = useRef(null);
  const done = useRef(false);
  const latest = useRef(value);
  latest.current = value;

  function save(v) {
    if (done.current) return;
    done.current = true;
    onSave(v);
  }
  function cancel() {
    if (done.current) return;
    done.current = true;
    onCancel();
  }

  useEffect(() => {
    ref.current?.querySelector('input:not([type=file]), select, textarea')?.focus();
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) save(latest.current);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancel();
    } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      save(latest.current);
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      save(latest.current);
    }
  }

  const pick = (v) => {
    setValue(v);
    save(v);
  };

  let input;
  if (fieldKey === 'title') {
    input = <input className="input input-sm" value={value} onChange={(e) => setValue(e.target.value)} />;
  } else if (fieldKey === 'description') {
    input = <textarea className="input" rows={3} value={value} onChange={(e) => setValue(e.target.value)} />;
  } else if (fieldKey === 'status') {
    input = (
      <select className="input input-sm" value={value} onChange={(e) => pick(e.target.value)}>
        {statuses.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
      </select>
    );
  } else if (fieldKey === 'priority') {
    input = (
      <select className="input input-sm" value={value} onChange={(e) => pick(e.target.value)}>
        {PRIORITIES.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
      </select>
    );
  } else if (fieldKey === 'assignee_id') {
    input = (
      <select className="input input-sm" value={value} onChange={(e) => pick(e.target.value)}>
        <option value="">Unassigned</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    );
  } else if (fieldKey === 'due_date') {
    input = <input type="date" className="input input-sm" value={value || ''} onChange={(e) => setValue(e.target.value)} />;
  } else {
    const column = columns.find((c) => c.field_key === fieldKey.slice(5));
    input = <ColumnInput column={column} value={value} onChange={setValue} />;
  }

  return (
    <div className="log-editor" ref={ref} onKeyDown={onKeyDown} onDoubleClick={(e) => e.stopPropagation()}>
      <span className="log-editor-label">{label} · now</span>
      {input}
      <span className="log-editor-hint">Enter to save · Esc to cancel</span>
    </div>
  );
}

// ---------- the pieces of an entry ----------

// A logged change: "PRIORITY  Medium → High", "DUE DATE  set to 5 Oct 2026".
function ChangeChip({ change, editable, onEdit }) {
  const { oldText, newText } = change;
  return (
    <span
      className={`log-chip${editable ? ' log-chip-editable' : ''}`}
      title={editable ? `Double-click to change ${change.label} on the task` : `${change.label}: ${oldText || '—'} → ${newText || '—'}`}
      onDoubleClick={editable ? onEdit : undefined}
    >
      <span className="log-chip-label">{change.label}</span>
      {oldText && newText ? (
        <>
          <Value text={oldText} className="log-old" />
          <span className="log-arrow">→</span>
          <Value text={newText} className="log-new" />
        </>
      ) : newText ? (
        <>
          <span className="log-verb">set to</span>
          <Value text={newText} className="log-new" />
        </>
      ) : oldText ? (
        <>
          <span className="log-verb">cleared, was</span>
          <Value text={oldText} className="log-was" />
        </>
      ) : (
        <span className="log-verb">left empty</span>
      )}
    </span>
  );
}

// What a new task started with — "PRIORITY Medium", "ASSIGNEE Ann".
function FactChip({ change, editable, onEdit }) {
  return (
    <span
      className={`log-chip${editable ? ' log-chip-editable' : ''}`}
      title={editable ? `Double-click to change ${change.label} on the task` : `${change.label}: ${change.newText}`}
      onDoubleClick={editable ? onEdit : undefined}
    >
      <span className="log-chip-label">{change.label}</span>
      <Value text={change.newText} className="log-chip-value" />
    </span>
  );
}

// The text of a logged note / comment change, old (struck) then new.
function TextChange({ change, people, noun }) {
  return (
    <div className="log-details">
      {change.oldText && <span className="log-quote log-quote-old" title={change.oldText}>{change.oldText}</span>}
      {change.newText ? (
        <span className="log-quote" title={change.newText}>
          “<MentionText text={change.newText} mentions={mentionsIn(change.newText, people)} />”
        </span>
      ) : (
        <span className="log-verb">{noun} removed.</span>
      )}
    </div>
  );
}

async function sendComment(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Could not save the comment.');
  return json;
}

const MAX_FILES = 5;

function fileIcon(type, name) {
  if (/^image\//.test(type)) return 'fa-solid fa-file-image';
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'fa-solid fa-file-pdf';
  if (/sheet|excel|csv/.test(type) || /\.(xlsx?|csv)$/i.test(name)) return 'fa-solid fa-file-excel';
  if (/word|document/.test(type) || /\.docx?$/i.test(name)) return 'fa-solid fa-file-word';
  if (/zip|compressed/.test(type) || /\.(zip|rar|7z)$/i.test(name)) return 'fa-solid fa-file-zipper';
  if (/^video\//.test(type)) return 'fa-solid fa-file-video';
  return 'fa-solid fa-file';
}

const INLINE_IMAGE = /^image\/(png|jpeg|gif|webp)$/i;

// Attachments on a posted comment: image thumbnails and file chips. A click
// opens the full-size preview (with Download); `urlFor(i)` is the file route.
export function CommentFiles({ files, urlFor }) {
  const [open, setOpen] = useState(null);
  if (!files?.length) return null;
  const items = files.map((f, i) => ({ ...f, previewUrl: `${urlFor(i)}?preview=1`, downloadUrl: urlFor(i) }));
  return (
    <div className="comment-files">
      {files.map((f, i) =>
        INLINE_IMAGE.test(f.type) ? (
          <button key={i} type="button" className="comment-thumb" onClick={() => setOpen(i)} title={`Preview ${f.name} · ${fileSize(f.size)}`}>
            <img src={urlFor(i)} alt={f.name} loading="lazy" />
          </button>
        ) : (
          <button key={i} type="button" className="comment-file" onClick={() => setOpen(i)} title={`Preview ${f.name}`}>
            <i className={fileIcon(f.type, f.name)} />
            <span className="comment-file-name">{f.name}</span>
            <small>{fileSize(f.size)}</small>
          </button>
        )
      )}
      {open !== null && <AttachmentPreview files={items} index={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// Composer used for new comments and edits: text with @mentions plus up to 5
// attachments (📎 button, drag & drop, or paste a screenshot). Ctrl/⌘+Enter
// posts, Esc cancels. `existing` (edits only) lists the comment's current
// files — each can be removed. onSubmit(text, newFiles, keptIndexes).
export function CommentComposer({
  people,
  initial = '',
  existing = [],
  existingUrl,
  submitLabel = 'Comment',
  cancelLabel = 'Cancel',
  placeholder,
  onSubmit,
  onCancel,
  hint,
  autoFocus = true,
}) {
  const [text, setText] = useState(initial);
  const [files, setFiles] = useState([]); // new: { name, type, size, data, preview }
  const [kept, setKept] = useState(() => existing.map((_, i) => i));
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(null); // { files, index } — blob: URLs revoked on close
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const total = files.length + kept.length;
  const canSubmit = Boolean(text.trim()) || total > 0;

  function addFiles(list) {
    const picked = [...list];
    if (!picked.length) return;
    setError('');
    const room = MAX_FILES - total;
    if (room <= 0) {
      setError(`You can attach up to ${MAX_FILES} files.`);
      return;
    }
    if (picked.length > room) setError(`Only ${room} more file${room === 1 ? '' : 's'} fit — up to ${MAX_FILES} per comment.`);
    picked.slice(0, room).forEach((file) => {
      if (file.size > MAX_TASK_FILE_BYTES) {
        setError(`"${file.name}" is too large. Files must be under 2MB.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () =>
        setFiles((prev) =>
          prev.length + kept.length >= MAX_FILES
            ? prev
            : [...prev, { name: file.name || 'pasted-image.png', type: file.type, size: file.size, data: reader.result }]
        );
      reader.readAsDataURL(file);
    });
  }

  // Preview before posting: kept files come from the server, new ones from
  // the data URLs picked here (as blob: URLs, revoked when the preview closes).
  function openPreview(target) {
    const list = [];
    let index = 0;
    existing.forEach((f, i) => {
      if (!kept.includes(i)) return;
      if (target === `old-${i}`) index = list.length;
      list.push({ ...f, previewUrl: `${existingUrl(i)}?preview=1`, downloadUrl: existingUrl(i) });
    });
    files.forEach((f, i) => {
      if (target === `new-${i}`) index = list.length;
      const url = dataUrlToBlobUrl(f.data);
      list.push({ name: f.name, type: f.type, size: f.size, previewUrl: url, downloadUrl: url, blob: true });
    });
    setPreview({ files: list, index });
  }
  function closePreview() {
    preview?.files.forEach((f) => f.blob && URL.revokeObjectURL(f.previewUrl));
    setPreview(null);
  }

  async function submit() {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSubmit(
        text,
        files.map(({ name, type, size, data }) => ({ name, type, size, data })),
        kept
      );
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div
      className={`comment-composer${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
      onPaste={(e) => {
        if (e.clipboardData.files.length) {
          e.preventDefault();
          addFiles(e.clipboardData.files);
        }
      }}
    >
      <MentionInput
        value={text}
        onChange={setText}
        people={people}
        autoFocus={autoFocus}
        placeholder={placeholder || 'Write a comment… type @ to mention someone'}
        onSubmit={submit}
        onCancel={onCancel}
      />

      {total > 0 && (
        <div className="composer-files">
          {existing.map((f, i) =>
            kept.includes(i) ? (
              <span key={`old-${i}`} className="composer-file">
                <button type="button" className="composer-file-open" onClick={() => openPreview(`old-${i}`)} title={`Preview ${f.name}`}>
                  {INLINE_IMAGE.test(f.type) && existingUrl ? <img src={existingUrl(i)} alt="" /> : <i className={fileIcon(f.type, f.name)} />}
                  <span className="comment-file-name">{f.name}</span>
                  <small>{fileSize(f.size)}</small>
                </button>
                <button type="button" title="Remove" onClick={() => setKept((k) => k.filter((x) => x !== i))}>×</button>
              </span>
            ) : null
          )}
          {files.map((f, i) => (
            <span key={`new-${i}`} className="composer-file new">
              <button type="button" className="composer-file-open" onClick={() => openPreview(`new-${i}`)} title={`Preview ${f.name}`}>
                {INLINE_IMAGE.test(f.type) ? <img src={f.data} alt="" /> : <i className={fileIcon(f.type, f.name)} />}
                <span className="comment-file-name">{f.name}</span>
                <small>{fileSize(f.size)}</small>
              </button>
              <button type="button" title="Remove" onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
        </div>
      )}

      <div className="comment-composer-actions">
        <button
          type="button"
          className="composer-attach"
          onClick={() => fileRef.current?.click()}
          disabled={saving || total >= MAX_FILES}
          title={`Attach files (up to ${MAX_FILES}, 2MB each) — or drag & drop / paste`}
        >
          <i className="fa-solid fa-paperclip" /> Attach
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <span className="task-muted">{dragging ? 'Drop files to attach' : hint || '@ to mention · drop or paste files · Ctrl/⌘ + Enter to post'}</span>
        {onCancel && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={onCancel}>{cancelLabel}</button>
        )}
        <button type="button" className="btn btn-primary btn-sm" disabled={saving || !canSubmit} onClick={submit}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
      {error && <div className="top-error">{error}</div>}
      {preview && <AttachmentPreview files={preview.files} index={preview.index} onClose={closePreview} />}
    </div>
  );
}

// The comment thread on one log entry. Any board member can comment; the
// author (or the board admin) can edit or delete. Every add / edit / delete
// is logged by the server, and @mentions notify the people named.
function CommentThread({ entry, people, boardUuid, meId, isAdmin, onChanged, composing, setComposing }) {
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const base = `/api/task-boards/${boardUuid}/activity/${entry.id}/comments`;

  if (!entry.comments.length && !composing) return null;

  async function remove(c) {
    setError('');
    try {
      await sendComment(`${base}/${c.id}`, 'DELETE');
      onChanged?.();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="comment-thread">
      {entry.comments.map((c) => {
        const person = people.find((p) => p.id === c.user_id) || { name: c.user_name };
        const mayChange = c.user_id === meId || isAdmin;
        return (
          <div key={c.id} className="comment">
            <Avatar person={person} size={22} />
            <div className="comment-body">
              <div className="comment-head">
                <strong>{c.user_id === meId ? 'You' : c.user_name}</strong>
                <span className="comment-time" title={formatDateTime(c.created_at)}>
                  {timeAgo(c.created_at)}{c.edited_at ? ' · edited' : ''}
                </span>
                {mayChange && editingId !== c.id && (
                  <span className="comment-tools">
                    <button type="button" className="log-link" onClick={() => setEditingId(c.id)}>Edit</button>
                    <button type="button" className="log-link danger" onClick={() => remove(c)}>Delete</button>
                  </span>
                )}
              </div>
              {editingId === c.id ? (
                <CommentComposer
                  people={people}
                  initial={c.body}
                  existing={c.attachments}
                  existingUrl={(i) => `${base}/${c.id}/files/${i}`}
                  submitLabel="Save"
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (text, files, kept) => {
                    await sendComment(`${base}/${c.id}`, 'PATCH', { body: text, attachments: files, keep_attachments: kept });
                    setEditingId(null);
                    onChanged?.();
                  }}
                />
              ) : (
                <>
                  {c.body && (
                    <p className="comment-text">
                      <MentionText text={c.body} mentions={c.mentions} />
                    </p>
                  )}
                  <CommentFiles files={c.attachments} urlFor={(i) => `${base}/${c.id}/files/${i}`} />
                </>
              )}
            </div>
          </div>
        );
      })}
      {composing && (
        <CommentComposer
          people={people}
          onCancel={() => setComposing(false)}
          onSubmit={async (text, files) => {
            await sendComment(base, 'POST', { body: text, attachments: files });
            setComposing(false);
            onChanged?.();
          }}
        />
      )}
      {error && <div className="top-error">{error}</div>}
    </div>
  );
}

// Every field of the entry's task as it is now, each editable in place
// (double-click, or the ✎ that appears on hover) — "update anything" from
// any log entry, without opening the task form.
function TaskFieldsPanel({ task, columns, people, statuses, canEditKey, onEditField }) {
  const [editing, setEditing] = useState(null);
  const assignee = people.find((p) => p.id === task.assignee_id);
  const fields = [
    { key: 'title', label: 'Title', view: task.title },
    { key: 'status', label: 'Status', view: task.status },
    { key: 'priority', label: 'Priority', view: task.priority },
    { key: 'assignee_id', label: 'Assignee', view: assignee?.name || (task.assignee_id ? 'Former member' : '') },
    { key: 'due_date', label: 'Due date', view: task.due_date ? formatDay(task.due_date) : '' },
    { key: 'description', label: 'Description', view: task.description || '', wide: true },
    ...columns.map((c) => ({
      key: `data.${c.field_key}`,
      label: c.label,
      view: <ColumnValue column={c} value={task.data?.[c.field_key]} />,
      raw: task.data?.[c.field_key],
    })),
  ];
  return (
    <div className="log-fields">
      {fields.map((f) => {
        const editable = canEditKey(f.key);
        const empty = f.raw === undefined ? !f.view : f.raw === '' || f.raw === null || f.raw === undefined;
        return (
          <div key={f.key} className={`log-field${f.wide ? ' log-field-wide' : ''}`}>
            <span className="log-field-label">{f.label}</span>
            {editing === f.key ? (
              <InlineEditor
                fieldKey={f.key}
                label={f.label}
                task={task}
                columns={columns}
                people={people}
                statuses={statuses}
                onCancel={() => setEditing(null)}
                onSave={(v) => {
                  setEditing(null);
                  onEditField(task, f.key, v);
                }}
              />
            ) : (
              <span
                className={`log-field-value${editable ? ' editable' : ''}`}
                title={editable ? `Double-click to change ${f.label}` : undefined}
                onDoubleClick={editable ? () => setEditing(f.key) : undefined}
              >
                {empty ? <span className="log-verb">—</span> : f.view}
                {editable && (
                  <button type="button" className="log-field-edit" onClick={() => setEditing(f.key)} title={`Change ${f.label}`}>✎</button>
                )}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- one entry ----------

// Full details of one log entry — opened by clicking a history row. Shows
// everything without clipping: who and exactly when, every change in full
// (before → after), the task as it is now, the whole comment thread with
// attachments (previewable), and the record's ids.
function FullValue({ text }) {
  if (!text) return <span className="log-verb">—</span>;
  if (/^https?:\/\/\S+$/i.test(text)) {
    return (
      <a className="log-url" href={text} target="_blank" rel="noopener noreferrer">{text}</a>
    );
  }
  return <span className="details-value">{pretty(text)}</span>;
}

function EntryDetails({ entry: a, person, who, people, task, statuses, threadProps, onClose }) {
  const [composing, setComposing] = useState(false);
  useEffect(() => {
    function onKey(e) {
      // An open attachment preview handles its own Esc first.
      if (e.key !== 'Escape' || document.querySelector('.preview-overlay')) return;
      e.stopPropagation();
      onClose();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const assignee = task && people.find((p) => p.id === task.assignee_id);
  const isText = a.action === 'log_note' || a.action === 'log_comment';

  return (
    <div className="modal-overlay entry-details-overlay" onClick={onClose}>
      <div className="modal modal-lg entry-details" onClick={(e) => e.stopPropagation()}>
        <div className="details-head">
          <Avatar person={person} size={40} />
          <div className="details-who">
            <div>
              <strong>{who}</strong>
              <span className={`task-log-badge ${ACTION_TONE[a.action] || ''}`}>{ACTION_LABELS[a.action] || a.action}</span>
            </div>
            <span>{formatDateTime(a.created_at)} · {timeAgo(a.created_at)}</span>
          </div>
          <button type="button" className="new-track-close" onClick={onClose} title="Close (Esc)">×</button>
        </div>

        <p className="details-summary">{a.summary}</p>

        {(a.task_id || a.task_title) && (
          <section className="details-section">
            <h4>Task</h4>
            {task ? (
              <div className="details-task">
                <strong>{task.title}</strong>
                <div className="details-task-meta">
                  <span className="log-status-static" style={{ '--pill': statusColor(statuses, task.status) }}>{task.status}</span>
                  <span><em>Priority</em> {task.priority}</span>
                  <span><em>Assignee</em> {assignee?.name || 'Unassigned'}</span>
                  <span><em>Due</em> {task.due_date ? formatDay(task.due_date) : '—'}</span>
                </div>
                {task.description && <p className="details-desc">{task.description}</p>}
              </div>
            ) : (
              <p className="task-muted">{a.task_title ? `“${a.task_title}” — ` : ''}this task has been deleted or isn’t visible to you.</p>
            )}
          </section>
        )}

        {a.changes.length > 0 && (
          <section className="details-section">
            <h4>{isText ? 'Text' : a.action === 'task_create' ? 'Created with' : `What changed (${a.changes.length})`}</h4>
            <table className="details-changes">
              <thead>
                <tr>
                  <th>Field</th>
                  {a.action !== 'task_create' && <th>Before</th>}
                  <th>{a.action === 'task_create' ? 'Value' : 'After'}</th>
                </tr>
              </thead>
              <tbody>
                {a.changes.map((c) => (
                  <tr key={c.key}>
                    <td className="details-field">{c.label}</td>
                    {a.action !== 'task_create' && (
                      <td className="details-before"><FullValue text={c.oldText} /></td>
                    )}
                    <td className="details-after">
                      {isText && c.newText ? (
                        <span className="details-value"><MentionText text={c.newText} mentions={mentionsIn(c.newText, people)} /></span>
                      ) : (
                        <FullValue text={c.newText} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {(a.reverted_at || a.revert_of) && (
          <section className="details-section">
            <h4>Revert</h4>
            {a.reverted_at && <p className="task-log-reverted-note">↺ Reverted by {a.reverted_by_name || 'admin'} on {formatDateTime(a.reverted_at)}</p>}
            {a.revert_of && <p className="task-log-reverted-note">↺ This entry undid change #{a.revert_of}</p>}
          </section>
        )}

        <section className="details-section">
          <h4>
            Comments ({a.comments.length})
            {!composing && (
              <button type="button" className="log-link log-link-strong" onClick={() => setComposing(true)}>💬 Add comment</button>
            )}
          </h4>
          {a.comments.length === 0 && !composing && <p className="task-muted">No comments yet.</p>}
          <CommentThread {...threadProps} entry={a} people={people} composing={composing} setComposing={setComposing} />
        </section>

        <section className="details-section details-record">
          <h4>Record</h4>
          <dl>
            <dt>Log ID</dt><dd>#{a.id}</dd>
            <dt>Action</dt><dd>{a.action}</dd>
            {a.task_id && (<><dt>Task ID</dt><dd>{a.task_id}</dd></>)}
            <dt>Logged at</dt><dd>{new Date(a.created_at).toLocaleString()}</dd>
            <dt>By</dt><dd>{a.user_name}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}

// Clicks on these never open the details (they do their own thing; editable
// chips and titles are double-click targets).
const ROW_CLICK_IGNORE =
  'button, a, select, input, textarea, label, .log-editor, .comment-thread, .log-fields, .log-chip-editable, .log-task-editable, .log-now, .log-revert, .preview-overlay, .entry-details-overlay';


// One log entry as a row of fixed columns — who & what | current status |
// when — so every row lines up. Double-clicking the task title or a field
// chip edits that field on the task in place (no form opens).
export default function ActivityEntry({
  entry: a,
  people,
  boardUuid,
  meId,
  isAdmin,
  showTask = true,
  canRevert = false,
  onRevert,
  onChanged,
  task = null, // the entry's task as it is now (null if deleted / board-level)
  statuses = [],
  columns = [],
  canChangeStatus,
  canEdit = false,
  onStatusChange,
  onEditField,
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [showFields, setShowFields] = useState(false);
  const [editing, setEditing] = useState(null); // { key, label } being edited inline
  const [showDetails, setShowDetails] = useState(false);
  const person = people.find((p) => p.id === a.user_id) || { name: a.user_name };
  const who = a.user_id === meId ? 'You' : a.user_name;

  // A click anywhere plain on the row opens its full details.
  function onRowClick(e) {
    if (editing || e.target.closest(ROW_CLICK_IGNORE) || window.getSelection?.()?.toString()) return;
    setShowDetails(true);
  }
  const detailsModal = showDetails && (
    <EntryDetails
      entry={a}
      person={person}
      who={who}
      people={people}
      task={task}
      statuses={statuses}
      threadProps={{ boardUuid, meId, isAdmin, onChanged }}
      onClose={() => setShowDetails(false)}
    />
  );

  const canEditKey = (key) =>
    Boolean(task && onEditField && editableKey(key, columns) && (key === 'status' ? canChangeStatus?.(task) : canEdit));
  const startEdit = (key, label) => (e) => {
    e?.preventDefault();
    window.getSelection?.()?.removeAllRanges();
    setEditing({ key, label });
  };
  const editor = editing && task && (
    <InlineEditor
      key={editing.key}
      fieldKey={editing.key}
      label={editing.label}
      task={task}
      columns={columns}
      people={people}
      statuses={statuses}
      onCancel={() => setEditing(null)}
      onSave={(v) => {
        setEditing(null);
        onEditField(task, editing.key, v);
      }}
    />
  );

  const time = (
    <div className="log-when" title={formatDateTime(a.created_at)}>
      <span className="log-ago">{timeAgo(a.created_at)}</span>
      <span className="log-stamp">
        {new Date(a.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · #{a.id}
      </span>
    </div>
  );

  const status = (
    <div className="log-now">
      {task && onStatusChange ? (
        <>
          <span className="log-now-label">Status now</span>
          {canChangeStatus?.(task) ? (
            <select
              className="task-status-select log-status"
              style={{ '--pill': statusColor(statuses, task.status) }}
              value={task.status}
              onChange={(e) => onStatusChange(task, e.target.value)}
              title="This task's current status — change it here"
            >
              {statuses.map((st) => (
                <option key={st.name} value={st.name}>{st.name}</option>
              ))}
            </select>
          ) : (
            <span className="log-status-static" style={{ '--pill': statusColor(statuses, task.status) }}>{task.status}</span>
          )}
        </>
      ) : a.task_id && a.action !== 'log_note' ? (
        <span className="log-now-label">Task deleted</span>
      ) : null}
    </div>
  );

  const titleEditable = canEditKey('title');
  const taskTitle = (text) =>
    editing?.key === 'title' ? null : (
      <span
        className={`log-task${titleEditable ? ' log-task-editable' : ''}`}
        title={titleEditable ? 'Double-click to rename the task' : text}
        onDoubleClick={titleEditable ? startEdit('title', 'Title') : undefined}
      >
        {text}
      </span>
    );

  // "Viewed" entries are frequent and say one thing — a short single line.
  if (a.action === 'task_view') {
    return (
      <div className="log-row log-row-view log-row-clickable" onClick={onRowClick} title="Click for full details">
        <span className="log-view-icon">👁</span>
        <p className="log-line">
          <strong>{who}</strong> <span className="log-verb-main">viewed</span> {a.task_title ? taskTitle(a.task_title) : 'a task'}
        </p>
        {status}
        {time}
        {editing?.key === 'title' && <div className="log-view-editor">{editor}</div>}
        {detailsModal}
      </div>
    );
  }

  const created = a.action === 'task_create';
  const title = created ? a.changes.find((c) => c.key === 'title')?.newText || a.task_title : a.task_title;
  const lower = (text) => text.charAt(0).toLowerCase() + text.slice(1);
  let headline;
  if (ACTION_VERB[a.action]) headline = <><span className="log-verb-main">{ACTION_VERB[a.action]}</span> {title ? taskTitle(title) : 'a task'}</>;
  else if (a.action === 'log_note' || a.action === 'log_comment') headline = <><span className="log-verb-main">{lower(a.summary)}</span>{a.task_title && showTask ? <> · {taskTitle(a.task_title)}</> : null}</>;
  else headline = <span className="log-verb-main">{lower(a.summary)}</span>;

  const chips = created
    ? a.changes.filter((c) => c.key !== 'title' && c.newText)
    : a.action === 'log_note' || a.action === 'log_comment'
      ? []
      : a.changes;

  async function doRevert() {
    setBusy(true);
    try {
      await onRevert(a);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      id={`log-${a.id}`}
      className={`log-row log-row-clickable${a.reverted_at ? ' log-row-reverted' : ''}`}
      onClick={onRowClick}
    >
      <div className="log-avatar">
        <Avatar person={person} size={32} />
        <span className={`log-icon-badge ${ACTION_TONE[a.action] || ''}`}>{ACTION_ICON[a.action] || '•'}</span>
      </div>

      <div className="log-main">
        <p className="log-line">
          <strong>{who}</strong> {headline}
          <span className={`task-log-badge log-badge ${ACTION_TONE[a.action] || ''}`}>{ACTION_LABELS[a.action] || a.action}</span>
        </p>
        {editing?.key === 'title' && editor}

        {(a.action === 'log_note' || a.action === 'log_comment') && a.changes[0] && (
          <TextChange change={a.changes[0]} people={people} noun={a.action === 'log_note' ? 'Note' : 'Comment'} />
        )}
        {chips.length > 0 && (
          <div className="log-details">
            {chips.map((c) => {
              if (editing?.key === c.key) return <span key={c.key}>{editor}</span>;
              const editable = canEditKey(c.key);
              const onEdit = startEdit(c.key, c.label);
              return created ? (
                <FactChip key={c.key} change={c} editable={editable} onEdit={onEdit} />
              ) : (
                <ChangeChip key={c.key} change={c} editable={editable} onEdit={onEdit} />
              );
            })}
          </div>
        )}

        {(a.reverted_at || a.revert_of) && (
          <div className="task-log-reverted-note">
            {a.reverted_at && <>↺ Reverted by {a.reverted_by_name || 'admin'} · {formatDateTime(a.reverted_at)}</>}
            {a.revert_of && <>↺ This undid change #{a.revert_of}</>}
          </div>
        )}

        {confirm && (
          <div className="log-revert">
            <span className="task-muted">Undo this change?</span>
            <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={doRevert}>
              {busy ? 'Reverting…' : 'Yes, revert'}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        )}

        {a.note && (
          <div className="log-note">
            <span className="log-note-icon">📝</span>
            <p>{a.note}</p>
            <span className="log-note-meta">{a.note_by_name || 'Someone'} · {timeAgo(a.note_at)}</span>
          </div>
        )}

        {showFields && task && (
          <TaskFieldsPanel
            task={task}
            columns={columns}
            people={people}
            statuses={statuses}
            canEditKey={canEditKey}
            onEditField={onEditField}
          />
        )}

        <CommentThread
          entry={a}
          people={people}
          boardUuid={boardUuid}
          meId={meId}
          isAdmin={isAdmin}
          onChanged={onChanged}
          composing={composing}
          setComposing={setComposing}
        />

        <div className="log-actions">
          {!composing && (
            <button type="button" className={`log-link${a.comments.length ? ' log-link-strong' : ''}`} onClick={() => setComposing(true)}>
              💬 {a.comments.length ? `Reply (${a.comments.length})` : 'Comment'}
            </button>
          )}
          {task && onEditField && (
            <button type="button" className={`log-link${showFields ? ' log-link-strong' : ''}`} onClick={() => setShowFields((v) => !v)}>
              {showFields ? '▴ Hide task fields' : '✎ Edit task here'}
            </button>
          )}
          {canRevert && a.revertible && !confirm && (
            <button type="button" className="log-link" onClick={() => setConfirm(true)}>↺ Revert</button>
          )}
          <button type="button" className="log-link" onClick={() => setShowDetails(true)}>ⓘ Details</button>
        </div>
      </div>

      {status}
      {time}
      {detailsModal}
    </article>
  );
}

// "‹ Prev  Page 2 of 5 · 11–20 of 47 entries  Next ›"
export function Pager({ page, per, total, onPage, noun = 'items' }) {
  const pages = Math.max(1, Math.ceil(total / per));
  if (total <= per) return null;
  const from = (page - 1) * per + 1;
  const to = Math.min(total, page * per);
  return (
    <div className="pagination-bar">
      <button type="button" className="btn btn-sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>‹ Prev</button>
      <span className="pagination-status">
        Page {page} of {pages} · {from}–{to} of {total} {noun}
      </span>
      <button type="button" className="btn btn-sm" onClick={() => onPage(page + 1)} disabled={page >= pages}>Next ›</button>
    </div>
  );
}

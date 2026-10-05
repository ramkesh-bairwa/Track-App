'use client';
import { safeFileUrl } from '@/lib/safeUrl';
import { DATE_LOCALE } from '@/lib/dateLocale';

// Small shared pieces for the task assigner screens.

export function initials(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

export function Avatar({ person, size = 24 }) {
  return (
    <span className="avatar task-avatar" style={{ width: size, height: size, fontSize: size * 0.42 }} title={person?.name}>
      {person?.avatar ? <img src={person.avatar} alt="" /> : initials(person?.name)}
    </span>
  );
}

export function Pill({ color, children, title }) {
  return (
    <span className="task-pill" style={{ '--pill': color }} title={title}>
      <span className="task-pill-dot" />
      {children}
    </span>
  );
}

export function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(DATE_LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatDay(value) {
  if (!value) return '';
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y) return '';
  return new Date(y, m - 1, d).toLocaleDateString(DATE_LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function timeAgo(value) {
  const d = new Date(value);
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (Number.isNaN(secs)) return '';
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return formatDateTime(value);
}

export function isOverdue(task, statuses) {
  if (!task.due_date) return false;
  const last = statuses[statuses.length - 1]?.name;
  if (task.status === 'Done' || task.status === last) return false;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return task.due_date < todayStr;
}

export function FileValue({ value }) {
  if (!value?.data) return <span className="cell-empty">No file</span>;
  return (
    <a
      href={safeFileUrl(value.data) || undefined}
      download={value.name}
      className="task-file-link"
      onClick={(e) => e.stopPropagation()}
      title={`Download ${value.name}`}
    >
      📎 {value.name}
    </a>
  );
}

// Read-only display of a custom column value in the board table.
export function ColumnValue({ column, value }) {
  if (column.field_type === 'file') return <FileValue value={value} />;
  if (value === '' || value === null || value === undefined) return <span className="cell-empty">—</span>;
  if (column.field_type === 'checkbox') return <span>{value ? '✓ Yes' : 'No'}</span>;
  if (column.field_type === 'link') {
    const href = /^https?:\/\//.test(value) ? value : `https://${value}`;
    return (
      <a href={href} target="_blank" rel="noreferrer" className="cell-link" onClick={(e) => e.stopPropagation()}>
        {value}
      </a>
    );
  }
  if (column.field_type === 'date') return <span>{formatDay(value)}</span>;
  return <span className="task-cell-text">{String(value)}</span>;
}

'use client';

import { TASK_FIELD_TYPES, taskFieldTypeMeta } from '@/lib/taskConfig';

export function blankColumn() {
  return { label: '', field_type: 'text', options: '' };
}

// Editable list of { label, field_type, options } column definitions.
export default function TaskColumnBuilder({ columns, onChange, disabled }) {
  function update(i, patch) {
    onChange(columns.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }
  return (
    <div className="task-status-list">
      {columns.map((c, i) => (
        <div key={i} className="task-status-row task-column-builder-row">
          <input
            className="input"
            placeholder="Column name"
            value={c.label}
            disabled={disabled}
            onChange={(e) => update(i, { label: e.target.value })}
            autoFocus={i === columns.length - 1 && !c.label}
          />
          <select className="input" value={c.field_type} disabled={disabled} onChange={(e) => update(i, { field_type: e.target.value })}>
            {TASK_FIELD_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          {taskFieldTypeMeta(c.field_type).supportsOptions && (
            <input
              className="input"
              placeholder="Options, comma separated"
              value={c.options}
              disabled={disabled}
              onChange={(e) => update(i, { options: e.target.value })}
            />
          )}
          {columns.length > 1 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={disabled}
              onClick={() => onChange(columns.filter((_, j) => j !== i))}
              title="Remove column"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <div>
        <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => onChange([...columns, blankColumn()])}>
          ＋ Another column
        </button>
      </div>
    </div>
  );
}

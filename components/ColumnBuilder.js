'use client';

import { useState, useRef } from 'react';
import { FIELD_TYPE_GROUPS, fieldTypeMeta } from '@/lib/fieldTypes';

let localIdCounter = 0;
function nextLocalId() {
  localIdCounter += 1;
  return `new-${Date.now()}-${localIdCounter}`;
}

export function makeColumn(fieldType) {
  const meta = fieldTypeMeta(fieldType);
  return {
    localId: nextLocalId(),
    label: meta.label,
    field_type: fieldType,
    options: '',
    field_length: meta.defaultLength || '',
    auto_increment: false,
  };
}

export default function ColumnBuilder({ columns, onChange }) {
  const [dragOver, setDragOver] = useState(false);
  const dragIndexRef = useRef(null);
  const hasAutoIncrement = columns.some((c) => c.auto_increment);

  function handlePaletteDragStart(e, fieldType) {
    e.dataTransfer.setData('application/x-mytrack-field', fieldType);
    e.dataTransfer.effectAllowed = 'copy';
  }

  function handleDropzoneDragOver(e) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDropzoneDragLeave() {
    setDragOver(false);
  }

  function handleDropzoneDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const fieldType = e.dataTransfer.getData('application/x-mytrack-field');
    if (fieldType) {
      onChange([...columns, makeColumn(fieldType)]);
    }
  }

  function updateColumn(index, patch) {
    const next = columns.slice();
    next[index] = { ...next[index], ...patch };
    onChange(next);
  }

  function removeColumn(index) {
    const next = columns.slice();
    next.splice(index, 1);
    onChange(next);
  }

  function handleRowDragStart(index) {
    dragIndexRef.current = index;
  }

  function handleRowDragOver(e, index) {
    e.preventDefault();
    const from = dragIndexRef.current;
    if (from === null || from === index) return;
    const next = columns.slice();
    const [moved] = next.splice(from, 1);
    next.splice(index, 0, moved);
    dragIndexRef.current = index;
    onChange(next);
  }

  function handleRowDragEnd() {
    dragIndexRef.current = null;
  }

  return (
    <div className="builder-grid">
      <div className="palette">
        <h4>Drag a field onto the form</h4>
        {FIELD_TYPE_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="palette-group-label">{group.label}</div>
            {group.types.map((f) => (
              <div
                key={f.id}
                className="palette-item"
                draggable
                onDragStart={(e) => handlePaletteDragStart(e, f.id)}
              >
                <span className="palette-icon">{f.icon}</span>
                <span className="palette-item-text">
                  <strong>{f.label}</strong>
                  <small>{f.hint}</small>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div
        className={`dropzone${dragOver ? ' drag-over' : ''}`}
        onDragOver={handleDropzoneDragOver}
        onDragLeave={handleDropzoneDragLeave}
        onDrop={handleDropzoneDrop}
      >
        {columns.length === 0 ? (
          <div className="dropzone-empty">
            Drop field types here to build this track's structure.
            <br />
            Each one becomes a column in the table and a field in the entry form.
          </div>
        ) : (
          columns.map((col, index) => {
            const meta = fieldTypeMeta(col.field_type);
            return (
              <div
                key={col.localId || col.id}
                className="builder-row"
                draggable
                onDragStart={() => handleRowDragStart(index)}
                onDragOver={(e) => handleRowDragOver(e, index)}
                onDragEnd={handleRowDragEnd}
              >
                <span className="builder-row-handle">⠿</span>
                <div>
                  <input
                    className="input"
                    value={col.label}
                    onChange={(e) => updateColumn(index, { label: e.target.value })}
                    placeholder="Field label"
                  />
                  {meta.supportsOptions && (
                    <input
                      className="input"
                      style={{ marginTop: 6 }}
                      value={col.options}
                      onChange={(e) => updateColumn(index, { options: e.target.value })}
                      placeholder="Options, comma separated"
                    />
                  )}
                  {meta.supportsLength && (
                    <input
                      className="input input-mono"
                      style={{ marginTop: 6 }}
                      value={col.field_length || ''}
                      onChange={(e) => updateColumn(index, { field_length: e.target.value })}
                      placeholder={meta.lengthPlaceholder || meta.defaultLength || 'Length'}
                    />
                  )}
                  <label className="checkbox-row" style={{ marginTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(col.auto_increment)}
                      disabled={!col.auto_increment && hasAutoIncrement}
                      onChange={(e) => updateColumn(index, { auto_increment: e.target.checked })}
                    />
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      Auto increment{!col.auto_increment && hasAutoIncrement ? ' (one per track)' : ''}
                    </span>
                  </label>
                </div>
                <span className="builder-row-type">
                  {meta.sqlType}{col.field_length && meta.supportsLength ? `(${col.field_length})` : ''}
                </span>
                <button
                  type="button"
                  className="builder-row-remove"
                  onClick={() => removeColumn(index)}
                  title="Remove field"
                >
                  ×
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

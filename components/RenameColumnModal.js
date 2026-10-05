'use client';

import { useState } from 'react';
import { FIELD_TYPE_GROUPS, fieldTypeMeta } from '@/lib/fieldTypes';

export default function RenameColumnModal({ column, onClose, onSave }) {
  const [label, setLabel] = useState(column.label);
  const [fieldType, setFieldType] = useState(column.field_type);
  const [fieldLength, setFieldLength] = useState(column.field_length || '');
  const [options, setOptions] = useState(column.options || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const meta = fieldTypeMeta(fieldType);

  function handleTypeChange(nextType) {
    setFieldType(nextType);
    const nextMeta = fieldTypeMeta(nextType);
    setFieldLength(nextMeta.defaultLength || '');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!label.trim()) {
      setError('Give this column a label.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        label: label.trim(),
        field_type: fieldType,
        field_length: meta.supportsLength ? fieldLength : '',
        options,
      });
    } catch (err) {
      setError(err.message || 'Could not save this column.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit column</h2>
        {error && <div className="top-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field-group">
            <label className="field-label">Label</label>
            <input
              className="input"
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onFocus={(e) => e.target.select()}
            />
          </div>

          <div className="field-group">
            <label className="field-label">Field type</label>
            <select className="input" value={fieldType} onChange={(e) => handleTypeChange(e.target.value)}>
              {FIELD_TYPE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.types.map((f) => (
                    <option key={f.id} value={f.id}>{f.label} — {f.hint}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {meta.supportsLength && (
            <div className="field-group">
              <label className="field-label">Length</label>
              <input
                className="input input-mono"
                value={fieldLength}
                onChange={(e) => setFieldLength(e.target.value)}
                placeholder={meta.lengthPlaceholder || meta.defaultLength || 'e.g. 255'}
              />
              <p className="field-hint">
                Shown as {meta.sqlType}{fieldLength ? `(${fieldLength})` : ''} — for reference only, values are still stored flexibly.
              </p>
            </div>
          )}

          {meta.supportsOptions && (
            <div className="field-group">
              <label className="field-label">Options</label>
              <input
                className="input"
                value={options}
                onChange={(e) => setOptions(e.target.value)}
                placeholder="Comma separated, e.g. Active, Paused, Done"
              />
            </div>
          )}

          {column.is_auto_increment ? (
            <p className="field-hint">
              This column auto-numbers each entry — its value can&apos;t be edited by hand, but the label, type and length shown here are just for display.
            </p>
          ) : null}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

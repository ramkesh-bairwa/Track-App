'use client';

import { fieldTypeMeta, optionList, htmlInputTypeFor, parseRangeConfig, inputConstraintsFor } from '@/lib/fieldTypes';
import { safeFileUrl } from '@/lib/safeUrl';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export default function EntryForm({ columns, values, onChange }) {
  function setField(key, val) {
    onChange({ ...values, [key]: val });
  }

  function handleFileChange(key, e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      window.alert('That file is too large. Please pick one under 2MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setField(key, reader.result);
    reader.readAsDataURL(file);
  }

  const visibleColumns = columns.filter((col) => !col.is_auto_increment);

  return (
    <div>
      {visibleColumns.map((col) => {
        const meta = fieldTypeMeta(col.field_type);
        const val = values[col.field_key] ?? '';
        return (
          <div className="field-group" key={col.id}>
            <label className="field-label">{col.label}</label>

            {meta.input === 'textarea' && (
              <textarea
                className="input"
                value={val}
                onChange={(e) => setField(col.field_key, e.target.value)}
              />
            )}

            {meta.input === 'select' && (
              <select
                className="input"
                value={val}
                onChange={(e) => setField(col.field_key, e.target.value)}
              >
                <option value="">Select…</option>
                {optionList(col.options).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            )}

            {meta.input === 'multiselect' && (
              <select
                className="input"
                multiple
                value={optionList(val)}
                onChange={(e) =>
                  setField(col.field_key, Array.from(e.target.selectedOptions).map((o) => o.value).join(','))
                }
              >
                {optionList(col.options).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            )}

            {meta.input === 'checkbox' && (
              <div className="checkbox-row">
                <input
                  type="checkbox"
                  checked={Boolean(val)}
                  onChange={(e) => setField(col.field_key, e.target.checked)}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>Yes / enabled</span>
              </div>
            )}

            {meta.input === 'password' && (
              <input
                className="input input-mono"
                type="text"
                autoComplete="off"
                value={val}
                onChange={(e) => setField(col.field_key, e.target.value)}
                placeholder="Stored as entered — this app does not encrypt it"
                {...inputConstraintsFor(col)}
              />
            )}

            {meta.input === 'radio' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {optionList(col.options).map((o) => (
                  <label key={o} className="checkbox-row">
                    <input
                      type="radio"
                      name={col.field_key}
                      checked={val === o}
                      onChange={() => setField(col.field_key, o)}
                    />
                    <span>{o}</span>
                  </label>
                ))}
                {optionList(col.options).length === 0 && (
                  <span className="field-hint">No options configured for this field yet.</span>
                )}
              </div>
            )}

            {meta.input === 'range' && (() => {
              const { min, max, step } = parseRangeConfig(col.field_length);
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={val === '' ? min : val}
                    onChange={(e) => setField(col.field_key, e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <span className="input-mono" style={{ fontSize: 12.5, minWidth: 32, textAlign: 'right' }}>
                    {val === '' ? min : val}
                  </span>
                </div>
              );
            })()}

            {meta.input === 'file' && (
              <div>
                <input type="file" onChange={(e) => handleFileChange(col.field_key, e)} />
                {val && (
                  <p className="field-hint">
                    <a href={safeFileUrl(val) || undefined} target="_blank" rel="noreferrer">View current file</a>{' '}
                    — choose another to replace it.
                  </p>
                )}
              </div>
            )}

            {[
              'text', 'link', 'email', 'number', 'decimal', 'date', 'datetime', 'time', 'year',
              'tel', 'url', 'search', 'month', 'week', 'color',
            ].includes(meta.input) && (
              <input
                className="input"
                type={htmlInputTypeFor(meta.input)}
                value={val}
                onChange={(e) => setField(col.field_key, e.target.value)}
                placeholder={meta.input === 'link' || meta.input === 'url' ? 'https://…' : ''}
                {...inputConstraintsFor(col)}
              />
            )}
          </div>
        );
      })}
      {visibleColumns.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {columns.length === 0
            ? 'This track has no fields yet. Add a column first.'
            : 'Every field on this track is auto-generated — nothing to fill in.'}
        </p>
      )}
    </div>
  );
}

'use client';

import { useState, useRef, useEffect } from 'react';
import { fieldTypeMeta, optionList, htmlInputTypeFor, parseRangeConfig, inputConstraintsFor, clampValueForColumn, detectFileKind, openDataUrlInNewTab, formatDisplayValue } from '@/lib/fieldTypes';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export default function EntryCell({ column, value, serial, onSave }) {
  const meta = fieldTypeMeta(column.field_type);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [revealed, setRevealed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      window.alert('That file is too large. Please pick one under 2MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onSave(reader.result);
    reader.readAsDataURL(file);
  }

  useEffect(() => {
    setDraft(value ?? '');
    setExpanded(false);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current.select) inputRef.current.select();
    }
  }, [editing]);

  if (column.is_auto_increment) {
    return (
      <div className="cell-inner">
        <span className="cell-serial">{serial}</span>
      </div>
    );
  }

  if (meta.input === 'checkbox') {
    return (
      <div className="cell-inner">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onSave(e.target.checked)}
          style={{ accentColor: 'var(--accent)', width: 16, height: 16 }}
        />
      </div>
    );
  }

  if (meta.input === 'file') {
    const fileKind = value ? detectFileKind(value) : null;
    return (
      <div className="cell-inner">
        {value ? (
          <button
            type="button"
            className="cell-file-link"
            onClick={() => openDataUrlInNewTab(value)}
            title="Open in a new tab"
          >
            {fileKind === 'image' ? (
              <img src={value} alt="" className="cell-file-thumb" />
            ) : (
              <span className="cell-file-icon">📄</span>
            )}
            <span>View file</span>
          </button>
        ) : (
          <span className="cell-empty">No file</span>
        )}
        <button
          type="button"
          className="cell-reveal"
          onClick={() => fileInputRef.current?.click()}
          title={value ? 'Replace file' : 'Upload file'}
        >
          ⇧
        </button>
        <input ref={fileInputRef} type="file" onChange={handleFileChange} style={{ display: 'none' }} />
      </div>
    );
  }

  function commit() {
    setEditing(false);
    const clamped = clampValueForColumn(column, draft);
    if (clamped !== value) onSave(clamped);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && meta.input !== 'textarea') {
      commit();
    } else if (e.key === 'Enter' && e.metaKey) {
      commit();
    } else if (e.key === 'Escape') {
      setDraft(value ?? '');
      setEditing(false);
    }
  }

  if (editing) {
    if (meta.input === 'select' || meta.input === 'radio') {
      const opts = optionList(column.options);
      return (
        <div className="cell-inner">
          <select
            ref={inputRef}
            className="cell-edit-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
          >
            <option value="">—</option>
            {opts.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      );
    }
    if (meta.input === 'multiselect') {
      const opts = optionList(column.options);
      return (
        <div className="cell-inner">
          <select
            ref={inputRef}
            className="cell-edit-input"
            multiple
            value={optionList(draft)}
            onChange={(e) => setDraft(Array.from(e.target.selectedOptions).map((o) => o.value).join(','))}
            onBlur={commit}
            onKeyDown={handleKeyDown}
          >
            {opts.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      );
    }
    if (meta.input === 'textarea') {
      return (
        <div className="cell-inner">
          <textarea
            ref={inputRef}
            className="cell-edit-input"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
          />
        </div>
      );
    }
    if (meta.input === 'range') {
      const { min, max, step } = parseRangeConfig(column.field_length);
      return (
        <div className="cell-inner" style={{ gap: 8 }}>
          <input
            ref={inputRef}
            type="range"
            min={min}
            max={max}
            step={step}
            value={draft === '' ? min : draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            style={{ flex: 1 }}
          />
          <span className="input-mono" style={{ fontSize: 12 }}>{draft === '' ? min : draft}</span>
        </div>
      );
    }
    return (
      <div className="cell-inner">
        <input
          ref={inputRef}
          className={`cell-edit-input${meta.input === 'password' ? ' input-mono' : ''}`}
          type={htmlInputTypeFor(meta.input)}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          {...inputConstraintsFor(column)}
        />
      </div>
    );
  }

  // ---- display (non-editing) states ----
  if (meta.input === 'password') {
    const display = value ? (revealed ? value : '•'.repeat(Math.min(String(value).length, 14))) : '';
    return (
      <div className="cell-inner editable" onClick={() => setEditing(true)}>
        {value ? (
          <span className="cell-secret">{display}</span>
        ) : (
          <span className="cell-empty">Click to add</span>
        )}
        {value && (
          <button
            type="button"
            className="cell-reveal"
            onClick={(e) => {
              e.stopPropagation();
              setRevealed((r) => !r);
            }}
            title={revealed ? 'Hide' : 'Reveal'}
          >
            {revealed ? '🙈' : '👁'}
          </button>
        )}
      </div>
    );
  }

  if (meta.input === 'link') {
    return (
      <div className="cell-inner editable" onClick={() => setEditing(true)}>
        {value ? (
          <a
            href={/^https?:\/\//.test(value) ? value : `https://${value}`}
            target="_blank"
            rel="noreferrer"
            className="cell-link"
            onClick={(e) => e.stopPropagation()}
          >
            {value}
          </a>
        ) : (
          <span className="cell-empty">Click to add</span>
        )}
      </div>
    );
  }

  const displayValue = meta.input === 'multiselect' ? optionList(value).join(', ') : value;
  const isLongText = meta.input === 'textarea';

  if (isLongText && displayValue !== '' && displayValue !== null && displayValue !== undefined) {
    const text = String(displayValue);
    const words = text.trim().split(/\s+/);
    const canTruncate = words.length > 8;
    const shown = canTruncate && !expanded ? words.slice(0, 8).join(' ') + '…' : text;
    return (
      <div className="cell-inner editable cell-inner-clamp" onClick={() => setEditing(true)}>
        <span className="cell-text-wrap">
          {shown}
          {canTruncate && (
            <button
              type="button"
              className="cell-load-more"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
            >
              {expanded ? 'Show less' : 'Load more'}
            </button>
          )}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`cell-inner editable${isLongText ? ' cell-inner-clamp' : ''}`}
      onClick={() => setEditing(true)}
    >
      {displayValue === '' || displayValue === null || displayValue === undefined ? (
        <span className="cell-empty">Click to add</span>
      ) : (
        <>
          {meta.input === 'color' && (
            <span
              style={{
                display: 'inline-block', width: 12, height: 12, borderRadius: 3,
                background: displayValue, border: '1px solid var(--border)', flexShrink: 0,
              }}
            />
          )}
          <span className="cell-text-wrap">{String(formatDisplayValue(column, displayValue))}</span>
        </>
      )}
    </div>
  );
}

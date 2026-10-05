'use client';

import { useState } from 'react';
import { fieldTypeMeta, optionList, formatSqlType, formatDisplayValue } from '@/lib/fieldTypes';
import FilePreviewModal from '@/components/FilePreviewModal';

export function FieldValue({ column, value }) {
  const meta = fieldTypeMeta(column.field_type);
  const [revealed, setRevealed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  if (value === '' || value === null || value === undefined) {
    return <span className="cell-empty">Empty</span>;
  }

  if (meta.input === 'checkbox') {
    return <span>{value ? 'Yes' : 'No'}</span>;
  }

  if (meta.input === 'password') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span className="cell-secret">{revealed ? value : '•'.repeat(Math.min(String(value).length, 14))}</span>
        <button
          type="button"
          className="cell-reveal"
          onClick={() => setRevealed((r) => !r)}
          title={revealed ? 'Hide' : 'Reveal'}
        >
          {revealed ? '🙈' : '👁'}
        </button>
      </span>
    );
  }

  if (meta.input === 'link' || meta.input === 'url') {
    return (
      <a href={/^https?:\/\//.test(value) ? value : `https://${value}`} target="_blank" rel="noreferrer" className="cell-link">
        {value}
      </a>
    );
  }

  if (meta.input === 'file') {
    return (
      <>
        <button type="button" className="cell-link" onClick={() => setPreviewOpen(true)}>
          View file
        </button>
        {previewOpen && (
          <FilePreviewModal label={column.label} value={value} onClose={() => setPreviewOpen(false)} />
        )}
      </>
    );
  }

  if (meta.input === 'multiselect') {
    return <span>{optionList(value).join(', ')}</span>;
  }

  if (meta.input === 'color') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 14, height: 14, borderRadius: 3, background: value, border: '1px solid var(--border)' }} />
        {value}
      </span>
    );
  }

  return <span style={{ whiteSpace: 'pre-wrap' }}>{String(formatDisplayValue(column, value))}</span>;
}

export default function ViewEntryModal({ columns, entry, serial, onClose, onEdit }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Entry details</h2>
        <dl className="info-list">
          {columns.map((col) => (
            <div className="info-row" key={col.id}>
              <dt>
                {col.label}
                <span className="col-type" style={{ display: 'block', marginLeft: 0 }}>
                  {formatSqlType(col).toLowerCase()}
                </span>
              </dt>
              <dd>
                {col.is_auto_increment ? (
                  <span className="cell-serial">{serial}</span>
                ) : (
                  <FieldValue column={col} value={entry.data ? entry.data[col.field_key] : ''} />
                )}
              </dd>
            </div>
          ))}
        </dl>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          {onEdit && (
            <button type="button" className="btn btn-primary" onClick={onEdit}>Edit entry</button>
          )}
        </div>
      </div>
    </div>
  );
}

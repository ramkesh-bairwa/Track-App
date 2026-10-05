'use client';

import { fieldTypeMeta, formatSqlType } from '@/lib/fieldTypes';

export default function ColumnInfoModal({ column, onClose }) {
  const meta = fieldTypeMeta(column.field_type);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <h2>{column.label}</h2>
        <dl className="info-list">
          <div className="info-row">
            <dt>Column key</dt>
            <dd className="input-mono">{column.field_key}</dd>
          </div>
          <div className="info-row">
            <dt>Field type</dt>
            <dd>{meta.label}</dd>
          </div>
          <div className="info-row">
            <dt>MySQL type</dt>
            <dd className="input-mono">{formatSqlType(column)}</dd>
          </div>
          <div className="info-row">
            <dt>Auto increment</dt>
            <dd>{column.is_auto_increment ? 'Yes — computed row number' : 'No'}</dd>
          </div>
          {meta.supportsOptions && (
            <div className="info-row">
              <dt>Options</dt>
              <dd>{column.options || '—'}</dd>
            </div>
          )}
          <div className="info-row">
            <dt>Position</dt>
            <dd>#{(column.position ?? 0) + 1}</dd>
          </div>
        </dl>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

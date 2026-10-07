'use client';

import { useState } from 'react';
import { fieldTypeMeta } from '@/lib/fieldTypes';

const PAGE_SIZES = [10, 25, 50, 100];

export default function TrackSettingsModal({ track, columns, onClose, onSaved }) {
  const [pageSize, setPageSize] = useState(track.page_size || 25);
  const [showSerial, setShowSerial] = useState(Boolean(track.show_serial));
  const [filterableIds, setFilterableIds] = useState(
    () => new Set(columns.filter((c) => c.is_filterable).map((c) => c.id))
  );
  const [searchableIds, setSearchableIds] = useState(
    () => new Set(columns.filter((c) => c.is_searchable).map((c) => c.id))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function toggle(setFn, id) {
    setFn((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/tracks/${track.id}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page_size: Number(pageSize),
          show_serial: showSerial,
          filterable_column_ids: Array.from(filterableIds),
          searchable_column_ids: Array.from(searchableIds),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not save settings.');
      onSaved(json);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Track settings</h2>
        {error && <div className="top-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <p className="modal-section-title" style={{ paddingTop: 0, borderTop: 'none' }}>Pagination</p>
          <div className="field-group">
            <label className="field-label" htmlFor="page-size">Rows per page</label>
            <select
              id="page-size"
              className="input"
              value={pageSize}
              onChange={(e) => setPageSize(e.target.value)}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>

          <div className="field-group">
            <label className="checkbox-row">
              <input type="checkbox" checked={showSerial} onChange={(e) => setShowSerial(e.target.checked)} />
              <span>Show a <strong>Sr. No.</strong> column — numbers every row 1, 2, 3… at the start of the table.</span>
            </label>
          </div>

          <p className="modal-section-title">Columns</p>
          <p className="field-hint" style={{ marginTop: -8, marginBottom: 10 }}>
            Pick which columns show up as filters, and which ones the search box looks through.
          </p>
          {columns.length === 0 ? (
            <p className="field-hint">This track has no columns yet.</p>
          ) : (
            <div className="settings-column-list">
              <div className="settings-column-row settings-column-row-head">
                <span>Column</span>
                <span>Filter</span>
                <span>Search</span>
              </div>
              {columns.map((col) => (
                <div key={col.id} className="settings-column-row">
                  <span className="settings-column-name">
                    <span className="col-header-icon">{fieldTypeMeta(col.field_type).icon}</span>
                    {col.label}
                  </span>
                  <input
                    type="checkbox"
                    checked={filterableIds.has(col.id)}
                    onChange={() => toggle(setFilterableIds, col.id)}
                  />
                  <input
                    type="checkbox"
                    checked={searchableIds.has(col.id)}
                    onChange={() => toggle(setSearchableIds, col.id)}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

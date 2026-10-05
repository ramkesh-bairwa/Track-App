'use client';

import { useEffect, useRef, useState } from 'react';
import { EXPORT_FORMATS, exportTable } from '@/lib/exportData';

// "⬇ Export" dropdown. `getTable()` is called at click time so the export
// always reflects what's on screen right now (filters, edits, new rows).
// `pickColumns` asks which columns to include before downloading.
export default function ExportMenu({ getTable, label = '⬇ Export', className = 'btn', formats = EXPORT_FORMATS, note, pickColumns = false }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState(null); // { table, format, selected: Set<index> }
  // Column names unticked last time, so reopening the picker keeps those choices.
  const unticked = useRef(new Set());
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function run(format) {
    setBusy(format);
    setError('');
    try {
      const table = await getTable();
      if (pickColumns) {
        const selected = new Set(table.columns.map((_, i) => i).filter((i) => !unticked.current.has(table.columns[i])));
        setPicker({ table, format, selected, busy: false, error: '' });
      } else {
        await exportTable(table, format);
      }
      setOpen(false);
    } catch (err) {
      setError(err.message || 'Export failed.');
    } finally {
      setBusy(null);
    }
  }

  function toggleColumn(i) {
    setPicker((p) => {
      const selected = new Set(p.selected);
      if (selected.has(i)) selected.delete(i);
      else selected.add(i);
      return { ...p, selected };
    });
  }

  function setAll(on) {
    setPicker((p) => ({ ...p, selected: on ? new Set(p.table.columns.map((_, i) => i)) : new Set() }));
  }

  async function exportPicked() {
    const { table, format, selected } = picker;
    const keep = table.columns.map((_, i) => i).filter((i) => selected.has(i));
    unticked.current = new Set(table.columns.filter((_, i) => !selected.has(i)));
    setPicker((p) => ({ ...p, busy: true, error: '' }));
    try {
      await exportTable(
        { ...table, columns: keep.map((i) => table.columns[i]), rows: table.rows.map((r) => keep.map((i) => r[i])) },
        format
      );
      setPicker(null);
    } catch (err) {
      setPicker((p) => ({ ...p, busy: false, error: err.message || 'Export failed.' }));
    }
  }

  return (
    <div className="export-menu" ref={ref}>
      <button type="button" className={className} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {label}
      </button>
      {open && (
        <div className="export-dropdown" role="menu">
          {formats.map((f) => (
            <button key={f.key} type="button" role="menuitem" onClick={() => run(f.key)} disabled={Boolean(busy)}>
              <i className={f.icon} />
              <span>{f.label}</span>
              <small>{busy === f.key ? 'Preparing…' : f.ext}</small>
            </button>
          ))}
          {note && <p className="export-note">{note}</p>}
          {error && <p className="export-note export-error">{error}</p>}
        </div>
      )}
      {picker && (
        <div className="modal-overlay" onClick={picker.busy ? undefined : () => setPicker(null)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <h2>Choose columns</h2>
            <p className="field-hint">
              Only the ticked columns go into the {formats.find((f) => f.key === picker.format)?.label || 'export'}.
            </p>
            <div className="export-columns-toolbar">
              <span>
                {picker.selected.size} of {picker.table.columns.length} selected
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(true)}>Select all</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(false)}>Clear</button>
            </div>
            <div className="export-columns">
              {picker.table.columns.map((c, i) => (
                <label key={`${c}-${i}`} className="export-column-option">
                  <input type="checkbox" checked={picker.selected.has(i)} onChange={() => toggleColumn(i)} />
                  <span>{c}</span>
                </label>
              ))}
            </div>
            {picker.error && <div className="top-error">{picker.error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setPicker(null)} disabled={picker.busy}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={exportPicked} disabled={picker.busy || !picker.selected.size}>
                {picker.busy ? 'Preparing…' : 'Export'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

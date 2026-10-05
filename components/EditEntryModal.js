'use client';

import { useState } from 'react';
import EntryForm from '@/components/EntryForm';
import { emptyValueFor } from '@/lib/fieldTypes';

export default function EditEntryModal({ columns, entry, onClose, onSave }) {
  const initial = {};
  columns.forEach((c) => {
    const current = entry.data ? entry.data[c.field_key] : undefined;
    initial[c.field_key] = current !== undefined ? current : emptyValueFor(c.field_type);
  });
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSave(values);
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save this entry.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit entry</h2>
        {error && <div className="top-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <EntryForm columns={columns} values={values} onChange={setValues} />
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import EntryForm from '@/components/EntryForm';
import { emptyValueFor } from '@/lib/fieldTypes';

export default function AddEntryModal({ columns, onClose, onCreate }) {
  const initial = {};
  columns.forEach((c) => {
    initial[c.field_key] = emptyValueFor(c.field_type);
  });
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onCreate(values);
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save this entry.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add entry</h2>
        {error && <div className="top-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <EntryForm columns={columns} values={values} onChange={setValues} />
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || columns.length === 0}>
              {saving ? 'Saving…' : 'Save entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

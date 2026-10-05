'use client';

import { useState } from 'react';
import IconPicker from '@/components/IconPicker';

export default function EditTrackModal({ track, onClose, onSaved }) {
  const [name, setName] = useState(track.name);
  const [iconType, setIconType] = useState(track.icon_type || 'tag');
  const [icon, setIcon] = useState(track.icon || '01');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Give this track a name.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/tracks/${track.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), icon, icon_type: iconType }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not save this track.');
      onSaved({ name: name.trim(), icon, icon_type: iconType });
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit track</h2>
        {error && <div className="top-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field-group">
            <label className="field-label" htmlFor="edit-track-name">Name</label>
            <input
              id="edit-track-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field-group" style={{ marginBottom: 0 }}>
            <label className="field-label">Icon</label>
            <IconPicker
              iconType={iconType}
              iconValue={icon}
              color={track.color}
              onChange={(type, value) => {
                setIconType(type);
                setIcon(value);
              }}
            />
          </div>
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

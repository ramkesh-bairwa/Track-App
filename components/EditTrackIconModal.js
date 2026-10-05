'use client';

import { useState } from 'react';
import IconPicker from '@/components/IconPicker';

export default function EditTrackIconModal({ track, onClose, onSaved }) {
  const [iconType, setIconType] = useState(track.icon_type || 'tag');
  const [icon, setIcon] = useState(track.icon || '01');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/tracks/${track.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icon, icon_type: iconType }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not save this icon.');
      onSaved({ icon, icon_type: iconType });
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <h2>Track icon</h2>
        {error && <div className="top-error">{error}</div>}
        <IconPicker
          iconType={iconType}
          iconValue={icon}
          color={track.color}
          onChange={(type, value) => {
            setIconType(type);
            setIcon(value);
          }}
        />
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save icon'}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';

const FONT_FAMILIES = [
  { label: 'Default', value: '' },
  { label: 'Sans (Plex Sans)', value: 'IBM Plex Sans, sans-serif' },
  { label: 'Mono (Plex Mono)', value: 'IBM Plex Mono, monospace' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
];

export default function NotePageStyleModal({ style, onClose, onSave }) {
  const [background, setBackground] = useState(style?.background || '#ffffff');
  const [color, setColor] = useState(style?.color || '#1a1d24');
  const [fontFamily, setFontFamily] = useState(style?.fontFamily || '');
  const [fontSize, setFontSize] = useState(style?.fontSize || '16px');
  const [margin, setMargin] = useState(style?.margin ?? 0);
  const [padding, setPadding] = useState(style?.padding ?? 24);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave({
      background,
      color,
      fontFamily,
      fontSize,
      margin: Number(margin) || 0,
      padding: Number(padding) || 0,
    });
    setSaving(false);
    onClose();
  }

  function handleReset() {
    setBackground('#ffffff');
    setColor('#1a1d24');
    setFontFamily('');
    setFontSize('16px');
    setMargin(0);
    setPadding(24);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <h2>Page style</h2>
        <p className="field-hint" style={{ marginBottom: 14 }}>
          Background, default text color/font, margin and padding for this note's page.
        </p>

        <div className="field-group">
          <label className="field-label">Background color</label>
          <input type="color" className="input note-color-input" value={background} onChange={(e) => setBackground(e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label">Text color</label>
          <input type="color" className="input note-color-input" value={color} onChange={(e) => setColor(e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label">Font family</label>
          <select className="input" value={fontFamily} onChange={(e) => setFontFamily(e.target.value)}>
            {FONT_FAMILIES.map((f) => (
              <option key={f.label} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
        <div className="field-group">
          <label className="field-label">Font size</label>
          <input className="input" value={fontSize} onChange={(e) => setFontSize(e.target.value)} placeholder="e.g. 16px" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field-group" style={{ marginBottom: 0 }}>
            <label className="field-label">Margin (px)</label>
            <input type="number" className="input" min="0" value={margin} onChange={(e) => setMargin(e.target.value)} />
          </div>
          <div className="field-group" style={{ marginBottom: 0 }}>
            <label className="field-label">Padding (px)</label>
            <input type="number" className="input" min="0" value={padding} onChange={(e) => setPadding(e.target.value)} />
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={handleReset}>Reset</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save style'}
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { applyChromeColorLive } from '@/lib/color';

const SIDEBAR_SELECTOR = '.sidebar';
const TOPBAR_SELECTOR = '.topbar, .mobile-topbar';

const PRESET_COLORS = [
  // Neutral darks
  '#181c24', '#1f2430', '#12151a', '#0d1117', '#22272e', '#2d333b', '#202123', '#1c1c1e',
  // Dark colored
  '#10263f', '#1b2a4a', '#0f2d3a', '#142e1f', '#1a2b28', '#23202e', '#2a1a2e', '#2b1d12', '#3a2226', '#2e2a10',
  // Rich / brand
  '#0b3d2e', '#1e3a8a', '#4c1d95', '#7c2d12', '#334155',
  // Neutral lights
  '#ffffff', '#f4f5f7', '#f8fafc', '#eceff4',
  // Light tints
  '#eef2ff', '#fdf2e9', '#eafaf3', '#fef3f2', '#f0f7ff', '#f5f3ff', '#fffbea', '#f0fdf4',
];

function ColorField({ label, value, onChange, hint }) {
  return (
    <div className="field-group">
      <label className="field-label">{label}</label>
      <div className="appearance-swatch-row">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`appearance-swatch${value?.toLowerCase() === c.toLowerCase() ? ' active' : ''}`}
            style={{ background: c }}
            onClick={() => onChange(c)}
            title={c}
          />
        ))}
        <label className="appearance-swatch appearance-swatch-custom" title="Pick a custom color">
          +
          <input type="color" value={value || '#181c24'} onChange={(e) => onChange(e.target.value)} />
        </label>
        {value && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>
            Use default
          </button>
        )}
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export default function AppearanceModal({ user, onClose, onSaved }) {
  const originalSidebar = useRef(user?.sidebar_color || null);
  const originalTopbar = useRef(user?.topbar_color || null);
  const [sidebarColor, setSidebarColor] = useState(originalSidebar.current);
  const [topbarColor, setTopbarColor] = useState(originalTopbar.current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savedRef = useRef(false);

  // Live preview: reflect the picked colors on the real sidebar/topbar
  // immediately, before the user saves.
  useEffect(() => {
    applyChromeColorLive(SIDEBAR_SELECTOR, sidebarColor);
  }, [sidebarColor]);

  useEffect(() => {
    applyChromeColorLive(TOPBAR_SELECTOR, topbarColor);
  }, [topbarColor]);

  // If the modal is closed without saving, revert the live preview back to
  // whatever was actually saved before this modal opened.
  useEffect(() => {
    return () => {
      if (!savedRef.current) {
        applyChromeColorLive(SIDEBAR_SELECTOR, originalSidebar.current);
        applyChromeColorLive(TOPBAR_SELECTOR, originalTopbar.current);
      }
    };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/auth/appearance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sidebar_color: sidebarColor, topbar_color: topbarColor }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not save appearance settings.');
      savedRef.current = true;
      onSaved(json.user);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Appearance</h2>
        {error && <div className="top-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <ColorField
            label="Left sidebar color"
            value={sidebarColor}
            onChange={setSidebarColor}
            hint="Applies to the tracks sidebar, including the mobile menu."
          />
          <ColorField
            label="Top bar color"
            value={topbarColor}
            onChange={setTopbarColor}
            hint="Applies to the bar with your profile menu at the top."
          />
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save appearance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

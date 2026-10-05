'use client';

import { useState } from 'react';
import { MENU_ITEMS } from '@/lib/menuItems';

// Profile → Accessibility: tick the menu items you want to see in the
// sidebar and top bar. Hidden pages still open from their links.
export default function AccessibilityModal({ user, onClose, onSaved }) {
  const items = MENU_ITEMS.filter((m) => !m.adminOnly || user?.is_admin);
  const [hidden, setHidden] = useState(() => new Set(user?.hidden_menus || []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function toggle(id) {
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/auth/menus', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden: [...hidden] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not save your menu choices.');
      onSaved(json.user);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const shownCount = items.filter((m) => !hidden.has(m.id)).length;

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Accessibility</h2>
        <p className="field-hint" style={{ marginTop: -6 }}>
          Choose which options appear in your menus. Unticked ones are hidden only for you — their pages still work.
        </p>
        {error && <div className="top-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field-group">
            <div className="access-list-head">
              <span className="field-label">Menu items · {shownCount} of {items.length} shown</span>
              <span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHidden(new Set())}>Show all</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHidden(new Set(items.map((m) => m.id)))}>Hide all</button>
              </span>
            </div>
            <div className="access-scroll">
              {['Menus', 'Tools'].map((group) => (
                <div key={group}>
                  <div className="access-group">{group}</div>
                  <div className="access-list">
                    {items.filter((m) => (m.group || 'Menus') === group).map((m) => (
                      <label key={m.id} className="access-item">
                        <input type="checkbox" checked={!hidden.has(m.id)} onChange={() => toggle(m.id)} />
                        <i className={`fa-solid ${m.icon}`} />
                        <span className="access-item-label">{m.label}</span>
                        <span className="access-item-where">{m.where}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

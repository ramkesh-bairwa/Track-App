'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { TRACK_VIEW_TYPES, DEFAULT_VIEW_TYPE } from '@/lib/trackTypes';
import { TRACK_TEMPLATES, TEMPLATE_GROUPS, findTemplate } from '@/lib/trackTemplates';
import { fieldTypeMeta } from '@/lib/fieldTypes';

const CUSTOM = 'custom';

// Two-step "New track / sub-track" flow:
//  1. pick how entries are laid out (plain text, tabular, grid, doc)
//  2. give it a title and start from a category template — or "Customize",
//     which hands off to the full drag-and-drop builder page.
export default function NewTrackModal({ parentId, parentName, onClose }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [viewType, setViewType] = useState(DEFAULT_VIEW_TYPE);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [showSerial, setShowSerial] = useState(true);
  const [templateId, setTemplateId] = useState(CUSTOM);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('all');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const template = templateId === CUSTOM ? null : findTemplate(templateId);
  const isSub = Boolean(parentId);
  const noun = isSub ? 'sub-track' : 'track';

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !saving) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const visibleTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return TRACK_TEMPLATES.filter((t) => {
      if (group !== 'all' && t.group !== group) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.groupLabel.toLowerCase().includes(q) ||
        t.columns.some((c) => c.label.toLowerCase().includes(q))
      );
    });
  }, [search, group]);

  function pickTemplate(id) {
    const next = id === CUSTOM ? null : findTemplate(id);
    // Only auto-fill the title if the user hasn't typed their own.
    if (!name.trim() || (template && name === template.name)) {
      setName(next ? next.name : '');
    }
    if (!description.trim() || (template && description === template.description)) {
      setDescription(next ? next.description : '');
    }
    setTemplateId(id);
    setError('');
  }

  function openBuilder() {
    const params = new URLSearchParams();
    if (parentId) params.set('parent', String(parentId));
    if (parentName) params.set('parentName', parentName);
    params.set('type', viewType);
    if (name.trim()) params.set('name', name.trim());
    if (description.trim()) params.set('description', description.trim());
    if (template) params.set('template', template.id);
    if (!showSerial) params.set('serial', '0');
    router.push(`/dashboard/tracks/new?${params.toString()}`);
    onClose();
  }

  async function createFromTemplate() {
    setError('');
    if (!name.trim()) {
      setError(`Give this ${noun} a title.`);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          icon: template.icon,
          icon_type: 'class',
          color: template.color,
          parent_id: parentId || null,
          view_type: viewType,
          show_serial: showSerial,
          columns: template.columns.map((c) => ({
            label: c.label,
            field_type: c.field_type,
            options: c.options,
            field_length: fieldTypeMeta(c.field_type).defaultLength || '',
            auto_increment: c.auto_increment,
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || `Could not create the ${noun}.`);
        setSaving(false);
        return;
      }
      router.push(`/dashboard/tracks/${json.trackUuid}`);
      router.refresh();
      onClose();
    } catch {
      setError('Something went wrong. Try again.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onClose}>
      <div className="modal modal-lg new-track-modal" onClick={(e) => e.stopPropagation()}>
        <div className="new-track-head">
          <div>
            <h2>
              {isSub ? `New sub-track${parentName ? ` under ${parentName}` : ''}` : 'New track'}
            </h2>
            <p className="new-track-steps">
              <span className={step === 1 ? 'active' : 'done'}>1 · Type</span>
              <span className="new-track-steps-sep">›</span>
              <span className={step === 2 ? 'active' : ''}>2 · Title &amp; template</span>
            </p>
          </div>
          <button type="button" className="new-track-close" onClick={onClose} disabled={saving} title="Close">
            ×
          </button>
        </div>

        {step === 1 ? (
          <>
            <p className="new-track-lead">How should entries in this {noun} be shown? You can switch later.</p>
            <div className="new-track-types">
              {TRACK_VIEW_TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`new-track-type${viewType === t.key ? ' selected' : ''}`}
                  onClick={() => setViewType(t.key)}
                  onDoubleClick={() => {
                    setViewType(t.key);
                    setStep(2);
                  }}
                  aria-pressed={viewType === t.key}
                >
                  <span className="new-track-type-icon"><i className={t.icon} /></span>
                  <strong>{t.label}</strong>
                  <small>{t.hint}</small>
                  {t.key === DEFAULT_VIEW_TYPE && <span className="new-track-type-badge">Default</span>}
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => setStep(2)}>Next ›</button>
            </div>
          </>
        ) : (
          <>
            <div className="new-track-fields">
              <div className="field-group" style={{ marginBottom: 0 }}>
                <label className="field-label" htmlFor="new-track-name">Title</label>
                <input
                  id="new-track-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Server credentials, Reading list, Project X"
                  autoFocus
                />
              </div>
              <div className="field-group" style={{ marginBottom: 0 }}>
                <label className="field-label" htmlFor="new-track-desc">Description (optional)</label>
                <input
                  id="new-track-desc"
                  className="input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this is for"
                />
              </div>
              <label className="checkbox-row" style={{ marginTop: 10 }}>
                <input type="checkbox" checked={showSerial} onChange={(e) => setShowSerial(e.target.checked)} />
                <span>Add a <strong>Sr. No.</strong> column — numbers every row 1, 2, 3… at the start of the table.</span>
              </label>
            </div>

            <div className="new-track-picker-head">
              <label className="field-label" style={{ margin: 0 }}>
                Start from a category <span className="new-track-count">({TRACK_TEMPLATES.length} templates)</span>
              </label>
              <input
                type="search"
                className="input input-sm new-track-search"
                placeholder="Search categories — e.g. payment, SSH, recipes…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="new-track-groups">
              <button
                type="button"
                className={`new-track-group${group === 'all' ? ' active' : ''}`}
                onClick={() => setGroup('all')}
              >
                All
              </button>
              {TEMPLATE_GROUPS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`new-track-group${group === g.id ? ' active' : ''}`}
                  onClick={() => setGroup(g.id)}
                >
                  {g.label}
                </button>
              ))}
            </div>

            <div className="new-track-templates">
              <button
                type="button"
                className={`new-track-template new-track-template-custom${templateId === CUSTOM ? ' selected' : ''}`}
                onClick={() => pickTemplate(CUSTOM)}
              >
                <span className="new-track-template-icon"><i className="fa-solid fa-wand-magic-sparkles" /></span>
                <span className="new-track-template-text">
                  <strong>Customize</strong>
                  <small>Build your own fields from scratch</small>
                </span>
              </button>
              {visibleTemplates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`new-track-template${templateId === t.id ? ' selected' : ''}`}
                  onClick={() => pickTemplate(t.id)}
                  title={t.description}
                >
                  <span className="new-track-template-icon" style={{ background: `${t.color}22`, color: t.color }}>
                    <i className={t.icon} />
                  </span>
                  <span className="new-track-template-text">
                    <strong>{t.name}</strong>
                    <small>{t.description}</small>
                  </span>
                </button>
              ))}
              {visibleTemplates.length === 0 && (
                <p className="new-track-empty">No categories match “{search.trim()}”. Try another word, or pick Customize.</p>
              )}
            </div>

            <div className="new-track-preview">
              {template ? (
                <>
                  <span className="new-track-preview-label">{template.columns.length} fields:</span>
                  {template.columns.map((c) => (
                    <span key={c.label} className="new-track-field-chip" title={fieldTypeMeta(c.field_type).label}>
                      <span className="new-track-field-chip-icon">{fieldTypeMeta(c.field_type).icon}</span>
                      {c.label}
                    </span>
                  ))}
                </>
              ) : (
                <span className="new-track-preview-label">
                  You&apos;ll add fields yourself on the next screen by dragging them onto the form.
                </span>
              )}
            </div>

            {error && <div className="top-error" style={{ marginTop: 12 }}>{error}</div>}

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setStep(1)} disabled={saving}>
                ‹ Back
              </button>
              {template ? (
                <>
                  <button type="button" className="btn" onClick={openBuilder} disabled={saving}>
                    Edit fields first
                  </button>
                  <button type="button" className="btn btn-primary" onClick={createFromTemplate} disabled={saving}>
                    {saving ? 'Creating…' : `Create ${noun}`}
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-primary" onClick={openBuilder}>
                  Continue to builder ›
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// A trigger (button styled however the caller wants) that opens the modal.
export function NewTrackButton({ parentId, parentName, className, title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} title={title} onClick={() => setOpen(true)}>
        {children}
      </button>
      {/* Portaled to <body> so a trigger inside the sidebar (its own stacking
          context, and a transformed drawer on mobile) can't clip the overlay. */}
      {open &&
        createPortal(
          <NewTrackModal parentId={parentId} parentName={parentName} onClose={() => setOpen(false)} />,
          document.body
        )}
    </>
  );
}

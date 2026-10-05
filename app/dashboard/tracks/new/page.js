'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ColumnBuilder, { makeColumn } from '@/components/ColumnBuilder';
import { TRACK_VIEW_TYPES, normalizeViewType } from '@/lib/trackTypes';
import { findTemplate } from '@/lib/trackTemplates';
import IconPicker from '@/components/IconPicker';

const COLORS = ['#35C2A6', '#E8A33D', '#6C7BFF', '#E5646B', '#4FA6E8', '#B47FE8'];

export default function NewTrackPage() {
  return (
    <Suspense fallback={null}>
      <NewTrackForm />
    </Suspense>
  );
}

function NewTrackForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const parentId = searchParams.get('parent');
  const parentName = searchParams.get('parentName');
  // Arriving from the "New track" modal: carry over the chosen type, title
  // and (if "Edit fields first" was used) the template's fields and look.
  const template = findTemplate(searchParams.get('template'));
  const [viewType, setViewType] = useState(normalizeViewType(searchParams.get('type')));
  const [name, setName] = useState(searchParams.get('name') || '');
  const [description, setDescription] = useState(searchParams.get('description') || '');
  const [iconType, setIconType] = useState(template ? 'class' : 'tag');
  const [icon, setIcon] = useState(template ? template.icon : '01');
  const [color, setColor] = useState(template ? template.color : COLORS[0]);
  const [columns, setColumns] = useState(() =>
    template
      ? template.columns.map((c) => ({
          ...makeColumn(c.field_type),
          label: c.label,
          options: c.options,
          auto_increment: c.auto_increment,
        }))
      : []
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Give this track a name.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          icon,
          icon_type: iconType,
          color,
          parent_id: parentId || null,
          view_type: viewType,
          columns: columns.map((c) => ({
            label: c.label,
            field_type: c.field_type,
            options: c.options,
            field_length: c.field_length,
            auto_increment: c.auto_increment,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Could not create the track.');
        setSaving(false);
        return;
      }
      router.push(`/dashboard/tracks/${json.trackUuid}`);
      router.refresh();
    } catch {
      setError('Something went wrong. Try again.');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="page-head">
        <div>
          <h1>{parentId ? `New sub-track${parentName ? ` under ${parentName}` : ''}` : 'New track'}</h1>
          <p>Name it, then build its structure by dragging fields onto the form.</p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-ghost" onClick={() => router.back()}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Creating…' : 'Create track'}
          </button>
        </div>
      </div>

      {error && <div className="top-error">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 20 }}>
        <div className="field-group" style={{ marginBottom: 0 }}>
          <label className="field-label" htmlFor="name">Track name</label>
          <input
            id="name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Server credentials, Reading list, Project X"
            autoFocus
          />
        </div>
        <div className="field-group" style={{ marginBottom: 0 }}>
          <label className="field-label" htmlFor="description">Description (optional)</label>
          <textarea
            id="description"
            className="input"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this track is for"
          />
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">Type</label>
        <div className="tabs track-type-tabs" role="radiogroup" aria-label="Track type">
          {TRACK_VIEW_TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={viewType === t.key}
              className={`tab-btn${viewType === t.key ? ' active' : ''}`}
              onClick={() => setViewType(t.key)}
              title={t.hint}
            >
              <i className={t.icon} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, marginBottom: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <label className="field-label">Icon</label>
          <IconPicker
            iconType={iconType}
            iconValue={icon}
            color={color}
            onChange={(type, value) => {
              setIconType(type);
              setIcon(value);
            }}
          />
        </div>
        <div>
          <label className="field-label">Color</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setColor(c)}
                title={c}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  background: c,
                  border: color === c ? '2px solid #fff' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <label className="field-label" style={{ marginBottom: 10 }}>Structure</label>
      <ColumnBuilder columns={columns} onChange={setColumns} />
    </form>
  );
}

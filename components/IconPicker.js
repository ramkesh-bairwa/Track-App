'use client';

import { useMemo, useRef, useState } from 'react';
import { DEFAULT_ICON_TAGS } from '@/lib/icon';
import { FA_SOLID_ICONS } from '@/lib/faIcons';

const MAX_ICON_IMAGE_BYTES = 1.5 * 1024 * 1024;
const ICON_RESULTS_LIMIT = 200;

// Controlled icon editor: browse 1,300+ icon-font glyphs, pick a short text/
// emoji tag, upload an image, or paste a custom icon-font class. `iconType`/
// `iconValue`/`color` are the committed selection; onChange(type, value)
// commits a new one immediately.
export default function IconPicker({ iconType, iconValue, color, onChange }) {
  const [tab, setTab] = useState(iconType === 'tag' ? 'tag' : iconType === 'image' ? 'image' : 'icons');
  const [error, setError] = useState('');
  const [iconSearch, setIconSearch] = useState('');
  const [customClass, setCustomClass] = useState(iconType === 'class' ? iconValue : '');
  const fileInputRef = useRef(null);

  const iconMatches = useMemo(() => {
    const q = iconSearch.trim().toLowerCase();
    const source = q ? FA_SOLID_ICONS.filter((name) => name.includes(q)) : FA_SOLID_ICONS;
    return source.slice(0, ICON_RESULTS_LIMIT);
  }, [iconSearch]);

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    if (file.size > MAX_ICON_IMAGE_BYTES) {
      setError('That image is too large. Please pick one under 1.5MB.');
      return;
    }
    setError('');
    const reader = new FileReader();
    reader.onload = () => onChange('image', reader.result);
    reader.readAsDataURL(file);
  }

  const previewType = tab === iconType ? iconType : tab === 'tag' ? 'tag' : iconType;
  const previewValue = tab === iconType ? iconValue : tab === 'tag' ? iconValue : iconType === 'image' ? iconValue : '';

  return (
    <div className="icon-picker">
      <div className="icon-picker-preview" style={{ background: `${color}22`, color }}>
        {previewType === 'image' && previewValue ? (
          <img src={previewValue} alt="" className="track-icon-img" />
        ) : previewType === 'class' && previewValue ? (
          <i className={previewValue} />
        ) : (
          previewValue || '01'
        )}
      </div>

      <div className="icon-picker-tabs">
        <button
          type="button"
          className={`icon-picker-tab${tab === 'icons' ? ' active' : ''}`}
          onClick={() => setTab('icons')}
        >
          Icons
        </button>
        <button
          type="button"
          className={`icon-picker-tab${tab === 'tag' ? ' active' : ''}`}
          onClick={() => setTab('tag')}
        >
          Text tag
        </button>
        <button
          type="button"
          className={`icon-picker-tab${tab === 'image' ? ' active' : ''}`}
          onClick={() => setTab('image')}
        >
          Upload image
        </button>
        <button
          type="button"
          className={`icon-picker-tab${tab === 'class' ? ' active' : ''}`}
          onClick={() => setTab('class')}
        >
          Custom class
        </button>
      </div>

      {error && <p className="field-hint" style={{ color: 'var(--danger)' }}>{error}</p>}

      {tab === 'icons' && (
        <div>
          <input
            type="search"
            className="input input-sm"
            value={iconSearch}
            onChange={(e) => setIconSearch(e.target.value)}
            placeholder={`Search ${FA_SOLID_ICONS.length.toLocaleString()} icons…`}
          />
          <div className="icon-picker-grid icon-picker-grid-scroll">
            {iconMatches.map((name) => {
              const cls = `fa-solid fa-${name}`;
              return (
                <button
                  type="button"
                  key={name}
                  className={`icon-picker-swatch${iconType === 'class' && iconValue === cls ? ' selected' : ''}`}
                  onClick={() => onChange('class', cls)}
                  title={name}
                  style={{ color }}
                >
                  <i className={cls} />
                </button>
              );
            })}
            {iconMatches.length === 0 && (
              <p className="field-hint">No icons match “{iconSearch}”.</p>
            )}
          </div>
          {iconMatches.length === ICON_RESULTS_LIMIT && (
            <p className="field-hint">Showing the first {ICON_RESULTS_LIMIT} matches — keep typing to narrow it down.</p>
          )}
        </div>
      )}

      {tab === 'tag' && (
        <div className="icon-picker-grid">
          {DEFAULT_ICON_TAGS.map((tagVal) => (
            <button
              type="button"
              key={tagVal}
              className={`icon-picker-swatch${iconType === 'tag' && iconValue === tagVal ? ' selected' : ''}`}
              onClick={() => onChange('tag', tagVal)}
              style={{ color }}
            >
              {tagVal}
            </button>
          ))}
        </div>
      )}

      {tab === 'image' && (
        <div>
          <button type="button" className="btn btn-sm" onClick={() => fileInputRef.current?.click()}>
            Choose image
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          <p className="field-hint">PNG, JPG, WEBP, GIF, or SVG — under 1.5MB.</p>
        </div>
      )}

      {tab === 'class' && (
        <div>
          <input
            className="input input-mono"
            value={customClass}
            onChange={(e) => {
              setCustomClass(e.target.value);
              onChange('class', e.target.value);
            }}
            placeholder="e.g. fa-brands fa-github"
          />
          <p className="field-hint">
            For anything not in the Icons tab — e.g. brand logos. Font Awesome is loaded for this to render.
          </p>
        </div>
      )}
    </div>
  );
}

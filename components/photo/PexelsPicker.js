'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function pexelsProxy(url) {
  return `/api/pexels/image?src=${encodeURIComponent(url)}`;
}

// Loads a picked Pexels photo as a same-origin <img> ready for a canvas.
export function loadPexelsImage(photo, size = 'large') {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load that Pexels photo.'));
    img.src = pexelsProxy(size === 'original' ? photo.original : photo.large);
  });
}

// Search Pexels stock photos. `multiple` lets the collage pick several at once.
// Pexels' licence is free to use; they ask for a credit, which we show here.
export default function PexelsPicker({ multiple = false, max = 20, onPick, onClose, title = 'Stock photos from Pexels' }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [orientation, setOrientation] = useState('');
  const [photos, setPhotos] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [setup, setSetup] = useState(false);
  const [selected, setSelected] = useState([]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const load = useCallback(async (nextQuery, nextPage, nextOrientation, append) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(nextPage) });
      if (nextQuery) params.set('q', nextQuery);
      if (nextOrientation) params.set('orientation', nextOrientation);
      const res = await fetch(`/api/pexels/search?${params}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSetup(Boolean(json.setup));
        throw new Error(json.error || 'Pexels search failed.');
      }
      setPhotos((prev) => (append ? [...prev, ...json.photos] : json.photos));
      setHasMore(json.hasMore);
      setPage(nextPage);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load('', 1, '', false);
  }, [load]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function toggle(photo) {
    if (!multiple) {
      onPick([photo]);
      onClose();
      return;
    }
    setSelected((s) => (s.some((p) => p.id === photo.id) ? s.filter((p) => p.id !== photo.id) : s.length >= max ? s : [...s, photo]));
  }

  if (!mounted) return null;
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg pexels-modal" onClick={(e) => e.stopPropagation()}>
        <div className="new-track-head">
          <div>
            <h2>{title}</h2>
            <p className="new-track-steps">Free to use. Photos provided by <a href="https://www.pexels.com" target="_blank" rel="noreferrer">Pexels</a>.</p>
          </div>
          <button type="button" className="new-track-close" onClick={onClose} title="Close">×</button>
        </div>
        <form
          className="pexels-search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q.trim());
            load(q.trim(), 1, orientation, false);
          }}
        >
          <input className="input" placeholder="Search photos — e.g. mountains, office, coffee, wedding" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <select
            className="input"
            value={orientation}
            onChange={(e) => {
              setOrientation(e.target.value);
              if (query) load(query, 1, e.target.value, false);
            }}
          >
            <option value="">Any shape</option>
            <option value="landscape">Landscape</option>
            <option value="portrait">Portrait</option>
            <option value="square">Square</option>
          </select>
          <button type="submit" className="btn btn-primary">Search</button>
        </form>

        {error && (
          <div className="top-error">
            {error}
            {setup && (
              <div className="pexels-setup">
                1. Get a free API key at <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer">pexels.com/api</a>
                <br />2. Add a line <code>PEXELS_API_KEY=your-key</code> to the <code>.env</code> file
                <br />3. Restart the server (<code>npm run dev</code>)
              </div>
            )}
          </div>
        )}

        <div className="pexels-grid">
          {photos.map((p) => {
            const isSel = selected.some((s) => s.id === p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={`pexels-item${isSel ? ' selected' : ''}`}
                style={{ background: p.color || 'var(--panel-raised)' }}
                onClick={() => toggle(p)}
                title={`${p.alt || 'Photo'} — by ${p.photographer}`}
              >
                <img src={p.thumb} alt={p.alt} loading="lazy" />
                <span className="pexels-credit">{p.photographer}</span>
                {multiple && <span className="pexels-check">{isSel ? selected.findIndex((s) => s.id === p.id) + 1 : ''}</span>}
              </button>
            );
          })}
          {!loading && photos.length === 0 && !error && <p className="task-muted">No photos found.</p>}
        </div>
        <div className="modal-actions">
          {hasMore && (
            <button type="button" className="btn" style={{ marginRight: 'auto' }} disabled={loading} onClick={() => load(query, page + 1, orientation, true)}>
              {loading ? 'Loading…' : 'Load more'}
            </button>
          )}
          {loading && !hasMore && <span className="task-muted" style={{ marginRight: 'auto' }}>Loading…</span>}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          {multiple && (
            <button type="button" className="btn btn-primary" disabled={selected.length === 0} onClick={() => { onPick(selected); onClose(); }}>
              Add {selected.length || ''} photo{selected.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

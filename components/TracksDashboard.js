'use client';

import { useMemo, useState } from 'react';
import TrackCard from '@/components/TrackCard';
import { NewTrackButton } from '@/components/NewTrackModal';

function pathLabel(byId, track) {
  const parts = [];
  let current = track.parent_id ? byId.get(track.parent_id) : null;
  while (current) {
    parts.unshift(current.name);
    current = current.parent_id ? byId.get(current.parent_id) : null;
  }
  return parts.join(' / ');
}

export default function TracksDashboard({ tracks }) {
  const [search, setSearch] = useState('');
  const q = search.trim();
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);

  const visibleTracks = useMemo(() => {
    if (!q) return tracks.filter((t) => t.parent_id == null);
    const ql = q.toLowerCase();
    return tracks.filter((t) => t.name.toLowerCase().includes(ql));
  }, [tracks, q]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Your activity</h1>
          <p>Every track you keep, and what you've logged in it.</p>
        </div>
        <div className="page-head-actions">
          <NewTrackButton className="btn btn-primary">＋ New track</NewTrackButton>
        </div>
      </div>

      {tracks.length > 0 && (
        <input
          type="search"
          className="input dashboard-search-input"
          placeholder="Search all tracks, at every level…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      {tracks.length === 0 ? (
        <div className="empty-state">
          <h3>Nothing tracked yet</h3>
          <p>Create your first track — credentials, links, a project log, anything you want a record of.</p>
          <NewTrackButton className="btn btn-primary">＋ New track</NewTrackButton>
        </div>
      ) : q && visibleTracks.length === 0 ? (
        <div className="empty-state">
          <h3>No matches</h3>
          <p>No tracks match “{q}”, at any level.</p>
        </div>
      ) : (
        <div className="track-grid">
          {visibleTracks.map((t) => (
            <TrackCard key={t.id} track={t} query={q} trail={q ? pathLabel(byId, t) : ''} />
          ))}
        </div>
      )}
    </>
  );
}

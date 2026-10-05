'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import TrackIcon from '@/components/TrackIcon';
import EditTrackModal from '@/components/EditTrackModal';

export function highlightMatch(name, query) {
  if (!query) return name;
  const idx = name.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return name;
  return (
    <>
      {name.slice(0, idx)}
      <mark className="track-card-highlight">{name.slice(idx, idx + query.length)}</mark>
      {name.slice(idx + query.length)}
    </>
  );
}

// The card shown in every track grid (dashboard, sub-tracks). Double-clicking
// its title opens a modal to rename it and change its icon without leaving
// the grid; a single click still navigates into the track as normal.
export default function TrackCard({ track, query, trail }) {
  const router = useRouter();
  const [showEdit, setShowEdit] = useState(false);
  const [override, setOverride] = useState(null);
  const t = override ? { ...track, ...override } : track;

  return (
    <>
      <Link href={`/dashboard/tracks/${t.uuid}`} className="track-card">
        {trail && <span className="track-card-path">{trail}</span>}
        <div className="track-card-top">
          <span className="track-card-icon" style={{ background: `${t.color}22`, color: t.color }}>
            <TrackIcon track={t} />
          </span>
          <h3
            onClick={(e) => e.preventDefault()}
            onDoubleClick={(e) => {
              e.preventDefault();
              setShowEdit(true);
            }}
            title="Double-click to rename or change icon"
          >
            {query ? highlightMatch(t.name, query) : t.name}
          </h3>
        </div>
        <p>{t.description || 'No description yet.'}</p>
        <div className="track-card-meta">
          <span>{t.column_count} column{t.column_count === 1 ? '' : 's'}</span>
          <span>{t.entry_count} entr{t.entry_count === 1 ? 'y' : 'ies'}</span>
          {t.child_count > 0 && <span>{t.child_count} sub-track{t.child_count === 1 ? '' : 's'}</span>}
        </div>
      </Link>
      {showEdit && (
        <EditTrackModal
          track={t}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => {
            setOverride((prev) => ({ ...prev, ...updated }));
            router.refresh();
          }}
        />
      )}
    </>
  );
}

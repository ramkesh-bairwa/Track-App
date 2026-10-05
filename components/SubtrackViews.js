'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import TrackIcon from '@/components/TrackIcon';
import TrackCard, { highlightMatch } from '@/components/TrackCard';
import { DATE_LOCALE } from '@/lib/dateLocale';

export const SUBTRACK_VIEWS = [
  { key: 'cards', label: 'Cards', title: 'Card grid' },
  { key: 'list', label: 'List', title: 'Plain list' },
  { key: 'table', label: 'Table', title: 'Tabular view' },
  { key: 'compact', label: 'Compact', title: 'Compact chips' },
];

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function Icon({ track }) {
  return (
    <span className="track-card-icon" style={{ background: `${track.color}22`, color: track.color }}>
      <TrackIcon track={track} />
    </span>
  );
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(DATE_LOCALE);
}

// Renders a set of sub-tracks in the chosen layout. "cards" is the original
// grid (with double-click rename); the others are denser read-only layouts.
export default function SubtrackViews({ tracks, view, query }) {
  const router = useRouter();

  if (view === 'list') {
    return (
      <ul className="subtrack-list">
        {tracks.map((t) => (
          <li key={t.id}>
            <Link href={`/dashboard/tracks/${t.uuid}`} className="subtrack-list-row">
              <Icon track={t} />
              <span className="subtrack-list-main">
                <span className="subtrack-list-name">{highlightMatch(t.name, query)}</span>
                {t.description && <span className="subtrack-list-desc">{t.description}</span>}
              </span>
              <span className="subtrack-list-meta">
                {plural(t.entry_count, 'entry', 'entries')}
                {t.child_count > 0 && ` · ${plural(t.child_count, 'sub-track', 'sub-tracks')}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  if (view === 'table') {
    return (
      <div className="subtrack-table-wrap">
        <table className="data-table subtrack-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th className="num">Columns</th>
              <th className="num">Entries</th>
              <th className="num">Sub-tracks</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t) => (
              <tr key={t.id} onClick={() => router.push(`/dashboard/tracks/${t.uuid}`)}>
                <td>
                  <Link href={`/dashboard/tracks/${t.uuid}`} className="subtrack-table-name">
                    <Icon track={t} />
                    {highlightMatch(t.name, query)}
                  </Link>
                </td>
                <td className="subtrack-table-desc">{t.description || '—'}</td>
                <td className="num">{t.column_count}</td>
                <td className="num">{t.entry_count}</td>
                <td className="num">{t.child_count}</td>
                <td>{formatDate(t.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (view === 'compact') {
    return (
      <div className="subtrack-chips">
        {tracks.map((t) => (
          <Link
            key={t.id}
            href={`/dashboard/tracks/${t.uuid}`}
            className="subtrack-chip"
            title={t.description || t.name}
          >
            <Icon track={t} />
            <span>{highlightMatch(t.name, query)}</span>
            <span className="subtrack-chip-count">{t.entry_count}</span>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="track-grid">
      {tracks.map((t) => (
        <TrackCard key={t.id} track={t} query={query} />
      ))}
    </div>
  );
}

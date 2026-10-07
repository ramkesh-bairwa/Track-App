'use client';

import Link from 'next/link';
import './activity.css';
import { DATE_LOCALE } from '@/lib/dateLocale';

// What each kind of automatically recorded action looks like.
export const KINDS = {
  track: { label: 'Tracks', icon: 'fa-solid fa-table-list' },
  entry: { label: 'Entries', icon: 'fa-solid fa-pen-to-square' },
  note: { label: 'Notes', icon: 'fa-solid fa-note-sticky' },
  task: { label: 'Tasks', icon: 'fa-solid fa-list-check' },
  code: { label: 'Code', icon: 'fa-solid fa-code' },
  calendar: { label: 'Calendar', icon: 'fa-solid fa-calendar-days' },
  download: { label: 'Downloads', icon: 'fa-solid fa-cloud-arrow-down' },
  photo: { label: 'Photos', icon: 'fa-solid fa-image' },
  pdf: { label: 'PDFs', icon: 'fa-solid fa-file-pdf' },
  export: { label: 'Exports', icon: 'fa-solid fa-file-export' },
  user: { label: 'Users', icon: 'fa-solid fa-user-plus' },
  account: { label: 'Account', icon: 'fa-solid fa-user' },
  backup: { label: 'Backups', icon: 'fa-solid fa-cloud-arrow-up' },
  admin: { label: 'Admin', icon: 'fa-solid fa-shield-halved' },
  security: { label: 'Security', icon: 'fa-solid fa-user-shield' },
};
const kindOf = (k) => KINDS[k] || { label: k, icon: 'fa-solid fa-circle-dot' };

// Local calendar day ('YYYY-MM-DD') an activity happened on.
export function activityDay(item) {
  const d = new Date(item.created_at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const time = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export default function ActivityList({ items, compact = false }) {
  if (!items.length) return <p className="act-empty">Nothing recorded.</p>;
  return (
    <ol className={`act-list${compact ? ' compact' : ''}`}>
      {items.map((item) => {
        const k = kindOf(item.kind);
        const spans = item.hits > 1 && item.updated_at !== item.created_at;
        const body = (
          <>
            <span className="act-summary">
              {item.actor && <strong className="act-actor">{item.actor}: </strong>}
              {item.summary}
            </span>
            {item.hits > 1 && <span className="act-hits" title={`${item.hits} times`}>×{item.hits}</span>}
          </>
        );
        return (
          <li key={item.id} className={`act-item act-${item.action}`}>
            <span className="act-time" title={new Date(item.created_at).toLocaleString(DATE_LOCALE)}>
              {time(item.created_at)}
              {spans && !compact && <span className="act-until">–{time(item.updated_at)}</span>}
            </span>
            <span className="act-icon" title={k.label}><i className={k.icon} /></span>
            {item.url ? <Link href={item.url} className="act-body">{body}</Link> : <span className="act-body">{body}</span>}
            {item.source === 'history' && !compact && <span className="act-tag" title="Rebuilt from existing data (before the activity log started)">earlier</span>}
          </li>
        );
      })}
    </ol>
  );
}

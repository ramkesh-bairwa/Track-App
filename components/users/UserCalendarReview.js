'use client';

import { useEffect, useState } from 'react';

function d(v) {
  if (!v) return '';
  return new Date(`${v}T00:00:00`).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
}

// Read-only calendar (leaves + activities) for an admin reviewing one user.
export default function UserCalendarReview({ userId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/users/${userId}/calendar`, { cache: 'no-store' })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled) return;
        if (!ok) throw new Error(j.error || 'Could not load calendar.');
        setData(j);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [userId]);

  if (error) return <div className="top-error">{error}</div>;
  if (!data) return <p className="ua-muted">Loading…</p>;

  const { leaves, activities } = data;
  if (leaves.length === 0 && activities.length === 0) {
    return <p className="ua-muted">No leaves or activities in the last 30 / next 60 days.</p>;
  }

  return (
    <div className="ua-calendar">
      {leaves.length > 0 && (
        <>
          <h3 className="attendance-subhead">Leaves</h3>
          <table className="data-table attendance-table">
            <thead><tr><th>From</th><th>To</th><th>Type</th><th>Note</th></tr></thead>
            <tbody>
              {leaves.map((l) => (
                <tr key={`l${l.id}`}>
                  <td>{d(l.start_date)}</td>
                  <td>{d(l.end_date)}{l.half_day ? ' (½)' : ''}</td>
                  <td style={{ textTransform: 'capitalize' }}>{l.leave_type}</td>
                  <td className="ua-muted">{l.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {activities.length > 0 && (
        <>
          <h3 className="attendance-subhead">Activities</h3>
          <table className="data-table attendance-table">
            <thead><tr><th>Date</th><th>Time</th><th>Title</th></tr></thead>
            <tbody>
              {activities.map((a) => (
                <tr key={`a${a.id}`}>
                  <td>{d(a.activity_date)}</td>
                  <td className="ua-muted">{a.start_time ? `${a.start_time}${a.end_time ? `–${a.end_time}` : ''}` : 'all day'}</td>
                  <td>{a.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

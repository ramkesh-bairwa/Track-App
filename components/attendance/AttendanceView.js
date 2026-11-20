'use client';

import { useCallback, useEffect, useState } from 'react';

function hm(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0 && m === 0) return '0m';
  return `${h ? `${h}h ` : ''}${m}m`;
}

function when(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function dayLabel(key) {
  const d = new Date(`${key}T00:00:00`);
  return d.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' });
}

// Shared attendance + timesheet view. `admin`+`userId` → read-only review of
// that user; otherwise the signed-in user's own page with check in / out.
export default function AttendanceView({ admin = false, userId = null, embedded = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const url = admin ? `/api/admin/users/${userId}/attendance?days=30` : '/api/attendance?days=30';

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load attendance.');
      setData(json);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [url]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  async function act(action) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not save.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <div className={embedded ? '' : 'ua-page'}>{error ? <div className="top-error">{error}</div> : <p className="ua-muted">Loading…</p>}</div>;
  }

  const totalToday = (data.days.find((d) => d.date === new Date().toISOString().slice(0, 10))?.seconds) || 0;

  return (
    <div className={embedded ? 'attendance-embed' : 'attendance-page'}>
      {!admin && (
        <div className="attendance-status">
          <div>
            <strong>{data.open ? 'Checked in' : 'Checked out'}</strong>
            <span className="ua-muted">
              {data.open ? `since ${when(data.open.check_in)}` : 'You are not on the clock.'} · Today: {hm(totalToday)}
            </span>
          </div>
          {data.open ? (
            <button className="btn btn-primary" disabled={busy} onClick={() => act('out')}>{busy ? '…' : 'Check out'}</button>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={() => act('in')}>{busy ? '…' : 'Check in'}</button>
          )}
        </div>
      )}

      {admin && (
        <p className="ua-muted" style={{ marginBottom: 10 }}>
          {data.open ? `Currently checked in since ${when(data.open.check_in)}.` : 'Not checked in right now.'} Today: {hm(totalToday)}
        </p>
      )}

      {error && <div className="top-error">{error}</div>}

      <h3 className="attendance-subhead">Timesheet — last 30 days</h3>
      {data.days.length === 0 ? (
        <p className="ua-muted">No attendance yet.</p>
      ) : (
        <table className="data-table attendance-table">
          <thead>
            <tr><th>Day</th><th>Sessions</th><th>Hours</th></tr>
          </thead>
          <tbody>
            {data.days.map((d) => (
              <tr key={d.date}>
                <td>{dayLabel(d.date)}</td>
                <td>{d.sessions}</td>
                <td>{hm(d.seconds)}{d.open ? ' (running)' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="attendance-subhead">Sessions</h3>
      {data.rows.length === 0 ? (
        <p className="ua-muted">No sessions.</p>
      ) : (
        <table className="data-table attendance-table">
          <thead>
            <tr><th>Check in</th><th>Check out</th><th>Duration</th></tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td>{when(r.check_in)}</td>
                <td>{r.check_out ? when(r.check_out) : <span className="ua-muted">still in</span>}</td>
                <td>{hm(r.seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

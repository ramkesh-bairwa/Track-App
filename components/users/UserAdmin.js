'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Avatar, formatDateTime } from '@/components/tasks/taskUi';
import ActivityList from '@/components/activity/ActivityList';
import UserFormModal from '@/components/users/UserFormModal';
import './user-admin.css';

const INTERVALS = [1, 2, 5, 10, 15, 30, 60];
const SYSTEM_KINDS = { system_start: 'Computer started', unlock: 'Unlocked', wake: 'Woke from sleep' };

function ago(when) {
  if (!when) return 'never';
  const s = Math.round((Date.now() - new Date(when).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return formatDateTime(when);
}

async function api(url, init) {
  const res = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status}).`);
  return json;
}

function Device({ device, commands, screenshotsOn, onChange, busy }) {
  const s = device.settings;
  const send = (body, label) => onChange(device, body, label);
  return (
    <li className={`ua-device${device.revoked ? ' revoked' : ''}`}>
      <div className="ua-device-head">
        <span className={`ua-dot${device.online ? ' on' : ''}`} title={device.online ? 'Online' : 'Offline'} />
        <div>
          <strong>{device.name || 'Computer'}</strong>
          <span className="ua-muted">
            {device.os || '—'}{device.appVersion ? ` · MyTrack ${device.appVersion}` : ''} · {device.online ? 'online' : `last seen ${ago(device.lastSeenAt)}`}
            {device.lastSyncAt ? ` · synced ${ago(device.lastSyncAt)}` : ''}
            {device.lastIp ? ` · ${device.lastIp}` : ''}
          </span>
          {device.status?.tracker?.message && (
            <span className={`ua-muted ua-status ${device.status.tracker.state}`}>Screenshots: {device.status.tracker.message}</span>
          )}
          {device.revoked && <span className="ua-badge danger">Disconnected</span>}
        </div>
      </div>
      {!device.revoked && (
        <>
          <div className="ua-controls">
            <label className="checkbox-row">
              <input type="checkbox" checked={screenshotsOn} disabled={busy} onChange={(e) => send({ screenshots: e.target.checked }, e.target.checked ? 'Screenshots on' : 'Screenshots off')} />
              <span>Screenshots</span>
            </label>
            <label className="ua-inline">
              <span className="ua-muted">every</span>
              <select
                className="input input-sm"
                value={s.screenshotMinutes}
                disabled={busy}
                onChange={(e) => send({ settings: { screenshotMinutes: Number(e.target.value) } }, 'Interval changed')}
              >
                {INTERVALS.map((m) => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={s.systemPhotos} disabled={busy} onChange={(e) => send({ settings: { systemPhotos: e.target.checked } }, e.target.checked ? 'System photos on' : 'System photos off')} />
              <span>System photos (start / unlock / wake)</span>
            </label>
          </div>
          <div className="ua-actions">
            {Object.entries(commands).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`btn btn-sm${id === 'sign_out' ? ' btn-danger' : ''}`}
                disabled={busy || device.pending.some((p) => p.command === id)}
                onClick={() => send({ command: id }, `${label} — sent`)}
              >
                {device.pending.some((p) => p.command === id) ? `${label} (waiting…)` : label}
              </button>
            ))}
          </div>
          {device.pending.length > 0 && (
            <p className="ua-muted ua-hint">The computer picks these up within a minute while it’s on and MyTrack is running.</p>
          )}
        </>
      )}
      <div className="ua-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() => {
            if (device.revoked || window.confirm(`Disconnect “${device.name || 'this computer'}” from the server? It stops syncing until ${device.userName || 'the person'} signs in again on it.`)) {
              send({ revoke: !device.revoked }, device.revoked ? 'Reconnected' : 'Disconnected');
            }
          }}
        >
          {device.revoked ? 'Allow it to reconnect' : 'Disconnect'}
        </button>
      </div>
    </li>
  );
}

export default function UserAdmin({ userId, meId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [days, setDays] = useState(14);

  const load = useCallback(async () => {
    try {
      setData(await api(`/api/admin/users/${userId}/overview?days=${days}`));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [userId, days]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000); // online status / pending commands
    return () => clearInterval(t);
  }, [load]);

  async function changeDevice(device, body, label) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/admin/devices/${device.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setNotice(label);
      setTimeout(() => setNotice(''), 3000);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function openAs() {
    if (!window.confirm(`Open MyTrack as ${data.user.name}? You’ll see and can change their tracks, records, tasks and notes exactly as they do. Everything you do is marked as done by you, and a banner takes you back.`)) return;
    setBusy(true);
    try {
      await api('/api/admin/impersonate', { method: 'POST', body: JSON.stringify({ userId }) });
      window.location.href = '/dashboard';
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="ua-page">
        <Link href="/dashboard/users" className="tool-back">← Users</Link>
        {error ? <div className="top-error">{error}</div> : <p className="ua-muted">Loading…</p>}
      </div>
    );
  }

  const { user, counts, devices, commands, screenshots, system, logins, activity } = data;
  const isMe = user.id === meId;

  return (
    <div className="ua-page">
      <Link href="/dashboard/users" className="tool-back">← Users</Link>
      <div className="page-head">
        <div className="ua-person">
          <Avatar person={user} size={48} />
          <div>
            <h1>
              {user.name} {user.is_admin && <span className="task-role-badge admin">Admin</span>}
            </h1>
            <p>
              {user.email} · joined {formatDateTime(user.created_at)}
              {user.app_lock ? ' · app lock on' : ''}
              {user.privacy_password ? ' · privacy password set' : ''}
            </p>
          </div>
        </div>
        <div className="page-head-actions">
          {(!user.is_admin || isMe) && (
            <button type="button" className="btn" onClick={() => setEditing(true)} disabled={busy}>✎ Edit account</button>
          )}
          {!user.is_admin && (
            <button type="button" className="btn btn-primary" onClick={openAs} disabled={busy}>
              Open MyTrack as {user.name.split(' ')[0]}
            </button>
          )}
        </div>
      </div>

      {error && <div className="top-error">{error}</div>}
      {notice && <div className="task-notice">{notice}</div>}

      <div className="ua-tiles">
        {[
          ['Tracks', counts.tracks],
          ['Records', counts.records],
          ['Notes', counts.notes],
          ['Task boards', counts.boards],
          ['Tasks assigned', counts.tasks],
          ['Desktop apps', devices.filter((d) => !d.revoked).length],
        ].map(([label, n]) => (
          <div key={label} className="ua-tile">
            <strong>{n}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <section className="table-panel ua-section">
        <h2>Desktop apps</h2>
        {devices.length === 0 ? (
          <p className="ua-muted">
            No desktop app is linked yet. On their computer: open MyTrack → profile picture → <strong>Server connection</strong>, enter this server’s address and
            sign in as {user.email}. Their data, screenshots and system photos then sync here every minute, and you can control the app from this page.
          </p>
        ) : (
          <ul className="ua-devices">
            {devices.map((d) => (
              <Device key={d.id} device={d} commands={commands} screenshotsOn={screenshots.enabled} onChange={changeDevice} busy={busy} />
            ))}
          </ul>
        )}
      </section>

      <section className="table-panel ua-section">
        <div className="ua-section-head">
          <h2>Screenshots</h2>
          <Link href={`/dashboard/screenshots?user=${user.id}`} className="btn btn-sm">All screenshots →</Link>
        </div>
        <p className="ua-muted">
          {screenshots.enabled ? `Switched on${screenshots.since ? ` since ${formatDateTime(screenshots.since)}` : ''}.` : 'Switched off.'}
          {screenshots.status?.message ? ` Last run: ${screenshots.status.message}` : ''}
        </p>
        {screenshots.latest.length === 0 ? (
          <p className="ua-muted">No screenshots yet.</p>
        ) : (
          <div className="ua-shots">
            {screenshots.latest.map((s) => (
              <a key={`${s.date}/${s.file}`} href={`/api/admin/screenshots/${user.id}/${s.date}/${s.file}`} target="_blank" rel="noreferrer" className="ua-shot">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/admin/screenshots/${user.id}/${s.date}/${s.file}`} alt="" loading="lazy" />
                <span>{s.date} {s.file.slice(0, 8).replace(/-/g, ':')}</span>
              </a>
            ))}
          </div>
        )}
      </section>

      <div className="ua-two">
        <section className="table-panel ua-section">
          <h2>System photos</h2>
          {system.length === 0 ? (
            <p className="ua-muted">None yet. Their desktop app takes a camera photo when the computer starts, unlocks or wakes.</p>
          ) : (
            <ul className="ua-events">
              {system.map((e) => (
                <li key={e.uuid}>
                  {e.has_photo ? (
                    <a href={`/api/system-events/${e.uuid}/photo`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/system-events/${e.uuid}/photo`} alt="" loading="lazy" />
                    </a>
                  ) : (
                    <span className="ua-nophoto">No photo</span>
                  )}
                  <span>
                    <strong>{SYSTEM_KINDS[e.kind] || e.kind}</strong>
                    <span className="ua-muted">{formatDateTime(e.created_at)} · {e.device_name || e.device || 'computer'}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="table-panel ua-section">
          <h2>Sign-ins</h2>
          {logins.length === 0 ? (
            <p className="ua-muted">No sign-ins recorded.</p>
          ) : (
            <ul className="ua-events">
              {logins.map((e) => (
                <li key={e.uuid}>
                  {e.has_photo ? (
                    <a href={`/api/auth/login-photo/${e.uuid}?user=${user.id}`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/auth/login-photo/${e.uuid}?user=${user.id}`} alt="" loading="lazy" />
                    </a>
                  ) : (
                    <span className="ua-nophoto">No photo</span>
                  )}
                  <span>
                    <strong>{e.kind === 'login' ? 'Signed in' : e.kind}</strong>
                    <span className="ua-muted">
                      {formatDateTime(e.created_at)}{e.source ? ` · ${e.source}` : ''}{e.ip ? ` · ${e.ip}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="table-panel ua-section">
        <div className="ua-section-head">
          <h2>Activity</h2>
          <select className="input input-sm" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
            {[1, 7, 14, 30, 90].map((d) => (
              <option key={d} value={d}>Last {d === 1 ? 'day' : `${d} days`}</option>
            ))}
          </select>
        </div>
        <ActivityList items={activity} compact />
      </section>

      {editing && <UserFormModal user={user} onClose={() => setEditing(false)} onSaved={load} />}
    </div>
  );
}

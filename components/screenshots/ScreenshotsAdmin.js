'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import ConfirmModal from '@/components/ConfirmModal';
import { Avatar } from '@/components/tasks/taskUi';
import './screenshots.css';
import { DATE_LOCALE } from '@/lib/dateLocale';

const shotTime = (file) => {
  const screen = /-display(\d)/.exec(file);
  return file.slice(0, 5).replace('-', ':') + (screen ? ` · screen ${screen[1]}` : '');
};
const longDate = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(DATE_LOCALE, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const whenText = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(DATE_LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

// How the tracker's last run went, so a missing permission isn't a silent
// stream of wallpaper-only shots.
function TrackerStatus({ status }) {
  if (!status) return null;
  const bad = status.state === 'no-permission' || status.state === 'error';
  const label = { ok: 'Last capture', skipped: 'Last run skipped', 'no-permission': 'Not capturing', error: 'Capture failed' }[status.state] || 'Last run';
  return (
    <div className={`shots-status${bad ? ' bad' : ''}`}>
      <i className={`fa-solid ${bad ? 'fa-triangle-exclamation' : 'fa-circle-check'}`} />
      <span>
        <strong>{label}</strong> · {whenText(status.time)}
        {status.state !== 'ok' && <> — {status.message}</>}
        {status.state === 'no-permission' && (
          <> Once it’s on, the next capture (within 5 minutes) works.</>
        )}
      </span>
    </div>
  );
}

async function api(url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Something went wrong.');
  return json;
}

function Portal({ children }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}

// Admin-only: every account's tracker screenshots, by day, with delete.
export default function ScreenshotsAdmin() {
  const [users, setUsers] = useState(null);
  const [userId, setUserId] = useState(null);
  const [days, setDays] = useState(null);
  const [status, setStatus] = useState(null);
  const [date, setDate] = useState(null);
  const [files, setFiles] = useState(null);
  const [meta, setMeta] = useState({});
  const [picked, setPicked] = useState(() => new Set());
  const [open, setOpen] = useState(null);
  const [confirm, setConfirm] = useState(null); // { title, message, label, run }
  const [error, setError] = useState('');

  const loadUsers = useCallback(async () => {
    try {
      const { users: list } = await api('/api/admin/screenshots');
      setUsers(list);
      setUserId((id) => id ?? (list.find((u) => u.shots > 0) || list[0])?.id ?? null);
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  const loadDays = useCallback(async () => {
    if (userId == null) return;
    try {
      const { days: counts, status: last } = await api(`/api/admin/screenshots/${userId}`);
      setDays(counts);
      setStatus(last);
      setDate((d) => (d && counts[d] ? d : Object.keys(counts).sort().pop() || null));
    } catch (err) {
      setError(err.message);
    }
  }, [userId]);
  useEffect(() => {
    setDays(null);
    setStatus(null);
    setDate(null);
    loadDays();
  }, [loadDays]);

  const loadFiles = useCallback(async () => {
    if (userId == null || !date) return setFiles([]);
    try {
      const json = await api(`/api/admin/screenshots/${userId}/${date}`);
      setMeta(json.meta || {});
      setFiles(json.files);
    } catch (err) {
      setError(err.message);
    }
  }, [userId, date]);
  useEffect(() => {
    setFiles(null);
    setPicked(new Set());
    setOpen(null);
    loadFiles();
  }, [loadFiles]);

  // After any delete: refresh the counts, the day list and the grid.
  async function refresh() {
    setPicked(new Set());
    await Promise.all([loadUsers(), loadDays(), loadFiles()]);
  }

  const user = users?.find((u) => u.id === userId);
  const dayList = useMemo(() => Object.keys(days || {}).sort().reverse(), [days]);
  const src = (f) => `/api/admin/screenshots/${userId}/${date}/${encodeURIComponent(f)}`;
  const openIndex = open ? files?.indexOf(open) ?? -1 : -1;
  const infoOf = (f) => meta[f.slice(0, 8)];

  function togglePick(f) {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(f) ? next.delete(f) : next.add(f);
      return next;
    });
  }

  function askDeleteFiles(list) {
    setConfirm({
      title: `Delete ${plural(list.length, 'screenshot')}?`,
      message: `From ${user.name}, ${longDate(date)}. This can’t be undone.`,
      label: 'Delete',
      run: async () => {
        await api(`/api/admin/screenshots/${userId}/${date}`, 'DELETE', { files: list });
        if (open && list.includes(open)) {
          const rest = files.filter((f) => !list.includes(f));
          setOpen(rest[Math.min(openIndex, rest.length - 1)] || null);
        }
        await refresh();
      },
    });
  }
  function askDeleteDay() {
    setConfirm({
      title: 'Delete this day’s screenshots?',
      message: `All ${plural(files.length, 'file')} from ${user.name} on ${longDate(date)}. This can’t be undone.`,
      label: 'Delete day',
      run: async () => {
        await api(`/api/admin/screenshots/${userId}/${date}`, 'DELETE');
        await refresh();
      },
    });
  }
  function askDeleteAll() {
    setConfirm({
      title: `Delete all of ${user.name}’s screenshots?`,
      message: `${plural(user.shots, 'capture')} across ${plural(user.days, 'day')}. This can’t be undone.`,
      label: 'Delete everything',
      run: async () => {
        await api(`/api/admin/screenshots/${userId}`, 'DELETE');
        await refresh();
      },
    });
  }

  return (
    <div className="shots-page">
      <div className="page-head">
        <div>
          <h1>Screenshots</h1>
          <p>Screenshot tracker captures for every account. Only admins can see this page.</p>
        </div>
        {user?.shots > 0 && (
          <div className="page-head-actions">
            <button type="button" className="btn btn-danger" onClick={askDeleteAll}>
              <i className="fa-solid fa-trash" /> Delete all of {user.name}’s
            </button>
          </div>
        )}
      </div>

      {error && <div className="top-error">{error}</div>}

      <div className="shots-layout">
        <aside className="shots-panel shots-users">
          <div className="shots-label">People</div>
          {users === null && <p className="shots-empty">Loading…</p>}
          {users?.map((u) => (
            <button key={u.id} type="button" className={`shots-user${u.id === userId ? ' active' : ''}`} onClick={() => setUserId(u.id)}>
              <Avatar person={u} size={26} />
              <span className="shots-user-text">
                <strong>{u.name}</strong>
                <span>{u.email}</span>
              </span>
              <span className="shots-count">{u.shots || '—'}</span>
            </button>
          ))}
        </aside>

        <aside className="shots-panel shots-days">
          <div className="shots-label">Days</div>
          {days === null && userId != null && <p className="shots-empty">Loading…</p>}
          {days && dayList.length === 0 && <p className="shots-empty">No screenshots.</p>}
          {dayList.map((d) => (
            <button key={d} type="button" className={`shots-day${d === date ? ' active' : ''}`} onClick={() => setDate(d)}>
              <span>{longDate(d)}</span>
              <span className="shots-count">{days[d]}</span>
            </button>
          ))}
        </aside>

        <section className="shots-panel shots-main">
          <TrackerStatus status={status} />
          {date && files && files.length > 0 ? (
            <>
              <div className="shots-toolbar">
                <strong>{longDate(date)}</strong>
                <span className="shots-muted">{plural(files.length, 'file')}</span>
                <span className="shots-spacer" />
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPicked(picked.size === files.length ? new Set() : new Set(files))}>
                  {picked.size === files.length ? 'Clear selection' : 'Select all'}
                </button>
                {picked.size > 0 && (
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => askDeleteFiles([...picked])}>
                    Delete {picked.size} selected
                  </button>
                )}
                <button type="button" className="btn btn-sm btn-danger" onClick={askDeleteDay}>Delete day</button>
              </div>
              <div className="shots-grid">
                {files.map((f) => (
                  <div key={f} className={`shots-tile${picked.has(f) ? ' picked' : ''}`}>
                    <button type="button" className="shots-thumb" onClick={() => setOpen(f)} title={infoOf(f) ? [infoOf(f).app, infoOf(f).title].filter(Boolean).join(' — ') : 'View'}>
                      <img src={src(f)} alt="" loading="lazy" />
                    </button>
                    <div className="shots-tile-foot">
                      <label className="shots-check">
                        <input type="checkbox" checked={picked.has(f)} onChange={() => togglePick(f)} />
                        <span>{shotTime(f)}</span>
                      </label>
                      {infoOf(f)?.app && <span className="shots-app">{infoOf(f).app}</span>}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => askDeleteFiles([f])} title="Delete">🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="shots-empty">
              {users?.length === 0 ? 'No accounts yet.' : files === null && date ? 'Loading…' : 'Pick a day with screenshots.'}
            </p>
          )}
        </section>
      </div>

      {open && openIndex >= 0 && (
        <Portal>
          <div className="modal-overlay" onClick={() => setOpen(null)}>
            <div className="modal shots-lightbox" onClick={(e) => e.stopPropagation()}>
              <div className="shots-lightbox-head">
                <strong>
                  {user?.name} · {longDate(date)} · {shotTime(open)}
                  {infoOf(open)?.app && <> · {infoOf(open).app}{infoOf(open).title && ` — ${infoOf(open).title}`}</>}
                </strong>
                <span>{openIndex + 1} / {files.length}</span>
              </div>
              <img src={src(open)} alt={`Screenshot at ${shotTime(open)}`} />
              <div className="modal-actions">
                <button type="button" className="btn btn-sm" disabled={openIndex <= 0} onClick={() => setOpen(files[openIndex - 1])}>← Earlier</button>
                <a className="btn btn-sm" href={src(open)} target="_blank" rel="noreferrer">Open full size</a>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => askDeleteFiles([open])}>Delete</button>
                <button type="button" className="btn btn-sm" disabled={openIndex >= files.length - 1} onClick={() => setOpen(files[openIndex + 1])}>Later →</button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {confirm && (
        <Portal>
          <ConfirmModal
            title={confirm.title}
            message={confirm.message}
            confirmLabel={confirm.label}
            danger
            onConfirm={confirm.run}
            onClose={() => setConfirm(null)}
          />
        </Portal>
      )}
    </div>
  );
}

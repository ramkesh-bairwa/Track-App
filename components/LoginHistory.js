'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DATE_LOCALE } from '@/lib/dateLocale';
import '@/components/screenshots/screenshots.css'; // the on/off switch styles

function when(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(DATE_LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
}
function timeOnly(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(DATE_LOCALE, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

const loginPhoto = (uuid) => `/api/auth/login-photo/${uuid}`;
const systemPhoto = (uuid) => `/api/system-events/${uuid}/photo`;

function Photo({ has, src, onZoom, size = 'big', title }) {
  return (
    <button
      type="button"
      className={`login-photo${has ? '' : ' none'}${size === 'small' ? ' small' : ''}`}
      onClick={() => has && onZoom(src)}
      title={has ? 'Click to enlarge' : title || 'No photo (camera not allowed)'}
    >
      {has ? <img src={src} alt="" loading="lazy" /> : <i className="fa-solid fa-user-slash" />}
    </button>
  );
}

// Asks for the account's login password before deleting anything.
function ConfirmDelete({ action, onClose, onDone }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, tab: action.tab, scope: action.scope, uuid: action.uuid }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not delete.');
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <form className="modal modal-sm" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{action.title}</h2>
        <p className="confirm-message">{action.message} Enter your login password to confirm.</p>
        <input
          className="input"
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Your login password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="top-error" style={{ marginTop: 10 }}>{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-danger" disabled={busy || !password}>{busy ? 'Deleting…' : 'Delete'}</button>
        </div>
      </form>
    </div>
  );
}

// 🗑 actions on one entry: remove just its photo, or the whole entry.
function RowActions({ entry, tab, what, onDelete }) {
  return (
    <span className="login-actions">
      {entry.hasPhoto && (
        <button
          type="button"
          className="login-action"
          title="Delete photo"
          onClick={() => onDelete({ tab, scope: 'photo', uuid: entry.uuid, title: 'Delete this photo?', message: `The ${what} stays in the history without its photo.` })}
        >
          <i className="fa-solid fa-image" /> <span>Delete photo</span>
        </button>
      )}
      <button
        type="button"
        className="login-action danger"
        title="Delete entry"
        onClick={() => onDelete({ tab, scope: 'entry', uuid: entry.uuid, title: `Delete this ${what}?`, message: 'It is removed from the history, with its photo.' })}
      >
        <i className="fa-solid fa-trash" /> <span>Delete</span>
      </button>
    </span>
  );
}

// Each login with the "MyTrack opened" photos taken after it (until the next
// login) as its sub-history. Openings before the first recorded login get a
// group of their own.
function groupLogins(logins) {
  const asc = [...logins].reverse();
  const groups = [];
  let current = null;
  for (const l of asc) {
    if (l.kind !== 'login') {
      if (!current) {
        current = { login: null, opens: [] };
        groups.push(current);
      }
      current.opens.push(l);
    } else {
      current = { login: l, opens: [] };
      groups.push(current);
    }
  }
  for (const g of groups) g.opens.reverse();
  return groups.reverse();
}

const SUB_LABELS = { app_open: 'Opened', app_unlock: 'Unlocked', app_unlock_failed: 'Wrong password' };

function SourceBadge({ source }) {
  return <span className={`login-source ${source === 'desktop' ? 'desktop' : 'web'}`}>{source === 'desktop' ? 'Desktop app' : 'Web'}</span>;
}

function MyTrackTab({ logins, onZoom, onDelete }) {
  const groups = useMemo(() => groupLogins(logins), [logins]);
  if (groups.length === 0) {
    return <div className="empty-state"><h3>No logins recorded yet</h3><p>Your next login will appear here.</p></div>;
  }
  return (
    <div className="login-history">
      {groups.map((g, i) => (
        <div key={g.login?.uuid || `opens-${i}`} className="login-group">
          {g.login ? (
            <div className="login-row">
              <Photo has={g.login.hasPhoto} src={loginPhoto(g.login.uuid)} onZoom={onZoom} />
              <div className="login-info">
                <strong>
                  Signed in · {when(g.login.at)} <SourceBadge source={g.login.source} />
                </strong>
                <span className="task-muted">{g.login.device}{g.login.ip ? ` · ${g.login.ip}` : ''}</span>
              </div>
              {!g.login.hasPhoto && <span className="task-muted login-nophoto">no photo</span>}
              <RowActions entry={g.login} tab="mytrack" what="login" onDelete={onDelete} />
            </div>
          ) : (
            <div className="login-row login-row-plain">
              <div className="login-info">
                <strong>MyTrack opened</strong>
                <span className="task-muted">Before the first recorded login</span>
              </div>
            </div>
          )}
          {g.opens.length > 0 && (
            <div className="login-subhistory">
              <span className="login-sub-title">
                <i className="fa-solid fa-camera" /> {g.opens.length} photo{g.opens.length === 1 ? '' : 's'} in this session — app opened / unlocked
              </span>
              <div className="login-sub-list">
                {g.opens.map((o) => (
                  <div key={o.uuid} className={`login-sub-item${o.kind === 'app_unlock_failed' ? ' failed' : ''}`}>
                    <button
                      type="button"
                      className="login-sub-delete"
                      title="Delete this entry"
                      onClick={() =>
                        onDelete({ tab: 'mytrack', scope: 'entry', uuid: o.uuid, title: `Delete this “${SUB_LABELS[o.kind] || 'Event'}” entry?`, message: 'It is removed from the history, with its photo.' })
                      }
                    >
                      ×
                    </button>
                    <Photo has={o.hasPhoto} src={loginPhoto(o.uuid)} onZoom={onZoom} size="small" />
                    <span className="login-sub-kind">{SUB_LABELS[o.kind] || 'Event'}</span>
                    <span>{timeOnly(o.at)}</span>
                    <SourceBadge source={o.source} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SystemTab({ system, isDesktop, enabled, onZoom, onDelete }) {
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function toggle() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/system-events/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !on }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not change it.');
      setOn(json.enabled);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {isDesktop ? (
        <div className={`shots-switch${on ? ' on' : ''}`}>
          <button type="button" role="switch" aria-checked={on} className="shots-toggle" disabled={busy} onClick={toggle}>
            <span className="shots-toggle-knob" />
          </button>
          <span className="shots-switch-text">
            <strong>{on ? 'System photos on' : 'System photos off'}</strong>
            <span>
              {on
                ? 'A photo is taken whenever someone starts or signs in to this computer, unlocks it, or wakes it. MyTrack opens by itself at sign-in and keeps running in the background for this.'
                : 'Nothing is captured when this computer starts, unlocks or wakes.'}
            </span>
          </span>
        </div>
      ) : (
        <p className="field-hint">These photos are taken by the MyTrack desktop app on the computer it runs on, and arrive here when you sync.</p>
      )}
      {error && <div className="top-error">{error}</div>}
      {system.length === 0 ? (
        <div className="empty-state">
          <h3>No system logins yet</h3>
          <p>{isDesktop ? 'The next time this computer is started, unlocked or woken, it shows up here.' : 'Sync with the desktop app to see them here.'}</p>
        </div>
      ) : (
        <div className="login-history">
          {system.map((e) => (
            <div key={e.uuid} className="login-row">
              <Photo has={e.hasPhoto} src={systemPhoto(e.uuid)} onZoom={onZoom} title="No photo (camera unavailable)" />
              <div className="login-info">
                <strong>
                  {e.label} · {when(e.at)}
                </strong>
                <span className="task-muted">{e.device}</span>
              </div>
              {!e.hasPhoto && <span className="task-muted login-nophoto">no photo</span>}
              <RowActions entry={e} tab="system" what="system login" onDelete={onDelete} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function LoginHistory({ logins, system, isDesktop, systemEnabled }) {
  const router = useRouter();
  const [zoom, setZoom] = useState(null);
  const [tab, setTab] = useState('mytrack');
  const [confirm, setConfirm] = useState(null); // delete waiting for the password
  const activeTab = tab === 'system' && system ? 'system' : 'mytrack';
  const count = activeTab === 'system' ? system.length : logins.length;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Login history</h1>
          <p>
            Who signed in to MyTrack and who used this computer, each with a camera photo (taken only when the camera was allowed). If
            you see one you don’t recognise, change your password.
          </p>
        </div>
      </div>

      <div className="login-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'mytrack'} className={tab === 'mytrack' ? 'active' : ''} onClick={() => setTab('mytrack')}>
          <i className="fa-solid fa-right-to-bracket" /> MyTrack login
          <span className="login-tab-count">{logins.length}</span>
        </button>
        {system && (
          <button type="button" role="tab" aria-selected={tab === 'system'} className={tab === 'system' ? 'active' : ''} onClick={() => setTab('system')}>
            <i className="fa-solid fa-desktop" /> System login
            <span className="login-tab-count">{system.length}</span>
          </button>
        )}
        {count > 0 && (
          <button
            type="button"
            className="login-clear"
            onClick={() =>
              setConfirm({
                tab: activeTab,
                scope: 'all',
                title: activeTab === 'system' ? 'Clear all system logins?' : 'Clear your whole login history?',
                message:
                  activeTab === 'system'
                    ? 'Every system login entry and photo is deleted.'
                    : 'Every login and “MyTrack opened” entry of your account, with their photos, is deleted.',
              })
            }
          >
            <i className="fa-solid fa-trash" /> Clear all
          </button>
        )}
      </div>

      {activeTab === 'mytrack' ? (
        <MyTrackTab logins={logins} onZoom={setZoom} onDelete={setConfirm} />
      ) : (
        <SystemTab system={system} isDesktop={isDesktop} enabled={systemEnabled} onZoom={setZoom} onDelete={setConfirm} />
      )}

      {confirm && (
        <ConfirmDelete
          action={confirm}
          onClose={() => setConfirm(null)}
          onDone={() => {
            setConfirm(null);
            router.refresh();
          }}
        />
      )}

      {zoom && (
        <div className="modal-overlay" onClick={() => setZoom(null)}>
          <img className="login-zoom" src={zoom} alt="Photo" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

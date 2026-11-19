'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ExportMenu from '@/components/ExportMenu';
import { Pager, DayHeading, withDayHeadings } from '@/components/tasks/ActivityEntry';
import { Avatar, formatDateTime, timeAgo } from '@/components/tasks/taskUi';

// History of a track (optionally with its sub-tracks), or of one record
// (`entry` set): every change, who made it and what it was before. Notes can
// be added to any line; record edits can be reverted and deleted records
// restored.

const LABELS = {
  track_create: 'Track created',
  track_update: 'Track edited',
  track_settings: 'Settings',
  track_delete: 'Track deleted',
  subtrack_add: 'Sub-track',
  subtrack_remove: 'Sub-track',
  subtrack_delete: 'Sub-track deleted',
  subtrack_reorder: 'Sub-tracks',
  column_add: 'Column added',
  column_update: 'Column edited',
  column_remove: 'Column removed',
  column_reorder: 'Columns',
  entry_create: 'Record added',
  entry_update: 'Record edited',
  entry_delete: 'Record deleted',
  entry_restore: 'Record restored',
  entry_lock: 'Locked',
  entry_unlock: 'Unlocked',
  entry_reorder: 'Reordered',
  entry_view: 'Viewed',
  log_note: 'Note',
};
const TONE = {
  track_create: 'good',
  subtrack_add: 'good',
  column_add: 'good',
  entry_create: 'good',
  entry_restore: 'good',
  subtrack_delete: 'bad',
  track_delete: 'bad',
  column_remove: 'bad',
  entry_delete: 'bad',
  log_note: 'info',
};
const ICON = {
  track_create: '✚',
  track_update: '✎',
  track_settings: '⚙',
  track_delete: '🗑',
  subtrack_add: '⤷',
  subtrack_remove: '⤴',
  subtrack_delete: '🗑',
  subtrack_reorder: '⇅',
  column_add: '▥',
  column_update: '▥',
  column_remove: '▥',
  column_reorder: '⇄',
  entry_create: '✚',
  entry_update: '✎',
  entry_delete: '🗑',
  entry_restore: '↺',
  entry_lock: '🔒',
  entry_unlock: '🔓',
  entry_reorder: '⇅',
  entry_view: '👁',
  log_note: '📝',
};
const KINDS = [
  ['', 'All changes'],
  ['entry', 'Records'],
  ['column', 'Columns'],
  ['track', 'Track & sub-tracks'],
  ['log', 'Notes'],
];
const kindOf = (action) => (action.startsWith('entry') ? 'entry' : action.startsWith('column') ? 'column' : action.startsWith('log') ? 'log' : 'track');

const EXPORT_COLUMNS = ['#', 'When', 'Who', 'Track', 'Action', 'Record', 'Summary', 'Field', 'Old value', 'New value', 'Reverted', 'Note'];
const stamp = (v) => (v ? new Date(v).toLocaleString() : '');
function exportRows(list) {
  const rows = [];
  for (const a of list) {
    const base = [a.id, stamp(a.created_at), a.user_name || '', a.track_name, LABELS[a.action] || a.action, a.entry_label || '', a.summary];
    const tail = [a.reverted_at ? `by ${a.reverted_by_name || 'you'} on ${stamp(a.reverted_at)}` : '', a.note || ''];
    if (!a.changes.length) rows.push([...base, '', '', '', ...tail]);
    else a.changes.forEach((c) => rows.push([...base, c.label, c.type === 'password' ? '••••' : c.oldText || '', c.type === 'password' ? '••••' : c.newText || '', ...tail]));
  }
  return rows;
}

function Secret({ text, className }) {
  const [shown, setShown] = useState(false);
  return (
    <span className={className}>
      {shown ? text : '••••••'}
      <button type="button" className="cell-reveal" onClick={() => setShown((v) => !v)} title={shown ? 'Hide' : 'Reveal'}>
        {shown ? '🙈' : '👁'}
      </button>
    </span>
  );
}

function Val({ change, text, className }) {
  if (change.type === 'password') return <Secret text={text} className={className} />;
  if (/^https?:\/\/\S+$/i.test(text)) {
    return (
      <a className={`${className} log-url`} href={text} target="_blank" rel="noopener noreferrer">
        {text.replace(/^https?:\/\//i, '')}
      </a>
    );
  }
  return <span className={className}>{text}</span>;
}

function Chip({ change, fact }) {
  const { oldText, newText } = change;
  return (
    <span className="log-chip" title={`${change.label}: ${oldText || '—'} → ${newText || '—'}`}>
      <span className="log-chip-label">{change.label}</span>
      {fact ? (
        <Val change={change} text={newText} className="log-chip-value" />
      ) : oldText && newText ? (
        <>
          <Val change={change} text={oldText} className="log-old" />
          <span className="log-arrow">→</span>
          <Val change={change} text={newText} className="log-new" />
        </>
      ) : newText ? (
        <>
          <span className="log-verb">set to</span>
          <Val change={change} text={newText} className="log-new" />
        </>
      ) : oldText ? (
        <>
          <span className="log-verb">cleared, was</span>
          <Val change={change} text={oldText} className="log-was" />
        </>
      ) : (
        <span className="log-verb">left empty</span>
      )}
    </span>
  );
}

function Row({ a, meId, showTrack, showRecord, onOpenRecord, onChanged }) {
  const trackId = a.track_id;
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(a.note || '');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const who = a.user_id === meId ? 'You' : a.user_name || 'Someone';

  async function send(url, init, changesRecords = false) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(url, init);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Something went wrong.');
      await onChanged(changesRecords);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    const ok = await send(`/api/tracks/${trackId}/activity/${a.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: noteDraft }),
    });
    if (ok) setEditingNote(false);
  }

  async function revert() {
    if (await send(`/api/tracks/${trackId}/activity/${a.id}/revert`, { method: 'POST' }, true)) setConfirm(false);
  }

  const time = (
    <div className="log-when" title={formatDateTime(a.created_at)}>
      <span className="log-ago">{timeAgo(a.created_at)}</span>
      <span className="log-stamp">
        {new Date(a.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · #{a.id}
      </span>
    </div>
  );

  const where = (
    <>
      {showTrack &&
        (a.track_uuid ? (
          <a className="log-task" href={`/dashboard/tracks/${a.track_uuid}`} title="Open this track"> · {a.track_name}</a>
        ) : (
          <span className="log-task" title="This track was deleted"> · {a.track_name} (deleted)</span>
        ))}
      {showRecord && a.entry_id && a.entry_exists && onOpenRecord && (
        <button type="button" className="log-link" onClick={() => onOpenRecord(a)} title="Show this record's history">
          {' '}🕘 record
        </button>
      )}
    </>
  );

  if (a.action === 'entry_view') {
    return (
      <div className="log-row log-row-view">
        <span className="log-view-icon">👁</span>
        <p className="log-line">
          <strong>{who}</strong> <span className="log-verb-main">{a.summary.charAt(0).toLowerCase() + a.summary.slice(1)}</span>
          {where}
        </p>
        {time}
      </div>
    );
  }

  const fact = a.action === 'entry_create' || a.action === 'track_create' || a.action === 'column_add';
  const chips = a.action === 'log_note' ? [] : a.changes;
  const noteChange = a.action === 'log_note' ? a.changes[0] : null;

  return (
    <article className={`log-row${a.reverted_at ? ' log-row-reverted' : ''}`}>
      <div className="log-avatar">
        <Avatar person={{ name: a.user_name, avatar: a.user_avatar }} size={32} />
        <span className={`log-icon-badge ${TONE[a.action] || ''}`}>{ICON[a.action] || '•'}</span>
      </div>

      <div className="log-main">
        <p className="log-line">
          <strong>{who}</strong> <span className="log-verb-main">{a.summary.charAt(0).toLowerCase() + a.summary.slice(1)}</span>
          {where}
          <span className={`task-log-badge log-badge ${TONE[a.action] || ''}`}>{LABELS[a.action] || a.action}</span>
        </p>

        {a.hidden && <p className="task-muted" style={{ fontSize: 12.5 }}>🔒 Record is locked — unlock it to see what changed.</p>}

        {noteChange && (
          <div className="log-details">
            {noteChange.oldText && <span className="log-quote log-quote-old">{noteChange.oldText}</span>}
            {noteChange.newText ? <span className="log-quote">“{noteChange.newText}”</span> : <span className="log-verb">Note removed.</span>}
          </div>
        )}

        {chips.length > 0 && (
          <div className="log-details">
            {chips.map((c) => (
              <Chip key={c.key} change={c} fact={fact} />
            ))}
          </div>
        )}

        {(a.reverted_at || a.revert_of) && (
          <div className="task-log-reverted-note">
            {a.reverted_at && <>↺ Reverted by {a.reverted_by_name || 'you'} · {formatDateTime(a.reverted_at)}</>}
            {a.revert_of && <>↺ This undid change #{a.revert_of}</>}
          </div>
        )}

        {confirm && (
          <div className="log-revert">
            <span className="task-muted">{a.action === 'entry_delete' ? 'Bring this record back?' : 'Put the old values back?'}</span>
            <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={revert}>
              {busy ? 'Working…' : a.action === 'entry_delete' ? 'Yes, restore' : 'Yes, revert'}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        )}

        {a.note && !editingNote && (
          <div className="log-note">
            <span className="log-note-icon">📝</span>
            <p>{a.note}</p>
            <span className="log-note-meta">{a.note_by_name || 'You'} · {timeAgo(a.note_at)}</span>
          </div>
        )}

        {editingNote && (
          <div className="log-note-edit">
            <textarea
              className="input"
              rows={3}
              autoFocus
              value={noteDraft}
              placeholder="Why was this changed? Anything to remember…"
              onChange={(e) => setNoteDraft(e.target.value)}
            />
            <div className="log-note-edit-actions">
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={saveNote}>
                {busy ? 'Saving…' : 'Save note'}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setEditingNote(false);
                  setNoteDraft(a.note || '');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && <div className="top-error">{error}</div>}

        <div className="log-actions">
          {a.action !== 'log_note' && !editingNote && (
            <button type="button" className={`log-link${a.note ? ' log-link-strong' : ''}`} onClick={() => setEditingNote(true)}>
              📝 {a.note ? 'Edit note' : 'Add note'}
            </button>
          )}
          {a.revertible && !confirm && (
            <button type="button" className="log-link" onClick={() => setConfirm(true)}>
              ↺ {a.action === 'entry_delete' ? 'Restore record' : 'Revert'}
            </button>
          )}
        </div>
      </div>

      {time}
    </article>
  );
}

// TrackView fires this after every saved change, so an open History updates at once.
export const TRACK_CHANGED_EVENT = 'mytrack:track-changed';

// `track` null → the history of all your tracks (opened from the dashboard).
// `inline` → shown as a section on the page (under the table) instead of a
// pop-up; `entry` then switches it to one record, `onEntryCleared` back.
export default function TrackHistory({ track, entry: initialEntry, hasSubtracks, onClose, onRestored, inline = false, onEntryCleared }) {
  const [entry, setEntry] = useState(initialEntry || null); // { id, label }
  const initialEntryId = initialEntry?.id ?? null;
  useEffect(() => {
    setEntry(initialEntry || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEntryId]);
  const [activity, setActivity] = useState(null);
  const [meId, setMeId] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const trackId = track?.id ?? null;
  // 'track' | 'subs' | 'all'
  const [scope, setScope] = useState(!track ? 'all' : hasSubtracks ? 'subs' : 'track');
  const [hideViews, setHideViews] = useState(true);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const url =
        entry && trackId
          ? `/api/tracks/${trackId}/activity?entry=${entry.id}`
          : scope === 'all' || !trackId
            ? '/api/tracks/activity'
            : `/api/tracks/${trackId}/activity${scope === 'subs' ? '?sub=1' : ''}`;
      const res = await fetch(url);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not load the history.');
      setActivity(json.activity);
      setMeId(json.me);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [trackId, entry, scope]);

  useEffect(() => {
    setActivity(null);
    load();
  }, [load]);

  // Stay current while open: changes saved anywhere (this window, another
  // window or tab) show up within a few seconds, and right away on focus.
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && load();
    const timer = setInterval(tick, 4000);
    window.addEventListener('focus', load);
    window.addEventListener(TRACK_CHANGED_EVENT, load);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', load);
      window.removeEventListener(TRACK_CHANGED_EVENT, load);
    };
  }, [load]);

  useEffect(() => {
    if (inline) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, inline]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (activity || []).filter((a) => {
      if (kind && kindOf(a.action) !== kind) return false;
      if (hideViews && a.action === 'entry_view') return false;
      if (!q) return true;
      return (
        a.summary.toLowerCase().includes(q) ||
        (a.entry_label || '').toLowerCase().includes(q) ||
        (a.track_name || '').toLowerCase().includes(q) ||
        (a.note || '').toLowerCase().includes(q) ||
        a.changes.some((c) => `${c.label} ${c.type === 'password' ? '' : `${c.oldText} ${c.newText}`}`.toLowerCase().includes(q))
      );
    });
  }, [activity, search, kind, hideViews]);

  useEffect(() => setPage(1), [search, kind, hideViews, scope, entry]);
  const PER = 15;
  const pageCount = Math.max(1, Math.ceil(shown.length / PER));
  const current = Math.min(page, pageCount);
  const pageItems = shown.slice((current - 1) * PER, current * PER);

  async function changed(recordsChanged) {
    await load();
    if (recordsChanged) onRestored?.();
  }

  const title = entry
    ? `Record history — ${entry.label || 'record'}`
    : !track || scope === 'all'
      ? 'History — all tracks'
      : `History — ${track.name}`;

  const body = (
    <>
        <div className="new-track-head">
          <div>
            <h2>{title}</h2>
            <p className="new-track-steps">
              {entry
                ? 'Every change to this record, what each field was before, and who made it. '
                : 'Every change to your tracks, sub-tracks, columns and records — logged automatically, kept even after a delete. '}
              Add a note to any line; record edits can be reverted and deleted records restored.
            </p>
          </div>
          {!inline && <button type="button" className="new-track-close" onClick={onClose} title="Close">×</button>}
        </div>

        {entry && (inline || !initialEntry) && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => {
              setEntry(null);
              onEntryCleared?.();
            }}
          >
            ‹ Back to the whole track
          </button>
        )}

        <div className="task-activity-filters">
          <input
            type="search"
            className="input input-sm"
            placeholder="Search the history — field, value, record…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {!entry && (
            <select className="input input-sm" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          )}
          {!entry && track && (
            <select className="input input-sm" value={scope} onChange={(e) => setScope(e.target.value)} title="Whose history to show">
              <option value="track">This track only</option>
              {hasSubtracks && <option value="subs">This track + sub-tracks</option>}
              <option value="all">All tracks (incl. deleted)</option>
            </select>
          )}
          <label className="checkbox-row" title="Leave out who-opened-which-record lines">
            <input type="checkbox" checked={hideViews} onChange={(e) => setHideViews(e.target.checked)} />
            <span style={{ fontSize: 13 }}>Hide views</span>
          </label>
          <ExportMenu
            className="btn btn-sm"
            getTable={() => ({ title, columns: EXPORT_COLUMNS, rows: exportRows(shown) })}
            note="Exports the lines currently shown, one row per changed field (credentials masked)."
          />
        </div>

        {error && <div className="top-error">{error}</div>}

        <div className="task-activity-list">
          {activity === null ? (
            <p className="task-muted">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="task-muted">
              {activity.length === 0 ? 'No history yet — changes from now on are logged here.' : 'Nothing matches.'}
            </p>
          ) : (
            withDayHeadings(pageItems).map(({ heading, entry: a, key }) =>
              heading ? (
                <DayHeading key={key}>{heading}</DayHeading>
              ) : (
                <Row
                  key={key}
                  a={a}
                  meId={meId}
                  showTrack={!track || a.track_id !== track.id}
                  showRecord={!entry}
                  onOpenRecord={track && a.track_id === track.id ? (x) => setEntry({ id: x.entry_id, label: x.entry_label }) : null}
                  onChanged={changed}
                />
              )
            )
          )}
        </div>
        <Pager page={current} per={PER} total={shown.length} onPage={setPage} noun="lines" />
    </>
  );

  if (inline) {
    return (
      <section id="track-history" className="table-panel track-history-panel">
        {body}
      </section>
    );
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg task-activity-modal" onClick={(e) => e.stopPropagation()}>
        {body}
      </div>
    </div>
  );
}

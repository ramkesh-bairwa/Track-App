'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import ConfirmModal from '@/components/ConfirmModal';
import ActivityList, { activityDay } from '@/components/activity/ActivityList';
import './calendar.css';
import { DATE_LOCALE } from '@/lib/dateLocale';

const LEAVE_TYPES = [
  { id: 'casual', label: 'Casual leave', color: '#35c2a6' },
  { id: 'sick', label: 'Sick leave', color: '#e5646b' },
  { id: 'vacation', label: 'Vacation', color: '#5b8def' },
  { id: 'personal', label: 'Personal', color: '#b07ce8' },
  { id: 'holiday', label: 'Public holiday', color: '#e8a33d' },
  { id: 'other', label: 'Other', color: '#8b93a5' },
];
const leaveType = (id) => LEAVE_TYPES.find((t) => t.id === id) || LEAVE_TYPES[LEAVE_TYPES.length - 1];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ---------- date helpers (local dates as 'YYYY-MM-DD' keys) ----------
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const longDate = (k) => parseKey(k).toLocaleDateString(DATE_LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = (k) => parseKey(k).toLocaleDateString(DATE_LOCALE, { day: 'numeric', month: 'short' });

// Working days a leave covers inside [from, to] — weekends don't count, half days count 0.5.
function leaveDays(leave, from, to) {
  const start = leave.start_date > from ? leave.start_date : from;
  const end = leave.end_date < to ? leave.end_date : to;
  if (start > end) return 0;
  if (leave.half_day) return isWeekend(parseKey(start)) ? 0 : 0.5;
  let n = 0;
  for (let d = parseKey(start); keyOf(d) <= end; d = addDays(d, 1)) if (!isWeekend(d)) n += 1;
  return n;
}

function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = addDays(first, -((first.getDay() + 6) % 7)); // back to Monday
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
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

function Modal({ children, onClose }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body
  );
}

// ---------- leave form ----------
function LeaveModal({ leave, onClose, onSaved }) {
  const [form, setForm] = useState({
    start_date: leave.start_date,
    end_date: leave.end_date || leave.start_date,
    leave_type: leave.leave_type || 'casual',
    half_day: Boolean(leave.half_day),
    note: leave.note || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const singleDay = form.start_date === form.end_date;
  const days = form.start_date && form.end_date && form.end_date >= form.start_date
    ? leaveDays({ ...form, half_day: singleDay && form.half_day }, form.start_date, form.end_date)
    : 0;

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = { ...form, half_day: singleDay && form.half_day };
      if (leave.id) await api(`/api/calendar/leaves/${leave.id}`, 'PATCH', body);
      else await api('/api/calendar/leaves', 'POST', body);
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal onClose={saving ? undefined : onClose}>
      <form onSubmit={submit}>
        <h2>{leave.id ? 'Edit leave' : 'Add leave'}</h2>
        <div className="cal-form-row">
          <div className="field-group">
            <label className="field-label" htmlFor="leave-from">From</label>
            <input id="leave-from" type="date" className="input" value={form.start_date} required
              onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value, end_date: f.end_date < e.target.value ? e.target.value : f.end_date }))} />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="leave-to">To</label>
            <input id="leave-to" type="date" className="input" value={form.end_date} min={form.start_date} required onChange={(e) => set('end_date', e.target.value)} />
          </div>
        </div>
        <div className="field-group">
          <label className="field-label">Type</label>
          <div className="cal-type-picker">
            {LEAVE_TYPES.map((t) => (
              <button key={t.id} type="button" className={`cal-type-chip${form.leave_type === t.id ? ' active' : ''}`}
                style={{ '--chip': t.color }} onClick={() => set('leave_type', t.id)}>
                <span className="cal-dot" />{t.label}
              </button>
            ))}
          </div>
        </div>
        {singleDay && (
          <label className="checkbox-row field-group">
            <input type="checkbox" checked={form.half_day} onChange={(e) => set('half_day', e.target.checked)} />
            Half day
          </label>
        )}
        <div className="field-group">
          <label className="field-label" htmlFor="leave-note">Note (optional)</label>
          <input id="leave-note" className="input" value={form.note} maxLength={500} placeholder="e.g. Family function, fever…" onChange={(e) => set('note', e.target.value)} />
          <p className="field-hint">{days} working day{days === 1 ? '' : 's'} (weekends aren’t counted)</p>
        </div>
        {error && <div className="top-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save leave'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- activity form (inline in the day panel) ----------
function ActivityForm({ date, activity, onDone, onCancel }) {
  const [form, setForm] = useState({
    title: activity?.title || '',
    start_time: activity?.start_time || '',
    end_time: activity?.end_time || '',
    details: activity?.details || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (activity) await api(`/api/calendar/activities/${activity.id}`, 'PATCH', form);
      else await api('/api/calendar/activities', 'POST', { ...form, activity_date: date });
      setForm({ title: '', start_time: '', end_time: '', details: '' });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="cal-activity-form" onSubmit={submit}>
      <input className="input" value={form.title} maxLength={255} required autoFocus={Boolean(activity)}
        placeholder="What did you do? e.g. Fixed login bug, client call…" onChange={(e) => set('title', e.target.value)} />
      <div className="cal-form-row">
        <label className="cal-time">
          <span>From</span>
          <input type="time" className="input input-sm" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} />
        </label>
        <label className="cal-time">
          <span>To</span>
          <input type="time" className="input input-sm" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} />
        </label>
      </div>
      <textarea className="input" rows={2} value={form.details} placeholder="Details (optional)" onChange={(e) => set('details', e.target.value)} />
      {error && <div className="top-error">{error}</div>}
      <div className="cal-form-actions">
        {onCancel && <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
          {saving ? 'Saving…' : activity ? 'Save' : '＋ Add activity'}
        </button>
      </div>
    </form>
  );
}

// ---------- day side panel ----------
function DayPanel({ date, leaves, activities, auto, onEditLeave, onChanged, onClose }) {
  const [editing, setEditing] = useState(null);
  const [showAllAuto, setShowAllAuto] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setEditing(null);
    setShowAllAuto(false);
  }, [date]);

  // Asks in a modal first; the modal shows any error itself.
  const [ask, setAsk] = useState(null); // { kind, id, title, message, label }
  function remove(kind, id, what, detail) {
    setAsk({ kind, id, title: `Delete this ${what}?`, message: detail ? `“${detail}” will be removed. This can’t be undone.` : 'This can’t be undone.', label: `Delete ${what}` });
  }
  async function confirmRemove() {
    await api(`/api/calendar/${ask.kind}/${ask.id}`, 'DELETE');
    onChanged();
  }

  const totalMinutes = activities.reduce((sum, a) => {
    if (!a.start_time || !a.end_time) return sum;
    const [h1, m1] = a.start_time.split(':').map(Number);
    const [h2, m2] = a.end_time.split(':').map(Number);
    return sum + Math.max(0, h2 * 60 + m2 - (h1 * 60 + m1));
  }, 0);

  return (
    <aside className="cal-day">
      <div className="cal-day-head">
        <div>
          <h2>{longDate(date)}</h2>
          {isWeekend(parseKey(date)) && <span className="cal-muted">Weekend</span>}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {error && <div className="top-error">{error}</div>}

      <section>
        <div className="cal-section-label">Leave</div>
        {leaves.length ? (
          leaves.map((l) => {
            const t = leaveType(l.leave_type);
            return (
              <div key={l.id} className="cal-leave-card" style={{ '--chip': t.color }}>
                <div>
                  <strong><span className="cal-dot" />{t.label}{l.half_day ? ' · half day' : ''}</strong>
                  <span className="cal-muted">
                    {l.start_date === l.end_date ? shortDate(l.start_date) : `${shortDate(l.start_date)} – ${shortDate(l.end_date)}`}
                    {l.note ? ` · ${l.note}` : ''}
                  </span>
                </div>
                <div className="cal-row-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEditLeave(l)}>Edit</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove('leaves', l.id, 'leave', `${leaveType(l.leave_type).label}, ${l.start_date === l.end_date ? shortDate(l.start_date) : `${shortDate(l.start_date)} – ${shortDate(l.end_date)}`}`)}>Delete</button>
                </div>
              </div>
            );
          })
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => onEditLeave({ start_date: date })}>
            <i className="fa-solid fa-umbrella-beach" /> Mark leave
          </button>
        )}
      </section>

      <section>
        <div className="cal-section-label">
          What I did{activities.length ? ` · ${activities.length}` : ''}
          {totalMinutes > 0 && <span className="cal-muted"> · {Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m logged</span>}
        </div>
        {activities.map((a) =>
          editing === a.id ? (
            <ActivityForm key={a.id} date={date} activity={a} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); onChanged(); }} />
          ) : (
            <div key={a.id} className="cal-activity">
              <span className="cal-activity-time">{a.start_time ? `${a.start_time}${a.end_time ? `–${a.end_time}` : ''}` : '—'}</span>
              <div className="cal-activity-body">
                <strong>{a.title}</strong>
                {a.details && <p>{a.details}</p>}
              </div>
              <div className="cal-row-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(a.id)} title="Edit">✎</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove('activities', a.id, 'activity', a.title)} title="Delete">🗑</button>
              </div>
            </div>
          )
        )}
        {editing == null && <ActivityForm date={date} onDone={onChanged} />}
      </section>

      <section>
        <div className="cal-section-label">
          Done in MyTrack{auto.length ? ` · ${auto.length}` : ''}
          <span className="cal-muted"> · recorded automatically</span>
        </div>
        <ActivityList compact items={showAllAuto ? auto : auto.slice(0, 12)} />
        <div className="cal-auto-foot">
          {auto.length > 12 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAllAuto(!showAllAuto)}>
              {showAllAuto ? 'Show less' : `Show all ${auto.length}`}
            </button>
          )}
          <Link href="/dashboard/activity" className="btn btn-ghost btn-sm">Full activity log →</Link>
        </div>
      </section>
      {ask && <ConfirmModal title={ask.title} message={ask.message} confirmLabel={ask.label} danger onConfirm={confirmRemove} onClose={() => setAsk(null)} />}
    </aside>
  );
}

// ---------- the page ----------
// Rendered in the browser only: dates use the browser's locale and "today" is
// the browser's today, neither of which the server can know.
export default function CalendarView() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <Calendar /> : null;
}

function Calendar() {
  const today = keyOf(new Date());
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [selected, setSelected] = useState(today);
  const [data, setData] = useState({ leaves: [], activities: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [leaveForm, setLeaveForm] = useState(null);
  const [auto, setAuto] = useState([]);

  const days = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const gridFrom = keyOf(days[0]);
  const gridTo = keyOf(days[days.length - 1]);
  const yearFrom = `${cursor.year}-01-01`;
  const yearTo = `${cursor.year}-12-31`;
  // One fetch covers the visible grid and the whole year (for the leave totals).
  const from = gridFrom < yearFrom ? gridFrom : yearFrom;
  const to = gridTo > yearTo ? gridTo : yearTo;

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await api(`/api/calendar?from=${from}&to=${to}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  // What was done in MyTrack on the visible days (recorded automatically).
  const loadAuto = useCallback(async () => {
    try {
      const start = parseKey(gridFrom);
      const end = addDays(parseKey(gridTo), 1);
      const res = await fetch(`/api/activity?from=${start.toISOString()}&to=${end.toISOString()}&limit=2000`);
      if (res.ok) setAuto((await res.json()).items || []);
    } catch {}
  }, [gridFrom, gridTo]);
  useEffect(() => { loadAuto(); }, [loadAuto]);
  const autoByDay = useMemo(() => {
    const map = {};
    for (const it of auto) (map[activityDay(it)] ||= []).push(it);
    return map;
  }, [auto]);

  const byDay = useMemo(() => {
    const map = {};
    const slot = (k) => (map[k] ||= { leaves: [], activities: [] });
    for (const a of data.activities) slot(a.activity_date).activities.push(a);
    for (const l of data.leaves) {
      for (let d = parseKey(l.start_date); keyOf(d) <= l.end_date; d = addDays(d, 1)) slot(keyOf(d)).leaves.push(l);
    }
    return map;
  }, [data]);

  const monthFrom = keyOf(new Date(cursor.year, cursor.month, 1));
  const monthTo = keyOf(new Date(cursor.year, cursor.month + 1, 0));
  const stats = useMemo(() => {
    const sum = (a, b) => data.leaves.reduce((n, l) => n + leaveDays(l, a, b), 0);
    const byType = {};
    for (const l of data.leaves) {
      const n = leaveDays(l, yearFrom, yearTo);
      if (n) byType[l.leave_type] = (byType[l.leave_type] || 0) + n;
    }
    const monthActivities = data.activities.filter((a) => a.activity_date >= monthFrom && a.activity_date <= monthTo);
    const loggedDays = new Set(monthActivities.map((a) => a.activity_date)).size;
    return { month: sum(monthFrom, monthTo), year: sum(yearFrom, yearTo), byType, activities: monthActivities.length, loggedDays };
  }, [data, monthFrom, monthTo, yearFrom, yearTo]);

  function shiftMonth(delta) {
    setCursor(({ year, month }) => {
      const d = new Date(year, month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }
  function goToday() {
    const d = new Date();
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
    setSelected(today);
  }

  const title = new Date(cursor.year, cursor.month, 1).toLocaleDateString(DATE_LOCALE, { month: 'long', year: 'numeric' });
  const sel = selected ? byDay[selected] || { leaves: [], activities: [] } : null;

  return (
    <div className="cal-page">
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <p>Mark your leaves and log what you did each day — everything you do in MyTrack is added automatically. Click a day to see it.</p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-primary" onClick={() => setLeaveForm({ start_date: selected || today })}>
            <i className="fa-solid fa-umbrella-beach" /> Add leave
          </button>
        </div>
      </div>

      <div className="cal-stats">
        <div className="cal-stat"><strong>{stats.month}</strong><span>leave days in {new Date(cursor.year, cursor.month, 1).toLocaleDateString(DATE_LOCALE, { month: 'long' })}</span></div>
        <div className="cal-stat"><strong>{stats.year}</strong><span>leave days in {cursor.year}</span></div>
        <div className="cal-stat"><strong>{stats.activities}</strong><span>activities logged on {stats.loggedDays} day{stats.loggedDays === 1 ? '' : 's'} this month</span></div>
        <Link href="/dashboard/activity" className="cal-stat cal-stat-link">
          <strong>{auto.filter((a) => { const k = activityDay(a); return k >= monthFrom && k <= monthTo; }).length}</strong>
          <span>actions recorded in MyTrack this month →</span>
        </Link>
        {Object.keys(stats.byType).length > 0 && (
          <div className="cal-stat cal-stat-types">
            {LEAVE_TYPES.filter((t) => stats.byType[t.id]).map((t) => (
              <span key={t.id} style={{ '--chip': t.color }}><span className="cal-dot" />{t.label}: {stats.byType[t.id]}</span>
            ))}
          </div>
        )}
      </div>

      {error && <div className="top-error">{error}</div>}

      <div className={`cal-layout${selected ? ' with-day' : ''}`}>
        <div className="cal-month">
          <div className="cal-month-head">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
            <h2>{title}</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
            <button type="button" className="btn btn-sm" onClick={goToday}>Today</button>
            {loading && <span className="cal-muted">Loading…</span>}
          </div>
          <div className="cal-grid">
            {WEEKDAYS.map((w) => <div key={w} className="cal-weekday">{w}</div>)}
            {days.map((d) => {
              const k = keyOf(d);
              const info = byDay[k];
              const leave = info?.leaves[0];
              const cls = [
                'cal-cell',
                d.getMonth() !== cursor.month && 'other',
                isWeekend(d) && 'weekend',
                k === today && 'today',
                k === selected && 'selected',
                leave && 'on-leave',
              ].filter(Boolean).join(' ');
              return (
                <button key={k} type="button" className={cls} onClick={() => setSelected(k)}
                  style={leave ? { '--chip': leaveType(leave.leave_type).color } : undefined}>
                  <span className="cal-num">{d.getDate()}</span>
                  {leave && <span className="cal-leave-tag">{leaveType(leave.leave_type).label.replace(' leave', '')}{leave.half_day ? ' ½' : ''}</span>}
                  {info?.activities.slice(0, 2).map((a) => <span key={a.id} className="cal-item">{a.title}</span>)}
                  {info?.activities.length > 2 && <span className="cal-more">+{info.activities.length - 2} more</span>}
                  {autoByDay[k]?.length > 0 && (
                    <span className="cal-auto-count" title={`${autoByDay[k].length} actions recorded in MyTrack`}>
                      <i className="fa-solid fa-bolt" /> {autoByDay[k].length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {selected && sel && (
          <DayPanel
            date={selected}
            leaves={sel.leaves}
            activities={sel.activities}
            auto={autoByDay[selected] || []}
            onEditLeave={setLeaveForm}
            onChanged={() => { load(); loadAuto(); }}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      {leaveForm && (
        <LeaveModal leave={leaveForm} onClose={() => setLeaveForm(null)} onSaved={() => { setLeaveForm(null); load(); }} />
      )}
    </div>
  );
}

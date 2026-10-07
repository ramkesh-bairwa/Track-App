'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import ConfirmModal from '@/components/ConfirmModal';
import { DATE_LOCALE } from '@/lib/dateLocale';
import './routine.css';

// ISO weekdays as stored in routine_items.days: 1 = Monday … 7 = Sunday.
const WEEKDAYS = [
  { id: '1', short: 'Mon' },
  { id: '2', short: 'Tue' },
  { id: '3', short: 'Wed' },
  { id: '4', short: 'Thu' },
  { id: '5', short: 'Fri' },
  { id: '6', short: 'Sat' },
  { id: '7', short: 'Sun' },
];
const PRESETS = [
  { label: 'Every day', days: '1234567' },
  { label: 'Weekdays', days: '12345' },
  { label: 'Weekends', days: '67' },
];

// ---------- date helpers (local dates as 'YYYY-MM-DD' keys) ----------
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (k, n) => {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return keyOf(d);
};
const weekdayOf = (k) => String(((parseKey(k).getDay() + 6) % 7) + 1);
const daysText = (days) => PRESETS.find((p) => p.days === days)?.label || WEEKDAYS.filter((w) => days.includes(w.id)).map((w) => w.short).join(', ');
const timeText = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
};
// Items that are part of the routine on a given day.
const scheduledOn = (items, date) => items.filter((i) => i.days.includes(weekdayOf(date)) && i.created_on <= date);

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

function ItemForm({ item, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    title: item?.title || '',
    time_of_day: item?.time_of_day || '',
    days: item?.days || '1234567',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleDay = (id) => set('days', form.days.includes(id) ? form.days.replace(id, '') : [...form.days, id].sort().join(''));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (item) await api(`/api/routine/${item.id}`, 'PATCH', form);
      else await api('/api/routine', 'POST', form);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2>{item ? 'Edit routine item' : 'Add to your routine'}</h2>
      {error && <div className="top-error">{error}</div>}
      <form onSubmit={submit}>
        <div className="field-group">
          <label className="field-label" htmlFor="rt-title">What</label>
          <input id="rt-title" className="input" maxLength={255} required autoFocus value={form.title}
            placeholder="e.g. Wake up, Morning walk, Read 20 pages" onChange={(e) => set('title', e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="rt-time">Time (optional)</label>
          <input id="rt-time" className="input rt-time-input" type="time" value={form.time_of_day} onChange={(e) => set('time_of_day', e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label">Repeat on</label>
          <div className="rt-days">
            {WEEKDAYS.map((w) => (
              <button key={w.id} type="button" className={`rt-day${form.days.includes(w.id) ? ' on' : ''}`} onClick={() => toggleDay(w.id)} aria-pressed={form.days.includes(w.id)}>
                {w.short}
              </button>
            ))}
          </div>
          <div className="rt-presets">
            {PRESETS.map((p) => (
              <button key={p.days} type="button" className={`btn btn-sm${form.days === p.days ? '' : ' btn-ghost'}`} onClick={() => set('days', p.days)}>{p.label}</button>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !form.days}>{saving ? 'Saving…' : item ? 'Save changes' : 'Add item'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function RoutineView() {
  const today = keyOf(new Date());
  const [date, setDate] = useState(today);
  const [items, setItems] = useState(null);
  const [checks, setChecks] = useState([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | item
  const [removing, setRemoving] = useState(null);

  const load = useCallback(async () => {
    try {
      const json = await api(`/api/routine?date=${date}`);
      setItems(json.items);
      setChecks(json.checks);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const done = useMemo(() => new Set(checks.map((c) => `${c.item_id}|${c.check_date}`)), [checks]);
  const isDone = (item, d) => done.has(`${item.id}|${d}`);
  const all = items || [];
  const todays = scheduledOn(all, date);
  const doneCount = todays.filter((i) => isDone(i, date)).length;
  const percent = todays.length ? Math.round((doneCount / todays.length) * 100) : 0;
  const week = Array.from({ length: 7 }, (_, n) => {
    const d = addDays(date, n - 6);
    const due = scheduledOn(all, d);
    const ticked = due.filter((i) => isDone(i, d)).length;
    return { date: d, due: due.length, ticked };
  });

  async function toggle(item) {
    const key = `${item.id}|${date}`;
    const next = !done.has(key);
    // Show it straight away; put it back if saving fails.
    setChecks((prev) => (next ? [...prev, { item_id: item.id, check_date: date }] : prev.filter((c) => `${c.item_id}|${c.check_date}` !== key)));
    try {
      await api(`/api/routine/${item.id}/check`, 'PUT', { date, done: next });
    } catch (err) {
      setError(err.message);
      load();
    }
  }

  const label = date === today ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : null;
  const longDate = parseKey(date).toLocaleDateString(DATE_LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="rt-page">
      <div className="page-head">
        <div>
          <h1>Daily Routine</h1>
          <p>Plan the things you do every day and tick them off as you go.</p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            <i className="fa-solid fa-plus" /> Add routine item
          </button>
        </div>
      </div>

      {error && <div className="top-error">{error}</div>}

      <div className="rt-datebar">
        <button type="button" className="btn btn-sm" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">
          <i className="fa-solid fa-chevron-left" />
        </button>
        <strong className="rt-date">{label ? <>{label} <span>· {longDate}</span></> : longDate}</strong>
        <button type="button" className="btn btn-sm" onClick={() => setDate(addDays(date, 1))} disabled={date >= today} aria-label="Next day">
          <i className="fa-solid fa-chevron-right" />
        </button>
        {date !== today && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDate(today)}>Today</button>}
      </div>

      <div className="rt-layout">
        <section className="rt-panel">
          {items !== null && todays.length > 0 && (
            <div className="rt-progress">
              <div className="rt-progress-top">
                <span><strong>{doneCount} of {todays.length}</strong> done</span>
                <span>{percent === 100 ? 'All done — nice work!' : `${percent}%`}</span>
              </div>
              <div className="rt-progress-track"><span style={{ width: `${percent}%` }} /></div>
            </div>
          )}

          {items === null && <p className="rt-empty">Loading…</p>}
          {items && all.length === 0 && (
            <div className="rt-empty">
              <p>Your routine is empty. Add the things you do every day — waking up, exercise, work blocks, reading.</p>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing('new')}>
                <i className="fa-solid fa-plus" /> Add your first item
              </button>
            </div>
          )}
          {items && all.length > 0 && todays.length === 0 && <p className="rt-empty">Nothing in your routine for {parseKey(date).toLocaleDateString(DATE_LOCALE, { weekday: 'long' })}.</p>}

          <ul className="rt-list">
            {todays.map((item) => {
              const checked = isDone(item, date);
              return (
                <li key={item.id} className={`rt-item${checked ? ' done' : ''}`}>
                  <button type="button" className="rt-check" role="checkbox" aria-checked={checked} onClick={() => toggle(item)} title={checked ? 'Mark as not done' : 'Mark as done'}>
                    {checked && <i className="fa-solid fa-check" />}
                  </button>
                  <span className="rt-time">{timeText(item.time_of_day) || 'Any time'}</span>
                  <span className="rt-title" onClick={() => toggle(item)}>{item.title}</span>
                  <span className="rt-item-actions">
                    <button type="button" className="btn btn-ghost btn-sm" title="Edit" onClick={() => setEditing(item)}><i className="fa-solid fa-pen" /></button>
                    <button type="button" className="btn btn-ghost btn-sm" title="Delete" onClick={() => setRemoving(item)}><i className="fa-solid fa-trash" /></button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="rt-side">
          <section className="rt-panel">
            <div className="rt-label">Last 7 days</div>
            <div className="rt-week">
              {week.map((d) => {
                const p = d.due ? d.ticked / d.due : 0;
                return (
                  <button key={d.date} type="button" className={`rt-week-day${d.date === date ? ' active' : ''}`} onClick={() => setDate(d.date)}
                    title={d.due ? `${d.ticked} of ${d.due} done` : 'Nothing scheduled'}>
                    <span className="rt-week-bar"><span style={{ height: `${p * 100}%` }} className={p === 1 ? 'full' : ''} /></span>
                    <span className="rt-week-name">{parseKey(d.date).toLocaleDateString(DATE_LOCALE, { weekday: 'narrow' })}</span>
                    <span className="rt-week-num">{d.due ? `${Math.round(p * 100)}%` : '—'}</span>
                  </button>
                );
              })}
            </div>
          </section>
          <section className="rt-panel">
            <div className="rt-label">All routine items · {all.length}</div>
            {all.length === 0 && <p className="rt-empty-sm">None yet.</p>}
            {all.map((item) => (
              <div key={item.id} className="rt-all-item">
                <span className="rt-all-text">
                  <strong>{item.title}</strong>
                  <span>{[timeText(item.time_of_day), daysText(item.days)].filter(Boolean).join(' · ')}</span>
                </span>
                <button type="button" className="btn btn-ghost btn-sm" title="Edit" onClick={() => setEditing(item)}><i className="fa-solid fa-pen" /></button>
                <button type="button" className="btn btn-ghost btn-sm" title="Delete" onClick={() => setRemoving(item)}><i className="fa-solid fa-trash" /></button>
              </div>
            ))}
          </section>
        </aside>
      </div>

      {editing && <ItemForm item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={load} />}
      {removing && (
        <ConfirmModal
          title="Remove from your routine?"
          message={`“${removing.title}” and its tick history will be deleted.`}
          confirmLabel="Remove"
          danger
          onConfirm={async () => {
            await api(`/api/routine/${removing.id}`, 'DELETE');
            await load();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

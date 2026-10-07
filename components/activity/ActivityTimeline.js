'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ActivityList, { KINDS, activityDay } from './ActivityList';
import { DATE_LOCALE } from '@/lib/dateLocale';

const STEP_DAYS = 7;

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayTitle = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = startOfDay(new Date());
  const diff = Math.round((today - date) / 86400000);
  const label = date.toLocaleDateString(DATE_LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return diff === 0 ? `Today · ${label}` : diff === 1 ? `Yesterday · ${label}` : label;
};

// Rendered in the browser only, so days and times follow the viewer's clock.
export default function ActivityTimeline() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <Timeline /> : null;
}

function Timeline() {
  const [since, setSince] = useState(() => addDays(startOfDay(new Date()), -(STEP_DAYS - 1)));
  const [items, setItems] = useState(null);
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const to = addDays(startOfDay(new Date()), 1);
      const res = await fetch(`/api/activity?from=${since.toISOString()}&to=${to.toISOString()}&limit=2000`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load activity.');
      setItems(json.items);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [since]);
  useEffect(() => { load(); }, [load]);

  const days = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const map = new Map();
    for (const it of items || []) {
      if (kind && it.kind !== kind) continue;
      if (needle && !it.summary.toLowerCase().includes(needle)) continue;
      const k = activityDay(it);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(it);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [items, kind, search]);
  const kindsPresent = useMemo(() => [...new Set((items || []).map((i) => i.kind))], [items]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p>Everything you did in MyTrack, recorded automatically — tracks, entries, notes, tasks, code, downloads and more — plus changes others made to your boards and to tasks you&apos;re on.</p>
        </div>
        <div className="page-head-actions">
          <Link href="/dashboard/calendar" className="btn btn-sm"><i className="fa-solid fa-calendar-days" /> Calendar</Link>
        </div>
      </div>

      <div className="act-toolbar">
        <input type="search" className="input act-search" placeholder="Search what you did…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Everything</option>
          {kindsPresent.map((k) => <option key={k} value={k}>{KINDS[k]?.label || k}</option>)}
        </select>
      </div>

      {error && <div className="top-error">{error}</div>}
      {items === null && !error && <p className="act-empty">Loading…</p>}
      {items && days.length === 0 && <p className="act-empty">No activity {search || kind ? 'matches that' : 'in this period'}.</p>}

      {days.map(([key, list]) => (
        <section key={key} className="act-day">
          <div className="act-day-head">
            <h2>{dayTitle(key)}</h2>
            <span>{list.length} action{list.length === 1 ? '' : 's'}</span>
          </div>
          <ActivityList items={list} />
        </section>
      ))}

      {items && (
        <div className="act-more">
          <button type="button" className="btn btn-sm" disabled={loading} onClick={() => setSince((d) => addDays(d, -STEP_DAYS * 4))}>
            {loading ? 'Loading…' : `Show earlier (since ${since.toLocaleDateString(DATE_LOCALE, { day: 'numeric', month: 'short' })})`}
          </button>
        </div>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import ConfirmModal from '@/components/ConfirmModal';
import { DATE_LOCALE } from '@/lib/dateLocale';
import './expenses.css';

export const CATEGORIES = [
  { id: 'food', label: 'Food & dining', icon: 'fa-utensils', color: '#e8a33d' },
  { id: 'groceries', label: 'Groceries', icon: 'fa-basket-shopping', color: '#35c2a6' },
  { id: 'transport', label: 'Transport', icon: 'fa-bus', color: '#5b8def' },
  { id: 'fuel', label: 'Fuel', icon: 'fa-gas-pump', color: '#d9773a' },
  { id: 'shopping', label: 'Shopping', icon: 'fa-bag-shopping', color: '#d65db1' },
  { id: 'bills', label: 'Bills & recharge', icon: 'fa-file-invoice', color: '#e5646b' },
  { id: 'rent', label: 'Rent', icon: 'fa-house', color: '#9b6b4a' },
  { id: 'health', label: 'Health', icon: 'fa-heart-pulse', color: '#ef5f7a' },
  { id: 'education', label: 'Education', icon: 'fa-graduation-cap', color: '#6c7bff' },
  { id: 'entertainment', label: 'Entertainment', icon: 'fa-film', color: '#b07ce8' },
  { id: 'travel', label: 'Travel', icon: 'fa-plane', color: '#3fb6d9' },
  { id: 'gifts', label: 'Gifts', icon: 'fa-gift', color: '#e0699a' },
  { id: 'personal', label: 'Personal care', icon: 'fa-spa', color: '#7fbf5a' },
  { id: 'other', label: 'Other', icon: 'fa-receipt', color: '#8b93a5' },
];
const PAYMENT_METHODS = [
  { id: 'cash', label: 'Cash' },
  { id: 'upi', label: 'UPI' },
  { id: 'card', label: 'Card' },
  { id: 'bank', label: 'Bank transfer' },
  { id: 'wallet', label: 'Wallet' },
  { id: 'other', label: 'Other' },
];
const categoryOf = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
const methodOf = (id) => PAYMENT_METHODS.find((m) => m.id === id) || PAYMENT_METHODS[PAYMENT_METHODS.length - 1];

// ---------- formatting ----------
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const fmt = (n) => money.format(n || 0);
const pad = (n) => String(n).padStart(2, '0');
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const parseKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
};
const monthLabel = (m) => parseKey(m).toLocaleDateString(DATE_LOCALE, { month: 'long', year: 'numeric' });
const shiftMonth = (m, n) => {
  const d = parseKey(m);
  const next = new Date(d.getFullYear(), d.getMonth() + n, 1);
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}`;
};
function dayLabel(k) {
  const today = todayKey();
  const yesterday = (() => {
    const d = parseKey(today);
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  })();
  const long = parseKey(k).toLocaleDateString(DATE_LOCALE, { weekday: 'long', day: 'numeric', month: 'short' });
  if (k === today) return `Today · ${long}`;
  if (k === yesterday) return `Yesterday · ${long}`;
  return long;
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

function ExpenseForm({ expense, defaultDate, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    spent_on: expense?.spent_on || defaultDate,
    amount: expense ? String(expense.amount) : '',
    description: expense?.description || '',
    category: expense?.category || 'food',
    payment_method: expense?.payment_method || 'upi',
    note: expense?.note || '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e, addAnother = false) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (expense) await api(`/api/expenses/${expense.id}`, 'PATCH', form);
      else await api('/api/expenses', 'POST', form);
      await onSaved();
      if (addAnother) {
        setForm((f) => ({ ...f, amount: '', description: '', note: '' }));
        setSaving(false);
      } else {
        onClose();
      }
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2>{expense ? 'Edit expense' : 'Add expense'}</h2>
      {error && <div className="top-error">{error}</div>}
      <form onSubmit={submit}>
        <div className="exp-form-row">
          <div className="field-group">
            <label className="field-label" htmlFor="exp-amount">Amount (₹)</label>
            <input id="exp-amount" className="input exp-amount-input" type="number" inputMode="decimal" min="0.01" step="0.01" required autoFocus
              value={form.amount} placeholder="0" onChange={(e) => set('amount', e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="exp-date">Date</label>
            <input id="exp-date" className="input" type="date" required max={todayKey()} value={form.spent_on} onChange={(e) => set('spent_on', e.target.value)} />
          </div>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="exp-desc">What for</label>
          <input id="exp-desc" className="input" maxLength={255} required value={form.description}
            placeholder="e.g. Lunch, Auto to office, Electricity bill" onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label">Category</label>
          <div className="exp-cat-picker">
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" className={`exp-cat-chip${form.category === c.id ? ' active' : ''}`}
                style={{ '--chip': c.color }} onClick={() => set('category', c.id)}>
                <i className={`fa-solid ${c.icon}`} /> {c.label}
              </button>
            ))}
          </div>
        </div>
        <div className="exp-form-row">
          <div className="field-group">
            <label className="field-label" htmlFor="exp-method">Paid with</label>
            <select id="exp-method" className="input" value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
              {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="exp-note">Note (optional)</label>
            <input id="exp-note" className="input" maxLength={500} value={form.note} placeholder="Shop, who with…" onChange={(e) => set('note', e.target.value)} />
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          {!expense && (
            <button type="button" className="btn" disabled={saving} onClick={(e) => submit(e, true)}>Save &amp; add another</button>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : expense ? 'Save changes' : 'Add expense'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function ExpensesView() {
  const [month, setMonth] = useState(() => todayKey().slice(0, 7));
  const [expenses, setExpenses] = useState(null);
  const [previousTotal, setPreviousTotal] = useState(0);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | expense
  const [removing, setRemoving] = useState(null);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const json = await api(`/api/expenses?month=${month}`);
      setExpenses(json.expenses);
      setPreviousTotal(json.previousTotal);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [month]);
  useEffect(() => {
    setExpenses(null);
    load();
  }, [load]);

  const today = todayKey();
  const isCurrentMonth = month === today.slice(0, 7);
  const list = expenses || [];
  const total = list.reduce((s, e) => s + e.amount, 0);
  const todayTotal = list.filter((e) => e.spent_on === today).reduce((s, e) => s + e.amount, 0);
  // Average over the days of the month so far (all of it, for a past month).
  const daysCounted = isCurrentMonth ? Number(today.slice(8)) : new Date(...month.split('-').map(Number), 0).getDate();
  const average = total / Math.max(daysCounted, 1);
  const change = previousTotal > 0 ? ((total - previousTotal) / previousTotal) * 100 : null;

  const byCategory = useMemo(() => {
    const sums = new Map();
    list.forEach((e) => sums.set(e.category, (sums.get(e.category) || 0) + e.amount));
    return [...sums.entries()].map(([id, amount]) => ({ ...categoryOf(id), amount })).sort((a, b) => b.amount - a.amount);
  }, [list]);
  const byMethod = useMemo(() => {
    const sums = new Map();
    list.forEach((e) => sums.set(e.payment_method, (sums.get(e.payment_method) || 0) + e.amount));
    return [...sums.entries()].map(([id, amount]) => ({ ...methodOf(id), amount })).sort((a, b) => b.amount - a.amount);
  }, [list]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter(
      (e) => (!category || e.category === category) && (!q || `${e.description} ${e.note || ''}`.toLowerCase().includes(q))
    );
  }, [list, category, search]);
  const days = useMemo(() => {
    const groups = new Map();
    shown.forEach((e) => {
      if (!groups.has(e.spent_on)) groups.set(e.spent_on, []);
      groups.get(e.spent_on).push(e);
    });
    return [...groups.entries()].map(([date, items]) => ({ date, items, total: items.reduce((s, e) => s + e.amount, 0) }));
  }, [shown]);
  const filtered = category || search.trim();

  return (
    <div className="exp-page">
      <div className="page-head">
        <div>
          <h1>Daily Expenses</h1>
          <p>Note down what you spend each day and see where your money goes.</p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            <i className="fa-solid fa-plus" /> Add expense
          </button>
        </div>
      </div>

      {error && <div className="top-error">{error}</div>}

      <div className="exp-monthbar">
        <button type="button" className="btn btn-sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
          <i className="fa-solid fa-chevron-left" />
        </button>
        <strong className="exp-month">{monthLabel(month)}</strong>
        <button type="button" className="btn btn-sm" onClick={() => setMonth(shiftMonth(month, 1))} disabled={isCurrentMonth} aria-label="Next month">
          <i className="fa-solid fa-chevron-right" />
        </button>
        {!isCurrentMonth && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMonth(today.slice(0, 7))}>This month</button>
        )}
      </div>

      <div className="exp-stats">
        {isCurrentMonth && (
          <div className="exp-stat">
            <span>Today</span>
            <strong>{fmt(todayTotal)}</strong>
          </div>
        )}
        <div className="exp-stat">
          <span>{isCurrentMonth ? 'This month' : monthLabel(month)}</span>
          <strong>{fmt(total)}</strong>
          <small>{list.length} {list.length === 1 ? 'entry' : 'entries'}</small>
        </div>
        <div className="exp-stat">
          <span>Daily average</span>
          <strong>{fmt(average)}</strong>
          <small>over {daysCounted} {daysCounted === 1 ? 'day' : 'days'}</small>
        </div>
        <div className="exp-stat">
          <span>vs previous month</span>
          <strong className={change == null ? '' : change > 0 ? 'exp-up' : 'exp-down'}>
            {change == null ? '—' : `${change > 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(0)}%`}
          </strong>
          <small>{fmt(previousTotal)} last month</small>
        </div>
      </div>

      <div className="exp-layout">
        <section className="exp-panel">
          <div className="exp-filters">
            <input className="input input-sm" type="search" placeholder="Search expenses…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="input input-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>

          {expenses === null && <p className="exp-empty">Loading…</p>}
          {expenses && days.length === 0 && (
            <div className="exp-empty">
              {filtered ? 'Nothing matches that filter.' : (
                <>
                  <p>No expenses in {monthLabel(month)} yet.</p>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing('new')}>
                    <i className="fa-solid fa-plus" /> Add your first expense
                  </button>
                </>
              )}
            </div>
          )}

          {days.map((day) => (
            <div key={day.date} className="exp-day">
              <div className="exp-day-head">
                <span>{dayLabel(day.date)}</span>
                <strong>{fmt(day.total)}</strong>
              </div>
              {day.items.map((e) => {
                const c = categoryOf(e.category);
                return (
                  <div key={e.id} className="exp-row">
                    <span className="exp-row-icon" style={{ '--chip': c.color }}><i className={`fa-solid ${c.icon}`} /></span>
                    <span className="exp-row-text">
                      <strong>{e.description}</strong>
                      <span>{c.label} · {methodOf(e.payment_method).label}{e.note ? ` · ${e.note}` : ''}</span>
                    </span>
                    <span className="exp-row-amount">{fmt(e.amount)}</span>
                    <span className="exp-row-actions">
                      <button type="button" className="btn btn-ghost btn-sm" title="Edit" onClick={() => setEditing(e)}><i className="fa-solid fa-pen" /></button>
                      <button type="button" className="btn btn-ghost btn-sm" title="Delete" onClick={() => setRemoving(e)}><i className="fa-solid fa-trash" /></button>
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </section>

        <aside className="exp-side">
          <section className="exp-panel">
            <div className="exp-label">By category</div>
            {byCategory.length === 0 && <p className="exp-empty-sm">No spending yet.</p>}
            {byCategory.map((c) => (
              <button key={c.id} type="button" className={`exp-bar${category === c.id ? ' active' : ''}`}
                onClick={() => setCategory(category === c.id ? '' : c.id)} title="Show only this category">
                <span className="exp-bar-top">
                  <span><i className={`fa-solid ${c.icon}`} style={{ color: c.color }} /> {c.label}</span>
                  <span>{fmt(c.amount)} <small>{((c.amount / total) * 100).toFixed(0)}%</small></span>
                </span>
                <span className="exp-bar-track"><span style={{ width: `${(c.amount / byCategory[0].amount) * 100}%`, background: c.color }} /></span>
              </button>
            ))}
          </section>
          <section className="exp-panel">
            <div className="exp-label">By payment method</div>
            {byMethod.length === 0 && <p className="exp-empty-sm">No spending yet.</p>}
            {byMethod.map((m) => (
              <div key={m.id} className="exp-method">
                <span>{m.label}</span>
                <strong>{fmt(m.amount)}</strong>
              </div>
            ))}
          </section>
        </aside>
      </div>

      {editing && (
        <ExpenseForm
          expense={editing === 'new' ? null : editing}
          defaultDate={isCurrentMonth ? today : `${month}-01`}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
      {removing && (
        <ConfirmModal
          title="Delete this expense?"
          message={`${removing.description} — ${fmt(removing.amount)} on ${dayLabel(removing.spent_on)}.`}
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            await api(`/api/expenses/${removing.id}`, 'DELETE');
            await load();
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

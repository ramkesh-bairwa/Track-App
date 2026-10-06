'use client';

// Extra note editor tools: templates, calculator, statistics, links to other
// notes, snapshots, read aloud and voice typing.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { collectHashtags } from '@/lib/noteExtensionsExtra';
import { DATE_LOCALE } from '@/lib/dateLocale';

const today = () => new Date().toLocaleDateString(DATE_LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

// ---------- templates ----------

export const TEMPLATES = [
  {
    id: 'meeting', label: 'Meeting notes', icon: '👥',
    html: () => `<h2>Meeting notes — ${today()}</h2><p><strong>Attendees:</strong> </p><p><strong>Purpose:</strong> </p><h3>Agenda</h3><ol><li><p></p></li></ol><h3>Discussion</h3><p></p><h3>Decisions</h3><ul><li><p></p></li></ul><h3>Action items</h3><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Who — what — by when</p></li></ul>`,
  },
  {
    id: 'journal', label: 'Daily journal', icon: '📔',
    html: () => `<h2>${today()}</h2><h3>Grateful for</h3><ol><li><p></p></li><li><p></p></li><li><p></p></li></ol><h3>Today's top 3</h3><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li><li data-type="taskItem" data-checked="false"><p></p></li><li data-type="taskItem" data-checked="false"><p></p></li></ul><h3>Notes</h3><p></p><h3>What went well / what to improve</h3><p></p>`,
  },
  {
    id: 'todo', label: 'To-do list', icon: '✅',
    html: () => `<h2>To do — ${today()}</h2><h3>🔥 Urgent</h3><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul><h3>📌 Important</h3><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul><h3>🕐 Later</h3><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>`,
  },
  {
    id: 'project', label: 'Project plan', icon: '🚀',
    html: () => `<h2>Project: </h2><table><tbody><tr><th><p>Owner</p></th><td><p></p></td></tr><tr><th><p>Start</p></th><td><p></p></td></tr><tr><th><p>Deadline</p></th><td><p></p></td></tr><tr><th><p>Status</p></th><td><p>Planning</p></td></tr></tbody></table><h3>Goal</h3><p></p><h3>Milestones</h3><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul><h3>Risks</h3><ul><li><p></p></li></ul><h3>Resources & links</h3><ul><li><p></p></li></ul>`,
  },
  {
    id: 'weekly', label: 'Weekly review', icon: '🗓️',
    html: () => `<h2>Weekly review — ${today()}</h2><h3>Wins this week</h3><ul><li><p></p></li></ul><h3>Challenges</h3><ul><li><p></p></li></ul><h3>Lessons learned</h3><p></p><h3>Goals for next week</h3><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>`,
  },
  {
    id: 'bug', label: 'Bug report', icon: '🐛',
    html: () => `<h2>Bug: </h2><p><strong>Reported:</strong> ${today()}</p><p><strong>Severity:</strong> Low / Medium / High</p><h3>Steps to reproduce</h3><ol><li><p></p></li></ol><h3>Expected</h3><p></p><h3>Actual</h3><p></p><h3>Notes</h3><p></p>`,
  },
];

export const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.';

// ---------- calculator ----------

// Evaluates + − × ÷ % ^ and brackets without eval(). Returns a number or null.
export function calculate(input) {
  const src = String(input).replace(/[,₹$€£\s]/g, '').replace(/[×x]/g, '*').replace(/÷/g, '/').replace(/=+$/, '');
  if (!src || /[^0-9+\-*/%^().]/.test(src)) return null;
  let i = 0;
  const peek = () => src[i];
  function number() {
    const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(src.slice(i));
    if (!m) throw new Error('number');
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function factor() {
    if (peek() === '-') { i += 1; return -factor(); }
    if (peek() === '+') { i += 1; return factor(); }
    let v;
    if (peek() === '(') {
      i += 1;
      v = expr();
      if (peek() !== ')') throw new Error('bracket');
      i += 1;
    } else v = number();
    if (peek() === '%') { i += 1; v /= 100; }
    if (peek() === '^') { i += 1; v **= factor(); }
    return v;
  }
  function term() {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = src[i++];
      const r = factor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = src[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  try {
    const v = expr();
    if (i !== src.length || !Number.isFinite(v)) return null;
    return Math.round(v * 1e10) / 1e10;
  } catch {
    return null;
  }
}

// ---------- modal shell ----------

function Modal({ title, onClose, children, wide }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal${wide ? ' modal-lg' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="new-track-head">
          <h2>{title}</h2>
          <button type="button" className="new-track-close" onClick={onClose} title="Close">×</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

// ---------- statistics ----------

const STOP = new Set('the a an and or but of to in on at for with is are was were be been it this that as by from i you he she we they my your our not no so if then than too very can will just do does did have has had me him her them its'.split(' '));

export function StatsModal({ editor, onClose }) {
  const stats = useMemo(() => {
    const doc = editor.state.doc;
    const text = doc.textBetween(0, doc.content.size, '\n', ' ');
    const words = text.match(/[\p{L}\p{N}'’-]+/gu) || [];
    const sentences = text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim()).length;
    let paragraphs = 0;
    let headings = 0;
    let images = 0;
    let tables = 0;
    let links = 0;
    doc.descendants((n) => {
      if (n.isTextblock && n.textContent.trim()) paragraphs += 1;
      if (n.type.name === 'heading') headings += 1;
      if (n.type.name === 'image') images += 1;
      if (n.type.name === 'table') tables += 1;
      if (n.isText && n.marks.some((m) => m.type.name === 'link')) links += 1;
    });
    const freq = new Map();
    words.forEach((w) => {
      const k = w.toLowerCase();
      if (k.length > 2 && !STOP.has(k)) freq.set(k, (freq.get(k) || 0) + 1);
    });
    const letters = words.reduce((s, w) => s + w.length, 0);
    const longest = words.reduce((a, w) => (w.length > a.length ? w : a), '');
    const mins = (n) => (n < 1 ? '< 1 min' : `${Math.round(n)} min`);
    return {
      rows: [
        ['Words', words.length],
        ['Unique words', new Set(words.map((w) => w.toLowerCase())).size],
        ['Characters', text.replace(/\n/g, '').length],
        ['Characters (no spaces)', text.replace(/\s/g, '').length],
        ['Sentences', sentences],
        ['Paragraphs', paragraphs],
        ['Headings', headings],
        ['Images / tables / links', `${images} / ${tables} / ${links}`],
        ['Average words per sentence', sentences ? (words.length / sentences).toFixed(1) : '—'],
        ['Average word length', words.length ? `${(letters / words.length).toFixed(1)} letters` : '—'],
        ['Longest word', longest || '—'],
        ['Reading time', mins(words.length / 220)],
        ['Speaking time', mins(words.length / 130)],
      ],
      top: [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
      tags: collectHashtags(doc),
    };
  }, [editor]);

  return (
    <Modal title="Note statistics" onClose={onClose} wide>
      <table className="note-shortcuts note-stats">
        <tbody>
          {stats.rows.map(([k, v]) => <tr key={k}><td>{k}</td><td><strong>{v}</strong></td></tr>)}
        </tbody>
      </table>
      {stats.top.length > 0 && (
        <>
          <p className="field-label note-stats-head">Most used words</p>
          <div className="note-stats-chips">{stats.top.map(([w, n]) => <span key={w}>{w} <small>{n}</small></span>)}</div>
        </>
      )}
      {stats.tags.length > 0 && (
        <>
          <p className="field-label note-stats-head">Hashtags</p>
          <div className="note-stats-chips">{stats.tags.map(([w, n]) => <span key={w} className="note-hashtag">{w} <small>{n}</small></span>)}</div>
        </>
      )}
    </Modal>
  );
}

// ---------- link to another note ----------

export function NoteLinkPicker({ onPick, onClose }) {
  const [notes, setNotes] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/notes')
      .then((r) => r.json().then((j) => (r.ok ? j : Promise.reject(new Error(j.error || 'Could not load notes')))))
      .then((j) => setNotes(j.notes))
      .catch((e) => setError(e.message));
  }, []);
  const shown = (notes || []).filter((n) => !q.trim() || n.title.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Modal title="Link to another note" onClose={onClose}>
      {error && <div className="top-error">{error}</div>}
      <input className="input" autoFocus placeholder="Search your notes…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="note-pick-list">
        {notes === null && !error && <p className="field-hint">Loading…</p>}
        {notes && shown.length === 0 && <p className="field-hint">No notes match.</p>}
        {shown.map((n) => (
          <button key={n.uuid} type="button" className="note-pick-item" onClick={() => onPick(n)}>
            <span>📝</span> {n.title || 'Untitled'}
          </button>
        ))}
      </div>
    </Modal>
  );
}

// ---------- snapshots (kept in this browser) ----------

const snapKey = (id) => `mytrack_note_snapshots_${id}`;
export function readSnapshots(id) {
  try {
    return JSON.parse(localStorage.getItem(snapKey(id)) || '[]');
  } catch {
    return [];
  }
}
export function saveSnapshot(id, html, words) {
  const list = [{ at: new Date().toISOString(), html, words }, ...readSnapshots(id)].slice(0, 20);
  try {
    localStorage.setItem(snapKey(id), JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function SnapshotsModal({ noteId, onRestore, onClose }) {
  const [list, setList] = useState(() => readSnapshots(noteId));
  const remove = (at) => {
    const next = list.filter((s) => s.at !== at);
    setList(next);
    try {
      localStorage.setItem(snapKey(noteId), JSON.stringify(next));
    } catch {}
  };
  return (
    <Modal title="Snapshots" onClose={onClose}>
      <p className="field-hint">Snapshots are saved copies of this note, kept in this browser. Restoring one replaces the note's current text (you can undo with Ctrl+Z).</p>
      {list.length === 0 && <p className="field-hint">No snapshots yet — use “Save snapshot” in the ⋯ menu.</p>}
      <div className="note-pick-list">
        {list.map((s) => (
          <div key={s.at} className="note-snap-row">
            <span>
              <strong>{new Date(s.at).toLocaleString(DATE_LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</strong>
              <small>{s.words} words</small>
            </span>
            <button type="button" className="btn btn-sm" onClick={() => onRestore(s.html)}>Restore</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove(s.at)} title="Delete snapshot">🗑</button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ---------- speech ----------

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
export const canDictate = () => typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

// Starts voice typing; calls onText with each finished phrase. Returns stop().
export function startDictation(onText, onEnd) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new Recognition();
  rec.continuous = true;
  rec.interimResults = false;
  rec.lang = navigator.language || 'en-IN';
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i += 1) if (e.results[i].isFinal) onText(e.results[i][0].transcript);
  };
  rec.onend = onEnd;
  rec.onerror = onEnd;
  rec.start();
  return () => rec.stop();
}

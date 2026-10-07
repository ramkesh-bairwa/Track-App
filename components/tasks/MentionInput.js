'use client';

import { useRef, useState } from 'react';
import { Avatar } from '@/components/tasks/taskUi';

// The "@word" being typed right before the cursor, if any.
function mentionQuery(text, caret) {
  const before = text.slice(0, caret);
  const m = before.match(/(^|\s)@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/);
  return m ? { start: before.length - m[2].length - 1, q: m[2].toLowerCase() } : null;
}

// Textarea with @mention autocomplete: typing "@" lists the board's people;
// ↑/↓ + Enter (or a click) inserts "@Name ". The server reads "@Name" back out
// of the text, so nothing else needs to be sent.
export default function MentionInput({ value, onChange, people, placeholder, rows = 2, autoFocus, onSubmit, onCancel }) {
  const ref = useRef(null);
  const [menu, setMenu] = useState(null); // { start, q }
  const [index, setIndex] = useState(0);

  const matches = menu
    ? people.filter((p) => p.name && p.name.toLowerCase().includes(menu.q)).slice(0, 6)
    : [];

  function update(text, caret) {
    onChange(text);
    const found = mentionQuery(text, caret);
    setMenu(found);
    setIndex(0);
  }

  function pick(person) {
    const el = ref.current;
    const caret = el.selectionStart;
    const text = `${value.slice(0, menu.start)}@${person.name} ${value.slice(caret)}`;
    const pos = menu.start + person.name.length + 2;
    onChange(text);
    setMenu(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function onKeyDown(e) {
    if (menu && matches.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(matches[index]);
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenu(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit?.();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel?.();
    }
  }

  return (
    <div className="mention-input">
      <textarea
        ref={ref}
        className="input"
        rows={rows}
        maxLength={2000}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => update(e.target.value, e.target.selectionStart)}
        onKeyDown={onKeyDown}
        onClick={(e) => setMenu(mentionQuery(value, e.target.selectionStart))}
        onBlur={() => setTimeout(() => setMenu(null), 150)}
      />
      {menu && matches.length > 0 && (
        <div className="mention-menu" role="listbox">
          {matches.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={i === index}
              className={i === index ? 'active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              onMouseEnter={() => setIndex(i)}
            >
              <Avatar person={p} size={20} />
              <span>{p.name}</span>
              {p.email && <small>{p.email}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Comment text with each @mention highlighted.
export function MentionText({ text, mentions = [] }) {
  if (!mentions.length) return text;
  const names = [...mentions].sort((a, b) => b.name.length - a.name.length).map((m) => m.name);
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(@(?:${escaped.join('|')}))`, 'gi'));
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="mention">{part}</mark>
    ) : (
      part
    )
  );
}

// Client-side twin of the server's findMentions — used to highlight names in
// logged comment text, which doesn't carry its mention list.
export function mentionsIn(text, people) {
  const lower = (text || '').toLowerCase();
  return people.filter((p) => p.name && lower.includes(`@${p.name.toLowerCase()}`)).map((p) => ({ id: p.id, name: p.name }));
}

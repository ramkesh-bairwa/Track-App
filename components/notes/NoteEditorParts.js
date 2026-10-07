'use client';

// Building blocks for the note editor toolbar: dropdown menus, colour
// palettes, the table-size picker, emoji / symbol pickers, the "/" menu and
// the find & replace bar.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

// ---------- dropdown ----------

export function Dropdown({ label, title, children, className = '', active = false, wide = false }) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const ref = useRef(null);
  const panelRef = useRef(null);
  // Keep the panel inside the window: nudge it left if it would overflow.
  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    const overflow = rect.right - (window.innerWidth - 12);
    setShift((s) => (overflow > 0 ? s - overflow : s < 0 && rect.right - s < window.innerWidth - 12 ? 0 : s));
  }, [open]);
  useEffect(() => {
    if (!open) setShift(0);
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className={`note-dd ${className}`} ref={ref}>
      <button
        type="button"
        className={`note-tb-btn note-dd-trigger${active || open ? ' active' : ''}`}
        title={title}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        {label} <span className="note-dd-caret">▾</span>
      </button>
      {open && (
        <div ref={panelRef} style={shift ? { transform: `translateX(${shift}px)` } : undefined} className={`note-dd-panel${wide ? ' wide' : ''}`} onMouseDown={(e) => e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && e.preventDefault()}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, children, shortcut, active, disabled, close }) {
  return (
    <button
      type="button"
      className={`note-dd-item${active ? ' active' : ''}`}
      disabled={disabled}
      onClick={() => {
        onClick();
        close?.();
      }}
    >
      <span>{children}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}

export const MenuLabel = ({ children }) => <div className="note-dd-label">{children}</div>;
export const MenuSep = () => <div className="note-dd-sep" />;

// ---------- colours ----------

export const TEXT_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#cccccc', '#ffffff',
  '#e5646b', '#e8a33d', '#f2d45c', '#35c2a6', '#4fa6e8', '#6c7bff',
  '#a36be8', '#e86bb7', '#8b1a1a', '#b45309', '#166534', '#1e3a8a',
  '#581c87', '#831843', '#0f766e', '#475569', '#92400e', '#be123c',
];
export const HIGHLIGHT_COLORS = [
  '#fff59d', '#ffe0b2', '#c8e6c9', '#b3e5fc', '#e1bee7', '#f8bbd0',
  '#ffccbc', '#d7ccc8', '#cfd8dc', '#b2dfdb', '#fde68a', '#bbf7d0',
];

export function ColorGrid({ colors, value, onPick, onClear, clearLabel = 'Remove colour', close }) {
  return (
    <div className="note-color-pop">
      <div className="note-color-grid">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            className={`note-swatch${value?.toLowerCase() === c ? ' active' : ''}`}
            style={{ background: c }}
            title={c}
            onClick={() => {
              onPick(c);
              close?.();
            }}
          />
        ))}
      </div>
      <div className="note-color-row">
        <label className="note-color-custom">
          Custom
          <input type="color" value={value || '#000000'} onChange={(e) => onPick(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            onClear();
            close?.();
          }}
        >
          {clearLabel}
        </button>
      </div>
    </div>
  );
}

// ---------- table size picker ----------

export function TableGridPicker({ onPick }) {
  const [hover, setHover] = useState({ r: 3, c: 3 });
  const [header, setHeader] = useState(true);
  return (
    <div className="note-table-picker">
      <div className="note-table-grid" onMouseLeave={() => setHover({ r: 3, c: 3 })}>
        {Array.from({ length: 8 }, (_, r) =>
          Array.from({ length: 10 }, (_, c) => (
            <button
              key={`${r}-${c}`}
              type="button"
              className={`note-table-cell${r < hover.r && c < hover.c ? ' on' : ''}`}
              onMouseEnter={() => setHover({ r: r + 1, c: c + 1 })}
              onClick={() => onPick(r + 1, c + 1, header)}
            />
          ))
        )}
      </div>
      <div className="note-table-picker-foot">
        <span>{hover.r} × {hover.c}</span>
        <label className="checkbox-row">
          <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} />
          <span>Header row</span>
        </label>
      </div>
    </div>
  );
}

// ---------- emoji & symbols ----------

const EMOJI = {
  Smileys: '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😎 🤓 🤔 🤨 😐 😴 😮 😢 😭 😡 🤯 🥳 😬 🙄 😷',
  Gestures: '👍 👎 👌 ✌️ 🤞 👏 🙌 🙏 💪 👉 👈 👆 👇 ✋ 🤝 👀 🧠 ❤️ 💔 💯',
  Work: '✅ ❌ ⚠️ ❗ ❓ 📌 📍 📎 📝 📄 📊 📈 📉 🗂️ 📁 📅 ⏰ ⏳ 🔔 🔒 🔑 💡 🚀 🎯 🏆 ⭐ 🔥 ✨ 💬 📣',
  Objects: '💻 🖥️ 📱 ⌨️ 🖨️ 📷 🎧 📦 🛒 💰 💳 🧾 🏠 🏢 🚗 ✈️ 🌍 ☀️ 🌧️ ☕ 🍕 🎉 🎁 📚 ✏️',
  Symbols: '➡️ ⬅️ ⬆️ ⬇️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 ⬛ ⬜ ☑️ 🔘 ♻️ ⛔ 🚫',
};
const SYMBOLS = {
  Punctuation: '— – … • · ‣ ¶ § † ‡ ‰ ′ ″ « » ‹ › “ ” ‘ ’ ¡ ¿',
  Currency: '₹ $ € £ ¥ ¢ ₩ ₽ ₺ ₿ ¤',
  Math: '± × ÷ = ≠ ≈ ≤ ≥ ∞ √ ∑ ∏ ∫ ∂ ∆ π µ ° ‰ ½ ⅓ ¼ ¾ ² ³ ¹ ∈ ∉ ∩ ∪ ⊂ ⊃ ∀ ∃ ¬ ∧ ∨',
  Arrows: '← → ↑ ↓ ↔ ↕ ⇐ ⇒ ⇑ ⇓ ⇔ ↩ ↪ ↺ ↻ ➔ ➜ ➤',
  Other: '© ® ™ ℠ ✓ ✔ ✗ ✘ ★ ☆ ♥ ♦ ♣ ♠ ☐ ☑ ☒ ♪ ♫ ☎ ✉ ⌘ ⌥ ⇧ ⏎ ⌫',
};

function CharPicker({ groups, onPick, close, search }) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState(Object.keys(groups)[0]);
  const chars = useMemo(() => {
    if (q && search) return Object.values(groups).join(' ').split(' ').filter((c) => c && search(c, q));
    return groups[tab].split(' ').filter(Boolean);
  }, [q, tab, groups, search]);
  return (
    <div className="note-char-picker">
      {search && <input className="input input-sm" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className="note-char-tabs">
        {Object.keys(groups).map((g) => (
          <button key={g} type="button" className={g === tab && !q ? 'active' : ''} onClick={() => { setTab(g); setQ(''); }}>{g}</button>
        ))}
      </div>
      <div className="note-char-grid">
        {chars.map((c, i) => (
          <button key={`${c}-${i}`} type="button" onClick={() => { onPick(c); close?.(); }} title={c}>{c}</button>
        ))}
      </div>
    </div>
  );
}

export const EmojiPicker = (props) => <CharPicker groups={EMOJI} {...props} />;
export const SymbolPicker = (props) => <CharPicker groups={SYMBOLS} {...props} />;

// ---------- "/" command menu ----------

export function SlashMenu({ editor, items }) {
  const [state, setState] = useState({ active: false, query: '' });
  const [index, setIndex] = useState(0);
  const listRef = useRef(null);

  const shown = useMemo(() => {
    const q = state.query.toLowerCase();
    return items.filter((it) => !q || it.label.toLowerCase().includes(q) || it.keywords?.some((k) => k.startsWith(q))).slice(0, 12);
  }, [items, state.query]);

  useEffect(() => {
    const onSlash = (next) => {
      setState(next);
      setIndex(0);
    };
    editor.on('slashMenu', onSlash);
    return () => editor.off('slashMenu', onSlash);
  }, [editor]);

  const run = (item) => {
    const range = editor.storage.slashMenu.range;
    if (!range) return;
    editor.chain().focus().deleteRange(range).run();
    item.run(editor);
    setState({ active: false, query: '' });
  };

  // The editor plugin forwards keys here while the menu is open.
  useEffect(() => {
    editor.storage.slashMenu.onKey = (e) => {
      if (!shown.length) return false;
      if (e.key === 'ArrowDown') { setIndex((i) => (i + 1) % shown.length); return true; }
      if (e.key === 'ArrowUp') { setIndex((i) => (i - 1 + shown.length) % shown.length); return true; }
      if (e.key === 'Enter' || e.key === 'Tab') { run(shown[index] || shown[0]); return true; }
      if (e.key === 'Escape') { setState({ active: false, query: '' }); editor.storage.slashMenu.active = false; return true; }
      return false;
    };
  });

  useEffect(() => {
    listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!state.active || !shown.length || !editor.storage.slashMenu.range) return null;
  let coords;
  try {
    coords = editor.view.coordsAtPos(editor.storage.slashMenu.range.from);
  } catch {
    return null;
  }
  return (
    <div className="note-slash" style={{ top: coords.bottom + 6, left: coords.left }} ref={listRef}>
      {shown.map((it, i) => (
        <button
          key={it.label}
          type="button"
          className={`note-slash-item${i === index ? ' active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setIndex(i)}
          onClick={() => run(it)}
        >
          <span className="note-slash-icon">{it.icon}</span>
          <span>
            <strong>{it.label}</strong>
            {it.hint && <small>{it.hint}</small>}
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------- find & replace ----------

export function FindBar({ editor, withReplace, onClose }) {
  const s = editor.storage.findReplace;
  const [term, setTerm] = useState(s.term || editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to) || '');
  const [replace, setReplace] = useState('');
  const [caseSensitive, setCase] = useState(s.caseSensitive);
  const [wholeWord, setWhole] = useState(s.wholeWord);
  const [showReplace, setShowReplace] = useState(withReplace);
  const inputRef = useRef(null);

  useEffect(() => {
    editor.commands.setSearch({ term, caseSensitive, wholeWord, index: 0 });
  }, [editor, term, caseSensitive, wholeWord]);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => editor.commands.clearSearch();
  }, [editor]);
  useEffect(() => setShowReplace((v) => v || withReplace), [withReplace]);

  const total = s.results.length;
  return (
    <div className="note-find">
      <div className="note-find-row">
        <input
          ref={inputRef}
          className="input input-sm"
          placeholder="Find in note"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) editor.commands.findPrev(); else editor.commands.findNext(); }
            if (e.key === 'Escape') onClose();
          }}
        />
        <span className="note-find-count">{term ? (total ? `${s.index + 1} / ${total}` : 'No results') : ''}</span>
        <button type="button" className="note-tb-btn" title="Previous (Shift+Enter)" onClick={() => editor.commands.findPrev()}>↑</button>
        <button type="button" className="note-tb-btn" title="Next (Enter)" onClick={() => editor.commands.findNext()}>↓</button>
        <button type="button" className={`note-tb-btn${caseSensitive ? ' active' : ''}`} title="Match case" onClick={() => setCase((v) => !v)}>Aa</button>
        <button type="button" className={`note-tb-btn${wholeWord ? ' active' : ''}`} title="Whole word" onClick={() => setWhole((v) => !v)}>ab|</button>
        <button type="button" className={`note-tb-btn${showReplace ? ' active' : ''}`} title="Replace" onClick={() => setShowReplace((v) => !v)}>⇄</button>
        <button type="button" className="note-tb-btn" title="Close (Esc)" onClick={onClose}>×</button>
      </div>
      {showReplace && (
        <div className="note-find-row">
          <input
            className="input input-sm"
            placeholder="Replace with"
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); editor.commands.replaceCurrent(replace); }
              if (e.key === 'Escape') onClose();
            }}
          />
          <button type="button" className="btn btn-sm" disabled={!total} onClick={() => editor.commands.replaceCurrent(replace)}>Replace</button>
          <button type="button" className="btn btn-sm" disabled={!total} onClick={() => editor.commands.replaceAll(replace)}>Replace all</button>
        </div>
      )}
    </div>
  );
}

// ---------- keyboard shortcut reference ----------

export const SHORTCUTS = [
  ['Bold / Italic / Underline', 'Ctrl+B / I / U'],
  ['Strikethrough', 'Ctrl+Shift+S'],
  ['Inline code', 'Ctrl+E'],
  ['Superscript / Subscript', 'Ctrl+. / Ctrl+,'],
  ['Heading 1–6', 'Ctrl+Alt+1…6'],
  ['Normal text', 'Ctrl+Alt+0'],
  ['Bullet / Numbered / Checklist', 'Ctrl+Shift+8 / 7 / 9'],
  ['Quote', 'Ctrl+Shift+B'],
  ['Code block', 'Ctrl+Alt+C'],
  ['Align left / center / right / justify', 'Ctrl+Shift+L / E / R / J'],
  ['Indent / Outdent', 'Tab / Shift+Tab or Ctrl+] / ['],
  ['Link', 'Ctrl+K'],
  ['Highlight', 'Ctrl+Shift+H'],
  ['Page break', 'Ctrl+Enter'],
  ['Find / Replace', 'Ctrl+F / Ctrl+H'],
  ['Save now', 'Ctrl+S'],
  ['Undo / Redo', 'Ctrl+Z / Ctrl+Shift+Z'],
  ['Paste without formatting', 'Ctrl+Shift+V'],
  ['Move block up / down', 'Alt+↑ / Alt+↓'],
  ['Duplicate / delete block', 'Ctrl+Shift+D / Ctrl+Shift+K'],
  ['Emoji', 'type :smile: :fire: :check: :rocket: …'],
  ['Hashtag', 'type #idea — it is highlighted'],
  ['Command menu', 'type / at the start of a line'],
  ['Markdown', '# heading, - list, 1. list, [ ] task, > quote, ``` code, --- line'],
];

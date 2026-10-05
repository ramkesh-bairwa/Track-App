'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// Plain text / code mode for a note: a monospace editor whose content is saved
// exactly as typed or pasted — indentation, tabs, blank lines and characters
// like < > & included. Nothing is parsed or reformatted.
const INDENT = '  ';
const WRAP_KEY = 'mytrack_note_plain_wrap';

function readWrap() {
  try {
    return localStorage.getItem(WRAP_KEY) === '1';
  } catch {
    return false;
  }
}

// Inserts through the browser's editing command so Ctrl+Z still undoes it.
function insertText(el, text) {
  el.focus();
  if (!document.execCommand?.('insertText', false, text)) {
    el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

export default function NotePlainEditor({ content, onUpdate, onSaveNow, fileName = 'note' }) {
  const taRef = useRef(null);
  const gutterRef = useRef(null);
  const [wrap, setWrap] = useState(false);
  const [flash, setFlash] = useState('');

  useEffect(() => setWrap(readWrap()), []);

  function toggleWrap() {
    setWrap((w) => {
      try {
        localStorage.setItem(WRAP_KEY, w ? '0' : '1');
      } catch {}
      return !w;
    });
  }

  const lineCount = useMemo(() => content.split('\n').length, [content]);

  function showFlash(msg) {
    setFlash(msg);
    setTimeout(() => setFlash(''), 1600);
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(content);
      showFlash('Copied');
    } catch {
      taRef.current?.select();
      showFlash('Press Ctrl+C to copy');
    }
  }

  function download() {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(fileName || 'note').replace(/[\\/:*?"<>|]+/g, '_')}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function handleKeyDown(e) {
    const el = e.currentTarget;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      onSaveNow?.();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: start, selectionEnd: end, value } = el;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      // Tab with no multi-line selection just inserts an indent.
      if (!e.shiftKey && !value.slice(start, end).includes('\n')) {
        insertText(el, INDENT);
        return;
      }
      // Otherwise indent / outdent every selected line.
      const block = value.slice(lineStart, end);
      const lines = block.split('\n');
      const changed = lines.map((l) =>
        e.shiftKey ? l.replace(new RegExp(`^( {1,${INDENT.length}}|\\t)`), '') : INDENT + l
      );
      el.setSelectionRange(lineStart, end);
      insertText(el, changed.join('\n'));
      el.setSelectionRange(lineStart, lineStart + changed.join('\n').length);
      return;
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Keep the current line's indentation on the new line.
      const { selectionStart: start, value } = el;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const indent = value.slice(lineStart, start).match(/^[ \t]*/)[0];
      if (indent) {
        e.preventDefault();
        insertText(el, `\n${indent}`);
      }
    }
  }

  function syncScroll(e) {
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
  }

  return (
    <div className="note-plain">
      <div className="note-plain-bar">
        <span className="note-plain-badge">Plain text · saved exactly as typed</span>
        <div className="note-plain-actions">
          <button type="button" className={`btn btn-sm${wrap ? ' active' : ''}`} onClick={toggleWrap} title="Wrap long lines">
            {wrap ? '↩ Wrap on' : '→ No wrap'}
          </button>
          <button type="button" className="btn btn-sm" onClick={copyAll}>Copy all</button>
          <button type="button" className="btn btn-sm" onClick={download}>⬇ .txt</button>
        </div>
      </div>
      <div className={`note-plain-body${wrap ? ' wrap' : ''}`}>
        {!wrap && (
          <div className="note-plain-gutter" ref={gutterRef} aria-hidden="true">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          className="note-plain-input"
          value={content}
          onChange={(e) => onUpdate(e.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={syncScroll}
          wrap={wrap ? 'soft' : 'off'}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          placeholder="Paste or type code / text here — it's kept exactly as it is."
        />
      </div>
      <div className="note-plain-foot">
        <span>{lineCount} line{lineCount === 1 ? '' : 's'} · {content.length} character{content.length === 1 ? '' : 's'}</span>
        {flash && <span className="note-plain-flash">{flash}</span>}
        <span className="note-plain-hint">Tab / Shift+Tab indent · Ctrl+S save</span>
      </div>
    </div>
  );
}

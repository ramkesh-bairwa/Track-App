'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CODE_LANGUAGES, languageForName } from '@/lib/codeLanguages';
import { highlightCode, splitHighlightedLines, markWhitespace } from '@/lib/codeHighlight';
import { downloadBlob, safeFilename } from '@/lib/exportData';
import CodeCompare from '@/components/code/CodeCompare';
import ConfirmModal from '@/components/ConfirmModal';

const INDENT = '  ';

// How long lines are shown. 'off' scrolls sideways; the others soft-wrap,
// either at the editor's width or at a fixed column like a code review tool.
const WRAP_MODES = [
  { id: 'off', label: 'No wrap', title: 'Long lines scroll sideways' },
  { id: 'wrap', label: 'Wrap', title: 'Wrap long lines at the edge of the editor' },
  { id: '80', label: '80 cols', title: 'Wrap at 80 characters' },
  { id: '120', label: '120 cols', title: 'Wrap at 120 characters' },
];
const VIEW_KEY = 'mytrack_code_view';
const DEFAULT_VIEW = { wrap: 'off', lineNumbers: true, fontSize: 13, whitespace: false };

function loadView() {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
    return saved ? { ...DEFAULT_VIEW, ...saved } : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

async function exportAsWord(name, content) {
  const docx = await import('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
  const lines = content.split('\n').map(
    (line) => new Paragraph({ children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 18 })], spacing: { after: 0 } })
  );
  const doc = new Document({ sections: [{ children: [new Paragraph({ text: name, heading: HeadingLevel.HEADING_1 }), ...lines] }] });
  downloadBlob(await Packer.toBlob(doc), `${safeFilename(name, 'code')}.docx`);
}

export default function CodeEditor({ file }) {
  const router = useRouter();
  const [name, setName] = useState(file.name);
  const [language, setLanguage] = useState(file.language);
  const [content, setContent] = useState(file.content || '');
  const [status, setStatus] = useState('saved'); // saved | dirty | saving | error
  const [error, setError] = useState('');
  const [view, setViewState] = useState(DEFAULT_VIEW);
  const wrap = view.wrap !== 'off';

  // View options are a per-browser preference, remembered across files.
  useEffect(() => setViewState(loadView()), []);
  function setView(patch) {
    setViewState((v) => {
      const next = { ...v, ...patch };
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(next));
      } catch {
        // private mode — still applies for this visit
      }
      return next;
    });
  }
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [choice, setChoice] = useState(false); // "save or compare?" dialog
  const [versionLabel, setVersionLabel] = useState('');
  const [comparing, setComparing] = useState(false);
  const [notice, setNotice] = useState('');
  const textRef = useRef(null);
  const preRef = useRef(null);
  const gutterRef = useRef(null);
  const saved = useRef({ name: file.name, language: file.language, content: file.content || '' });
  const timer = useRef(null);

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    const next = { name: name.trim() || saved.current.name, language, content };
    if (next.name === saved.current.name && next.language === saved.current.language && next.content === saved.current.content) {
      setStatus('saved');
      return;
    }
    setStatus('saving');
    setError('');
    try {
      const res = await fetch(`/api/code/${file.uuid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not save.');
      saved.current = next;
      setStatus('saved');
    } catch (err) {
      setStatus('error');
      setError(err.message);
    }
  }, [name, language, content, file.uuid]);

  // Autosave a moment after typing stops.
  useEffect(() => {
    const s = saved.current;
    if (name === s.name && language === s.language && content === s.content) return undefined;
    setStatus('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 1200);
    return () => clearTimeout(timer.current);
  }, [name, language, content, save]);

  // "Save code": write the file and keep a version to compare against later.
  async function saveVersion() {
    setChoice(false);
    await save();
    try {
      const res = await fetch(`/api/code/${file.uuid}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, language, label: versionLabel }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not keep a version.');
      setNotice(json.unchanged ? 'Saved — same as the last version, so no new version was added.' : 'Saved, and kept as a version you can compare against later.');
      setVersionLabel('');
      setTimeout(() => setNotice(''), 3500);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!comparing) setChoice(true);
      }
    }
    function onUnload(e) {
      if (status === 'dirty' || status === 'saving') {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [save, status, comparing]);

  const highlighted = useMemo(() => highlightCode(content, language), [content, language]);
  const lineCount = useMemo(() => content.split('\n').length, [content]);
  // Wrapped / whitespace views render one block per source line, so each
  // line keeps a single number however many rows it wraps onto.
  const lineHtml = useMemo(() => {
    if (!wrap && !view.whitespace) return null;
    const lines = splitHighlightedLines(highlighted);
    return view.whitespace ? lines.map(markWhitespace) : lines;
  }, [highlighted, wrap, view.whitespace]);
  const longestLine = useMemo(() => content.split('\n').reduce((m, l) => Math.max(m, l.length), 0), [content]);

  function syncScroll() {
    const t = textRef.current;
    if (preRef.current) {
      preRef.current.scrollTop = t.scrollTop;
      preRef.current.scrollLeft = t.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = t.scrollTop;
  }

  // Replace [start, end) with `text` and keep native undo where possible.
  function insert(text, start, end, selectStart, selectEnd) {
    const t = textRef.current;
    t.focus();
    t.setSelectionRange(start, end);
    const ok = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
    if (!ok) {
      const next = content.slice(0, start) + text + content.slice(end);
      setContent(next);
    }
    requestAnimationFrame(() => t.setSelectionRange(selectStart ?? start + text.length, selectEnd ?? start + text.length));
  }

  function handleKeyDown(e) {
    const t = e.currentTarget;
    const { selectionStart: s, selectionEnd: en, value } = t;
    if (e.key === 'Tab') {
      e.preventDefault();
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      if (s === en && !e.shiftKey) {
        insert(INDENT, s, en);
        return;
      }
      // Indent / outdent every selected line.
      const block = value.slice(lineStart, en);
      const lines = block.split('\n');
      const changed = e.shiftKey
        ? lines.map((l) => (l.startsWith(INDENT) ? l.slice(INDENT.length) : l.replace(/^\t| /, '')))
        : lines.map((l) => INDENT + l);
      const text = changed.join('\n');
      insert(text, lineStart, en, lineStart, lineStart + text.length);
    } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      // Keep the current line's indentation (plus one level after an opener).
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const indent = value.slice(lineStart, s).match(/^[ \t]*/)[0];
      const before = value.slice(lineStart, s).trimEnd();
      const extra = /[{[(:]$/.test(before) ? INDENT : '';
      e.preventDefault();
      insert(`\n${indent}${extra}`, s, en);
    }
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copy was blocked by the browser.');
    }
  }

  async function deleteFile() {
    const res = await fetch(`/api/code/${file.uuid}`, { method: 'DELETE' });
    if (res.ok) {
      saved.current = { name, language, content }; // no unsaved-changes prompt
      router.push('/dashboard/code');
      router.refresh();
    } else throw new Error('Could not delete the file.');
  }

  const statusText = { saved: '✓ Saved', dirty: '● Unsaved', saving: 'Saving…', error: '⚠ Not saved' }[status];

  return (
    <div className="code-page">
      <div className="track-breadcrumbs">
        <Link href="/dashboard/code">Saved code</Link>
        <span className="track-breadcrumb-sep">/</span>
      </div>
      <div className="code-head">
        <input
          className="input input-mono code-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const guess = languageForName(name);
            if (guess !== 'text' && guess !== language && status !== 'saving') setLanguage(guess);
          }}
          aria-label="File name"
        />
        <select className="input input-sm" value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
          {CODE_LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
        <span className={`code-status code-status-${status}`} title={error || 'Autosaves as you type · Ctrl/⌘+S to save now'}>
          {statusText}
        </span>
        <div className="code-actions">
          <button type="button" className="btn btn-sm" onClick={copyAll}>{copied ? '✓ Copied' : '⧉ Copy'}</button>
          <div className="export-menu">
            <button type="button" className="btn btn-sm" onClick={() => setExportOpen((v) => !v)}>⬇ Download</button>
            {exportOpen && (
              <div className="export-dropdown" onMouseLeave={() => setExportOpen(false)}>
                <button type="button" onClick={() => { setExportOpen(false); downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), safeFilename(name, 'code')); }}>
                  <i className="fa-solid fa-file-code" /><span>As {name || 'file'}</span><small>original</small>
                </button>
                <button type="button" onClick={() => { setExportOpen(false); downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), `${safeFilename(name, 'code')}.txt`); }}>
                  <i className="fa-solid fa-file-lines" /><span>Plain text</span><small>.txt</small>
                </button>
                <button type="button" onClick={() => { setExportOpen(false); exportAsWord(name, content); }}>
                  <i className="fa-solid fa-file-word" /><span>Word document</span><small>.docx</small>
                </button>
              </div>
            )}
          </div>
          <button type="button" className="btn btn-sm" onClick={() => setComparing(true)} title="Compare with an earlier version, another file or pasted code">⇄ Compare</button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setChoice(true)} disabled={status === 'saving'} title="Save or compare (Ctrl/⌘+S)">Save</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(true)} title="Delete this file">🗑</button>
          {confirmDelete && (
            <ConfirmModal
              title={`Delete “${name}”?`}
              message="The file and all its saved versions will be deleted forever. This can’t be undone."
              confirmLabel="Delete file"
              danger
              onConfirm={deleteFile}
              onClose={() => setConfirmDelete(false)}
            />
          )}
        </div>
      </div>
      {error && <div className="top-error">{error}</div>}
      {notice && <div className="task-notice">{notice}</div>}

      <div className="code-viewbar" role="toolbar" aria-label="View options">
        <span className="code-viewbar-label">Wrap</span>
        <div className="tabs track-type-tabs code-wrap-tabs">
          {WRAP_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`tab-btn${view.wrap === m.id ? ' active' : ''}`}
              onClick={() => setView({ wrap: m.id })}
              title={m.title}
              aria-pressed={view.wrap === m.id}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className="checkbox-row code-view-check">
          <input type="checkbox" checked={view.lineNumbers} onChange={(e) => setView({ lineNumbers: e.target.checked })} />
          <span>Line numbers</span>
        </label>
        <label className="checkbox-row code-view-check" title="Show tabs (→) and trailing spaces">
          <input type="checkbox" checked={view.whitespace} onChange={(e) => setView({ whitespace: e.target.checked })} />
          <span>Whitespace</span>
        </label>
        <span className="code-font-size">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setView({ fontSize: Math.max(10, view.fontSize - 1) })} title="Smaller text" disabled={view.fontSize <= 10}>A−</button>
          <span>{view.fontSize}px</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setView({ fontSize: Math.min(22, view.fontSize + 1) })} title="Bigger text" disabled={view.fontSize >= 22}>A+</button>
        </span>
        <span className="code-viewbar-info" title="Length of the longest line">
          Longest line: {longestLine} chars
          {view.wrap === 'off' && longestLine > 120 && ' — try Wrap'}
        </span>
      </div>

      <div
        className={`code-editor wrap-${view.wrap}${wrap ? ' wrap' : ''}${view.whitespace ? ' show-ws' : ''}`}
        style={{
          '--code-font': `${view.fontSize}px`,
          '--gutter-chars': String(String(lineCount).length),
          ...(view.wrap === '80' || view.wrap === '120' ? { '--wrap-cols': view.wrap } : {}),
        }}
      >
        {!wrap && view.lineNumbers && (
          <div className="code-gutter" ref={gutterRef} aria-hidden="true">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        )}
        <div className={`code-area${wrap && view.lineNumbers ? ' numbered' : ''}`}>
          <pre ref={preRef} className="code-highlight" aria-hidden="true">
            {lineHtml ? (
              <code dangerouslySetInnerHTML={{ __html: lineHtml.map((l) => `<div class="cl">${l}</div>`).join('') }} />
            ) : (
              <code dangerouslySetInnerHTML={{ __html: `${highlighted}\n` }} />
            )}
          </pre>
          <textarea
            ref={textRef}
            className="code-input"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            onScroll={syncScroll}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            wrap={wrap ? 'soft' : 'off'}
            placeholder="Paste or type your code here…"
            autoFocus
          />
        </div>
      </div>
      {choice && (
        <div className="modal-overlay" onClick={() => setChoice(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="new-track-head">
              <h2>Save or compare?</h2>
              <button type="button" className="new-track-close" onClick={() => setChoice(false)} title="Close">×</button>
            </div>
            <div className="code-choice">
              <button type="button" className="code-choice-card" onClick={saveVersion} autoFocus>
                <span className="code-choice-icon">💾</span>
                <strong>Save code</strong>
                <small>Save now and keep this as a version you can compare against later.</small>
              </button>
              <button type="button" className="code-choice-card" onClick={() => { setChoice(false); setComparing(true); }}>
                <span className="code-choice-icon">⇄</span>
                <strong>Compare code</strong>
                <small>See every difference against an earlier version, another file or pasted code — and anything that looks broken.</small>
              </button>
            </div>
            <input
              className="input input-sm"
              placeholder="Version note (optional), e.g. “before refactor”"
              value={versionLabel}
              onChange={(e) => setVersionLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveVersion()}
            />
          </div>
        </div>
      )}
      {comparing && (
        <CodeCompare
          file={{ uuid: file.uuid, name }}
          current={content}
          language={language}
          onApply={(next) => setContent(next)}
          onClose={() => setComparing(false)}
        />
      )}
      <div className="code-foot">
        {lineCount} line{lineCount === 1 ? '' : 's'} · {content.length.toLocaleString()} characters · Tab indents, Shift+Tab outdents · Ctrl/⌘+S saves
      </div>
    </div>
  );
}

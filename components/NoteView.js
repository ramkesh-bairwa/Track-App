'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import NoteEditor from '@/components/NoteEditor';
import NotePlainEditor from '@/components/notes/NotePlainEditor';
import NoteCard from '@/components/NoteCard';
import NewNoteModal from '@/components/NewNoteModal';
import NotePageStyleModal from '@/components/NotePageStyleModal';
import ConfirmModal from '@/components/ConfirmModal';
import { exportNoteAsWord, exportNoteAsExcel, exportNoteAsImage, printNoteAsPdf } from '@/lib/noteExport';
import { exportNoteAsText, exportNoteAsCsv } from '@/lib/noteExportText';
import { jsonToText } from '@/lib/noteMarkdown';

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function parseStyle(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

// A note that is only code blocks (e.g. one switched rich → plain → rich)
// converts back character for character; anything else goes through the
// general text export.
function richToPlain(json) {
  const blocks = (json?.content || []).filter((n) => !(n.type === 'paragraph' && !n.content));
  if (blocks.length > 0 && blocks.every((n) => n.type === 'codeBlock')) {
    return blocks.map((n) => (n.content || []).map((t) => t.text || '').join('')).join('\n\n');
  }
  return jsonToText(json).replace(/\n$/, '');
}

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]+/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function NoteView({ note, breadcrumbs, subnotes }) {
  const router = useRouter();
  const printAreaRef = useRef(null);
  const jsonRef = useRef(null);
  const saveTimerRef = useRef(null);
  const exportMenuRef = useRef(null);

  const [title, setTitle] = useState(note.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(note.title);
  const [content, setContent] = useState(note.content || '');
  const [style, setStyle] = useState(() => parseStyle(note.style));
  const [saveStatus, setSaveStatus] = useState('saved');
  const [showNewSub, setShowNewSub] = useState(false);
  const [showStyle, setShowStyle] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    if (!exportOpen) return undefined;
    function handleClickOutside(e) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) setExportOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [exportOpen]);

  const pendingRef = useRef(null); // latest unsaved patch

  const saveNow = useCallback(async ({ keepalive = false } = {}) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const patch = pendingRef.current;
    if (!patch) return;
    pendingRef.current = null;
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
        keepalive,
      });
      if (!res.ok) pendingRef.current = { ...patch, ...pendingRef.current };
      setSaveStatus(res.ok && !pendingRef.current ? 'saved' : 'unsaved');
    } catch {
      pendingRef.current = { ...patch, ...pendingRef.current };
      setSaveStatus('unsaved');
    }
  }, [note.id]);

  const scheduleSave = useCallback((patch) => {
    setSaveStatus('unsaved');
    pendingRef.current = { ...pendingRef.current, ...patch };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveNow(), 800);
  }, [saveNow]);

  // Leaving the page (or closing the tab) mid-typing still saves: flush the
  // pending change instead of dropping it, and warn if it can't be sent.
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!pendingRef.current) return;
      saveNow({ keepalive: true });
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      saveNow({ keepalive: true });
    };
  }, [saveNow]);

  // 'plain' notes store their content as raw text (kept byte for byte);
  // anything else is the rich editor's HTML.
  const plain = style?.mode === 'plain';

  function handlePlainUpdate(text) {
    setContent(text);
    scheduleSave({ content: text });
  }

  function applyMode(mode, nextContent) {
    const nextStyle = { ...(style || {}), mode };
    if (mode !== 'plain') delete nextStyle.mode;
    setStyle(nextStyle);
    setContent(nextContent);
    jsonRef.current = null;
    pendingRef.current = { ...pendingRef.current, content: nextContent, style: nextStyle };
    saveNow();
  }

  function switchMode(mode) {
    if ((mode === 'plain') === plain) return;
    if (mode === 'plain') {
      const text = content && jsonRef.current ? richToPlain(jsonRef.current) : '';
      setConfirmState({
        title: 'Switch to plain text?',
        message:
          'The text is kept, but formatting (bold, headings, colors, tables, images) is removed. Plain text is saved exactly as typed — best for code.',
        confirmLabel: 'Switch to plain text',
        onConfirm: () => applyMode('plain', text),
      });
    } else {
      // The whole text goes into one code block, so not a single space changes.
      applyMode('rich', content ? `<pre><code>${escapeHtml(content)}</code></pre>` : '');
    }
  }

  function handleEditorUpdate(html, json) {
    setContent(html);
    jsonRef.current = json;
    scheduleSave({ content: html });
  }

  async function saveTitle() {
    const trimmed = titleDraft.trim();
    setEditingTitle(false);
    if (!trimmed || trimmed === title) {
      setTitleDraft(title);
      return;
    }
    setTitle(trimmed);
    await fetch(`/api/notes/${note.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed }),
    });
    router.refresh();
  }

  async function handleSaveStyle(saved) {
    // The page-style modal doesn't know about the editor mode; keep it.
    const newStyle = style?.mode ? { ...(saved || {}), mode: style.mode } : saved;
    setStyle(newStyle);
    await fetch(`/api/notes/${note.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ style: newStyle }),
    });
    router.refresh();
  }

  function handleDelete() {
    setConfirmState({
      title: `Delete "${title}"?`,
      message:
        subnotes && subnotes.length > 0
          ? 'Everything in it — including all its sub-notes — will be deleted. This cannot be undone.'
          : 'This cannot be undone.',
      confirmLabel: 'Delete note',
      danger: true,
      onConfirm: async () => {
        await fetch(`/api/notes/${note.id}`, { method: 'DELETE' });
        if (breadcrumbs && breadcrumbs.length > 1) {
          router.push(`/dashboard/notes/${breadcrumbs[breadcrumbs.length - 2].uuid}`);
        } else {
          router.push('/dashboard/notes');
        }
        router.refresh();
      },
    });
  }

  const pageStyle = {
    background: style?.background || undefined,
    color: style?.color || undefined,
    fontFamily: style?.fontFamily || undefined,
    fontSize: style?.fontSize || undefined,
    margin: style?.margin != null ? `${style.margin}px` : undefined,
    padding: style?.padding != null ? `${style.padding}px` : '24px',
  };

  return (
    <>
      {breadcrumbs && breadcrumbs.length > 1 && (
        <div className="track-breadcrumbs">
          {breadcrumbs.map((b, i) => (
            <span key={b.id} className="track-breadcrumb-item">
              {i === breadcrumbs.length - 1 ? (
                <span>{b.title}</span>
              ) : (
                <>
                  <Link href={`/dashboard/notes/${b.uuid}`}>{b.title}</Link>
                  <span className="track-breadcrumb-sep">/</span>
                </>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="page-head">
        <div>
          <h1>
            {editingTitle ? (
              <input
                className="input track-name-input"
                value={titleDraft}
                autoFocus
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); saveTitle(); }
                  if (e.key === 'Escape') { setTitleDraft(title); setEditingTitle(false); }
                }}
              />
            ) : (
              <span
                className="track-name-text"
                onDoubleClick={() => { setTitleDraft(title); setEditingTitle(true); }}
                title="Double-click to rename"
              >
                📝 {title}
              </span>
            )}
          </h1>
          <p className="note-save-status">
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'unsaved' ? 'Unsaved changes' : 'Saved'}
          </p>
          <div className="tabs note-mode-tabs" role="tablist" aria-label="Editor type">
            <button
              type="button"
              role="tab"
              aria-selected={!plain}
              className={`tab-btn${!plain ? ' active' : ''}`}
              onClick={() => switchMode('rich')}
              title="Formatted text: headings, lists, tables, images"
            >
              Rich text
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={plain}
              className={`tab-btn${plain ? ' active' : ''}`}
              onClick={() => switchMode('plain')}
              title="Code / plain text, saved exactly as typed"
            >
              {'</>'} Plain text
            </button>
          </div>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn" onClick={() => setShowNewSub(true)}>＋ Sub-note</button>
          <button type="button" className="btn" onClick={() => setShowStyle(true)}>🎨 Page style</button>
          <div className="note-export-menu" ref={exportMenuRef}>
            <button type="button" className="btn" onClick={() => setExportOpen((v) => !v)}>⬇ Export</button>
            {exportOpen && plain && (
              <div className="note-export-dropdown">
                <button type="button" onClick={() => { setExportOpen(false); download(content, `${title}.txt`); }}>
                  Plain text (.txt) — exactly as saved
                </button>
              </div>
            )}
            {exportOpen && !plain && (
              <div className="note-export-dropdown">
                <button type="button" onClick={() => { setExportOpen(false); exportNoteAsWord(jsonRef.current, title); }}>
                  Word (.docx)
                </button>
                <button type="button" onClick={() => { setExportOpen(false); exportNoteAsExcel(jsonRef.current, title); }}>
                  Excel (.xlsx) — tables only
                </button>
                <button type="button" onClick={() => { setExportOpen(false); exportNoteAsCsv(jsonRef.current, title); }}>
                  CSV (.csv) — tables, or one line per row
                </button>
                <button type="button" onClick={() => { setExportOpen(false); exportNoteAsText(jsonRef.current, title); }}>
                  Plain text (.txt)
                </button>
                <button type="button" onClick={() => { setExportOpen(false); exportNoteAsImage(printAreaRef.current, title); }}>
                  Image (.png)
                </button>
                <button type="button" onClick={() => { setExportOpen(false); printNoteAsPdf(); }}>
                  PDF (print)
                </button>
              </div>
            )}
          </div>
          <button type="button" className="btn btn-danger" onClick={handleDelete}>Delete</button>
        </div>
      </div>

      {subnotes && subnotes.length > 0 && (
        <div className="track-grid-sub">
          <div className="track-grid">
            {subnotes.map((n) => (
              <NoteCard key={n.id} note={n} />
            ))}
          </div>
        </div>
      )}

      <div className="note-print-area" ref={printAreaRef} style={pageStyle}>
        {plain ? (
          <NotePlainEditor content={content} onUpdate={handlePlainUpdate} onSaveNow={() => saveNow()} fileName={title} />
        ) : (
          <NoteEditor
            content={content}
            onUpdate={handleEditorUpdate}
            onSaveNow={() => saveNow()}
            fileName={title}
            onEditorReady={(editor) => {
              if (!jsonRef.current) jsonRef.current = editor.getJSON();
            }}
          />
        )}
      </div>

      {showNewSub && <NewNoteModal parentId={note.id} onClose={() => setShowNewSub(false)} />}
      {showStyle && (
        <NotePageStyleModal style={style} onClose={() => setShowStyle(false)} onSave={handleSaveStyle} />
      )}
      {confirmState && <ConfirmModal {...confirmState} onClose={() => setConfirmState(null)} />}
    </>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import TextAlign from '@tiptap/extension-text-align';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Table, TableRow } from '@tiptap/extension-table';
import { Placeholder, CharacterCount } from '@tiptap/extensions';
import {
  BlockFormat, ListStyle, PageBreak, Callout, CALLOUT_TYPES, HeadingIds, TableOfContents, collectHeadings,
  Image, TableCell, TableHeader, TextCase, Typography, FindReplace, SlashMenu as SlashMenuExt, ImageDrop,
} from '@/lib/noteExtensions';
import { jsonToMarkdown, jsonToText, markdownToHtml, textToHtml } from '@/lib/noteMarkdown';
import {
  Dropdown, MenuItem, MenuLabel, MenuSep, ColorGrid, TEXT_COLORS, HIGHLIGHT_COLORS, TableGridPicker,
  EmojiPicker, SymbolPicker, SlashMenu, FindBar, SHORTCUTS,
} from '@/components/notes/NoteEditorParts';
import {
  TextEffects, Kbd, Spoiler, TagLabel, TAG_COLORS, BlockStyles, Details, DetailsSummary, DetailsContent, Columns, Column,
  BlockTools, LineTools, ChecklistTools, MoreCases, EmojiShortcodes, Hashtags, CurrentBlock, taskCounts, sortTableByColumn, textToTable,
} from '@/lib/noteExtensionsExtra';
import {
  TEMPLATES, LOREM, calculate, StatsModal, NoteLinkPicker, SnapshotsModal, saveSnapshot, canSpeak, canDictate, startDictation,
} from '@/components/notes/NoteExtras';
import { safeLink } from '@/lib/safeUrl';
import { DATE_LOCALE } from '@/lib/dateLocale';

const FONT_FAMILIES = [
  { label: 'Default', value: '' },
  { label: 'IBM Plex Sans', value: 'IBM Plex Sans, sans-serif' },
  { label: 'IBM Plex Mono', value: 'IBM Plex Mono, monospace' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Calibri', value: 'Calibri, Carlito, sans-serif' },
  { label: 'Segoe UI', value: '"Segoe UI", system-ui, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
  { label: 'Garamond', value: 'Garamond, "EB Garamond", serif' },
  { label: 'Palatino', value: '"Palatino Linotype", Palatino, serif' },
  { label: 'Cambria', value: 'Cambria, Caladea, serif' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Consolas', value: 'Consolas, monospace' },
  { label: 'Comic Sans MS', value: '"Comic Sans MS", cursive' },
  { label: 'Impact', value: 'Impact, sans-serif' },
];
const FONT_SIZES = ['8px', '9px', '10px', '11px', '12px', '14px', '16px', '18px', '20px', '22px', '24px', '28px', '32px', '36px', '40px', '48px', '60px', '72px'];
const LINE_HEIGHTS = [['Single', '1'], ['1.15', '1.15'], ['1.5', '1.5'], ['Double', '2'], ['2.5', '2.5'], ['Triple', '3']];
const SPACING = [['None', '0px'], ['Small', '6px'], ['Medium', '12px'], ['Large', '24px']];
const CODE_LANGS = ['plain', 'javascript', 'typescript', 'python', 'java', 'php', 'sql', 'html', 'css', 'json', 'bash', 'go', 'ruby', 'c', 'cpp', 'csharp', 'yaml', 'markdown'];
const ZOOMS = [50, 67, 75, 90, 100, 110, 125, 150, 175, 200];
const PAGE_WIDTHS = [['Narrow', '680px'], ['Normal', '860px'], ['Wide', '1100px'], ['Full width', 'none']];

const FONT_WEIGHTS = [['Thin', '300'], ['Regular', '400'], ['Medium', '500'], ['Semibold', '600'], ['Bold', '700'], ['Black', '900']];
const LETTER_SPACINGS = [['Tight', '-0.03em'], ['Normal', null], ['Wide', '0.06em'], ['Wider', '0.14em']];
const DECORATIONS = [['Dotted underline', 'underline dotted'], ['Dashed underline', 'underline dashed'], ['Wavy underline', 'underline wavy'], ['Double underline', 'underline double'], ['Overline', 'overline']];
const QUOTE_STYLES = [['Classic', null], ['Pull quote', 'pull'], ['Boxed', 'boxed']];
const LINE_STYLES = [['Solid', null], ['Dashed', 'dashed'], ['Dotted', 'dotted'], ['Double', 'double'], ['Thick', 'thick'], ['Fade', 'fade']];

const BLOCK_STYLES = [
  { id: 'p', label: 'Normal text' },
  ...[1, 2, 3, 4, 5, 6].map((l) => ({ id: `h${l}`, label: `Heading ${l}` })),
  { id: 'quote', label: 'Quote' },
  { id: 'code', label: 'Code block' },
];

function blockStyleOf(editor) {
  for (let l = 1; l <= 6; l += 1) if (editor.isActive('heading', { level: l })) return `h${l}`;
  if (editor.isActive('codeBlock')) return 'code';
  if (editor.isActive('blockquote')) return 'quote';
  return 'p';
}

function setBlockStyle(editor, id) {
  const c = editor.chain().focus();
  if (id === 'p') c.setParagraph().run();
  else if (id === 'quote') (editor.isActive('blockquote') ? c : c.setParagraph().setBlockquote()).run();
  else if (id === 'code') c.setCodeBlock().run();
  else c.setHeading({ level: Number(id.slice(1)) }).run();
}

function stepFontSize(editor, dir) {
  const current = parseFloat(editor.getAttributes('textStyle').fontSize) || 16;
  const sizes = FONT_SIZES.map(parseFloat);
  const next = dir > 0 ? sizes.find((s) => s > current) : [...sizes].reverse().find((s) => s < current);
  if (next) editor.chain().focus().setFontSize(`${next}px`).run();
}

function nowStamp(kind) {
  const d = new Date();
  if (kind === 'date') return d.toLocaleDateString(DATE_LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
  if (kind === 'time') return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleString(DATE_LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// Module-level so its identity never changes: BubbleMenu dispatches a
// transaction whenever `shouldShow` changes, and with re-render-on-
// transaction an inline function would loop forever.
const bubbleShouldShow = ({ editor, state }) =>
  !state.selection.empty && !editor.isActive('image') && !editor.isActive('codeBlock') && !editor.isActive('tableOfContents');

// "/" menu entries.
const SLASH_ITEMS = [
  { label: 'Text', icon: '¶', keywords: ['paragraph', 'normal'], run: (e) => e.chain().focus().setParagraph().run() },
  ...[1, 2, 3, 4, 5, 6].map((l) => ({ label: `Heading ${l}`, icon: `H${l}`, keywords: ['h', `h${l}`, 'title'], run: (e) => e.chain().focus().setHeading({ level: l }).run() })),
  { label: 'Bullet list', icon: '•', keywords: ['ul', 'list'], run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: 'Numbered list', icon: '1.', keywords: ['ol', 'list'], run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: 'Checklist', icon: '☑', keywords: ['todo', 'task'], run: (e) => e.chain().focus().toggleTaskList().run() },
  { label: 'Quote', icon: '❝', keywords: ['blockquote'], run: (e) => e.chain().focus().setBlockquote().run() },
  { label: 'Code block', icon: '{ }', keywords: ['code'], run: (e) => e.chain().focus().setCodeBlock().run() },
  { label: 'Table', icon: '▦', hint: '3 × 3', keywords: ['grid'], run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  ...CALLOUT_TYPES.map((c) => ({ label: `${c.label} callout`, icon: c.icon, keywords: ['callout', 'box', c.id], run: (e) => e.chain().focus().setCallout(c.id).run() })),
  { label: 'Divider', icon: '―', keywords: ['hr', 'line', 'rule'], run: (e) => e.chain().focus().setHorizontalRule().run() },
  { label: 'Page break', icon: '⤓', keywords: ['page', 'break'], run: (e) => e.chain().focus().setPageBreak().run() },
  { label: 'Table of contents', icon: '☰', keywords: ['toc', 'contents'], run: (e) => e.chain().focus().insertTableOfContents().run() },
  { label: 'Collapsible section', icon: '▸', keywords: ['toggle', 'details', 'fold', 'accordion'], run: (e) => e.chain().focus().setDetails().run() },
  { label: 'Two columns', icon: '◫', keywords: ['columns', 'layout', 'side'], run: (e) => e.chain().focus().insertColumns(2).run() },
  { label: 'Three columns', icon: '▥', keywords: ['columns', 'layout'], run: (e) => e.chain().focus().insertColumns(3).run() },
  ...TEMPLATES.map((t) => ({ label: `${t.label} template`, icon: t.icon, keywords: ['template', t.id], run: (e) => e.chain().focus().insertContent(t.html()).run() })),
  { label: 'Lorem ipsum', icon: '¶', keywords: ['dummy', 'placeholder', 'lorem'], run: (e) => e.chain().focus().insertContent(`<p>${LOREM}</p>`).run() },
  { label: 'Date', icon: '📅', keywords: ['today'], run: (e) => e.chain().focus().insertContent(nowStamp('date')).run() },
  { label: 'Time', icon: '⏰', keywords: ['now'], run: (e) => e.chain().focus().insertContent(nowStamp('time')).run() },
];

export default function NoteEditor({ content, editable = true, onUpdate, onEditorReady, onSaveNow, fileName = 'note', noteId }) {
  const safeName = String(fileName).replace(/[/\\?%*:|"<>]/g, '-').slice(0, 80) || 'note';
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkNewTab, setLinkNewTab] = useState(true);
  const [imageUrlOpen, setImageUrlOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [find, setFind] = useState(null); // null | { replace: bool }
  const [outline, setOutline] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [pageWidth, setPageWidth] = useState('none');
  const [spellcheck, setSpellcheck] = useState(true);
  const [locked, setLocked] = useState(false);
  const [painter, setPainter] = useState(null); // copied marks for the format painter
  const [toast, setToast] = useState('');
  // Extra tools and view options
  const [modal, setModal] = useState(null); // 'stats' | 'link' | 'snapshots'
  const [typewriter, setTypewriter] = useState(false);
  const [focusPara, setFocusPara] = useState(false);
  const [showMarks, setShowMarks] = useState(false);
  const [lineNumbers, setLineNumbers] = useState(false);
  const [wrapCode, setWrapCode] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [dictating, setDictating] = useState(false);
  const stopDictationRef = useRef(null);
  const [goal, setGoalState] = useState(0);
  useEffect(() => {
    try {
      setGoalState(Number(localStorage.getItem(`mytrack_note_goal_${noteId}`)) || 0);
    } catch {}
  }, [noteId]);
  const setGoal = (n) => {
    setGoalState(n);
    try {
      if (n) localStorage.setItem(`mytrack_note_goal_${noteId}`, String(n));
      else localStorage.removeItem(`mytrack_note_goal_${noteId}`);
    } catch {}
  };
  const imageInputRef = useRef(null);
  const importInputRef = useRef(null);

  const flash = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 1800);
  }, []);

  // Built once: a new extension list on every render makes useEditor push
  // "changed" options into the live editor, which tears it down.
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https' },
      }),
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image,
      Placeholder.configure({ placeholder: 'Start writing… type “/” for blocks, tables, callouts and more' }),
      Subscript,
      Superscript,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      CharacterCount,
      BlockFormat,
      ListStyle,
      PageBreak,
      Callout,
      HeadingIds,
      TableOfContents,
      TextCase,
      Typography,
      FindReplace,
      SlashMenuExt,
      ImageDrop,
      TextEffects,
      Kbd,
      Spoiler,
      TagLabel,
      BlockStyles,
      Details,
      DetailsSummary,
      DetailsContent,
      Columns,
      Column,
      BlockTools,
      LineTools,
      ChecklistTools,
      MoreCases,
      EmojiShortcodes,
      Hashtags,
      CurrentBlock,
    ],
    []
  );

  // Only the first value goes into the options (later changes are synced by
  // the effect below) — see the note on `extensions`.
  const [initialContent] = useState(() => content || '');

  const editor = useEditor({
    extensions,
    content: initialContent,
    editable,
    immediatelyRender: false,
    // Tiptap v3 doesn't re-render on selection changes by default — the
    // toolbar needs it to show what's active under the cursor.
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor: ed }) => onUpdate?.(ed.getHTML(), ed.getJSON()),
  });

  useEffect(() => {
    if (editor && onEditorReady) onEditorReady(editor);
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (editor && content !== undefined && content !== editor.getHTML()) {
      editor.commands.setContent(content || '', { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, editor]);

  useEffect(() => {
    if (editor) editor.setEditable(editable && !locked);
  }, [editor, editable, locked]);

  // Format painter: after copying, the next selection gets those marks.
  useEffect(() => {
    if (!editor || !painter) return undefined;
    const apply = () => {
      if (editor.state.selection.empty) return;
      const chain = editor.chain().focus().unsetAllMarks();
      painter.forEach((m) => chain.setMark(m.type.name, m.attrs));
      chain.run();
      setPainter(null);
      flash('Formatting applied');
    };
    const onUp = () => setTimeout(apply, 0);
    const dom = editor.view.dom;
    dom.addEventListener('mouseup', onUp);
    return () => dom.removeEventListener('mouseup', onUp);
  }, [editor, painter, flash]);

  // Typewriter scrolling: keep the line you're typing on in the middle of the screen.
  useEffect(() => {
    if (!editor || !typewriter) return undefined;
    const center = () => {
      const { node } = editor.view.domAtPos(editor.state.selection.head);
      const el = node.nodeType === 3 ? node.parentElement : node;
      el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    };
    editor.on('selectionUpdate', center);
    return () => editor.off('selectionUpdate', center);
  }, [editor, typewriter]);

  // Stop talking / listening when leaving the note.
  useEffect(() => () => {
    if (canSpeak()) window.speechSynthesis.cancel();
    stopDictationRef.current?.();
  }, []);

  const openLink = useCallback(() => {
    if (!editor) return;
    setLinkValue(editor.getAttributes('link').href || '');
    setLinkNewTab(editor.getAttributes('link').target !== '_self');
    setLinkOpen(true);
  }, [editor]);

  // Editor-wide shortcuts that aren't part of any extension.
  useEffect(() => {
    if (!editor) return undefined;
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) {
        if (e.key === 'Escape' && fullscreen) setFullscreen(false);
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'f' && !e.shiftKey) { e.preventDefault(); setFind({ replace: false }); }
      else if (k === 'h' && !e.shiftKey) { e.preventDefault(); setFind({ replace: true }); }
      else if (k === 's' && !e.shiftKey) { e.preventDefault(); onSaveNow?.(); flash('Saved'); }
      else if (k === 'k' && !e.shiftKey) { e.preventDefault(); openLink(); }
      else if (e.key === ']') { e.preventDefault(); editor.chain().focus().sinkListItem('listItem').run() || editor.chain().focus().sinkListItem('taskItem').run() || editor.commands.indentBlock(); }
      else if (e.key === '[') { e.preventDefault(); editor.chain().focus().liftListItem('listItem').run() || editor.chain().focus().liftListItem('taskItem').run() || editor.commands.outdentBlock(); }
      else if (k === '/' ) { e.preventDefault(); setShowShortcuts(true); }
    };
    const root = editor.view.dom.closest('.note-editor');
    root?.addEventListener('keydown', onKey);
    return () => root?.removeEventListener('keydown', onKey);
  }, [editor, fullscreen, onSaveNow, openLink, flash]);

  const headings = useMemo(() => (editor && outline ? collectHeadings(editor.state.doc) : []), [editor, outline, editor?.state.doc]);

  if (!editor) return null;

  const tStyle = editor.getAttributes('textStyle');
  const inTable = editor.isActive('table');
  const inImage = editor.isActive('image');
  const inCallout = editor.isActive('callout');
  const inCode = editor.isActive('codeBlock');
  const para = editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph');
  const cc = editor.storage.characterCount;
  const words = cc.words();
  const chars = cc.characters();
  const { from, to, empty } = editor.state.selection;
  const selWords = empty ? 0 : editor.state.doc.textBetween(from, to, ' ').split(/\s+/).filter(Boolean).length;
  const can = editor.can();
  const readOnly = !editable || locked;

  function applyLink() {
    const url = linkValue.trim();
    const c = editor.chain().focus().extendMarkRange('link');
    if (!url) c.unsetLink().run();
    else if (editor.state.selection.empty && !editor.isActive('link')) {
      c.insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url, target: linkNewTab ? '_blank' : '_self' } }] }).run();
    } else c.setLink({ href: url, target: linkNewTab ? '_blank' : '_self' }).run();
    setLinkOpen(false);
  }

  function handleImageFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => editor.chain().focus().setImage({ src: reader.result, alt: file.name.replace(/\.[^.]+$/, '') }).run();
    reader.readAsDataURL(file);
  }

  async function handleImport(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const name = file.name.toLowerCase();
    const html = name.endsWith('.html') || name.endsWith('.htm') ? text : name.endsWith('.md') || name.endsWith('.markdown') ? markdownToHtml(text) : textToHtml(text);
    editor.chain().focus().insertContent(html).run();
    flash(`Imported ${file.name}`);
  }

  async function copyAs(kind) {
    const json = editor.getJSON();
    const text = kind === 'md' ? jsonToMarkdown(json) : kind === 'html' ? editor.getHTML() : jsonToText(json);
    try {
      await navigator.clipboard.writeText(text);
      flash(`Copied as ${kind === 'md' ? 'Markdown' : kind === 'html' ? 'HTML' : 'plain text'}`);
    } catch {
      flash('Clipboard not available');
    }
  }

  async function pastePlain() {
    try {
      const text = await navigator.clipboard.readText();
      editor.chain().focus().insertContent(textToHtml(text)).run();
    } catch {
      flash('Allow clipboard access, or press Ctrl+Shift+V');
    }
  }

  function readAloud() {
    if (!canSpeak()) return flash('Read aloud is not supported in this browser');
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return undefined;
    }
    const text = empty ? jsonToText(editor.getJSON()) : editor.state.doc.textBetween(from, to, '\n');
    if (!text.trim()) return flash('Nothing to read');
    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setSpeaking(true);
    return undefined;
  }

  function toggleDictation() {
    if (dictating) {
      stopDictationRef.current?.();
      return;
    }
    if (!canDictate()) {
      flash('Voice typing needs Chrome, Edge or Safari');
      return;
    }
    try {
      stopDictationRef.current = startDictation(
        (text) => editor.chain().focus().insertContent(`${text.trim()} `).run(),
        () => setDictating(false)
      );
      setDictating(true);
      flash('Listening… speak now');
    } catch {
      flash('Could not start the microphone');
    }
  }

  function calcSelection() {
    const expr = editor.state.doc.textBetween(from, to, ' ');
    const result = calculate(expr);
    if (result === null) return flash('Select a sum like 1250 * 12 + 300');
    editor.chain().focus().setTextSelection(to).insertContent(` = ${result.toLocaleString('en-IN', { maximumFractionDigits: 10 })}`).run();
    return undefined;
  }

  async function insertQr() {
    const selected = editor.state.doc.textBetween(from, to, ' ').trim();
    const value = window.prompt('Text or link for the QR code', selected || editor.getAttributes('link').href || '');
    if (!value?.trim()) return;
    try {
      const QRCode = (await import('qrcode')).default;
      const src = await QRCode.toDataURL(value.trim(), { margin: 1, width: 240 });
      editor.chain().focus().setImage({ src, alt: `QR code: ${value.trim()}` }).run();
    } catch {
      flash('Could not make a QR code from that');
    }
  }

  function exportWord() {
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${safeName}</title></head><body>${editor.getHTML()}</body></html>`;
    download(`﻿${html}`, `${safeName}.doc`, 'application/msword');
  }

  function askGoal() {
    const n = window.prompt('Word goal for this note (0 to remove)', goal ? String(goal) : '500');
    if (n === null) return;
    const v = Math.max(0, Math.floor(Number(n) || 0));
    setGoal(v);
    flash(v ? `Goal set: ${v} words` : 'Word goal removed');
  }

  const tasks = taskCounts(editor.state.doc);

  const tb = (active, onClick, label, title, disabled) => (
    <button
      type="button"
      className={`note-tb-btn${active ? ' active' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {label}
    </button>
  );
  const run = (fn) => () => fn(editor.chain().focus()).run();

  return (
    <div className={`note-editor${fullscreen ? ' note-editor-fullscreen' : ''}${readOnly ? ' is-readonly' : ''}${focusPara ? ' focus-paragraph' : ''}${showMarks ? ' show-marks' : ''}${lineNumbers ? ' line-numbers' : ''}${wrapCode ? '' : ' nowrap-code'}${outline ? ' outline-open' : ''}`}>
      <div className="note-sticky">
      {editable && (
        <div className="note-toolbar" role="toolbar" aria-label="Formatting">
          <div className="note-toolbar-group">
            {tb(false, run((c) => c.undo()), '↺', 'Undo (Ctrl+Z)', !can.undo())}
            {tb(false, run((c) => c.redo()), '↻', 'Redo (Ctrl+Shift+Z)', !can.redo())}
            {tb(Boolean(painter), () => {
              if (painter) return setPainter(null);
              setPainter(editor.state.selection.$from.marks());
              flash('Select text to apply this formatting');
            }, '🖌', 'Format painter — copy formatting, then select text to apply it')}
            {tb(false, run((c) => c.unsetAllMarks().clearNodes()), 'Tx', 'Clear formatting')}
          </div>

          <div className="note-toolbar-group">
            <select className="note-tb-select" value={blockStyleOf(editor)} onChange={(e) => setBlockStyle(editor, e.target.value)} title="Paragraph style">
              {BLOCK_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <select
              className="note-tb-select"
              value={tStyle.fontFamily || ''}
              onChange={(e) => (e.target.value ? editor.chain().focus().setFontFamily(e.target.value).run() : editor.chain().focus().unsetFontFamily().run())}
              title="Font"
            >
              {FONT_FAMILIES.map((f) => <option key={f.label} value={f.value} style={{ fontFamily: f.value || undefined }}>{f.label}</option>)}
            </select>
            {tb(false, () => stepFontSize(editor, -1), 'A−', 'Smaller text')}
            <select
              className="note-tb-select note-tb-size"
              value={tStyle.fontSize || ''}
              onChange={(e) => (e.target.value ? editor.chain().focus().setFontSize(e.target.value).run() : editor.chain().focus().unsetFontSize().run())}
              title="Font size"
            >
              <option value="">Size</option>
              {FONT_SIZES.map((s) => <option key={s} value={s}>{parseFloat(s)}</option>)}
              {tStyle.fontSize && !FONT_SIZES.includes(tStyle.fontSize) && <option value={tStyle.fontSize}>{parseFloat(tStyle.fontSize)}</option>}
            </select>
            {tb(false, () => stepFontSize(editor, 1), 'A+', 'Bigger text')}
          </div>

          <div className="note-toolbar-group">
            {tb(editor.isActive('bold'), run((c) => c.toggleBold()), <b>B</b>, 'Bold (Ctrl+B)')}
            {tb(editor.isActive('italic'), run((c) => c.toggleItalic()), <i>I</i>, 'Italic (Ctrl+I)')}
            {tb(editor.isActive('underline'), run((c) => c.toggleUnderline()), <u>U</u>, 'Underline (Ctrl+U)')}
            {tb(editor.isActive('strike'), run((c) => c.toggleStrike()), <s>S</s>, 'Strikethrough (Ctrl+Shift+S)')}
            {tb(editor.isActive('superscript'), run((c) => c.toggleSuperscript()), 'X²', 'Superscript (Ctrl+.)')}
            {tb(editor.isActive('subscript'), run((c) => c.toggleSubscript()), 'X₂', 'Subscript (Ctrl+,)')}
            {tb(editor.isActive('code'), run((c) => c.toggleCode()), '</>', 'Inline code (Ctrl+E)')}
            <Dropdown label="Aa" title="Change case">
              {(close) => (
                <>
                  <MenuItem close={close} disabled={empty} onClick={() => editor.chain().focus().toUpperCase().run()}>UPPERCASE</MenuItem>
                  <MenuItem close={close} disabled={empty} onClick={() => editor.chain().focus().toLowerCase().run()}>lowercase</MenuItem>
                  <MenuItem close={close} disabled={empty} onClick={() => editor.chain().focus().toTitleCase().run()}>Title Case</MenuItem>
                  <MenuItem close={close} disabled={empty} onClick={() => editor.chain().focus().toSentenceCase().run()}>Sentence case</MenuItem>
                  <MenuItem close={close} disabled={empty} onClick={() => editor.chain().focus().toToggleCase().run()}>tOGGLE cASE</MenuItem>
                  <MenuSep />
                  <MenuLabel>For code</MenuLabel>
                  <MenuItem close={close} disabled={empty} onClick={() => editor.chain().focus().toCamelCase().run()}>camelCase</MenuItem>
                  <MenuItem close={close} disabled={empty} onClick={() => editor.chain().focus().toSnakeCase().run()}>snake_case</MenuItem>
                  <MenuItem close={close} disabled={empty} onClick={() => editor.chain().focus().toKebabCase().run()}>kebab-case</MenuItem>
                  <MenuItem close={close} disabled={empty} onClick={() => editor.chain().focus().toConstantCase().run()}>CONSTANT_CASE</MenuItem>
                </>
              )}
            </Dropdown>
            <Dropdown label="✦" title="Text effects: weight, spacing, small caps, underline styles, keys, spoilers, labels" wide>
              {(close) => (
                <div className="note-dd-cols">
                  <div>
                    <MenuLabel>Weight</MenuLabel>
                    {FONT_WEIGHTS.map(([l, v]) => (
                      <MenuItem key={v} close={close} active={tStyle.fontWeight === v} onClick={() => editor.chain().focus().setMark('textStyle', { fontWeight: v }).run()}>
                        <span style={{ fontWeight: v }}>{l}</span>
                      </MenuItem>
                    ))}
                    <MenuLabel>Letter spacing</MenuLabel>
                    {LETTER_SPACINGS.map(([l, v]) => (
                      <MenuItem key={l} close={close} active={(tStyle.letterSpacing || null) === v} onClick={() => editor.chain().focus().setMark('textStyle', { letterSpacing: v }).removeEmptyTextStyle().run()}>
                        <span style={{ letterSpacing: v || undefined }}>{l}</span>
                      </MenuItem>
                    ))}
                  </div>
                  <div>
                    <MenuLabel>Style</MenuLabel>
                    <MenuItem close={close} active={tStyle.fontVariant === 'small-caps'} onClick={() => editor.chain().focus().setMark('textStyle', { fontVariant: tStyle.fontVariant === 'small-caps' ? null : 'small-caps' }).removeEmptyTextStyle().run()}>
                      <span style={{ fontVariant: 'small-caps' }}>Small Caps</span>
                    </MenuItem>
                    {DECORATIONS.map(([l, v]) => (
                      <MenuItem key={v} close={close} active={tStyle.textDecoration === v} onClick={() => editor.chain().focus().setMark('textStyle', { textDecoration: tStyle.textDecoration === v ? null : v }).removeEmptyTextStyle().run()}>
                        <span style={{ textDecoration: v }}>{l}</span>
                      </MenuItem>
                    ))}
                    <MenuItem close={close} active={editor.isActive('kbd')} onClick={run((c) => c.toggleKbd())}><kbd className="note-kbd">Ctrl</kbd> Keyboard key</MenuItem>
                    <MenuItem close={close} active={editor.isActive('spoiler')} onClick={run((c) => c.toggleSpoiler())}>▒ Spoiler (blur until hover)</MenuItem>
                    <MenuLabel>Label</MenuLabel>
                    <div className="note-tag-row">
                      {TAG_COLORS.map((t) => (
                        <button key={t.id} type="button" className="note-tag" data-tag={t.id} onClick={() => { editor.chain().focus().setTagLabel(t.id).run(); close(); }}>{t.label}</button>
                      ))}
                    </div>
                    {editor.isActive('tagLabel') && <MenuItem close={close} onClick={run((c) => c.unsetTagLabel())}>Remove label</MenuItem>}
                    <MenuSep />
                    <MenuItem close={close} onClick={() => editor.chain().focus().setMark('textStyle', { fontWeight: null, letterSpacing: null, fontVariant: null, textDecoration: null }).removeEmptyTextStyle().unsetMark('kbd').unsetMark('spoiler').unsetMark('tagLabel').run()}>Clear text effects</MenuItem>
                  </div>
                </div>
              )}
            </Dropdown>
          </div>

          <div className="note-toolbar-group">
            <Dropdown label={<span className="note-tb-color" style={{ borderColor: tStyle.color || 'currentColor' }}>A</span>} title="Text colour">
              {(close) => (
                <ColorGrid colors={TEXT_COLORS} value={tStyle.color} close={close}
                  onPick={(c) => editor.chain().focus().setColor(c).run()}
                  onClear={() => editor.chain().focus().unsetColor().run()} />
              )}
            </Dropdown>
            <Dropdown label={<span className="note-tb-hl" style={{ background: editor.getAttributes('highlight').color || '#fff59d' }}>ab</span>} title="Highlight (Ctrl+Shift+H)" active={editor.isActive('highlight')}>
              {(close) => (
                <ColorGrid colors={HIGHLIGHT_COLORS} value={editor.getAttributes('highlight').color} close={close} clearLabel="No highlight"
                  onPick={(c) => editor.chain().focus().setHighlight({ color: c }).run()}
                  onClear={() => editor.chain().focus().unsetHighlight().run()} />
              )}
            </Dropdown>
          </div>

          <div className="note-toolbar-group">
            {tb(editor.isActive({ textAlign: 'left' }), run((c) => c.setTextAlign('left')), '⇤', 'Align left (Ctrl+Shift+L)')}
            {tb(editor.isActive({ textAlign: 'center' }), run((c) => c.setTextAlign('center')), '⇔', 'Center (Ctrl+Shift+E)')}
            {tb(editor.isActive({ textAlign: 'right' }), run((c) => c.setTextAlign('right')), '⇥', 'Align right (Ctrl+Shift+R)')}
            {tb(editor.isActive({ textAlign: 'justify' }), run((c) => c.setTextAlign('justify')), '☰', 'Justify (Ctrl+Shift+J)')}
            <Dropdown label="↕" title="Line & paragraph spacing">
              {(close) => (
                <>
                  <MenuLabel>Line spacing</MenuLabel>
                  {LINE_HEIGHTS.map(([l, v]) => (
                    <MenuItem key={v} close={close} active={para.lineHeight === v} onClick={() => editor.chain().focus().setLineHeight(v).run()}>{l}</MenuItem>
                  ))}
                  <MenuItem close={close} onClick={() => editor.chain().focus().setLineHeight(null).run()}>Default</MenuItem>
                  <MenuSep />
                  <MenuLabel>Space before & after paragraph</MenuLabel>
                  {SPACING.map(([l, v]) => (
                    <MenuItem key={v} close={close} active={para.spaceAfter === v} onClick={() => editor.chain().focus().setBlockSpacing(v, v).run()}>{l}</MenuItem>
                  ))}
                  <MenuItem close={close} onClick={() => editor.chain().focus().setBlockSpacing(null, null).run()}>Default</MenuItem>
                  <MenuSep />
                  <MenuLabel>Direction</MenuLabel>
                  <MenuItem close={close} active={para.dir !== 'rtl'} onClick={() => editor.chain().focus().setTextDirection(null).run()}>Left to right</MenuItem>
                  <MenuItem close={close} active={para.dir === 'rtl'} onClick={() => editor.chain().focus().setTextDirection('rtl').run()}>Right to left</MenuItem>
                </>
              )}
            </Dropdown>
            <Dropdown label="▤" title="Block style: drop cap, shading, accent bar, box, quote and divider styles" wide>
              {(close) => (
                <div className="note-dd-cols">
                  <div>
                    <MenuLabel>Paragraph</MenuLabel>
                    <MenuItem close={close} active={Boolean(para.dropCap)} onClick={() => editor.chain().focus().setBlockStyle('dropCap', true).run()}>Drop cap</MenuItem>
                    <MenuItem close={close} active={Boolean(para.accentBar)} onClick={() => editor.chain().focus().setBlockStyle('accentBar', true).run()}>Accent bar on the left</MenuItem>
                    <MenuItem close={close} active={Boolean(para.boxed)} onClick={() => editor.chain().focus().setBlockStyle('boxed', true).run()}>Box around it</MenuItem>
                    <MenuLabel>Shading</MenuLabel>
                    <ColorGrid colors={HIGHLIGHT_COLORS} value={para.shade} close={close} clearLabel="No shading"
                      onPick={(col) => editor.chain().focus().setBlockStyle('shade', col).run()}
                      onClear={() => editor.chain().focus().setBlockStyle('shade', null).run()} />
                  </div>
                  <div>
                    <MenuLabel>Quote style</MenuLabel>
                    {QUOTE_STYLES.map(([l, v]) => (
                      <MenuItem key={l} close={close} active={editor.isActive('blockquote') && (editor.getAttributes('blockquote').quoteStyle || null) === v} onClick={() => {
                        if (!editor.isActive('blockquote')) editor.chain().focus().setBlockquote().run();
                        editor.chain().focus().updateAttributes('blockquote', { quoteStyle: v }).run();
                      }}>❝ {l}</MenuItem>
                    ))}
                    <MenuLabel>Insert divider</MenuLabel>
                    {LINE_STYLES.map(([l, v]) => (
                      <MenuItem key={l} close={close} onClick={() => editor.chain().focus().setHorizontalRuleStyle(v).run()}>
                        <span className="note-hr-sample" data-style={v || undefined} /> {l}
                      </MenuItem>
                    ))}
                  </div>
                </div>
              )}
            </Dropdown>
          </div>

          <div className="note-toolbar-group">
            {tb(editor.isActive('bulletList'), run((c) => c.toggleBulletList()), '•—', 'Bullet list (Ctrl+Shift+8)')}
            {tb(editor.isActive('orderedList'), run((c) => c.toggleOrderedList()), '1.', 'Numbered list (Ctrl+Shift+7)')}
            {tb(editor.isActive('taskList'), run((c) => c.toggleTaskList()), '☑', 'Checklist (Ctrl+Shift+9)')}
            <Dropdown label="≡" title="List style">
              {(close) => (
                <>
                  <MenuLabel>Bullets</MenuLabel>
                  {[['● Disc', 'disc'], ['○ Circle', 'circle'], ['■ Square', 'square'], ['– None', 'none']].map(([l, v]) => (
                    <MenuItem key={v} close={close} onClick={() => {
                      if (!editor.isActive('bulletList')) editor.chain().focus().toggleBulletList().run();
                      editor.chain().focus().updateAttributes('bulletList', { listStyleType: v }).run();
                    }}>{l}</MenuItem>
                  ))}
                  <MenuSep />
                  <MenuLabel>Numbering</MenuLabel>
                  {[['1, 2, 3', '1'], ['a, b, c', 'a'], ['A, B, C', 'A'], ['i, ii, iii', 'i'], ['I, II, III', 'I']].map(([l, v]) => (
                    <MenuItem key={v} close={close} onClick={() => {
                      if (!editor.isActive('orderedList')) editor.chain().focus().toggleOrderedList().run();
                      editor.chain().focus().updateAttributes('orderedList', { type: v === '1' ? null : v }).run();
                    }}>{l}</MenuItem>
                  ))}
                  <MenuItem close={close} disabled={!editor.isActive('orderedList')} onClick={() => {
                    const n = Number(window.prompt('Start numbering at', String(editor.getAttributes('orderedList').start || 1)));
                    if (n > 0) editor.chain().focus().updateAttributes('orderedList', { start: Math.floor(n) }).run();
                  }}>Start at…</MenuItem>
                </>
              )}
            </Dropdown>
            {tb(false, () => editor.chain().focus().sinkListItem('listItem').run() || editor.chain().focus().sinkListItem('taskItem').run() || editor.commands.indentBlock(), '⇥', 'Indent (Tab / Ctrl+])')}
            {tb(false, () => editor.chain().focus().liftListItem('listItem').run() || editor.chain().focus().liftListItem('taskItem').run() || editor.commands.outdentBlock(), '⇤', 'Outdent (Shift+Tab / Ctrl+[)')}
          </div>

          <div className="note-toolbar-group">
            {tb(editor.isActive('link'), openLink, '🔗', 'Link (Ctrl+K)')}
            <Dropdown label="🖼" title="Image" active={inImage}>
              {(close) => (
                <>
                  <MenuItem close={close} onClick={() => imageInputRef.current?.click()}>Upload image…</MenuItem>
                  <MenuItem close={close} onClick={() => { setImageUrl(''); setImageUrlOpen(true); }}>Image from URL…</MenuItem>
                  <MenuSep />
                  <MenuLabel>Selected image</MenuLabel>
                  {[['25%', '25%'], ['50%', '50%'], ['75%', '75%'], ['Full width', '100%'], ['Original size', null]].map(([l, v]) => (
                    <MenuItem key={l} close={close} disabled={!inImage} onClick={() => editor.chain().focus().updateAttributes('image', { width: v }).run()}>Size: {l}</MenuItem>
                  ))}
                  {[['Left', 'left'], ['Center', 'center'], ['Right', 'right'], ['Inline', null]].map(([l, v]) => (
                    <MenuItem key={l} close={close} disabled={!inImage} active={inImage && editor.getAttributes('image').align === v} onClick={() => editor.chain().focus().updateAttributes('image', { align: v }).run()}>Align: {l}</MenuItem>
                  ))}
                  <MenuItem close={close} disabled={!inImage} onClick={() => {
                    const alt = window.prompt('Describe the image (alt text)', editor.getAttributes('image').alt || '');
                    if (alt !== null) editor.chain().focus().updateAttributes('image', { alt }).run();
                  }}>Alt text…</MenuItem>
                  <MenuItem close={close} disabled={!inImage} onClick={() => editor.chain().focus().deleteSelection().run()}>Remove image</MenuItem>
                </>
              )}
            </Dropdown>
            <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImageFile} style={{ display: 'none' }} />

            <Dropdown label="▦" title="Table" active={inTable} wide>
              {(close) => (inTable ? (
                <div className="note-dd-cols">
                  <div>
                    <MenuLabel>Rows</MenuLabel>
                    <MenuItem close={close} onClick={run((c) => c.addRowBefore())}>Insert row above</MenuItem>
                    <MenuItem close={close} onClick={run((c) => c.addRowAfter())}>Insert row below</MenuItem>
                    <MenuItem close={close} onClick={run((c) => c.deleteRow())}>Delete row</MenuItem>
                    <MenuItem close={close} onClick={run((c) => c.toggleHeaderRow())}>Toggle header row</MenuItem>
                    <MenuLabel>Columns</MenuLabel>
                    <MenuItem close={close} onClick={run((c) => c.addColumnBefore())}>Insert column left</MenuItem>
                    <MenuItem close={close} onClick={run((c) => c.addColumnAfter())}>Insert column right</MenuItem>
                    <MenuItem close={close} onClick={run((c) => c.deleteColumn())}>Delete column</MenuItem>
                    <MenuItem close={close} onClick={run((c) => c.toggleHeaderColumn())}>Toggle header column</MenuItem>
                  </div>
                  <div>
                    <MenuLabel>Cells</MenuLabel>
                    <MenuItem close={close} disabled={!can.mergeCells()} onClick={run((c) => c.mergeCells())}>Merge cells</MenuItem>
                    <MenuItem close={close} disabled={!can.splitCell()} onClick={run((c) => c.splitCell())}>Split cell</MenuItem>
                    <MenuItem close={close} onClick={run((c) => c.toggleHeaderCell())}>Toggle header cell</MenuItem>
                    <MenuLabel>Cell colour</MenuLabel>
                    <ColorGrid colors={HIGHLIGHT_COLORS} close={close} clearLabel="No fill"
                      onPick={(col) => editor.chain().focus().setCellAttribute('backgroundColor', col).run()}
                      onClear={() => editor.chain().focus().setCellAttribute('backgroundColor', null).run()} />
                    <MenuSep />
                    <MenuLabel>Sort rows by this column</MenuLabel>
                    <MenuItem close={close} onClick={() => sortTableByColumn(editor, 1)}>A → Z / 0 → 9</MenuItem>
                    <MenuItem close={close} onClick={() => sortTableByColumn(editor, -1)}>Z → A / 9 → 0</MenuItem>
                    <MenuSep />
                    <MenuItem close={close} onClick={run((c) => c.fixTables())}>Repair table</MenuItem>
                    <MenuItem close={close} onClick={run((c) => c.deleteTable())}>Delete table</MenuItem>
                  </div>
                </div>
              ) : (
                <>
                  <MenuLabel>Insert a table</MenuLabel>
                  <TableGridPicker onPick={(rows, cols, withHeaderRow) => { editor.chain().focus().insertTable({ rows, cols, withHeaderRow }).run(); close(); }} />
                  <MenuSep />
                  <MenuItem close={close} disabled={empty} onClick={() => textToTable(editor) || flash('Select lines separated by commas, tabs or |')}>Convert selected text to table</MenuItem>
                </>
              ))}
            </Dropdown>

            <Dropdown label="＋ Insert" title="Insert" wide>
              {(close) => (
                <div className="note-dd-cols">
                  <div>
                    <MenuLabel>Blocks</MenuLabel>
                    <MenuItem close={close} onClick={run((c) => c.setHorizontalRule())}>― Divider line</MenuItem>
                    <MenuItem close={close} shortcut="Ctrl+↵" onClick={run((c) => c.setPageBreak())}>⤓ Page break</MenuItem>
                    <MenuItem close={close} onClick={run((c) => c.insertTableOfContents())}>☰ Table of contents</MenuItem>
                    <MenuItem close={close} onClick={run((c) => c.toggleBlockquote())}>❝ Quote</MenuItem>
                    <MenuItem close={close} onClick={run((c) => c.toggleCodeBlock())}>{'{ }'} Code block</MenuItem>
                    <MenuItem close={close} onClick={run((c) => c.setHardBreak())}>↵ Line break</MenuItem>
                    <MenuItem close={close} onClick={run((c) => c.setDetails())}>▸ Collapsible section</MenuItem>
                    <MenuItem close={close} onClick={run((c) => c.insertColumns(2))}>◫ Two columns</MenuItem>
                    <MenuItem close={close} onClick={run((c) => c.insertColumns(3))}>▥ Three columns</MenuItem>
                    <MenuItem close={close} onClick={() => setModal('link')}>📝 Link to another note…</MenuItem>
                    <MenuItem close={close} onClick={insertQr}>▣ QR code…</MenuItem>
                    <MenuItem close={close} onClick={() => editor.chain().focus().insertContent(`<p>${LOREM}</p>`).run()}>¶ Lorem ipsum text</MenuItem>
                    <MenuLabel>Templates</MenuLabel>
                    {TEMPLATES.map((t) => (
                      <MenuItem key={t.id} close={close} onClick={() => editor.chain().focus().insertContent(t.html()).run()}>{t.icon} {t.label}</MenuItem>
                    ))}
                    <MenuLabel>Callout box</MenuLabel>
                    {CALLOUT_TYPES.map((t) => (
                      <MenuItem key={t.id} close={close} onClick={() => (inCallout ? editor.chain().focus().setCalloutKind(t.id).run() : editor.chain().focus().setCallout(t.id).run())}>
                        {t.icon} {t.label}
                      </MenuItem>
                    ))}
                    {inCallout && <MenuItem close={close} onClick={() => editor.chain().focus().toggleCallout().run()}>Remove callout</MenuItem>}
                    <MenuLabel>Date & time</MenuLabel>
                    <MenuItem close={close} onClick={() => editor.chain().focus().insertContent(nowStamp('date')).run()}>📅 Today&apos;s date</MenuItem>
                    <MenuItem close={close} onClick={() => editor.chain().focus().insertContent(nowStamp('time')).run()}>⏰ Current time</MenuItem>
                    <MenuItem close={close} onClick={() => editor.chain().focus().insertContent(nowStamp('both')).run()}>🕒 Date & time</MenuItem>
                  </div>
                  <div>
                    <MenuLabel>Emoji</MenuLabel>
                    <EmojiPicker close={close} onPick={(c) => editor.chain().focus().insertContent(c).run()} />
                    <MenuLabel>Special characters</MenuLabel>
                    <SymbolPicker close={close} onPick={(c) => editor.chain().focus().insertContent(c).run()} />
                  </div>
                </div>
              )}
            </Dropdown>
          </div>

          {inCode && (
            <div className="note-toolbar-group">
              <select
                className="note-tb-select"
                value={editor.getAttributes('codeBlock').language || 'plain'}
                onChange={(e) => editor.chain().focus().updateAttributes('codeBlock', { language: e.target.value === 'plain' ? null : e.target.value }).run()}
                title="Code language"
              >
                {CODE_LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              {tb(false, async () => {
                try {
                  await navigator.clipboard.writeText(editor.state.selection.$from.parent.textContent);
                  flash('Code copied');
                } catch {
                  flash('Clipboard not available');
                }
              }, '⧉ Copy', 'Copy this code block')}
              {tb(!wrapCode, () => setWrapCode((v) => !v), '↔', wrapCode ? 'Long lines wrap — click to scroll them instead' : 'Long lines scroll — click to wrap them')}
            </div>
          )}

          <div className="note-toolbar-group">
            <Dropdown label="🛠" title="Tools: checklists, sort and tidy lines, move blocks, calculate" wide>
              {(close) => (
                <div className="note-dd-cols">
                  <div>
                    <MenuLabel>Checklists {empty ? '(whole note)' : '(selection)'}</MenuLabel>
                    <MenuItem close={close} disabled={!tasks.total} onClick={run((c) => c.setAllTasks(true))}>☑ Tick all items</MenuItem>
                    <MenuItem close={close} disabled={!tasks.total} onClick={run((c) => c.setAllTasks(false))}>☐ Untick all items</MenuItem>
                    <MenuItem close={close} disabled={!tasks.done} onClick={run((c) => c.completedTasksToBottom())}>⇣ Move done items to bottom</MenuItem>
                    <MenuItem close={close} disabled={!tasks.done} onClick={run((c) => c.removeCompletedTasks())}>✕ Remove done items</MenuItem>
                    <MenuLabel>Lines {empty ? '(this list or whole note)' : '(selection)'}</MenuLabel>
                    <MenuItem close={close} onClick={run((c) => c.sortLines(1))}>Sort A → Z</MenuItem>
                    <MenuItem close={close} onClick={run((c) => c.sortLines(-1))}>Sort Z → A</MenuItem>
                    <MenuItem close={close} onClick={run((c) => c.reverseLines())}>Reverse order</MenuItem>
                    <MenuItem close={close} onClick={() => editor.chain().focus().removeDuplicateLines().run() || flash('No duplicate lines')}>Remove duplicate lines</MenuItem>
                    <MenuItem close={close} onClick={() => editor.chain().focus().removeEmptyLines().run() || flash('No empty lines')}>Remove empty lines</MenuItem>
                    <MenuItem close={close} onClick={() => editor.chain().focus().trimSpaces().run() || flash('No extra spaces')}>Trim extra spaces</MenuItem>
                    <MenuItem close={close} disabled={empty} onClick={() => editor.chain().focus().joinLines().run() || flash('Select two or more paragraphs')}>Join lines into one</MenuItem>
                  </div>
                  <div>
                    <MenuLabel>This block</MenuLabel>
                    <MenuItem close={close} shortcut="Alt+↑" onClick={run((c) => c.moveBlock(-1))}>Move up</MenuItem>
                    <MenuItem close={close} shortcut="Alt+↓" onClick={run((c) => c.moveBlock(1))}>Move down</MenuItem>
                    <MenuItem close={close} shortcut="Ctrl+⇧+D" onClick={run((c) => c.duplicateBlock())}>Duplicate</MenuItem>
                    <MenuItem close={close} shortcut="Ctrl+⇧+K" onClick={run((c) => c.deleteBlock())}>Delete</MenuItem>
                    <MenuLabel>Maths</MenuLabel>
                    <MenuItem close={close} disabled={empty} onClick={calcSelection}>🧮 Calculate selection (= answer)</MenuItem>
                    <MenuLabel>Tidy the whole note</MenuLabel>
                    <MenuItem close={close} onClick={() => { editor.chain().focus().selectAll().unsetHighlight().run(); flash('Highlights removed'); }}>Remove all highlights</MenuItem>
                    <MenuItem close={close} onClick={() => { editor.chain().focus().selectAll().unsetLink().run(); flash('Links removed'); }}>Remove all links</MenuItem>
                    <MenuItem close={close} onClick={() => { editor.chain().focus().selectAll().unsetAllMarks().run(); flash('Text formatting cleared'); }}>Clear all text formatting</MenuItem>
                  </div>
                </div>
              )}
            </Dropdown>
            {tb(Boolean(find), () => setFind(find ? null : { replace: false }), '🔍', 'Find & replace (Ctrl+F / Ctrl+H)')}
            {tb(outline, () => setOutline((v) => !v), '☷', 'Document outline')}
            <Dropdown label="⋯" title="More tools" wide>
              {(close) => (
                <div className="note-dd-cols">
                  <div>
                    <MenuLabel>Clipboard</MenuLabel>
                    <MenuItem close={close} onClick={pastePlain} shortcut="Ctrl+⇧+V">Paste as plain text</MenuItem>
                    <MenuItem close={close} onClick={() => copyAs('md')}>Copy note as Markdown</MenuItem>
                    <MenuItem close={close} onClick={() => copyAs('text')}>Copy note as plain text</MenuItem>
                    <MenuItem close={close} onClick={() => copyAs('html')}>Copy note as HTML</MenuItem>
                    <MenuLabel>File</MenuLabel>
                    <MenuItem close={close} onClick={() => importInputRef.current?.click()}>Import .md / .txt / .html…</MenuItem>
                    <MenuItem close={close} onClick={() => download(jsonToMarkdown(editor.getJSON()), `${safeName}.md`, 'text/markdown')}>Download Markdown</MenuItem>
                    <MenuItem close={close} onClick={() => download(jsonToText(editor.getJSON()), `${safeName}.txt`, 'text/plain')}>Download plain text</MenuItem>
                    <MenuItem close={close} onClick={() => download(`<!doctype html><meta charset="utf-8"><title>${safeName}</title>${editor.getHTML()}`, `${safeName}.html`, 'text/html')}>Download HTML</MenuItem>
                    <MenuItem close={close} onClick={exportWord}>Download Word (.doc)</MenuItem>
                    <MenuItem close={close} onClick={() => window.print()} shortcut="Ctrl+P">Print</MenuItem>
                    <MenuItem close={close} onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(window.location.href);
                        flash('Link to this note copied');
                      } catch {
                        flash('Clipboard not available');
                      }
                    }}>Copy link to this note</MenuItem>
                    <MenuLabel>Versions</MenuLabel>
                    <MenuItem close={close} disabled={!noteId} onClick={() => flash(saveSnapshot(noteId, editor.getHTML(), words) ? 'Snapshot saved' : 'Not enough browser storage for a snapshot')}>Save snapshot</MenuItem>
                    <MenuItem close={close} disabled={!noteId} onClick={() => setModal('snapshots')}>View & restore snapshots…</MenuItem>
                    <MenuLabel>Tools</MenuLabel>
                    <MenuItem close={close} active={speaking} onClick={readAloud}>{speaking ? '⏹ Stop reading' : `🔊 Read ${empty ? 'note' : 'selection'} aloud`}</MenuItem>
                    <MenuItem close={close} active={dictating} onClick={toggleDictation}>{dictating ? '⏹ Stop voice typing' : '🎤 Voice typing'}</MenuItem>
                    <MenuItem close={close} onClick={() => setModal('stats')}>📊 Note statistics</MenuItem>
                    <MenuItem close={close} active={goal > 0} onClick={askGoal}>🎯 Word goal{goal ? ` (${goal})` : '…'}</MenuItem>
                    <MenuLabel>Select</MenuLabel>
                    <MenuItem close={close} onClick={run((c) => c.selectAll())} shortcut="Ctrl+A">Select all</MenuItem>
                  </div>
                  <div>
                    <MenuLabel>View</MenuLabel>
                    <MenuItem close={close} active={fullscreen} onClick={() => setFullscreen((v) => !v)} shortcut="Esc exits">Focus mode (full screen)</MenuItem>
                    <MenuItem close={close} active={outline} onClick={() => setOutline((v) => !v)}>Document outline</MenuItem>
                    <MenuItem close={close} active={typewriter} onClick={() => setTypewriter((v) => !v)}>Typewriter scrolling</MenuItem>
                    <MenuItem close={close} active={focusPara} onClick={() => setFocusPara((v) => !v)}>Focus on current paragraph</MenuItem>
                    <MenuItem close={close} active={showMarks} onClick={() => setShowMarks((v) => !v)}>Show formatting marks ¶</MenuItem>
                    <MenuItem close={close} active={lineNumbers} onClick={() => setLineNumbers((v) => !v)}>Paragraph numbers</MenuItem>
                    <MenuLabel>Page width</MenuLabel>
                    {PAGE_WIDTHS.map(([l, v]) => (
                      <MenuItem key={v} close={close} active={pageWidth === v} onClick={() => setPageWidth(v)}>{l}</MenuItem>
                    ))}
                    <MenuLabel>Zoom</MenuLabel>
                    <select className="note-tb-select" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
                      {ZOOMS.map((z) => <option key={z} value={z}>{z}%</option>)}
                    </select>
                    <MenuLabel>Editing</MenuLabel>
                    <MenuItem close={close} active={spellcheck} onClick={() => setSpellcheck((v) => !v)}>Spell check</MenuItem>
                    <MenuItem close={close} active={locked} onClick={() => setLocked((v) => !v)}>Lock note (read only)</MenuItem>
                    <MenuItem close={close} onClick={() => setShowShortcuts(true)} shortcut="Ctrl+/">Keyboard shortcuts</MenuItem>
                  </div>
                </div>
              )}
            </Dropdown>
            <input ref={importInputRef} type="file" accept=".md,.markdown,.txt,.html,.htm,text/plain,text/markdown,text/html" onChange={handleImport} style={{ display: 'none' }} />
          </div>
        </div>
      )}

      {linkOpen && (
        <div className="note-link-prompt">
          <input
            className="input input-sm"
            placeholder="https://… or #heading-id"
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyLink();
              if (e.key === 'Escape') setLinkOpen(false);
            }}
            autoFocus
          />
          <label className="checkbox-row"><input type="checkbox" checked={linkNewTab} onChange={(e) => setLinkNewTab(e.target.checked)} /><span>New tab</span></label>
          <button type="button" className="btn btn-sm btn-primary" onClick={applyLink}>Apply</button>
          {editor.isActive('link') && (
            <>
              <a className="btn btn-sm" href={safeLink(editor.getAttributes('link').href) || undefined} target="_blank" rel="noreferrer">Open</a>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); setLinkOpen(false); }}>Remove link</button>
            </>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLinkOpen(false)}>Cancel</button>
        </div>
      )}
      {imageUrlOpen && (
        <div className="note-link-prompt">
          <input
            className="input input-sm"
            placeholder="https://example.com/picture.png"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && imageUrl.trim()) { editor.chain().focus().setImage({ src: imageUrl.trim() }).run(); setImageUrlOpen(false); }
              if (e.key === 'Escape') setImageUrlOpen(false);
            }}
            autoFocus
          />
          <button type="button" className="btn btn-sm btn-primary" disabled={!imageUrl.trim()} onClick={() => { editor.chain().focus().setImage({ src: imageUrl.trim() }).run(); setImageUrlOpen(false); }}>Insert</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setImageUrlOpen(false)}>Cancel</button>
        </div>
      )}
      {find && <FindBar editor={editor} withReplace={find.replace} onClose={() => { setFind(null); editor.commands.focus(); }} />}
      {locked && <div className="note-locked-bar">🔒 This note is locked. <button type="button" className="link-btn" onClick={() => setLocked(false)}>Unlock to edit</button></div>}
      </div>

      <div className="note-editor-body">
        {outline && (
          <aside className="note-outline">
            <div className="note-outline-title">
              Outline
              <button type="button" className="note-outline-close" onClick={() => setOutline(false)} aria-label="Close outline">×</button>
            </div>
            {headings.length === 0 && <p className="note-outline-empty">Headings you add show up here.</p>}
            {headings.map((h) => (
              <button
                key={`${h.pos}-${h.id}`}
                type="button"
                className={`note-outline-item l${h.level}`}
                onClick={() => {
                  editor.chain().focus().setTextSelection(h.pos + 1).run();
                  editor.view.nodeDOM(h.pos)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
                }}
              >
                {h.text}
              </button>
            ))}
          </aside>
        )}
        <div className="note-page-scroll">
          <div className="note-page" style={{ maxWidth: pageWidth, zoom: zoom / 100 }}>
            <EditorContent editor={editor} className="note-content-wrap" spellCheck={spellcheck} />
          </div>
        </div>
      </div>

      {editable && !readOnly && (
        <BubbleMenu editor={editor} shouldShow={bubbleShouldShow}>
          <div className="note-bubble">
            {tb(editor.isActive('bold'), run((c) => c.toggleBold()), <b>B</b>, 'Bold')}
            {tb(editor.isActive('italic'), run((c) => c.toggleItalic()), <i>I</i>, 'Italic')}
            {tb(editor.isActive('underline'), run((c) => c.toggleUnderline()), <u>U</u>, 'Underline')}
            {tb(editor.isActive('strike'), run((c) => c.toggleStrike()), <s>S</s>, 'Strikethrough')}
            {tb(editor.isActive('highlight'), run((c) => c.toggleHighlight({ color: '#fff59d' })), '🖍', 'Highlight')}
            {tb(editor.isActive('code'), run((c) => c.toggleCode()), '</>', 'Code')}
            {tb(editor.isActive('link'), openLink, '🔗', 'Link')}
            {tb(false, run((c) => c.unsetAllMarks()), 'Tx', 'Clear formatting')}
          </div>
        </BubbleMenu>
      )}
      {editable && !readOnly && <SlashMenu editor={editor} items={SLASH_ITEMS} />}

      <div className="note-statusbar">
        <span>{words} word{words === 1 ? '' : 's'}</span>
        <span className="note-stat-extra">{chars} characters</span>
        <span className="note-stat-extra">{editor.state.doc.textContent.replace(/\s/g, '').length} without spaces</span>
        <span className="note-stat-extra">{editor.state.doc.childCount} blocks</span>
        {tasks.total > 0 && <span title="Checklist items done">☑ {tasks.done}/{tasks.total}</span>}
        {goal > 0 && (
          <button type="button" className="note-goal" onClick={askGoal} title="Word goal — click to change">
            <span className="note-goal-bar"><span style={{ width: `${Math.min(100, (words / goal) * 100)}%` }} /></span>
            {words >= goal ? `🎯 Goal reached (${goal})` : `${words}/${goal}`}
          </button>
        )}
        {speaking && <button type="button" className="note-status-sel note-status-btn" onClick={readAloud}>🔊 Reading… stop</button>}
        {dictating && <button type="button" className="note-status-sel note-status-btn" onClick={toggleDictation}>🎤 Listening… stop</button>}
        <span>~{Math.max(1, Math.round(words / 220))} min read</span>
        {selWords > 0 && <span className="note-status-sel">{selWords} selected</span>}
        {painter && <span className="note-status-sel">🖌 Select text to paste formatting (click 🖌 to cancel)</span>}
        <span className="note-status-right">{zoom !== 100 ? `${zoom}% · ` : ''}{readOnly ? 'Read only' : 'Editing'}</span>
      </div>

      {toast && <div className="note-toast">{toast}</div>}

      {modal === 'stats' && <StatsModal editor={editor} onClose={() => setModal(null)} />}
      {modal === 'link' && (
        <NoteLinkPicker
          onClose={() => setModal(null)}
          onPick={(n) => {
            const href = `/dashboard/notes/${n.uuid}`;
            const c = editor.chain().focus();
            if (empty) c.insertContent({ type: 'text', text: n.title || 'Untitled', marks: [{ type: 'link', attrs: { href, target: '_self' } }] }).run();
            else c.setLink({ href, target: '_self' }).run();
            setModal(null);
          }}
        />
      )}
      {modal === 'snapshots' && (
        <SnapshotsModal
          noteId={noteId}
          onClose={() => setModal(null)}
          onRestore={(html) => {
            editor.chain().focus().setContent(html, { emitUpdate: true }).run();
            setModal(null);
            flash('Snapshot restored');
          }}
        />
      )}

      {showShortcuts && (
        <div className="modal-overlay" onClick={() => setShowShortcuts(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="new-track-head">
              <h2>Keyboard shortcuts</h2>
              <button type="button" className="new-track-close" onClick={() => setShowShortcuts(false)} title="Close">×</button>
            </div>
            <table className="note-shortcuts">
              <tbody>
                {SHORTCUTS.map(([what, keys]) => (
                  <tr key={what}><td>{what}</td><td><kbd>{keys}</kbd></td></tr>
                ))}
              </tbody>
            </table>
            <p className="field-hint">On a Mac use ⌘ instead of Ctrl.</p>
          </div>
        </div>
      )}
    </div>
  );
}

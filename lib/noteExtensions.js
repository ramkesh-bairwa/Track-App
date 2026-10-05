// Custom Tiptap extensions for the note editor: everything a "proper
// document" needs that Tiptap doesn't ship as a ready extension.
import { Extension, Node, mergeAttributes, InputRule } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import ImageBase from '@tiptap/extension-image';
import { TableCell as TableCellBase, TableHeader as TableHeaderBase } from '@tiptap/extension-table';

const BLOCK_TYPES = ['paragraph', 'heading'];

// ---------- paragraph layout: indent, line height, spacing, direction ----------

export const BlockFormat = Extension.create({
  name: 'blockFormat',

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => Number(el.getAttribute('data-indent')) || 0,
            renderHTML: (a) => (a.indent ? { 'data-indent': a.indent, style: `margin-left: ${a.indent * 2}em` } : {}),
          },
          lineHeight: {
            default: null,
            parseHTML: (el) => el.style.lineHeight || null,
            renderHTML: (a) => (a.lineHeight ? { style: `line-height: ${a.lineHeight}` } : {}),
          },
          spaceBefore: {
            default: null,
            parseHTML: (el) => el.style.marginTop || null,
            renderHTML: (a) => (a.spaceBefore ? { style: `margin-top: ${a.spaceBefore}` } : {}),
          },
          spaceAfter: {
            default: null,
            parseHTML: (el) => el.style.marginBottom || null,
            renderHTML: (a) => (a.spaceAfter ? { style: `margin-bottom: ${a.spaceAfter}` } : {}),
          },
          dir: {
            default: null,
            parseHTML: (el) => el.getAttribute('dir'),
            renderHTML: (a) => (a.dir ? { dir: a.dir } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    const update = (fn) => ({ state, tr, dispatch }) => {
      const { from, to } = state.selection;
      let changed = false;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!BLOCK_TYPES.includes(node.type.name)) return;
        const attrs = fn(node.attrs);
        if (attrs) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
          changed = true;
        }
      });
      if (changed && dispatch) dispatch(tr);
      return changed;
    };
    return {
      indentBlock: () => update((a) => (a.indent < 8 ? { indent: a.indent + 1 } : null)),
      outdentBlock: () => update((a) => (a.indent > 0 ? { indent: a.indent - 1 } : null)),
      setLineHeight: (lineHeight) => update(() => ({ lineHeight })),
      setBlockSpacing: (spaceBefore, spaceAfter) => update(() => ({ spaceBefore, spaceAfter })),
      setTextDirection: (dir) => update(() => ({ dir })),
    };
  },

  addKeyboardShortcuts() {
    // Tab indents a paragraph; inside lists and tables Tab keeps its usual job.
    const inListOrTable = (editor) =>
      editor.isActive('listItem') || editor.isActive('taskItem') || editor.isActive('table') || editor.isActive('codeBlock');
    return {
      Tab: ({ editor }) => (inListOrTable(editor) ? false : editor.commands.indentBlock() || true),
      'Shift-Tab': ({ editor }) => (inListOrTable(editor) ? false : editor.commands.outdentBlock() || true),
    };
  },
});

// Bullet style (disc / circle / square) — ordered lists already have `type`.
export const ListStyle = Extension.create({
  name: 'listStyle',
  addGlobalAttributes() {
    return [
      {
        types: ['bulletList'],
        attributes: {
          listStyleType: {
            default: null,
            parseHTML: (el) => el.style.listStyleType || null,
            renderHTML: (a) => (a.listStyleType ? { style: `list-style-type: ${a.listStyleType}` } : {}),
          },
        },
      },
    ];
  },
});

// ---------- blocks ----------

export const PageBreak = Node.create({
  name: 'pageBreak',
  // Above HardBreak, which also binds Mod-Enter (Shift-Enter still breaks a line).
  priority: 1000,
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div[data-type="page-break"]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'page-break', class: 'note-page-break' })],
  addCommands() {
    return {
      // One insert: a second insertContent would replace the just-selected break.
      setPageBreak: () => ({ commands }) => commands.insertContent([{ type: this.name }, { type: 'paragraph' }]),
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setPageBreak() };
  },
});

export const CALLOUT_TYPES = [
  { id: 'info', label: 'Info', icon: 'ℹ️' },
  { id: 'tip', label: 'Tip', icon: '💡' },
  { id: 'success', label: 'Success', icon: '✅' },
  { id: 'warning', label: 'Warning', icon: '⚠️' },
  { id: 'danger', label: 'Danger', icon: '⛔' },
  { id: 'note', label: 'Note', icon: '📝' },
];

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      kind: {
        default: 'info',
        parseHTML: (el) => el.getAttribute('data-callout') || 'info',
        renderHTML: (a) => ({ 'data-callout': a.kind }),
      },
    };
  },
  parseHTML: () => [{ tag: 'div[data-callout]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { class: 'note-callout' }), 0],
  addCommands() {
    return {
      setCallout: (kind = 'info') => ({ commands }) => commands.wrapIn(this.name, { kind }),
      toggleCallout: (kind = 'info') => ({ editor, commands }) =>
        editor.isActive(this.name) ? commands.lift(this.name) : commands.wrapIn(this.name, { kind }),
      setCalloutKind: (kind) => ({ commands }) => commands.updateAttributes(this.name, { kind }),
    };
  },
});

// ---------- headings: stable ids for the outline, links and the TOC ----------

const slug = (s) =>
  s.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';

export const HeadingIds = Extension.create({
  name: 'headingIds',
  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          id: { default: null, parseHTML: (el) => el.getAttribute('id'), renderHTML: (a) => (a.id ? { id: a.id } : {}) },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('headingIds'),
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((t) => t.docChanged)) return null;
          const tr = state.tr;
          const seen = new Set();
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'heading') return;
            let id = slug(node.textContent);
            for (let n = 2; seen.has(id); n += 1) id = `${slug(node.textContent)}-${n}`;
            seen.add(id);
            if (node.attrs.id !== id) tr.setNodeMarkup(pos, undefined, { ...node.attrs, id });
          });
          return tr.docChanged ? tr.setMeta('addToHistory', false) : null;
        },
      }),
    ];
  },
});

// Headings in document order → [{ level, text, id, pos }]
export function collectHeadings(doc) {
  const out = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading' && node.textContent.trim()) {
      out.push({ level: node.attrs.level, text: node.textContent, id: node.attrs.id, pos });
    }
  });
  return out;
}

// A table of contents that keeps itself up to date as headings change.
export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div[data-type="toc"]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toc', class: 'note-toc' })],
  addCommands() {
    return { insertTableOfContents: () => ({ commands }) => commands.insertContent({ type: this.name }) };
  },
  addNodeView() {
    return ({ editor }) => {
      const dom = document.createElement('div');
      dom.className = 'note-toc';
      dom.setAttribute('data-type', 'toc');
      dom.contentEditable = 'false';
      const render = () => {
        const headings = collectHeadings(editor.state.doc);
        dom.innerHTML = '';
        const title = document.createElement('div');
        title.className = 'note-toc-title';
        title.textContent = 'Contents';
        dom.appendChild(title);
        if (headings.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'note-toc-empty';
          empty.textContent = 'Add headings and they will be listed here.';
          dom.appendChild(empty);
        }
        for (const h of headings) {
          const a = document.createElement('a');
          a.href = `#${h.id || ''}`;
          a.textContent = h.text;
          a.className = `note-toc-item note-toc-l${h.level}`;
          a.onclick = (e) => {
            e.preventDefault();
            editor.view.nodeDOM(h.pos)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
          };
          dom.appendChild(a);
        }
      };
      render();
      editor.on('update', render);
      return { dom, destroy: () => editor.off('update', render), ignoreMutation: () => true };
    };
  },
});

// ---------- inline: images, table cells ----------

export const Image = ImageBase.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => el.style.width || el.getAttribute('width') || null,
      },
      align: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-align'),
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const { width, align, ...rest } = HTMLAttributes;
    const style = [width && `width: ${width}`, align === 'center' && 'display:block;margin-left:auto;margin-right:auto',
      align === 'right' && 'display:block;margin-left:auto', align === 'left' && 'display:block;margin-right:auto']
      .filter(Boolean).join(';');
    return ['img', mergeAttributes(rest, style ? { style } : {}, align ? { 'data-align': align } : {})];
  },
}).configure({ allowBase64: true });

const cellBackground = {
  backgroundColor: {
    default: null,
    parseHTML: (el) => el.style.backgroundColor || null,
    renderHTML: (a) => (a.backgroundColor ? { style: `background-color: ${a.backgroundColor}` } : {}),
  },
};
export const TableCell = TableCellBase.extend({ addAttributes() { return { ...this.parent?.(), ...cellBackground }; } });
export const TableHeader = TableHeaderBase.extend({ addAttributes() { return { ...this.parent?.(), ...cellBackground }; } });

// ---------- text tools ----------

// UPPERCASE / lowercase / Title Case / Sentence case on the selection,
// keeping every character's formatting.
export const TextCase = Extension.create({
  name: 'textCase',
  addCommands() {
    const transform = (fn) => ({ state, tr, dispatch }) => {
      const { from, to, empty } = state.selection;
      if (empty) return false;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isText) return;
        const start = Math.max(from, pos);
        const end = Math.min(to, pos + node.nodeSize);
        const text = node.text.slice(start - pos, end - pos);
        const next = fn(text, start === from);
        if (next !== text) tr.replaceWith(tr.mapping.map(start), tr.mapping.map(end), state.schema.text(next, node.marks));
      });
      tr.setSelection(TextSelection.create(tr.doc, from, tr.mapping.map(to)));
      if (dispatch) dispatch(tr);
      return true;
    };
    return {
      toUpperCase: () => transform((t) => t.toUpperCase()),
      toLowerCase: () => transform((t) => t.toLowerCase()),
      toTitleCase: () => transform((t) => t.toLowerCase().replace(/(^|[\s\-(“"'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())),
      toSentenceCase: () => transform((t, first) => {
        const lower = t.toLowerCase().replace(/([.!?]\s+)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
        return first ? lower.replace(/^(\s*)(\p{L})/u, (m, a, b) => a + b.toUpperCase()) : lower;
      }),
    };
  },
});

// Typing shortcuts: -- → —, ... → …, -> → →, (c) → ©, 1/2 → ½ and friends.
const REPLACEMENTS = [
  [/--$/, '—'], [/\.\.\.$/, '…'], [/->$/, '→'], [/<-$/, '←'], [/=>$/, '⇒'], [/\(c\)$/i, '©'], [/\(r\)$/i, '®'],
  [/\(tm\)$/i, '™'], [/(?<=^|\s)1\/2$/, '½'], [/(?<=^|\s)1\/4$/, '¼'], [/(?<=^|\s)3\/4$/, '¾'], [/!=$/, '≠'],
  [/<=$/, '≤'], [/>=$/, '≥'], [/\+-$/, '±'],
];
export const Typography = Extension.create({
  name: 'noteTypography',
  addInputRules() {
    return REPLACEMENTS.map(
      ([find, replace]) =>
        new InputRule({
          find,
          handler: ({ state, range }) => {
            state.tr.insertText(replace, range.from, range.to);
          },
        })
    );
  },
});

// ---------- find & replace ----------

export const findKey = new PluginKey('noteFind');

function findMatches(doc, term, caseSensitive, wholeWord) {
  const results = [];
  if (!term) return results;
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])` : esc, caseSensitive ? 'gu' : 'giu');
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    // Walk the block's text with positions, so matches can span marks.
    let text = '';
    const map = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text.length; i += 1) map.push(pos + 1 + offset + i);
        text += child.text;
      } else {
        map.push(null);
        text += '￼';
      }
    });
    for (const m of text.matchAll(re)) {
      if (!m[0]) continue;
      const from = map[m.index];
      const last = map[m.index + m[0].length - 1];
      if (from != null && last != null) results.push({ from, to: last + 1 });
    }
    return false;
  });
  return results;
}

export const FindReplace = Extension.create({
  name: 'findReplace',
  addStorage() {
    return { term: '', caseSensitive: false, wholeWord: false, results: [], index: 0 };
  },
  // Every command works on the transaction it's given (never dispatching
  // its own), so commands can't collide with each other.
  addCommands() {
    const store = () => this.storage;
    const refresh = (doc) => {
      const s = store();
      s.results = findMatches(doc, s.term, s.caseSensitive, s.wholeWord);
      if (s.index >= s.results.length) s.index = 0;
    };
    const select = (tr, i) => {
      const s = store();
      if (!s.results.length) return false;
      s.index = (i + s.results.length) % s.results.length;
      const r = s.results[s.index];
      tr.setSelection(TextSelection.create(tr.doc, r.from, r.to)).scrollIntoView();
      return true;
    };
    return {
      setSearch: (opts) => ({ state, tr, dispatch }) => {
        Object.assign(store(), opts);
        refresh(state.doc);
        if (dispatch) dispatch(tr.setMeta(findKey, true));
        return true;
      },
      findNext: () => ({ tr, dispatch }) => {
        const found = select(tr, store().index + 1);
        if (found && dispatch) dispatch(tr.setMeta(findKey, true));
        return found;
      },
      findPrev: () => ({ tr, dispatch }) => {
        const found = select(tr, store().index - 1);
        if (found && dispatch) dispatch(tr.setMeta(findKey, true));
        return found;
      },
      replaceCurrent: (text) => ({ tr, dispatch }) => {
        const s = store();
        const r = s.results[s.index];
        if (!r) return false;
        if (text) tr.insertText(text, r.from, r.to);
        else tr.delete(r.from, r.to);
        refresh(tr.doc);
        select(tr, s.index);
        if (dispatch) dispatch(tr.setMeta(findKey, true));
        return true;
      },
      replaceAll: (text) => ({ tr, dispatch }) => {
        const s = store();
        if (!s.results.length) return false;
        [...s.results].reverse().forEach((r) => (text ? tr.insertText(text, r.from, r.to) : tr.delete(r.from, r.to)));
        refresh(tr.doc);
        if (dispatch) dispatch(tr.setMeta(findKey, true));
        return true;
      },
      clearSearch: () => ({ tr, dispatch }) => {
        Object.assign(store(), { term: '', results: [], index: 0 });
        if (dispatch) dispatch(tr.setMeta(findKey, true));
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const ext = this;
    return [
      new Plugin({
        key: findKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const s = ext.storage;
            if (tr.docChanged && s.term) s.results = findMatches(tr.doc, s.term, s.caseSensitive, s.wholeWord);
            if (!tr.docChanged && !tr.getMeta(findKey)) return old;
            return DecorationSet.create(
              tr.doc,
              s.results.map((r, i) => Decoration.inline(r.from, r.to, { class: i === s.index ? 'note-find-hit current' : 'note-find-hit' }))
            );
          },
        },
        props: { decorations: (state) => findKey.getState(state) },
      }),
    ];
  },
});

// ---------- "/" command menu ----------

export const slashKey = new PluginKey('noteSlash');

// Tracks a "/query" typed at the start of a line or after a space. The React
// menu reads `editor.storage.slashMenu` and handles its own keys via `onKey`.
export const SlashMenu = Extension.create({
  name: 'slashMenu',
  addStorage() {
    return { active: false, query: '', range: null, onKey: null };
  },
  addProseMirrorPlugins() {
    const ext = this;
    return [
      new Plugin({
        key: slashKey,
        view: () => ({
          update(view) {
            const { state } = view;
            const s = ext.storage;
            const { $from, empty } = state.selection;
            let next = { active: false, query: '', range: null };
            if (empty && $from.parent.isTextblock && $from.parent.type.name !== 'codeBlock') {
              const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
              const m = before.match(/(?:^|\s)\/([\p{L}\p{N}-]{0,24})$/u);
              if (m) next = { active: true, query: m[1], range: { from: $from.pos - m[1].length - 1, to: $from.pos } };
            }
            if (next.active !== s.active || next.query !== s.query) {
              Object.assign(s, next);
              ext.editor.emit('slashMenu', next);
            } else if (next.active) {
              s.range = next.range;
            }
          },
        }),
        props: {
          handleKeyDown: (view, event) => (ext.storage.active && ext.storage.onKey ? ext.storage.onKey(event) : false),
        },
      }),
    ];
  },
});

// ---------- pasted / dropped image files → inline images ----------

export const ImageDrop = Extension.create({
  name: 'imageDrop',
  addProseMirrorPlugins() {
    const editor = this.editor;
    const insertFiles = (files, pos) => {
      const images = [...files].filter((f) => f.type.startsWith('image/'));
      if (!images.length) return false;
      for (const file of images) {
        const reader = new FileReader();
        reader.onload = () => {
          const chain = editor.chain().focus();
          (pos != null ? chain.insertContentAt(pos, { type: 'image', attrs: { src: reader.result } }) : chain.setImage({ src: reader.result })).run();
        };
        reader.readAsDataURL(file);
      }
      return true;
    };
    return [
      new Plugin({
        key: new PluginKey('noteImageDrop'),
        props: {
          handlePaste: (view, event) => insertFiles(event.clipboardData?.files || [], null),
          handleDrop: (view, event) => {
            const files = event.dataTransfer?.files;
            if (!files?.length) return false;
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            const handled = insertFiles(files, pos);
            if (handled) event.preventDefault();
            return handled;
          },
        },
      }),
    ];
  },
});

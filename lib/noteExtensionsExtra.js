// More note editor extensions: text effects, block styles, collapsible
// sections, columns, block and line tools, checklist tools, emoji
// shortcodes, #hashtags and the "focus on this paragraph" highlight.
import { Extension, Mark, Node, mergeAttributes, InputRule } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// ---------- text effects (stored on the textStyle mark) ----------

// Weight, letter spacing, small caps and underline / overline styles. Set
// them with setMark('textStyle', { fontWeight: '600' }) and clear with null.
export const TextEffects = Extension.create({
  name: 'textEffects',
  addGlobalAttributes() {
    const css = (name, prop) => ({
      default: null,
      parseHTML: (el) => el.style[prop] || null,
      renderHTML: (a) => (a[name] ? { style: `${prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${a[name]}` } : {}),
    });
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontWeight: css('fontWeight', 'fontWeight'),
          letterSpacing: css('letterSpacing', 'letterSpacing'),
          fontVariant: css('fontVariant', 'fontVariant'),
          // e.g. 'underline wavy', 'underline double', 'overline'
          textDecoration: css('textDecoration', 'textDecoration'),
        },
      },
    ];
  },
});

// <kbd>Ctrl</kbd> style keyboard keys.
export const Kbd = Mark.create({
  name: 'kbd',
  parseHTML: () => [{ tag: 'kbd' }],
  renderHTML: ({ HTMLAttributes }) => ['kbd', mergeAttributes(HTMLAttributes, { class: 'note-kbd' }), 0],
  addCommands() {
    return { toggleKbd: () => ({ commands }) => commands.toggleMark(this.name) };
  },
});

// Blurred text that shows when you hover or tap it.
export const Spoiler = Mark.create({
  name: 'spoiler',
  parseHTML: () => [{ tag: 'span[data-spoiler]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-spoiler': '', class: 'note-spoiler' }), 0],
  addCommands() {
    return { toggleSpoiler: () => ({ commands }) => commands.toggleMark(this.name) };
  },
});

export const TAG_COLORS = [
  { id: 'gray', label: 'Gray' }, { id: 'green', label: 'Green' }, { id: 'blue', label: 'Blue' },
  { id: 'yellow', label: 'Yellow' }, { id: 'red', label: 'Red' }, { id: 'purple', label: 'Purple' },
];
// A coloured pill label, e.g. "Done", "Urgent".
export const TagLabel = Mark.create({
  name: 'tagLabel',
  excludes: 'tagLabel',
  addAttributes() {
    return { color: { default: 'gray', parseHTML: (el) => el.getAttribute('data-tag') || 'gray', renderHTML: (a) => ({ 'data-tag': a.color }) } };
  },
  parseHTML: () => [{ tag: 'span[data-tag]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { class: 'note-tag' }), 0],
  addCommands() {
    return {
      setTagLabel: (color = 'gray') => ({ commands }) => commands.setMark(this.name, { color }),
      unsetTagLabel: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
});

// ---------- block styles ----------

const STYLED_BLOCKS = ['paragraph', 'heading'];

// Drop cap, shading, accent bar and box on paragraphs / headings; a style
// for quotes and for divider lines.
export const BlockStyles = Extension.create({
  name: 'blockStyles',
  addGlobalAttributes() {
    const flag = (name, cls) => ({
      default: false,
      parseHTML: (el) => el.classList.contains(cls),
      renderHTML: (a) => (a[name] ? { class: cls } : {}),
    });
    return [
      {
        types: STYLED_BLOCKS,
        attributes: {
          dropCap: flag('dropCap', 'note-dropcap'),
          accentBar: flag('accentBar', 'note-accentbar'),
          boxed: flag('boxed', 'note-boxed'),
          shade: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-shade'),
            renderHTML: (a) => (a.shade ? { 'data-shade': a.shade, style: `background-color: ${a.shade}` } : {}),
          },
        },
      },
      {
        types: ['blockquote'],
        attributes: {
          quoteStyle: { default: null, parseHTML: (el) => el.getAttribute('data-style'), renderHTML: (a) => (a.quoteStyle ? { 'data-style': a.quoteStyle } : {}) },
        },
      },
      {
        types: ['horizontalRule'],
        attributes: {
          lineStyle: { default: null, parseHTML: (el) => el.getAttribute('data-style'), renderHTML: (a) => (a.lineStyle ? { 'data-style': a.lineStyle } : {}) },
        },
      },
    ];
  },
  addCommands() {
    return {
      // Sets (or toggles, for true/false flags) an attribute on every paragraph / heading in the selection.
      setBlockStyle: (name, value) => ({ state, tr, dispatch }) => {
        const { from, to } = state.selection;
        let changed = false;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!STYLED_BLOCKS.includes(node.type.name)) return;
          const next = typeof value === 'boolean' ? !node.attrs[name] : value;
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, [name]: next });
          changed = true;
        });
        if (changed && dispatch) dispatch(tr);
        return changed;
      },
      setHorizontalRuleStyle: (lineStyle) => ({ commands }) =>
        commands.insertContent([{ type: 'horizontalRule', attrs: { lineStyle } }, { type: 'paragraph' }]),
    };
  },
});

// ---------- collapsible section ----------

// A toggle block: a one-line summary you click ▸ to open or close, with any
// content inside. Saved as <details><summary>…</summary><div>…</div></details>.
export const DetailsSummary = Node.create({
  name: 'detailsSummary',
  content: 'inline*',
  defining: true,
  selectable: false,
  parseHTML: () => [{ tag: 'summary' }],
  renderHTML: ({ HTMLAttributes }) => ['summary', mergeAttributes(HTMLAttributes, { class: 'note-details-summary' }), 0],
});

export const DetailsContent = Node.create({
  name: 'detailsContent',
  content: 'block+',
  defining: true,
  selectable: false,
  parseHTML: () => [{ tag: 'div[data-details-content]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-details-content': '', class: 'note-details-content' }), 0],
});

export const Details = Node.create({
  name: 'details',
  group: 'block',
  content: 'detailsSummary detailsContent',
  defining: true,
  isolating: true,
  addAttributes() {
    return { open: { default: true, parseHTML: (el) => el.hasAttribute('open'), renderHTML: (a) => (a.open ? { open: '' } : {}) } };
  },
  parseHTML: () => [{ tag: 'details' }],
  renderHTML: ({ HTMLAttributes }) => ['details', mergeAttributes(HTMLAttributes, { class: 'note-details' }), 0],
  addNodeView() {
    // A div instead of a real <details>, so clicking the summary edits it
    // instead of toggling; the ▸ button toggles.
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div');
      dom.className = 'note-details';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'note-details-toggle';
      toggle.contentEditable = 'false';
      toggle.title = 'Open / close';
      const contentDOM = document.createElement('div');
      contentDOM.className = 'note-details-body';
      dom.append(toggle, contentDOM);
      let current = node;
      const paint = () => {
        dom.classList.toggle('is-open', current.attrs.open);
        toggle.textContent = current.attrs.open ? '▾' : '▸';
      };
      paint();
      toggle.addEventListener('mousedown', (e) => e.preventDefault());
      toggle.addEventListener('click', () => {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        const { tr } = editor.view.state;
        editor.view.dispatch(tr.setNodeMarkup(pos, undefined, { ...current.attrs, open: !current.attrs.open }));
      });
      return {
        dom,
        contentDOM,
        update: (next) => {
          if (next.type !== current.type) return false;
          current = next;
          paint();
          return true;
        },
      };
    };
  },
  addCommands() {
    return {
      setDetails: () => ({ state, chain }) => {
        const { from, to } = state.selection;
        const text = state.doc.textBetween(from, to, ' ').trim();
        return chain()
          .insertContent({
            type: this.name,
            attrs: { open: true },
            content: [
              { type: 'detailsSummary', content: [{ type: 'text', text: text || 'Click ▸ to open or close this section' }] },
              { type: 'detailsContent', content: [{ type: 'paragraph' }] },
            ],
          })
          .run();
      },
    };
  },
  addKeyboardShortcuts() {
    return {
      // Enter at the end of the summary jumps into the section body.
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parent.type.name !== 'detailsSummary' || $from.parentOffset !== $from.parent.content.size) return false;
        const after = $from.after();
        return editor.commands.setTextSelection(after + 2);
      },
    };
  },
});

// ---------- columns ----------

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  parseHTML: () => [{ tag: 'div[data-column]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-column': '', class: 'note-column' }), 0],
});

export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,3}',
  defining: true,
  isolating: true,
  parseHTML: () => [{ tag: 'div[data-columns]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-columns': node.childCount, class: 'note-columns' }), 0],
  addCommands() {
    return {
      insertColumns: (count = 2) => ({ commands }) =>
        commands.insertContent([
          { type: this.name, content: Array.from({ length: count }, () => ({ type: 'column', content: [{ type: 'paragraph' }] })) },
          { type: 'paragraph' },
        ]),
    };
  },
});

// ---------- block tools: duplicate, move, delete ----------

// The top-level block the cursor is in: { node, pos }.
function currentBlock(state) {
  const { $from } = state.selection;
  if ($from.depth < 1) return null;
  const pos = $from.before(1);
  return { node: state.doc.nodeAt(pos), pos };
}

export const BlockTools = Extension.create({
  name: 'blockTools',
  addCommands() {
    return {
      duplicateBlock: () => ({ state, tr, dispatch }) => {
        const b = currentBlock(state);
        if (!b) return false;
        if (dispatch) dispatch(tr.insert(b.pos + b.node.nodeSize, b.node.copy(b.node.content)).scrollIntoView());
        return true;
      },
      moveBlock: (dir) => ({ state, tr, dispatch }) => {
        const b = currentBlock(state);
        if (!b) return false;
        const $pos = state.doc.resolve(b.pos);
        const index = $pos.index(0);
        const target = index + dir;
        if (target < 0 || target >= state.doc.childCount) return false;
        if (dispatch) {
          const offset = state.selection.from - b.pos;
          const neighbour = state.doc.child(target);
          tr.delete(b.pos, b.pos + b.node.nodeSize);
          const insertAt = dir < 0 ? b.pos - neighbour.nodeSize : b.pos + neighbour.nodeSize;
          tr.insert(insertAt, b.node);
          tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(insertAt + offset, tr.doc.content.size))));
          dispatch(tr.scrollIntoView());
        }
        return true;
      },
      deleteBlock: () => ({ state, tr, dispatch }) => {
        const b = currentBlock(state);
        if (!b) return false;
        if (dispatch) {
          tr.delete(b.pos, b.pos + b.node.nodeSize);
          if (tr.doc.childCount === 0) tr.insert(0, state.schema.nodes.paragraph.create());
          tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(b.pos, tr.doc.content.size))));
          dispatch(tr);
        }
        return true;
      },
    };
  },
  addKeyboardShortcuts() {
    return {
      'Alt-ArrowUp': () => this.editor.commands.moveBlock(-1),
      'Alt-ArrowDown': () => this.editor.commands.moveBlock(1),
      'Mod-Shift-d': () => this.editor.commands.duplicateBlock(),
      'Mod-Shift-k': () => this.editor.commands.deleteBlock(),
    };
  },
});

// ---------- line tools: sort, reverse, de-duplicate, tidy ----------

const LIST_TYPES = ['bulletList', 'orderedList', 'taskList'];

// The run of sibling blocks the line tools work on: the list you're in, the
// blocks the selection covers, or (with nothing selected) the whole note.
function lineRange(state) {
  const { $from, $to, empty } = state.selection;
  if (!empty) {
    const range = $from.blockRange($to);
    if (range && range.endIndex - range.startIndex > 1) return range;
  }
  for (let d = $from.depth; d > 0; d -= 1) {
    const node = $from.node(d);
    if (LIST_TYPES.includes(node.type.name)) {
      const $start = state.doc.resolve($from.before(d) + 1);
      return { parent: node, start: $start.pos, end: $from.after(d) - 1, startIndex: 0, endIndex: node.childCount };
    }
  }
  return { parent: state.doc, start: 0, end: state.doc.content.size, startIndex: 0, endIndex: state.doc.childCount };
}

function rewriteLines(fn) {
  return () => ({ state, tr, dispatch }) => {
    const range = lineRange(state);
    const nodes = [];
    for (let i = range.startIndex; i < range.endIndex; i += 1) nodes.push(range.parent.child(i));
    const next = fn(nodes, state.schema);
    if (!next || (next.length === nodes.length && next.every((n, i) => n === nodes[i]))) return false;
    if (dispatch) {
      const list = next.length ? next : [state.schema.nodes.paragraph.create()];
      tr.replaceWith(range.start, range.end, Fragment.from(list));
      dispatch(tr);
    }
    return true;
  };
}

const key = (n) => n.textContent.trim().toLowerCase();
// An empty line: a paragraph or list item with no text and nothing like an image in it.
const BLANKABLE = ['paragraph', 'listItem', 'taskItem'];
function isBlank(node) {
  if (!BLANKABLE.includes(node.type.name) || node.textContent.trim()) return false;
  let hasObject = false;
  node.descendants((child) => {
    if (child.isLeaf && !child.isText && child.type.name !== 'hardBreak') hasObject = true;
  });
  return !hasObject;
}
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const LineTools = Extension.create({
  name: 'lineTools',
  addCommands() {
    return {
      sortLines: (dir = 1) => rewriteLines((nodes) => [...nodes].sort((a, b) => dir * collator.compare(a.textContent.trim(), b.textContent.trim())))(),
      reverseLines: rewriteLines((nodes) => [...nodes].reverse()),
      removeDuplicateLines: rewriteLines((nodes) => {
        const seen = new Set();
        return nodes.filter((n) => {
          const k = key(n);
          if (!k) return true;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      }),
      removeEmptyLines: rewriteLines((nodes) => nodes.filter((n) => !isBlank(n))),
      // Collapses runs of spaces and trims every line in the note (or selection).
      trimSpaces: () => ({ state, tr, dispatch }) => {
        const { from, to, empty } = state.selection;
        const [a, b] = empty ? [0, state.doc.content.size] : [from, to];
        state.doc.nodesBetween(a, b, (node, pos, parent, index) => {
          if (!node.isText) return;
          let text = node.text.replace(/[ \t ]{2,}/g, ' ');
          if (index === 0) text = text.replace(/^\s+/, '');
          if (index === parent.childCount - 1) text = text.replace(/\s+$/, '');
          if (text !== node.text) {
            const start = tr.mapping.map(pos);
            const end = tr.mapping.map(pos + node.nodeSize);
            if (text) tr.replaceWith(start, end, state.schema.text(text, node.marks));
            else tr.delete(start, end);
          }
        });
        if (!tr.docChanged) return false;
        if (dispatch) dispatch(tr);
        return true;
      },
      // Merges the selected paragraphs into one, separated by spaces.
      joinLines: () => ({ state, tr, dispatch }) => {
        const range = state.selection.$from.blockRange(state.selection.$to);
        if (!range || range.endIndex - range.startIndex < 2) return false;
        const parts = [];
        for (let i = range.startIndex; i < range.endIndex; i += 1) {
          const n = range.parent.child(i);
          if (!n.isTextblock) return false;
          n.content.forEach((c) => parts.push(c));
          if (i < range.endIndex - 1) parts.push(state.schema.text(' '));
        }
        if (dispatch) {
          tr.replaceWith(range.start, range.end, range.parent.child(range.startIndex).type.create(range.parent.child(range.startIndex).attrs, parts));
          dispatch(tr);
        }
        return true;
      },
    };
  },
});

// ---------- checklist tools ----------

function eachTaskList(state, fn) {
  const { from, to, empty } = state.selection;
  const [a, b] = empty ? [0, state.doc.content.size] : [from, to];
  const lists = [];
  state.doc.nodesBetween(a, b, (node, pos) => {
    if (node.type.name === 'taskList') lists.push({ node, pos });
  });
  return lists.reverse().map(fn);
}

export const ChecklistTools = Extension.create({
  name: 'checklistTools',
  addCommands() {
    return {
      setAllTasks: (checked) => ({ state, tr, dispatch }) => {
        const { from, to, empty } = state.selection;
        const [a, b] = empty ? [0, state.doc.content.size] : [from, to];
        state.doc.nodesBetween(a, b, (node, pos) => {
          if (node.type.name === 'taskItem' && node.attrs.checked !== checked) tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked });
        });
        if (!tr.docChanged) return false;
        if (dispatch) dispatch(tr);
        return true;
      },
      removeCompletedTasks: () => ({ state, tr, dispatch }) => {
        eachTaskList(state, ({ node, pos }) => {
          const keep = [];
          node.forEach((item) => !item.attrs.checked && keep.push(item));
          if (keep.length === node.childCount) return;
          if (keep.length) tr.replaceWith(pos + 1, pos + node.nodeSize - 1, Fragment.from(keep));
          else tr.delete(pos, pos + node.nodeSize);
        });
        if (!tr.docChanged) return false;
        if (dispatch) dispatch(tr);
        return true;
      },
      completedTasksToBottom: () => ({ state, tr, dispatch }) => {
        eachTaskList(state, ({ node, pos }) => {
          const open = [];
          const done = [];
          node.forEach((item) => (item.attrs.checked ? done : open).push(item));
          const next = [...open, ...done];
          if (next.every((n, i) => n === node.child(i))) return;
          tr.replaceWith(pos + 1, pos + node.nodeSize - 1, Fragment.from(next));
        });
        if (!tr.docChanged) return false;
        if (dispatch) dispatch(tr);
        return true;
      },
    };
  },
});

// Ticked / total checklist items in a document.
export function taskCounts(doc) {
  let total = 0;
  let done = 0;
  doc.descendants((node) => {
    if (node.type.name === 'taskItem') {
      total += 1;
      if (node.attrs.checked) done += 1;
    }
  });
  return { total, done };
}

// ---------- more case styles ----------

export const MoreCases = Extension.create({
  name: 'moreCases',
  addCommands() {
    const words = (t) => t.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const transform = (fn) => () => ({ state, tr, dispatch }) => {
      const { from, to, empty } = state.selection;
      if (empty) return false;
      const text = state.doc.textBetween(from, to, '\n');
      const next = fn(text);
      if (next === text) return false;
      const marks = state.doc.resolve(from).marks();
      tr.replaceWith(from, to, state.schema.text(next, marks));
      tr.setSelection(TextSelection.create(tr.doc, from, from + next.length));
      if (dispatch) dispatch(tr);
      return true;
    };
    return {
      toToggleCase: transform((t) => [...t].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('')),
      toCamelCase: transform((t) => words(t).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('')),
      toSnakeCase: transform((t) => words(t).map((w) => w.toLowerCase()).join('_')),
      toKebabCase: transform((t) => words(t).map((w) => w.toLowerCase()).join('-')),
      toConstantCase: transform((t) => words(t).map((w) => w.toUpperCase()).join('_')),
    };
  },
});

// ---------- emoji shortcodes ----------

export const EMOJI_CODES = {
  smile: '😄', grin: '😁', joy: '😂', rofl: '🤣', wink: '😉', blush: '😊', heart_eyes: '😍', kiss: '😘', thinking: '🤔',
  neutral: '😐', sad: '😢', cry: '😭', angry: '😠', scream: '😱', cool: '😎', sleepy: '😴', party: '🥳', shrug: '🤷',
  heart: '❤️', broken_heart: '💔', fire: '🔥', star: '⭐', sparkles: '✨', zap: '⚡', boom: '💥', '100': '💯',
  thumbsup: '👍', '+1': '👍', thumbsdown: '👎', '-1': '👎', clap: '👏', pray: '🙏', wave: '👋', ok: '👌', muscle: '💪',
  eyes: '👀', check: '✅', x: '❌', warning: '⚠️', question: '❓', exclamation: '❗', bulb: '💡', memo: '📝', pin: '📌',
  calendar: '📅', clock: '⏰', bell: '🔔', lock: '🔒', key: '🔑', rocket: '🚀', tada: '🎉', gift: '🎁', trophy: '🏆',
  money: '💰', chart: '📈', book: '📖', phone: '📱', computer: '💻', coffee: '☕', pizza: '🍕', car: '🚗', house: '🏠',
  sun: '☀️', moon: '🌙', rain: '🌧️', earth: '🌍', bug: '🐛', link: '🔗', mail: '✉️', home: '🏠', flag: '🚩',
};

export const EmojiShortcodes = Extension.create({
  name: 'emojiShortcodes',
  addInputRules() {
    return [
      new InputRule({
        find: /:([a-z0-9_+-]{1,20}):$/,
        handler: ({ state, range, match }) => {
          const emoji = EMOJI_CODES[match[1]];
          if (!emoji) return null;
          state.tr.insertText(emoji, range.from, range.to);
          return undefined;
        },
      }),
    ];
  },
});

// ---------- #hashtags ----------

const HASHTAG = /(^|[\s(])(#[\p{L}\p{N}_-]*\p{L}[\p{L}\p{N}_-]*)/gu;

function hashtagDecorations(doc) {
  const decos = [];
  doc.descendants((node, pos, parent) => {
    if (!node.isText || parent.type.name === 'codeBlock' || node.marks.some((m) => m.type.name === 'code' || m.type.name === 'link')) return;
    for (const m of node.text.matchAll(HASHTAG)) {
      const start = pos + m.index + m[1].length;
      decos.push(Decoration.inline(start, start + m[2].length, { class: 'note-hashtag' }));
    }
  });
  return DecorationSet.create(doc, decos);
}

// Lists the #hashtags used in a document, most used first.
export function collectHashtags(doc) {
  const counts = new Map();
  doc.descendants((node) => {
    if (!node.isText) return;
    for (const m of node.text.matchAll(HASHTAG)) counts.set(m[2].toLowerCase(), (counts.get(m[2].toLowerCase()) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

export const Hashtags = Extension.create({
  name: 'hashtags',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('hashtags'),
        state: {
          init: (_, { doc }) => hashtagDecorations(doc),
          apply: (tr, old) => (tr.docChanged ? hashtagDecorations(tr.doc) : old),
        },
        props: { decorations(state) { return this.getState(state); } },
      }),
    ];
  },
});

// ---------- current block (for focus mode) ----------

// Marks the top-level block holding the cursor, so focus mode can dim the rest.
export const CurrentBlock = Extension.create({
  name: 'currentBlock',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('currentBlock'),
        props: {
          decorations(state) {
            const b = currentBlock(state);
            if (!b?.node) return null;
            return DecorationSet.create(state.doc, [Decoration.node(b.pos, b.pos + b.node.nodeSize, { class: 'is-current-block' })]);
          },
        },
      }),
    ];
  },
});

// ---------- tables ----------

// Sorts the rows of the table under the cursor by the cursor's column,
// keeping a header row on top.
export function sortTableByColumn(editor, dir = 1) {
  const { state } = editor;
  const { $from } = state.selection;
  let tableDepth = -1;
  let cellDepth = -1;
  for (let d = $from.depth; d > 0; d -= 1) {
    const name = $from.node(d).type.name;
    if (cellDepth < 0 && (name === 'tableCell' || name === 'tableHeader')) cellDepth = d;
    if (name === 'table') {
      tableDepth = d;
      break;
    }
  }
  if (tableDepth < 0 || cellDepth < 0) return false;
  const table = $from.node(tableDepth);
  const col = $from.index(cellDepth - 1);
  const rows = [];
  table.forEach((row) => rows.push(row));
  const isHeader = (row) => row.childCount > 0 && [...Array(row.childCount).keys()].every((i) => row.child(i).type.name === 'tableHeader');
  const head = rows.length && isHeader(rows[0]) ? [rows[0]] : [];
  const body = rows.slice(head.length);
  const cellText = (row) => (col < row.childCount ? row.child(col).textContent.trim() : '');
  body.sort((a, b) => dir * collator.compare(cellText(a), cellText(b)));
  const start = $from.before(tableDepth);
  const tr = state.tr.replaceWith(start + 1, start + table.nodeSize - 1, Fragment.from([...head, ...body]));
  editor.view.dispatch(tr);
  return true;
}

// Turns selected lines of comma / tab / | separated text into a table.
export function textToTable(editor) {
  const { state } = editor;
  const { from, to, empty, $from, $to } = state.selection;
  if (empty) return false;
  const text = state.doc.textBetween(from, to, '\n');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes('|') ? '|' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const split = (line) => {
    if (sep !== ',') return line.replace(/^\||\|$/g, '').split(sep).map((c) => c.trim());
    const cells = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (c === '"' && line[i + 1] === '"' && quoted) { cur += '"'; i += 1; }
      else if (c === '"') quoted = !quoted;
      else if (c === ',' && !quoted) { cells.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    cells.push(cur.trim());
    return cells;
  };
  const rows = lines.filter((l) => !/^\|?[\s:|-]+\|?$/.test(l)).map(split);
  const width = Math.max(...rows.map((r) => r.length));
  const cell = (type, value) => ({ type, content: [{ type: 'paragraph', content: value ? [{ type: 'text', text: value }] : [] }] });
  const table = {
    type: 'table',
    content: rows.map((r, i) => ({ type: 'tableRow', content: Array.from({ length: width }, (_, c) => cell(i === 0 ? 'tableHeader' : 'tableCell', r[c] || '')) })),
  };
  const start = $from.depth ? $from.before(1) : from;
  const end = $to.depth ? $to.after(1) : to;
  return editor.chain().focus().insertContentAt({ from: start, to: end }, [table, { type: 'paragraph' }]).run();
}

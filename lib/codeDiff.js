// Code comparison for the code saver: a line diff (Myers), character-level
// differences inside changed lines, side-by-side row alignment, and a quick
// "does this look broken?" check that works for any language.

// ---------- Myers diff over two arrays ----------

// → [{ op: 'equal' | 'del' | 'add', a?: index in A, b?: index in B }]
export function diffSequences(A, B, eq = (x, y) => x === y) {
  const n = A.length;
  const m = B.length;
  // Trim the common head and tail first: typical edits are small.
  let start = 0;
  while (start < n && start < m && eq(A[start], B[start])) start += 1;
  let endA = n;
  let endB = m;
  while (endA > start && endB > start && eq(A[endA - 1], B[endB - 1])) {
    endA -= 1;
    endB -= 1;
  }
  const a = A.slice(start, endA);
  const b = B.slice(start, endB);
  const N = a.length;
  const M = b.length;
  const max = N + M;
  const v = new Int32Array(2 * max + 2);
  const trace = [];
  let found = N === 0 && M === 0;
  for (let d = 0; d <= max && !found; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[max + k - 1] < v[max + k + 1]) ? v[max + k + 1] : v[max + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && eq(a[x], b[y])) {
        x += 1;
        y += 1;
      }
      v[max + k] = x;
      if (x >= N && y >= M) {
        found = true;
        break;
      }
    }
  }
  // Walk the trace back to recover the edit script.
  const middle = [];
  let x = N;
  let y = M;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d -= 1) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[max + k - 1] < vd[max + k + 1]) ? k + 1 : k - 1;
    const prevX = vd[max + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      middle.push({ op: 'equal', a: start + x, b: start + y });
    }
    if (d > 0) {
      if (x === prevX) middle.push({ op: 'add', b: start + prevY });
      else middle.push({ op: 'del', a: start + prevX });
    }
    x = prevX;
    y = prevY;
  }
  middle.reverse();
  const out = [];
  for (let i = 0; i < start; i += 1) out.push({ op: 'equal', a: i, b: i });
  out.push(...middle);
  for (let i = 0; i < n - endA; i += 1) out.push({ op: 'equal', a: endA + i, b: endB + i });
  return out;
}

// ---------- character / word level inside one changed line ----------

const TOKEN_RE = /\s+|[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g;

// → { left: [{ text, changed }], right: [...] }, merged into runs.
export function diffInline(a, b) {
  const ta = a.match(TOKEN_RE) || [];
  const tb = b.match(TOKEN_RE) || [];
  if (ta.length * tb.length > 250_000) {
    return { left: [{ text: a, changed: true }], right: [{ text: b, changed: true }] };
  }
  const ops = diffSequences(ta, tb);
  const left = [];
  const right = [];
  const push = (list, text, changed) => {
    const last = list[list.length - 1];
    if (last && last.changed === changed) last.text += text;
    else list.push({ text, changed });
  };
  for (const o of ops) {
    if (o.op === 'equal') {
      push(left, ta[o.a], false);
      push(right, tb[o.b], false);
    } else if (o.op === 'del') push(left, ta[o.a], true);
    else push(right, tb[o.b], true);
  }
  return { left, right };
}

// How alike two lines are (0…1), to decide whether a removed + added pair is
// "the same line, edited" or two unrelated lines.
function similarity(a, b) {
  const x = a.trim();
  const y = b.trim();
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  const { left } = diffInline(x, y);
  const same = left.filter((s) => !s.changed).reduce((n, s) => n + s.text.length, 0);
  return (2 * same) / (x.length + y.length);
}

// ---------- side-by-side rows ----------

export function normalizeLine(line, { ignoreWhitespace, ignoreCase }) {
  let s = line;
  if (ignoreWhitespace) s = s.replace(/\s+/g, ' ').trim();
  if (ignoreCase) s = s.toLowerCase();
  return s;
}

// → { rows, hunks, stats }
// rows: { kind: 'equal'|'mod'|'del'|'add', leftNo, rightNo, left, right, leftSegs, rightSegs, hunk }
// hunks: [{ start, end }] row index ranges of consecutive changes
export function compareText(leftText, rightText, opts = {}) {
  const L = String(leftText ?? '').replace(/\r\n?/g, '\n').split('\n');
  const R = String(rightText ?? '').replace(/\r\n?/g, '\n').split('\n');
  const nl = L.map((l) => normalizeLine(l, opts));
  const nr = R.map((l) => normalizeLine(l, opts));
  const ops = diffSequences(nl, nr);

  const rows = [];
  let dels = [];
  let adds = [];
  const flush = () => {
    // Pair removed and added lines that look like edits of each other.
    let i = 0;
    let j = 0;
    while (i < dels.length || j < adds.length) {
      const d = dels[i];
      const a = adds[j];
      if (d != null && a != null && similarity(L[d], R[a]) >= 0.35) {
        const segs = diffInline(L[d], R[a]);
        rows.push({ kind: 'mod', leftNo: d + 1, rightNo: a + 1, left: L[d], right: R[a], leftSegs: segs.left, rightSegs: segs.right });
        i += 1;
        j += 1;
      } else if (d != null && (a == null || dels.length - i >= adds.length - j)) {
        rows.push({ kind: 'del', leftNo: d + 1, rightNo: null, left: L[d], right: null });
        i += 1;
      } else {
        rows.push({ kind: 'add', leftNo: null, rightNo: a + 1, left: null, right: R[a] });
        j += 1;
      }
    }
    dels = [];
    adds = [];
  };
  for (const o of ops) {
    if (o.op === 'equal') {
      flush();
      // Equal after normalising (e.g. whitespace ignored) but not identical.
      rows.push({ kind: 'equal', leftNo: o.a + 1, rightNo: o.b + 1, left: L[o.a], right: R[o.b] });
    } else if (o.op === 'del') dels.push(o.a);
    else adds.push(o.b);
  }
  flush();

  const hunks = [];
  rows.forEach((r, i) => {
    if (r.kind === 'equal') return;
    const last = hunks[hunks.length - 1];
    if (last && last.end === i - 1) last.end = i;
    else hunks.push({ start: i, end: i });
    r.hunk = hunks.length - 1;
  });
  const stats = {
    added: rows.filter((r) => r.kind === 'add').length,
    removed: rows.filter((r) => r.kind === 'del').length,
    modified: rows.filter((r) => r.kind === 'mod').length,
    unchanged: rows.filter((r) => r.kind === 'equal').length,
    identical: leftText === rightText,
  };
  return { rows, hunks, stats, leftLines: L, rightLines: R };
}

// Right-side text after replacing one hunk with the left side's lines —
// "take the old version of just this change".
export function revertHunk(result, hunkIndex) {
  const h = result.hunks[hunkIndex];
  if (!h) return result.rightLines.join('\n');
  const rows = result.rows.slice(h.start, h.end + 1);
  const rightNos = rows.map((r) => r.rightNo).filter(Boolean);
  const leftLines = rows.filter((r) => r.left != null).map((r) => r.left);
  let at;
  if (rightNos.length) at = rightNos[0] - 1;
  else {
    // Pure deletion: insert after the previous right-side line.
    const before = result.rows.slice(0, h.start).reverse().find((r) => r.rightNo);
    at = before ? before.rightNo : 0;
  }
  const next = result.rightLines.slice();
  next.splice(at, rightNos.length, ...leftLines);
  return next.join('\n');
}

// ---------- "anything not perfect?" checks ----------

const LINE_COMMENT = {
  python: ['#'], ruby: ['#'], shell: ['#'], yaml: ['#'], sql: ['--'], php: ['//', '#'],
  css: [], html: [], json: [], markdown: [], text: [],
};
const BLOCK_COMMENT = { html: ['<!--', '-->'], markdown: null, text: null, python: null, ruby: null, shell: null, yaml: null, json: null };
const BRACKET_LANGS_OFF = new Set(['text', 'markdown', 'yaml']);
const PAIRS = { ')': '(', ']': '[', '}': '{' };

// → [{ line, severity: 'error'|'warning'|'info', message }], sorted by line.
export function checkCode(text, language = 'text') {
  const src = String(text ?? '');
  const lines = src.split('\n');
  const problems = [];
  const add = (line, severity, message) => problems.push({ line, severity, message });

  // Merge-conflict leftovers, in any language.
  lines.forEach((l, i) => {
    if (/^(<{7}|={7}|>{7})( |$)/.test(l)) add(i + 1, 'error', 'Unresolved merge-conflict marker');
  });

  // Brackets and strings, skipping comments and string contents.
  if (!BRACKET_LANGS_OFF.has(language)) {
    const lineComments = LINE_COMMENT[language] ?? ['//'];
    const block = BLOCK_COMMENT[language] === undefined ? ['/*', '*/'] : BLOCK_COMMENT[language];
    const stack = [];
    let quote = null; // current string delimiter
    let quoteLine = 0;
    let triple = false;
    let inBlock = false;
    let line = 1;
    for (let i = 0; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === '\n') {
        if (quote && quote !== '`' && !triple) {
          // A normal string can't run past the end of its line (unless escaped).
          if (src[i - 1] !== '\\') {
            add(quoteLine, 'error', `String opened with ${quote} is never closed`);
            quote = null;
          }
        }
        line += 1;
        continue;
      }
      if (inBlock) {
        if (src.startsWith(block[1], i)) {
          inBlock = false;
          i += block[1].length - 1;
        }
        continue;
      }
      if (quote) {
        if (ch === '\\') i += 1;
        else if (triple ? src.startsWith(quote.repeat(3), i) : ch === quote) {
          if (triple) i += 2;
          quote = null;
          triple = false;
        }
        continue;
      }
      if (block && src.startsWith(block[0], i)) {
        inBlock = true;
        i += block[0].length - 1;
        continue;
      }
      if (lineComments.some((c) => src.startsWith(c, i) && (c !== '#' || language !== 'css'))) {
        const nl = src.indexOf('\n', i);
        i = (nl === -1 ? src.length : nl) - 1;
        continue;
      }
      if (ch === '"' || ch === "'" || (ch === '`' && !['python', 'sql', 'css', 'html'].includes(language))) {
        // An apostrophe inside a word ("don't") in HTML text isn't a string.
        if (ch === "'" && language === 'html' && /\w/.test(src[i - 1] || '')) continue;
        quote = ch;
        quoteLine = line;
        triple = language === 'python' && src.startsWith(ch.repeat(3), i);
        if (triple) i += 2;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') stack.push({ ch, line });
      else if (PAIRS[ch]) {
        const top = stack[stack.length - 1];
        const match = stack.map((o) => o.ch).lastIndexOf(PAIRS[ch]);
        if (!top) add(line, 'error', `Unexpected “${ch}” — nothing to close`);
        else if (top.ch === PAIRS[ch]) stack.pop();
        else if (match !== -1) {
          // "[1, 2;  }" — the "[" is the one left open, not the "}" that's wrong.
          while (stack.length - 1 > match) {
            const open = stack.pop();
            add(open.line, 'error', `“${open.ch}” opened here is never closed (hit “${ch}” on line ${line})`);
          }
          stack.pop();
        } else add(line, 'error', `“${ch}” doesn’t match the open “${top.ch}” from line ${top.line}`);
      }
    }
    if (quote) add(quoteLine, 'error', `String opened with ${triple ? quote.repeat(3) : quote} is never closed`);
    if (inBlock) add(line, 'error', 'Comment is never closed');
    for (const open of stack) add(open.line, 'error', `“${open.ch}” is never closed`);
  }

  // Real parsers where the browser has one.
  if (language === 'json' && src.trim()) {
    try {
      JSON.parse(src);
    } catch (err) {
      const pos = Number((err.message.match(/position (\d+)/) || [])[1]);
      const lineNo = (err.message.match(/line (\d+)/) || [])[1];
      const at = lineNo ? Number(lineNo) : Number.isFinite(pos) ? src.slice(0, pos).split('\n').length : 1;
      if (!problems.some((p) => p.severity === 'error')) add(at, 'error', `Invalid JSON: ${err.message.replace(/^JSON\.parse: |^Unexpected/, (m) => (m.startsWith('Unexpected') ? 'Unexpected' : ''))}`);
    }
  }
  if (language === 'javascript' && src.trim() && !/^\s*(import|export)\s/m.test(src) && !/<[A-Za-z][^>]*>/.test(src)) {
    try {
      // Parses only — never runs. Skipped for modules and JSX, which Function can't parse.
      // eslint-disable-next-line no-new-func
      new Function(src);
    } catch (err) {
      if (err instanceof SyntaxError && !problems.some((p) => p.severity === 'error')) {
        add(1, 'error', `JavaScript syntax error: ${err.message}`);
      }
    }
  }

  // Style / consistency.
  let spaces = 0;
  let tabs = 0;
  lines.forEach((l, i) => {
    const indent = l.match(/^[ \t]*/)[0];
    if (indent.includes(' ') && indent.includes('\t')) add(i + 1, 'warning', 'Tabs and spaces mixed in the indentation');
    else if (indent.startsWith('\t')) tabs += 1;
    else if (indent.startsWith(' ')) spaces += 1;
    if (/\S[ \t]+$/.test(l)) add(i + 1, 'info', 'Trailing whitespace');
    if (l.length > 200) add(i + 1, 'info', `Very long line (${l.length} characters)`);
    if (language === 'yaml' && /^\t/.test(l)) add(i + 1, 'error', 'YAML doesn’t allow tabs for indentation');
    if (/\b(TODO|FIXME|XXX)\b/.test(l)) add(i + 1, 'info', `${l.match(/\b(TODO|FIXME|XXX)\b/)[1]} left in the code`);
  });
  if (tabs && spaces && (language === 'python' || language === 'yaml')) {
    add(1, 'warning', `File indents with both tabs (${tabs} lines) and spaces (${spaces} lines)`);
  }

  const order = { error: 0, warning: 1, info: 2 };
  return problems.sort((a, b) => a.line - b.line || order[a.severity] - order[b.severity]);
}

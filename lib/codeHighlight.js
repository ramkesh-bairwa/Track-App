// A small, dependency-free syntax highlighter for the code saver. It only
// colors comments, strings, numbers and keywords — enough to make saved code
// easy to read. Output is escaped HTML with exactly the same characters as
// the input, so it can sit under a transparent <textarea> and line up.

const KEYWORDS = {
  javascript: 'await async break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield',
  python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield print',
  php: 'abstract and array as break case catch class clone const continue declare default do echo else elseif empty endforeach endif extends false final finally fn for foreach function global if implements include instanceof interface isset list namespace new null or private protected public require require_once return static switch this throw trait true try use var while',
  java: 'abstract boolean break byte case catch char class const continue default do double else enum extends false final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws true try void volatile while var',
  c: 'auto bool break case char class const continue default delete do double else enum extern false float for goto if include define inline int long namespace new nullptr private protected public return short signed sizeof static struct switch template this true typedef union unsigned using virtual void volatile while',
  csharp: 'abstract as async await base bool break case catch class const continue decimal default do double else enum false finally float for foreach if in int interface internal is long namespace new null object override private protected public readonly return static string struct switch this throw true try using var virtual void while',
  go: 'break case chan const continue default defer else fallthrough false for func go goto if import interface map nil package range return select struct switch true type var',
  rust: 'as async await break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  ruby: 'begin break case class def do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield',
  kotlin: 'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias val var when while',
  swift: 'as break case catch class continue default defer do else enum extension false for func guard if import in init let nil protocol return self struct switch throw throws true try var where while',
  dart: 'abstract as async await break case catch class const continue default do else enum extends false final finally for if import in is new null return static super switch this throw true try var void while',
  sql: 'add all alter and as asc between by case create database default delete desc distinct drop else end exists foreign from group having in index inner insert into is join key left like limit not null on or order outer primary references right select set table then union unique update values view when where',
  shell: 'if then else elif fi for while do done case esac in function return export local echo exit source alias unset readonly',
  yaml: 'true false null yes no on off',
  json: 'true false null',
  css: '',
  html: '',
  markdown: '',
  text: '',
};
KEYWORDS.typescript = `${KEYWORDS.javascript} interface type enum implements private public protected readonly declare namespace abstract as any boolean number string unknown never`;

const COMMENTS = {
  python: ['#'],
  ruby: ['#'],
  shell: ['#'],
  yaml: ['#'],
  sql: ['--', '/*'],
  html: ['<!--'],
  css: ['/*'],
  php: ['//', '#', '/*'],
  json: [],
  markdown: [],
  text: [],
};

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const cache = new Map();

function tokenizer(lang) {
  if (cache.has(lang)) return cache.get(lang);
  const comments = COMMENTS[lang] || ['//', '/*'];
  const parts = [];
  if (comments.includes('/*')) parts.push('\\/\\*[\\s\\S]*?(?:\\*\\/|$)');
  if (comments.includes('<!--')) parts.push('<!--[\\s\\S]*?(?:-->|$)');
  if (comments.includes('//')) parts.push('\\/\\/[^\\n]*');
  if (comments.includes('#')) parts.push('#[^\\n]*');
  if (comments.includes('--')) parts.push('--[^\\n]*');
  const commentSrc = parts.length ? `(${parts.join('|')})` : '(\\b\\B)';
  const stringSrc = lang === 'python'
    ? `("""[\\s\\S]*?(?:"""|$)|'''[\\s\\S]*?(?:'''|$)|"(?:\\\\.|[^"\\\\\\n])*"?|'(?:\\\\.|[^'\\\\\\n])*'?)`
    : "(`(?:\\\\.|[^`\\\\])*`?|\"(?:\\\\.|[^\"\\\\\\n])*\"?|'(?:\\\\.|[^'\\\\\\n])*'?)";
  const re = new RegExp(`${commentSrc}|${stringSrc}|(\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b|\\b0x[\\da-f]+\\b)|([A-Za-z_$][\\w$]*)`, 'gi');
  const kw = new Set((KEYWORDS[lang] ?? KEYWORDS.javascript).split(' ').filter(Boolean));
  const caseInsensitive = lang === 'sql';
  const t = { re, kw, caseInsensitive };
  cache.set(lang, t);
  return t;
}

export function highlightCode(code, lang = 'text') {
  if (lang === 'text' || lang === 'markdown' || !code) return esc(code || '');
  if (code.length > 400_000) return esc(code); // keep huge files responsive
  const { re, kw, caseInsensitive } = tokenizer(lang);
  re.lastIndex = 0;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(code))) {
    if (m[0] === '') {
      re.lastIndex += 1;
      continue;
    }
    out += esc(code.slice(last, m.index));
    const [tok, comment, str, num, word] = m;
    if (comment) out += `<span class="tk-c">${esc(tok)}</span>`;
    else if (str) out += `<span class="tk-s">${esc(tok)}</span>`;
    else if (num) out += `<span class="tk-n">${esc(tok)}</span>`;
    else if (word && kw.has(caseInsensitive ? word.toLowerCase() : word)) out += `<span class="tk-k">${esc(tok)}</span>`;
    else out += esc(tok);
    last = m.index + tok.length;
  }
  return out + esc(code.slice(last));
}

// Splits highlightCode() output into one HTML string per source line. Spans
// never nest, so a span crossing a newline (a multi-line comment or string)
// is just closed at the line end and reopened on the next line.
export function splitHighlightedLines(html) {
  const lines = [];
  let line = '';
  let open = null; // class of the span currently open, if any
  const re = /<span class="([^"]+)">|<\/span>|\n|[^<\n]+|</g;
  let m;
  while ((m = re.exec(html))) {
    const tok = m[0];
    if (tok === '\n') {
      if (open) line += '</span>';
      lines.push(line);
      line = open ? `<span class="${open}">` : '';
    } else if (m[1]) {
      open = m[1];
      line += tok;
    } else if (tok === '</span>') {
      open = null;
      line += tok;
    } else {
      line += tok;
    }
  }
  lines.push(line);
  return lines;
}

// Makes tabs and trailing spaces visible (display only — same width, so the
// overlay still lines up with the textarea).
export function markWhitespace(lineHtml) {
  return lineHtml
    .replace(/\t/g, '<span class="ws-tab">\t</span>')
    .replace(/( +)((?:<\/span>)?)$/, (_, spaces, close) => `<span class="ws-trail">${spaces}</span>${close}`);
}

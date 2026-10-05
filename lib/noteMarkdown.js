// Converters between the editor's JSON and Markdown / plain text, used for
// "copy as", export and importing .md files. Deliberately small: they cover
// what the editor can produce, not the whole CommonMark spec.

function inlineMd(nodes = []) {
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n';
      if (n.type !== 'text') return inlineMd(n.content);
      // Markers go around the words only: "**bold **" isn't valid Markdown.
      const [, lead, core, trail] = (n.text || '').match(/^(\s*)([\s\S]*?)(\s*)$/);
      if (!core) return n.text || '';
      let t = core;
      const marks = (n.marks || []).map((m) => m.type);
      if (marks.includes('code')) return `${lead}\`${t}\`${trail}`;
      if (marks.includes('bold')) t = `**${t}**`;
      if (marks.includes('italic')) t = `*${t}*`;
      if (marks.includes('strike')) t = `~~${t}~~`;
      const link = (n.marks || []).find((m) => m.type === 'link');
      if (link) t = `[${t}](${link.attrs?.href || ''})`;
      return lead + t + trail;
    })
    .join('');
}

function blockMd(node, depth = 0) {
  const pad = '  '.repeat(depth);
  switch (node.type) {
    case 'paragraph':
      return inlineMd(node.content);
    case 'heading':
      return `${'#'.repeat(node.attrs?.level || 1)} ${inlineMd(node.content)}`;
    case 'blockquote':
      return (node.content || []).map((c) => blockMd(c)).join('\n\n').split('\n').map((l) => `> ${l}`).join('\n');
    case 'callout': {
      const body = (node.content || []).map((c) => blockMd(c)).join('\n\n');
      return `> **${(node.attrs?.kind || 'note').toUpperCase()}:** ${body}`.split('\n').join('\n> ');
    }
    case 'codeBlock':
      return `\`\`\`${node.attrs?.language || ''}\n${(node.content || []).map((t) => t.text || '').join('')}\n\`\`\``;
    case 'horizontalRule':
      return '---';
    case 'pageBreak':
      return '\n---\n';
    case 'tableOfContents':
      return '[TOC]';
    case 'image':
      return `![${node.attrs?.alt || ''}](${String(node.attrs?.src || '').startsWith('data:') ? 'embedded-image' : node.attrs?.src || ''})`;
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      let n = node.attrs?.start || 1;
      return (node.content || [])
        .map((item) => {
          const marker =
            node.type === 'orderedList' ? `${n++}.` : node.type === 'taskList' ? `- [${item.attrs?.checked ? 'x' : ' '}]` : '-';
          const [first, ...rest] = item.content || [];
          const lines = [`${pad}${marker} ${first ? blockMd(first, depth + 1) : ''}`];
          for (const child of rest) lines.push(blockMd(child, depth + 1));
          return lines.join('\n');
        })
        .join('\n');
    }
    case 'table': {
      const rows = (node.content || []).map((row) =>
        (row.content || []).map((cell) => (cell.content || []).map((c) => blockMd(c)).join(' ').replace(/\|/g, '\\|').replace(/\n/g, ' '))
      );
      if (!rows.length) return '';
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
      return [line(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
    }
    default:
      return (node.content || []).map((c) => blockMd(c, depth)).join('\n\n');
  }
}

export function jsonToMarkdown(json) {
  return (json?.content || []).map((n) => blockMd(n)).join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function jsonToText(json) {
  const out = [];
  const walk = (node) => {
    if (node.type === 'text') out.push(node.text || '');
    else if (node.type === 'hardBreak') out.push('\n');
    else {
      (node.content || []).forEach(walk);
      if (node.type !== 'doc' && !['text', 'listItem', 'taskItem', 'tableRow'].includes(node.type) && node.isBlock !== false) out.push('\n');
    }
  };
  walk(json || { content: [] });
  return out.join('').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------- Markdown → HTML (for importing .md files) ----------

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inlineHtml(s) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>');
}

export function markdownToHtml(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const code = [];
      for (i += 1; i < lines.length && !/^```/.test(lines[i]); i += 1) code.push(lines[i]);
      i += 1;
      html.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    let m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      html.push(`<h${m[1].length}>${inlineHtml(m[2])}</h${m[1].length}>`);
      i += 1;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      html.push('<hr>');
      i += 1;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-+/.test(lines[i + 1] || '')) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => inlineHtml(c.trim().replace(/\\\|/g, '|')));
      const head = cells(line);
      const body = [];
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i += 1) body.push(cells(lines[i]));
      html.push(`<table><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i += 1) quote.push(lines[i].replace(/^>\s?/, ''));
      html.push(`<blockquote>${markdownToHtml(quote.join('\n'))}</blockquote>`);
      continue;
    }
    m = line.match(/^\s*([-*+]|\d+[.)])\s+/);
    if (m) {
      const ordered = /\d/.test(m[1]);
      const task = /^\s*[-*+]\s+\[[ xX]\]\s/.test(line);
      const items = [];
      for (; i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]); i += 1) {
        const text = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        const t = text.match(/^\[([ xX])\]\s+(.*)$/);
        items.push(
          task && t
            ? `<li data-type="taskItem" data-checked="${t[1] !== ' '}"><p>${inlineHtml(t[2])}</p></li>`
            : `<li><p>${inlineHtml(text)}</p></li>`
        );
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}${task ? ' data-type="taskList"' : ''}>${items.join('')}</${tag}>`);
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const para = [];
    for (; i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+[.)])\s)/.test(lines[i]); i += 1) para.push(lines[i]);
    html.push(`<p>${para.map(inlineHtml).join('<br>')}</p>`);
  }
  return html.join('');
}

export function textToHtml(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

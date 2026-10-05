'use client';

// All exports run entirely in the browser against the editor's current
// content — no server round-trip, so a save isn't required before exporting.

function sanitizeFilename(name) {
  return (name || 'note').replace(/[/\\?%*:|"<>]/g, '-').slice(0, 80) || 'note';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------- Image export ----------------
export async function exportNoteAsImage(domNode, title) {
  const { toPng } = await import('html-to-image');
  const dataUrl = await toPng(domNode, { backgroundColor: '#ffffff', pixelRatio: 2 });
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  downloadBlob(blob, `${sanitizeFilename(title)}.png`);
}

// ---------------- PDF export (via the browser's own print-to-PDF) ----------------
export function printNoteAsPdf() {
  window.print();
}

// ---------------- Word export ----------------
function textNodeMarks(marks = []) {
  const props = {};
  for (const m of marks) {
    if (m.type === 'bold') props.bold = true;
    if (m.type === 'italic') props.italics = true;
    if (m.type === 'underline') props.underline = {};
    if (m.type === 'strike') props.strike = true;
    if (m.type === 'subscript') props.subScript = true;
    if (m.type === 'superscript') props.superScript = true;
    if (m.type === 'code') props.font = 'Courier New';
    if (m.type === 'highlight') {
      const c = String(m.attrs?.color || '').replace('#', '');
      if (/^[0-9a-f]{6}$/i.test(c)) props.shading = { type: 'clear', fill: c, color: 'auto' };
      else props.highlight = 'yellow';
    }
    if (m.type === 'link') props.style = 'Hyperlink';
    if (m.type === 'textStyle') {
      if (m.attrs?.color) props.color = String(m.attrs.color).replace('#', '');
      if (m.attrs?.fontFamily) props.font = String(m.attrs.fontFamily).split(',')[0].replace(/["']/g, '').trim();
      if (m.attrs?.fontSize) {
        const px = parseFloat(m.attrs.fontSize);
        if (!Number.isNaN(px)) props.size = Math.round(px * 1.5); // px -> half-points (roughly px*0.75*2)
      }
    }
  }
  return props;
}

function inlineRuns(TextRun, content = []) {
  const runs = [];
  for (const node of content) {
    if (node.type === 'text') runs.push(new TextRun({ text: node.text || '', ...textNodeMarks(node.marks) }));
    else if (node.type === 'hardBreak') runs.push(new TextRun({ text: '', break: 1 }));
    else if (node.content) runs.push(...inlineRuns(TextRun, node.content));
  }
  return runs;
}

async function imageParagraph(docx, node) {
  const src = node.attrs?.src;
  if (!src || !src.startsWith('data:image')) return null;
  try {
    const base64 = src.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    // Keep the picture's own proportions, scaled to its width in the note
    // (a % of a ~600px page, or 360px when it has no size set).
    const dims = await new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 360, h: 240 });
      img.src = src;
    });
    const pct = parseFloat(node.attrs?.width);
    const width = Math.min(600, String(node.attrs?.width || '').endsWith('%') ? (600 * pct) / 100 : pct || Math.min(dims.w, 360));
    const height = Math.round((width * dims.h) / (dims.w || 1));
    const align = { center: 'CENTER', right: 'RIGHT' }[node.attrs?.align];
    const type = (src.match(/^data:image\/(png|jpe?g|gif|bmp)/) || [])[1]?.replace('jpeg', 'jpg') || 'png';
    return new docx.Paragraph({
      alignment: align ? docx.AlignmentType[align] : undefined,
      children: [new docx.ImageRun({ type, data: bytes, transformation: { width: Math.round(width), height } })],
    });
  } catch {
    return null;
  }
}

const ALIGN_MAP_KEY = { left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'JUSTIFIED' };

async function blockToElements(docx, node, listCounters = {}) {
  const { Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType } = docx;
  const align = node.attrs?.textAlign ? AlignmentType[ALIGN_MAP_KEY[node.attrs.textAlign]] : undefined;
  // Paragraph layout from the editor: indent (2em ≈ 480 twips per step),
  // line height and space before/after (px → twips at 15 per px).
  const a = node.attrs || {};
  const layout = {
    alignment: align,
    indent: a.indent ? { left: a.indent * 480 } : undefined,
    spacing: {
      line: a.lineHeight ? Math.round(parseFloat(a.lineHeight) * 240) : undefined,
      before: a.spaceBefore ? Math.round(parseFloat(a.spaceBefore) * 15) : undefined,
      after: a.spaceAfter ? Math.round(parseFloat(a.spaceAfter) * 15) : undefined,
    },
    bidirectional: a.dir === 'rtl' || undefined,
  };

  switch (node.type) {
    case 'paragraph':
      return [new Paragraph({ children: node.content ? inlineRuns(TextRun, node.content) : [], ...layout })];

    case 'heading': {
      const map = {
        1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4, 5: HeadingLevel.HEADING_5, 6: HeadingLevel.HEADING_6,
      };
      return [new Paragraph({
        heading: map[node.attrs?.level] || HeadingLevel.HEADING_1,
        children: node.content ? inlineRuns(TextRun, node.content) : [],
        ...layout,
      })];
    }

    case 'pageBreak':
      return [new Paragraph({ children: [new docx.PageBreak()] })];

    case 'tableOfContents':
      return [new docx.TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-6' })];

    case 'callout': {
      const fills = { info: 'DBEAFE', tip: 'FEF9C3', success: 'DCFCE7', warning: 'FFEDD5', danger: 'FEE2E2', note: 'F1F5F9' };
      const inner = [];
      for (const child of node.content || []) inner.push(...(await blockToElements(docx, child, listCounters)));
      return [new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [new TableRow({ children: [new TableCell({
          children: inner.length ? inner : [new Paragraph('')],
          shading: { type: 'clear', color: 'auto', fill: fills[node.attrs?.kind] || fills.note },
          margins: { top: 120, bottom: 120, left: 160, right: 160 },
        })] })],
      }), new Paragraph('')];
    }

    case 'blockquote': {
      const els = [];
      for (const child of node.content || []) {
        if (child.type === 'paragraph') {
          els.push(new Paragraph({
            children: inlineRuns(TextRun, child.content).length
              ? inlineRuns(TextRun, child.content)
              : [new TextRun({ text: '' })],
            indent: { left: 720 },
          }));
        } else {
          els.push(...(await blockToElements(docx, child, listCounters)));
        }
      }
      return els;
    }

    case 'codeBlock':
      return [new Paragraph({
        children: [new TextRun({ text: (node.content || []).map((t) => t.text || '').join(''), font: 'Courier New' })],
      })];

    case 'horizontalRule':
      return [new Paragraph({ text: '────────────────────' })];

    case 'bulletList': {
      const els = [];
      for (const item of node.content || []) {
        const itemChildren = item.content || [];
        if (itemChildren[0]?.type === 'paragraph') {
          els.push(new Paragraph({ children: inlineRuns(TextRun, itemChildren[0].content), bullet: { level: 0 } }));
        } else if (itemChildren[0]) {
          els.push(...(await blockToElements(docx, itemChildren[0], listCounters)));
        }
        for (const child of itemChildren.slice(1)) els.push(...(await blockToElements(docx, child, listCounters)));
      }
      return els;
    }

    case 'orderedList': {
      const els = [];
      let n = node.attrs?.start || 1;
      const roman = (num, upper) => {
        const table = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
        let out = '';
        for (const [v, sym] of table) while (num >= v) { out += sym; num -= v; }
        return upper ? out.toUpperCase() : out;
      };
      const label = (num) => {
        const t = node.attrs?.type;
        if (t === 'a' || t === 'A') {
          let str = '';
          for (let x = num; x > 0; x = Math.floor((x - 1) / 26)) str = String.fromCharCode(97 + ((x - 1) % 26)) + str;
          return t === 'A' ? str.toUpperCase() : str;
        }
        if (t === 'i' || t === 'I') return roman(num, t === 'I');
        return String(num);
      };
      for (const item of node.content || []) {
        const itemChildren = item.content || [];
        if (itemChildren[0]?.type === 'paragraph') {
          els.push(new Paragraph({ children: [new TextRun({ text: `${label(n)}. ` }), ...inlineRuns(TextRun, itemChildren[0].content)] }));
          n += 1;
        } else if (itemChildren[0]) {
          els.push(...(await blockToElements(docx, itemChildren[0], listCounters)));
        }
        for (const child of itemChildren.slice(1)) els.push(...(await blockToElements(docx, child, listCounters)));
      }
      return els;
    }

    case 'taskList': {
      const els = [];
      for (const item of node.content || []) {
        const mark = item.attrs?.checked ? '☑ ' : '☐ ';
        const itemChildren = item.content || [];
        if (itemChildren[0]?.type === 'paragraph') {
          els.push(new Paragraph({ children: [new TextRun({ text: mark }), ...inlineRuns(TextRun, itemChildren[0].content)] }));
        } else if (itemChildren[0]) {
          els.push(...(await blockToElements(docx, itemChildren[0], listCounters)));
        }
        for (const child of itemChildren.slice(1)) els.push(...(await blockToElements(docx, child, listCounters)));
      }
      return els;
    }

    case 'table': {
      const rows = [];
      for (const row of node.content || []) {
        const cells = [];
        for (const cell of row.content || []) {
          const cellEls = [];
          for (const child of cell.content || []) cellEls.push(...(await blockToElements(docx, child, listCounters)));
          const fill = String(cell.attrs?.backgroundColor || '').replace('#', '');
          cells.push(new TableCell({
            children: cellEls.length ? cellEls : [new Paragraph('')],
            width: { size: 2000, type: WidthType.DXA },
            columnSpan: cell.attrs?.colspan > 1 ? cell.attrs.colspan : undefined,
            rowSpan: cell.attrs?.rowspan > 1 ? cell.attrs.rowspan : undefined,
            shading: /^[0-9a-f]{6}$/i.test(fill) ? { type: 'clear', color: 'auto', fill } : cell.type === 'tableHeader' ? { type: 'clear', color: 'auto', fill: 'F1F5F9' } : undefined,
          }));
        }
        rows.push(new TableRow({ children: cells }));
      }
      return [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })];
    }

    case 'image': {
      const p = await imageParagraph(docx, node);
      return p ? [p] : [];
    }

    default:
      if (node.content) {
        const els = [];
        for (const child of node.content) els.push(...(await blockToElements(docx, child, listCounters)));
        return els;
      }
      return [];
  }
}

export async function exportNoteAsWord(json, title) {
  const docx = await import('docx');
  const { Document, Packer, Paragraph, HeadingLevel } = docx;

  const children = [];
  for (const node of json?.content || []) {
    children.push(...(await blockToElements(docx, node)));
  }

  const doc = new Document({
    features: { updateFields: true }, // fills in the table of contents on open
    sections: [
      {
        children: [
          new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
          ...children,
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${sanitizeFilename(title)}.docx`);
}

// ---------------- Excel export (any tables found anywhere in the note) ----------------
function cellText(cell) {
  const parts = [];
  function walk(node) {
    if (node.type === 'text') parts.push(node.text || '');
    else if (node.type === 'hardBreak') parts.push('\n');
    else if (node.content) node.content.forEach(walk);
  }
  (cell.content || []).forEach(walk);
  return parts.join('');
}

function findTables(node, out = []) {
  if (node.type === 'table') out.push(node);
  (node.content || []).forEach((child) => findTables(child, out));
  return out;
}

export async function exportNoteAsExcel(json, title) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const tables = findTables(json || { content: [] });

  if (tables.length === 0) {
    const sheet = workbook.addWorksheet('Note');
    sheet.addRow(['This note has no tables to export.']);
  } else {
    tables.forEach((table, i) => {
      const sheet = workbook.addWorksheet(`Table ${i + 1}`);
      for (const row of table.content || []) {
        const values = (row.content || []).map(cellText);
        sheet.addRow(values);
      }
      sheet.columns.forEach((col) => {
        col.width = 22;
      });
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${sanitizeFilename(title)}.xlsx`);
}

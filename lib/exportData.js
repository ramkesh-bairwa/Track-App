'use client';

// Shared downloads for anything shaped like a table — track entries, task
// boards, activity logs. Everything is built in the browser from data the
// page already has, so exports never need a server round-trip.
//
//   exportTable({ title, columns: ['Name', ...], rows: [['Ann', ...], ...] }, 'docx' | 'txt' | 'csv' | 'xlsx')

export const EXPORT_FORMATS = [
  { key: 'docx', label: 'Word document', ext: '.docx', icon: 'fa-solid fa-file-word' },
  { key: 'xlsx', label: 'Excel spreadsheet', ext: '.xlsx', icon: 'fa-solid fa-file-excel' },
  { key: 'csv', label: 'CSV', ext: '.csv', icon: 'fa-solid fa-file-csv' },
  { key: 'txt', label: 'Plain text', ext: '.txt', icon: 'fa-solid fa-file-lines' },
];

export function safeFilename(name, fallback = 'export') {
  return (name || fallback).replace(/[/\\?%*:|"<>]/g, '-').trim().slice(0, 80) || fallback;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  logDownload(filename);
}

// Every export in the app (photos, PDFs, tables, notes) goes through
// downloadBlob, so this is where browser-only work reaches the activity log.
function logDownload(filename) {
  try {
    const path = window.location.pathname;
    const kind = path.startsWith('/dashboard/photo-editor') ? (/\.pdf$/i.test(filename) ? 'pdf' : 'photo') : 'export';
    fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, summary: `Downloaded ${filename}`, url: path }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

function cell(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function csvEscape(v) {
  const s = cell(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tableToCsv({ columns, rows }) {
  return [columns, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

// One "Field: value" block per row — readable anywhere, easy to paste.
export function tableToText({ title, subtitle, columns, rows }) {
  const width = Math.min(24, Math.max(...columns.map((c) => c.length)));
  const blocks = rows.map((r, i) => {
    const lines = columns.map((c, j) => {
      const value = cell(r[j]).replace(/\r?\n/g, `\n${' '.repeat(width + 2)}`);
      return `${c.padEnd(width)}: ${value}`;
    });
    return `#${i + 1}\n${lines.join('\n')}`;
  });
  const head = [title, subtitle, `${rows.length} record${rows.length === 1 ? '' : 's'} · exported ${new Date().toLocaleString()}`]
    .filter(Boolean)
    .join('\n');
  return `${head}\n${'='.repeat(Math.min(60, head.split('\n')[0].length || 10))}\n\n${blocks.join('\n\n')}\n`;
}

async function toWord({ title, subtitle, columns, rows }) {
  const docx = await import('docx');
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType, PageOrientation, ShadingType } = docx;
  const wide = columns.length > 5;
  const para = (text, opts = {}) =>
    new Paragraph({
      children: cell(text)
        .split(/\r?\n/)
        .flatMap((line, i) => (i === 0 ? [new TextRun({ text: line, ...opts })] : [new TextRun({ text: line, break: 1, ...opts })])),
    });
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: columns.map(
          (c) =>
            new TableCell({
              children: [para(c, { bold: true, size: 18 })],
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'E9EDF2' },
            })
        ),
      }),
      ...rows.map((r) => new TableRow({ children: columns.map((_, j) => new TableCell({ children: [para(r[j], { size: 18 })] })) })),
    ],
  });
  const doc = new Document({
    sections: [
      {
        properties: wide ? { page: { size: { orientation: PageOrientation.LANDSCAPE } } } : {},
        children: [
          new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
          ...(subtitle ? [new Paragraph({ text: subtitle })] : []),
          new Paragraph({
            children: [new TextRun({ text: `${rows.length} record${rows.length === 1 ? '' : 's'} · exported ${new Date().toLocaleString()}`, italics: true, size: 18, color: '666666' })],
          }),
          new Paragraph({ text: '' }),
          rows.length ? table : new Paragraph({ text: 'Nothing to export.' }),
        ],
      },
    ],
  });
  return Packer.toBlob(doc);
}

async function toExcel({ title, columns, rows, sheets }) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const all = [{ name: title, columns, rows }, ...(sheets || [])];
  const used = new Set();
  for (const s of all) {
    let name = safeFilename(s.name, 'Sheet').replace(/[[\]*?:/\\]/g, '').slice(0, 31) || 'Sheet';
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${used.size + 1}`;
    used.add(name.toLowerCase());
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.addRow(s.columns);
    s.rows.forEach((r) => sheet.addRow(r.map((v) => (v === null || v === undefined ? '' : v))));
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EDF2' } };
    s.columns.forEach((c, j) => {
      const longest = Math.max(c.length, ...s.rows.slice(0, 200).map((r) => Math.min(60, cell(r[j]).split('\n')[0].length)));
      sheet.getColumn(j + 1).width = Math.max(10, Math.min(60, longest + 2));
      sheet.getColumn(j + 1).alignment = { vertical: 'top', wrapText: true };
    });
    if (s.columns.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// `table.sheets` (optional, Excel only): extra [{ name, columns, rows }] tabs.
export async function exportTable(table, format) {
  const base = safeFilename(table.filename || table.title);
  if (format === 'csv') {
    // BOM so Excel opens UTF-8 (₹, accents, emoji) correctly.
    downloadBlob(new Blob(['﻿', tableToCsv(table)], { type: 'text/csv;charset=utf-8' }), `${base}.csv`);
  } else if (format === 'txt') {
    downloadBlob(new Blob([tableToText(table)], { type: 'text/plain;charset=utf-8' }), `${base}.txt`);
  } else if (format === 'docx') {
    downloadBlob(await toWord(table), `${base}.docx`);
  } else if (format === 'xlsx') {
    downloadBlob(await toExcel(table), `${base}.xlsx`);
  } else {
    throw new Error(`Unknown export format: ${format}`);
  }
}

'use client';

import { jsonToText } from '@/lib/noteMarkdown';
import { downloadBlob, safeFilename, tableToCsv } from '@/lib/exportData';

// Plain-text and CSV downloads for a note (Word / Excel / image / PDF live in
// lib/noteExport.js).

export function exportNoteAsText(json, title) {
  const body = `${title}\n${'='.repeat(Math.min(60, title.length || 4))}\n\n${jsonToText(json)}`;
  downloadBlob(new Blob([body], { type: 'text/plain;charset=utf-8' }), `${safeFilename(title, 'note')}.txt`);
}

function cellText(node) {
  const parts = [];
  const walk = (n) => {
    if (n.type === 'text') parts.push(n.text || '');
    else if (n.type === 'hardBreak') parts.push('\n');
    else (n.content || []).forEach(walk);
  };
  walk(node);
  return parts.join('');
}

function findTables(node, out = []) {
  if (node.type === 'table') out.push(node);
  (node.content || []).forEach((c) => findTables(c, out));
  return out;
}

// Every table in the note, one after another (blank line between). A note
// without tables exports one line of text per row instead.
export function exportNoteAsCsv(json, title) {
  const tables = findTables(json || { content: [] });
  let csv;
  if (tables.length === 0) {
    const lines = jsonToText(json).split('\n').filter((l) => l.trim());
    csv = tableToCsv({ columns: ['Line', 'Text'], rows: lines.map((l, i) => [i + 1, l]) });
  } else {
    csv = tables
      .map((t) => {
        const rows = (t.content || []).map((row) => (row.content || []).map(cellText));
        const [head = [], ...rest] = rows;
        return tableToCsv({ columns: head, rows: rest });
      })
      .join('\r\n\r\n');
  }
  downloadBlob(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }), `${safeFilename(title, 'note')}.csv`);
}

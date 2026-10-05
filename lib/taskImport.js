// Client-side helpers for importing tasks from an Excel (.xlsx) or CSV file:
// read the sheet, guess which spreadsheet column feeds which task field, and
// turn each row into task values. The server re-validates everything.
import { PRIORITIES, MAX_IMPORT_ROWS, matchPersonName } from './taskConfig';

export { MAX_IMPORT_ROWS };
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

// ---------- reading the file ----------

function detectDelimiter(text) {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'));
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length]);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

// RFC 4180-ish: quoted fields, doubled quotes, newlines inside quotes.
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const delim = detectDelimiter(src);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Excel stores dates as UTC midnight — read them back in UTC so a date
// doesn't shift by a day in timezones behind UTC.
function isoDay(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return isoDay(value);
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result); // formula
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text).join('');
    if ('text' in value) return cellText(value.text); // hyperlink
    if ('error' in value) return '';
    return '';
  }
  return String(value);
}

async function readXlsx(file) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const sheet = wb.worksheets.find((ws) => ws.actualRowCount > 0);
  if (!sheet) return [];
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (r) => {
    const cells = [];
    for (let c = 1; c <= r.cellCount; c += 1) cells.push(cellText(r.getCell(c).value));
    rows.push(cells);
  });
  return rows;
}

// → { headers: string[], rows: string[][] } — first non-empty row is the header.
export async function readSpreadsheet(file) {
  const name = file.name.toLowerCase();
  if (file.size > MAX_IMPORT_BYTES) throw new Error('That file is too large. Please use one under 5MB.');
  let raw;
  if (name.endsWith('.csv') || name.endsWith('.tsv') || file.type === 'text/csv') {
    raw = parseCsv(await file.text());
  } else if (name.endsWith('.xlsx')) {
    raw = await readXlsx(file);
  } else if (name.endsWith('.xls')) {
    throw new Error('Old .xls files aren’t supported — open it in Excel and “Save As” .xlsx or .csv.');
  } else {
    throw new Error('Choose an Excel (.xlsx) or CSV file.');
  }
  const nonEmpty = raw
    .map((r) => r.map((c) => String(c ?? '').trim()))
    .filter((r) => r.some((c) => c !== ''));
  if (nonEmpty.length < 2) throw new Error('The file needs a header row and at least one task row.');
  // Reports often start with a title line ("Task report – Sept") above the
  // real headers: the header is the first row that's nearly as full as the
  // fullest of the first few rows.
  const filled = (r) => r.filter((c) => c !== '').length;
  const top = nonEmpty.slice(0, Math.min(10, nonEmpty.length - 1));
  const widest = Math.max(...top.map(filled));
  const headerIndex = Math.max(0, top.findIndex((r) => filled(r) >= widest * 0.6));
  const headerRow = nonEmpty[headerIndex];
  const rows = nonEmpty.slice(headerIndex + 1);
  const width = Math.max(headerRow.length, ...rows.map((r) => r.length));
  // Blank or repeated header cells still get a usable, distinct name.
  const seenHeaders = new Map();
  const headers = Array.from({ length: width }, (_, i) => {
    const base = headerRow[i] || `Column ${i + 1}`;
    const n = (seenHeaders.get(base.toLowerCase()) || 0) + 1;
    seenHeaders.set(base.toLowerCase(), n);
    return n > 1 ? `${base} ${n}` : base;
  });
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`The file has ${rows.length} rows — import at most ${MAX_IMPORT_ROWS} at a time.`);
  }
  // A heading line above the headers ("Weekly Task Report") is the sheet's
  // own title; otherwise fall back to the file name.
  const heading = nonEmpty.slice(0, headerIndex).map((r) => r.find((c) => c !== '')).find(Boolean);
  return { headers, rows: rows.map((r) => headers.map((_, i) => r[i] ?? '')), title: fileTitle(heading, file.name) };
}

// "Sprint_plan-v2 (1).csv" → "Sprint plan v2"
export function fileTitle(heading, fileName) {
  const clean = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 255);
  if (heading && clean(heading)) return clean(heading);
  return clean(
    String(fileName || '')
      .replace(/\.[^.]+$/, '')
      .replace(/\s*\(\d+\)$/, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s-\s|-/g, ' ')
  );
}

// ---------- mapping spreadsheet columns to task fields ----------

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const SYNONYMS = {
  title: ['title', 'task', 'tasks', 'taskname', 'tasktitle', 'name', 'subject', 'summary', 'item', 'activity', 'workitem', 'todo', 'issue', 'ticket', 'work'],
  description: ['description', 'details', 'detail', 'desc', 'notes', 'note', 'comments', 'comment', 'remarks', 'remark'],
  status: ['status', 'state', 'stage', 'progress', 'taskstatus', 'currentstatus'],
  priority: ['priority', 'severity', 'importance', 'taskpriority'],
  assignee_id: ['assignee', 'assignedto', 'assignto', 'assigned', 'owner', 'user', 'username', 'responsible', 'person', 'member', 'employee', 'resource', 'assigneename', 'assignedby', 'taskowner', 'handledby', 'doneby'],
  due_date: ['due', 'duedate', 'deadline', 'enddate', 'targetdate', 'target', 'dueon', 'dueby', 'completiondate', 'eta'],
};

// Looser second pass for headers like "Task Details" or "Assigned User":
// the header contains one of these words.
const CONTAINS = {
  title: ['title', 'task', 'subject', 'activity'],
  status: ['status'],
  priority: ['priority'],
  assignee_id: ['assign', 'owner', 'responsible'],
  due_date: ['due', 'deadline'],
};

// Every task field a spreadsheet column can feed. File columns can't come
// from a spreadsheet cell, so they're left out.
export function importTargets(columns) {
  return [
    { key: 'title', label: 'Title' },
    { key: 'description', label: 'Description' },
    { key: 'status', label: 'Status' },
    { key: 'priority', label: 'Priority' },
    { key: 'assignee_id', label: 'Assignee' },
    { key: 'due_date', label: 'Due date' },
    ...columns.filter((c) => c.field_type !== 'file').map((c) => ({ key: `data.${c.field_key}`, label: c.label, column: c })),
  ];
}

// Mapping key for "create a new board column from spreadsheet column i".
export const newColumnKey = (i) => `data.new:${i}`;
export const isNewColumnKey = (key) => key.startsWith('data.new:');

// → array (one per spreadsheet column) of target keys, '' = ignore. With
// `createNew`, headers that match nothing become new columns instead.
// Always tries to end up with a Title column, since every task needs one.
export function autoMap(headers, columns, { createNew = false, rows = [] } = {}) {
  const targets = importTargets(columns);
  const mapping = headers.map(() => '');
  const used = new Set();
  const claim = (i, key) => {
    mapping[i] = key;
    used.add(key);
  };
  const norms = headers.map(norm);
  // 1. exact label of one of the board's own columns
  norms.forEach((n, i) => {
    const t = targets.find((x) => x.column && !used.has(x.key) && (norm(x.column.label) === n || norm(x.column.field_key) === n));
    if (t) claim(i, t.key);
  });
  // 2. exact synonym of a built-in field
  norms.forEach((n, i) => {
    if (mapping[i]) return;
    const t = targets.find((x) => !x.column && !used.has(x.key) && SYNONYMS[x.key].includes(n));
    if (t) claim(i, t.key);
  });
  // 3. header contains a telling word
  norms.forEach((n, i) => {
    if (mapping[i]) return;
    const key = Object.keys(CONTAINS).find((k) => !used.has(k) && CONTAINS[k].some((w) => n.includes(w)));
    if (key) claim(i, key);
  });
  // 4. still no title: the first free column holding mostly words (not
  // numbers or dates) — e.g. a sheet whose first column is "Sr. No".
  if (!used.has('title')) {
    const texty = (i) => {
      const vals = rows.map((r) => String(r[i] ?? '').trim()).filter(Boolean);
      return vals.length > 0 && vals.filter((v) => /[a-z]/i.test(v) && !parseDate(v)).length >= vals.length / 2;
    };
    let i = mapping.findIndex((k, j) => !k && texty(j));
    if (i === -1) i = mapping.findIndex((k) => k === 'description');
    if (i === -1) i = mapping.findIndex((k) => !k);
    if (i !== -1) claim(i, 'title');
  }
  return mapping.map((key, i) => key || (createNew ? newColumnKey(i) : ''));
}

const BOOL_RE = /^(y|n|yes|no|true|false|0|1|x|✓|✔|checked|unchecked)$/i;

// Guesses a column type from the values under a spreadsheet header.
// → { field_type, options }
export function inferColumnType(values) {
  const vals = values.map((v) => String(v ?? '').trim()).filter(Boolean);
  if (vals.length === 0) return { field_type: 'text', options: '' };
  const all = (fn) => vals.every(fn);
  if (all((v) => BOOL_RE.test(v)) && !all((v) => /^[01]$/.test(v))) return { field_type: 'checkbox', options: '' };
  if (all((v) => /^-?[\d,]*\.?\d+$/.test(v))) return { field_type: 'number', options: '' };
  if (all((v) => /[-/\s]/.test(v) && parseDate(v))) return { field_type: 'date', options: '' };
  if (all((v) => /^\S+@\S+\.\S+$/.test(v))) return { field_type: 'email', options: '' };
  if (all((v) => /^(https?:\/\/|www\.)\S+$/i.test(v))) return { field_type: 'link', options: '' };
  if (vals.some((v) => v.length > 120 || v.includes('\n'))) return { field_type: 'textarea', options: '' };
  // A handful of values repeated across rows reads as a dropdown.
  const distinct = [...new Set(vals.map((v) => v.toLowerCase()))];
  if (vals.length >= 4 && distinct.length <= 10 && distinct.length * 2 <= vals.length && vals.every((v) => v.length <= 40)) {
    const options = [];
    const seen = new Set();
    for (const v of vals) {
      if (seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      options.push(v.replace(/,/g, ' '));
    }
    return { field_type: 'select', options: options.join(', ') };
  }
  return { field_type: 'text', options: '' };
}

// ---------- converting cell values ----------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function validDay(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

// Accepts 2026-09-29, 2026/9/29, 29/09/2026, 29-09-2026, 29 Sep 2026,
// Sep 29 2026 and Excel serial numbers. Slash dates read day-first unless
// that's impossible (09/29/2026 → 29 Sep).
export function parseDate(text) {
  const s = String(text ?? '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return validDay(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let [a, b, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += 2000;
    return a > 12 || b <= 12 ? validDay(y, b, a) : validDay(y, a, b);
  }
  m = s.match(/^(\d{1,2})[\s-]+([a-z]{3,})[a-z]*[\s,-]+(\d{4})$/i);
  if (m && MONTHS.includes(m[2].slice(0, 3).toLowerCase())) return validDay(+m[3], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]);
  m = s.match(/^([a-z]{3,})[a-z]*[\s-]+(\d{1,2})(?:st|nd|rd|th)?[\s,-]+(\d{4})$/i);
  if (m && MONTHS.includes(m[1].slice(0, 3).toLowerCase())) return validDay(+m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]);
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    // Excel serial day (days since 1899-12-30)
    return isoDay(new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000));
  }
  return null;
}

// Assignee lookup for the preview: board members first, then `extra` —
// accounts elsewhere in MyTrack the server matched by name (they'll be added
// to the board on import).
export function peopleMatcher(people, extra = {}) {
  return (text) => {
    const onBoard = matchPersonName(text, people);
    if (onBoard.person || (onBoard.problem && !onBoard.problem.startsWith('nobody'))) return onBoard;
    const hit = extra[String(text ?? '').trim().toLowerCase()];
    if (hit?.person) return { person: hit.person, joining: true };
    return hit?.problem ? { person: null, problem: hit.problem } : onBoard;
  };
}

function customValue(column, text) {
  const s = text.trim();
  if (!s) return { value: '' };
  switch (column.field_type) {
    case 'checkbox':
      return { value: /^(y|yes|true|1|x|✓|✔|done|checked)$/i.test(s) };
    case 'number': {
      // 1,500 → 1500 (thousands separators); 1,5 → 1.5 (decimal comma)
      const n = Number(/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.'));
      return Number.isFinite(n) ? { value: n } : { value: '', problem: `"${s}" isn't a number` };
    }
    case 'date': {
      const d = parseDate(s);
      return d ? { value: d } : { value: '', problem: `"${s}" isn't a date` };
    }
    case 'select': {
      const options = (column.options || '').split(',').map((o) => o.trim()).filter(Boolean);
      const hit = options.find((o) => o.toLowerCase() === s.toLowerCase());
      return hit ? { value: hit } : { value: '', problem: `"${s}" isn't one of the ${column.label} options` };
    }
    default:
      return { value: s };
  }
}

// One spreadsheet row → { task, warnings, error }. `task` is ready to POST.
export function rowToTask(row, mapping, { board, columns, matchPerson, line }) {
  const task = { title: '', description: '', status: board.statuses[0]?.name, priority: 'Medium', assignee_id: null, due_date: null, data: {} };
  const warnings = [];
  const byKey = new Map(columns.map((c) => [`data.${c.field_key}`, c]));
  mapping.forEach((key, i) => {
    if (!key) return;
    const text = String(row[i] ?? '').trim();
    switch (key) {
      case 'title':
        task.title = text.slice(0, 255);
        break;
      case 'description':
        task.description = text;
        break;
      case 'status': {
        if (!text) break;
        const hit = board.statuses.find((s) => s.name.toLowerCase() === text.toLowerCase());
        if (hit) task.status = hit.name;
        else warnings.push(`status "${text}" isn't on this board — using "${task.status}"`);
        break;
      }
      case 'priority': {
        if (!text) break;
        const hit = PRIORITIES.find((p) => p.name.toLowerCase() === text.toLowerCase());
        if (hit) task.priority = hit.name;
        else warnings.push(`priority "${text}" unknown — using Medium`);
        break;
      }
      case 'assignee_id': {
        const { person, problem } = matchPerson(text);
        task.assignee_id = person?.id ?? null;
        if (problem) warnings.push(`${problem} — left unassigned`);
        break;
      }
      case 'due_date': {
        if (!text) break;
        const d = parseDate(text);
        if (d) task.due_date = d;
        else warnings.push(`due date "${text}" not understood — left empty`);
        break;
      }
      default: {
        const column = byKey.get(key);
        if (!column) break;
        const { value, problem } = customValue(column, text);
        task.data[column.field_key] = value;
        if (problem) warnings.push(`${problem} — left empty`);
      }
    }
  });
  // A row with no title still becomes a task: use the start of its
  // description, or number it.
  if (!task.title) {
    const desc = task.description.split('\n')[0].trim();
    task.title = (desc ? (desc.length > 80 ? `${desc.slice(0, 80)}…` : desc) : `Untitled task${line ? ` (row ${line})` : ''}`).slice(0, 255);
    warnings.push(desc ? 'no title — used the description' : 'no title — named it by row number');
  }
  return { task, warnings, error: null };
}

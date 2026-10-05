import { isInertMime } from './safeUrl';
// Field types available in the column / form builder.
// `id` is stored in track_columns.field_type and must stay stable —
// existing tracks already have these values saved in their database.
//
// Each type carries MySQL-flavored metadata (sqlType, length, whether it
// can auto-increment) purely for description/labelling — actual values are
// still stored inside track_entries.data as JSON, not as real table
// columns — plus an `input` kind that EntryForm/EntryCell use to decide
// how to render and edit it.

export const FIELD_TYPE_GROUPS = [
  {
    label: 'Common',
    types: [
      { id: 'text', label: 'Text', sqlType: 'VARCHAR', hint: 'A single line of text', icon: 'Aa', input: 'text', supportsLength: true, defaultLength: '255' },
      { id: 'textarea', label: 'Notes', sqlType: 'TEXT', hint: 'Multi-line text', icon: '¶', input: 'textarea' },
      { id: 'link', label: 'Link', sqlType: 'VARCHAR', hint: 'A URL, opens in a new tab', icon: '⛓', input: 'link', supportsLength: true, defaultLength: '2048' },
      { id: 'password', label: 'Credential', sqlType: 'VARCHAR', hint: 'Masked, click to reveal', icon: '••', input: 'password', supportsLength: true, defaultLength: '255' },
      { id: 'email', label: 'Email', sqlType: 'VARCHAR', hint: 'An email address', icon: '@', input: 'email', supportsLength: true, defaultLength: '255' },
      { id: 'number', label: 'Number', sqlType: 'INT', hint: 'Whole number', icon: '#', input: 'number', supportsLength: true, defaultLength: '11', supportsAutoIncrement: true },
      { id: 'date', label: 'Date', sqlType: 'DATE', hint: 'A calendar date', icon: '31', input: 'date' },
      { id: 'checkbox', label: 'Checkbox', sqlType: 'BOOLEAN', hint: 'True / false toggle', icon: '✓', input: 'checkbox' },
      { id: 'select', label: 'Dropdown', sqlType: 'ENUM', hint: 'Pick one of several options', icon: '▾', input: 'select', supportsOptions: true },
    ],
  },
  {
    label: 'More numeric types',
    types: [
      { id: 'tinyint', label: 'TINYINT', sqlType: 'TINYINT', hint: 'Whole number, -128 to 127', icon: '#', input: 'number', supportsLength: true, defaultLength: '4', supportsAutoIncrement: true },
      { id: 'smallint', label: 'SMALLINT', sqlType: 'SMALLINT', hint: 'Whole number, up to ~32K', icon: '#', input: 'number', supportsLength: true, defaultLength: '6', supportsAutoIncrement: true },
      { id: 'mediumint', label: 'MEDIUMINT', sqlType: 'MEDIUMINT', hint: 'Whole number, up to ~8M', icon: '#', input: 'number', supportsLength: true, defaultLength: '9', supportsAutoIncrement: true },
      { id: 'bigint', label: 'BIGINT', sqlType: 'BIGINT', hint: 'Very large whole number', icon: '#', input: 'number', supportsLength: true, defaultLength: '20', supportsAutoIncrement: true },
      { id: 'decimal', label: 'DECIMAL', sqlType: 'DECIMAL', hint: 'Exact decimal, e.g. currency', icon: '#.#', input: 'decimal', supportsLength: true, defaultLength: '10,2', lengthPlaceholder: 'precision,scale — e.g. 10,2' },
      { id: 'float', label: 'FLOAT', sqlType: 'FLOAT', hint: 'Approximate decimal number', icon: '#.#', input: 'decimal', supportsLength: true, lengthPlaceholder: 'precision,scale (optional)' },
      { id: 'double', label: 'DOUBLE', sqlType: 'DOUBLE', hint: 'Approximate decimal number (larger)', icon: '#.#', input: 'decimal', supportsLength: true, lengthPlaceholder: 'precision,scale (optional)' },
    ],
  },
  {
    label: 'More date & time types',
    types: [
      { id: 'datetime', label: 'DATETIME', sqlType: 'DATETIME', hint: 'Date and time', icon: '31', input: 'datetime' },
      { id: 'timestamp', label: 'TIMESTAMP', sqlType: 'TIMESTAMP', hint: 'Date and time (auto timezone)', icon: '31', input: 'datetime' },
      { id: 'time', label: 'TIME', sqlType: 'TIME', hint: 'A time of day', icon: '⏱', input: 'time' },
      { id: 'year', label: 'YEAR', sqlType: 'YEAR', hint: 'A four digit year', icon: '31', input: 'year' },
    ],
  },
  {
    label: 'More text types',
    types: [
      { id: 'char', label: 'CHAR', sqlType: 'CHAR', hint: 'Fixed-length text', icon: 'Aa', input: 'text', supportsLength: true, defaultLength: '10' },
      { id: 'tinytext', label: 'TINYTEXT', sqlType: 'TINYTEXT', hint: 'Short text block', icon: '¶', input: 'textarea' },
      { id: 'mediumtext', label: 'MEDIUMTEXT', sqlType: 'MEDIUMTEXT', hint: 'Long text block', icon: '¶', input: 'textarea' },
      { id: 'longtext', label: 'LONGTEXT', sqlType: 'LONGTEXT', hint: 'Very long text block', icon: '¶', input: 'textarea' },
      { id: 'set', label: 'SET', sqlType: 'SET', hint: 'Pick any number of fixed values', icon: '▾▾', input: 'multiselect', supportsOptions: true },
    ],
  },
  {
    label: 'Other',
    types: [
      { id: 'json', label: 'JSON', sqlType: 'JSON', hint: 'Raw JSON value', icon: '{ }', input: 'textarea' },
    ],
  },
  {
    label: 'More input types',
    types: [
      { id: 'tel', label: 'Phone', sqlType: 'VARCHAR', hint: 'A telephone number', icon: '☎', input: 'tel', supportsLength: true, defaultLength: '20' },
      { id: 'url', label: 'URL', sqlType: 'VARCHAR', hint: 'A website address', icon: '⛓', input: 'url', supportsLength: true, defaultLength: '2048' },
      { id: 'search', label: 'Search', sqlType: 'VARCHAR', hint: 'A search-style text field', icon: '⌕', input: 'search', supportsLength: true, defaultLength: '255' },
      { id: 'month', label: 'Month', sqlType: 'VARCHAR', hint: 'A month and year, e.g. 2024-06', icon: '31', input: 'month', supportsLength: true, defaultLength: '7' },
      { id: 'week', label: 'Week', sqlType: 'VARCHAR', hint: 'A week and year, e.g. 2024-W23', icon: '31', input: 'week', supportsLength: true, defaultLength: '8' },
      { id: 'color', label: 'Color', sqlType: 'VARCHAR', hint: 'A color picker', icon: '■', input: 'color', supportsLength: true, defaultLength: '7' },
      { id: 'range', label: 'Slider', sqlType: 'INT', hint: 'A numeric slider', icon: '↔', input: 'range', supportsLength: true, defaultLength: '0,100,1', lengthPlaceholder: 'min,max,step — e.g. 0,100,1' },
      { id: 'radio', label: 'Single choice', sqlType: 'ENUM', hint: 'Pick one, shown as radio buttons', icon: '◉', input: 'radio', supportsOptions: true },
      { id: 'file', label: 'File', sqlType: 'MEDIUMTEXT', hint: 'Upload a file, stored inline', icon: '⇧', input: 'file' },
    ],
  },
];

export const FIELD_TYPES = FIELD_TYPE_GROUPS.flatMap((g) => g.types);

export function fieldTypeMeta(id) {
  return FIELD_TYPES.find((f) => f.id === id) || FIELD_TYPES[0];
}

// How a column's type + length reads as a MySQL column definition, e.g. "VARCHAR(255)".
export function formatSqlType(column) {
  const meta = fieldTypeMeta(column.field_type);
  if (!meta.supportsLength || !column.field_length) return meta.sqlType;
  return `${meta.sqlType}(${column.field_length})`;
}

export function slugifyKey(label, existingKeys = []) {
  let base = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'field';
  let key = base;
  let i = 2;
  while (existingKeys.includes(key)) {
    key = `${base}_${i}`;
    i += 1;
  }
  return key;
}

export function emptyValueFor(type) {
  if (fieldTypeMeta(type).input === 'checkbox') return false;
  return '';
}

export function optionList(options) {
  return (options || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

// Maps an `input` kind to the <input type="..."> that renders it.
export function htmlInputTypeFor(inputKind) {
  switch (inputKind) {
    case 'number':
    case 'decimal':
    case 'year':
      return 'number';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime-local';
    case 'time':
      return 'time';
    case 'email':
      return 'email';
    case 'tel':
      return 'tel';
    case 'url':
      return 'url';
    case 'search':
      return 'search';
    case 'month':
      return 'month';
    case 'week':
      return 'week';
    case 'color':
      return 'color';
    case 'range':
      return 'range';
    default:
      return 'text';
  }
}

// A file value is stored as a data: URL (see the file input in EntryForm/EntryCell).
// Sniffs its MIME type so the viewer can render an actual preview — an image,
// an embedded PDF, or decoded text — instead of just a bare download link.
// Server-side clean-up of one incoming entry value. A file field must be a
// real data: URL — anything else (e.g. "javascript:alert(1)") would become a
// clickable link in EntryForm, so it's dropped.
export function sanitizeEntryValue(fieldType, value) {
  if (fieldType === 'file') {
    return typeof value === 'string' && /^data:[\w.+-]+\/[\w.+-]+[^,]*,/i.test(value) ? value : '';
  }
  return value;
}

export function detectFileKind(dataUrl) {
  if (typeof dataUrl !== 'string') return 'other';
  const match = dataUrl.match(/^data:([^;,]+)[^,]*,/);
  if (!match) return 'other';
  const mime = match[1].toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/') || mime === 'application/json') return 'text';
  return 'other';
}

export function decodeBase64Text(dataUrl) {
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:[^,]*;base64,(.*)$/s);
  if (!match) return '';
  try {
    if (typeof atob === 'function') return decodeURIComponent(escape(atob(match[1])));
    return Buffer.from(match[1], 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

// Chrome (and most modern browsers) silently block `target="_blank"`
// navigation straight to a data: URL — a defense against data-URI phishing —
// so a plain <a href={dataUrl} target="_blank"> just does nothing. Converting
// to a same-origin blob: URL first is the standard workaround.
export function openDataUrlInNewTab(dataUrl) {
  try {
    const [header, payload] = dataUrl.split(',');
    const isBase64 = /;base64$/i.test(header.split(';')[1] ? header : header + ';');
    const mimeMatch = header.match(/^data:([^;]+)/);
    // HTML/SVG/scripts would run as a same-origin page from a blob: URL —
    // show those as plain text instead.
    const declared = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const mime = isInertMime(declared) ? declared : 'text/plain';
    const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const win = window.open(blobUrl, '_blank', 'noopener,noreferrer');
    if (!win) window.location.assign(blobUrl);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } catch {
    // Fall back to the direct data: URL — blocked for some kinds in some
    // browsers, but strictly better than doing nothing. Only for inert types.
    const m = typeof dataUrl === 'string' && dataUrl.match(/^data:([^;,]+)/);
    if (m && isInertMime(m[1])) window.open(dataUrl, '_blank', 'noopener,noreferrer');
  }
}

// A range column's field_length is "min,max,step" (all optional), e.g. "0,100,1".
export function parseRangeConfig(fieldLength) {
  const [min, max, step] = (fieldLength || '').split(',').map((n) => n.trim());
  return {
    min: min !== undefined && min !== '' ? min : '0',
    max: max !== undefined && max !== '' ? max : '100',
    step: step !== undefined && step !== '' ? step : '1',
  };
}

// Real MySQL storage ranges for the integer types — a column's `field_length`
// is display width only (cosmetic, per MySQL semantics), not a value bound.
const INTEGER_RANGES = {
  tinyint: { min: -128, max: 127 },
  smallint: { min: -32768, max: 32767 },
  mediumint: { min: -8388608, max: 8388607 },
  number: { min: -2147483648, max: 2147483647 }, // INT
  bigint: { min: -9223372036854775808, max: 9223372036854775807 },
};

const LENGTH_CONSTRAINED_TYPES = new Set(['text', 'char', 'link', 'password', 'email', 'tel', 'url', 'search']);

function decimalScale(fieldLength) {
  return Number((fieldLength || '').split(',')[1]) || 0;
}

// HTML input constraint props (min/max/step/maxLength) so a value entered
// for a column actually fits what its type claims to store.
export function inputConstraintsFor(column) {
  const meta = fieldTypeMeta(column.field_type);
  const props = {};

  const range = INTEGER_RANGES[column.field_type];
  if (range) {
    props.min = range.min;
    props.max = range.max;
    props.step = '1';
  } else if (column.field_type === 'decimal') {
    const scale = decimalScale(column.field_length);
    props.step = scale > 0 ? (1 / 10 ** scale).toFixed(scale) : '1';
  } else if (column.field_type === 'float' || column.field_type === 'double') {
    props.step = 'any';
  } else if (column.field_type === 'year') {
    props.min = 1901;
    props.max = 2155;
    props.step = '1';
  }

  if (meta.supportsLength && LENGTH_CONSTRAINED_TYPES.has(column.field_type) && column.field_length) {
    const len = parseInt(column.field_length, 10);
    if (!Number.isNaN(len)) props.maxLength = len;
  }

  return props;
}

// Coerces a raw entered value to fit its column's type. Used when saving an
// inline table-cell edit, which has no <form> to run HTML5 validation for it
// (the add-entry form gets that for free via the min/max/maxLength props above).
export function clampValueForColumn(column, rawValue) {
  if (rawValue === '' || rawValue === null || rawValue === undefined) return rawValue;

  const range = INTEGER_RANGES[column.field_type];
  if (range) {
    const n = Math.trunc(Number(rawValue));
    if (Number.isNaN(n)) return '';
    return String(Math.min(range.max, Math.max(range.min, n)));
  }
  if (column.field_type === 'decimal') {
    const n = Number(rawValue);
    return Number.isNaN(n) ? '' : n.toFixed(decimalScale(column.field_length));
  }
  if (column.field_type === 'float' || column.field_type === 'double') {
    const n = Number(rawValue);
    return Number.isNaN(n) ? '' : String(n);
  }
  if (column.field_type === 'year') {
    const n = Math.trunc(Number(rawValue));
    if (Number.isNaN(n)) return '';
    return String(Math.min(2155, Math.max(1901, n)));
  }
  const meta = fieldTypeMeta(column.field_type);
  if (
    meta.supportsLength &&
    LENGTH_CONSTRAINED_TYPES.has(column.field_type) &&
    column.field_length &&
    typeof rawValue === 'string'
  ) {
    const len = parseInt(column.field_length, 10);
    if (!Number.isNaN(len)) return rawValue.slice(0, len);
  }
  return rawValue;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatTimeOfDay(hours, minutes) {
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${period}`;
}

// Read-only display formatting for date/time-flavored values — e.g.
// "2026-09-18T17:02" becomes "18 September 2026, 5:02 PM". Values stay
// stored/edited in their native HTML input format; this only touches how
// they're shown in the table and the "View full entry" modal.
export function formatDisplayValue(column, value) {
  if (value === '' || value === null || value === undefined) return value;
  const meta = fieldTypeMeta(column.field_type);
  const str = String(value);

  if (meta.input === 'date') {
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return value;
    const [, y, mo, d] = m;
    return `${Number(d)} ${MONTH_NAMES[Number(mo) - 1]} ${y}`;
  }

  if (meta.input === 'datetime') {
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) return value;
    const [, y, mo, d, h, mi] = m;
    return `${Number(d)} ${MONTH_NAMES[Number(mo) - 1]} ${y}, ${formatTimeOfDay(Number(h), Number(mi))}`;
  }

  if (meta.input === 'time') {
    const m = str.match(/^(\d{2}):(\d{2})/);
    if (!m) return value;
    const [, h, mi] = m;
    return formatTimeOfDay(Number(h), Number(mi));
  }

  if (meta.input === 'month') {
    const m = str.match(/^(\d{4})-(\d{2})$/);
    if (!m) return value;
    const [, y, mo] = m;
    return `${MONTH_NAMES[Number(mo) - 1]} ${y}`;
  }

  return value;
}

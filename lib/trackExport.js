import { fieldTypeMeta, optionList, formatDisplayValue, detectFileKind } from '@/lib/fieldTypes';

// A track's entries as { title, columns, rows } for lib/exportData.js.
// Values are exported the way they read on screen (formatted dates, Yes/No,
// real credential values). Files export as a short label, not megabytes of
// base64; locked entries export as "Locked" because their data never reaches
// the browser until unlocked.
export function trackExportTable(track, columns, entries, serialById) {
  const header = ['#', ...columns.map((c) => c.label)];
  const rows = entries.map((entry) => {
    const serial = serialById?.get(entry.id) ?? '';
    if (entry.is_locked) return [serial, '🔒 Locked', ...columns.slice(1).map(() => '')];
    return [serial, ...columns.map((col) => exportCellValue(col, entry.data?.[col.field_key], serial))];
  });
  return { title: track.name, subtitle: track.description || '', columns: header, rows };
}

export function exportCellValue(column, value, serial) {
  if (column.is_auto_increment) return serial;
  const meta = fieldTypeMeta(column.field_type);
  if (value === '' || value === null || value === undefined) return meta.input === 'checkbox' ? 'No' : '';
  if (meta.input === 'checkbox') return value ? 'Yes' : 'No';
  if (meta.input === 'multiselect') return optionList(value).join(', ');
  if (meta.input === 'file') {
    const kind = detectFileKind(value);
    return kind === 'other' ? '[file attached]' : `[${kind} file attached]`;
  }
  return String(formatDisplayValue(column, value));
}

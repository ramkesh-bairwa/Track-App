'use client';

import { useMemo, useState } from 'react';
import { readSpreadsheet, autoMap, importTargets, peopleMatcher, rowToTask, inferColumnType, newColumnKey, isNewColumnKey } from '@/lib/taskImport';
import { MAX_IMPORT_ROWS, TASK_FIELD_TYPES, statusColor, priorityColor } from '@/lib/taskConfig';
import { Pill, formatDay, ColumnValue } from '@/components/tasks/taskUi';

const PREVIEW_ROWS = 50;

function csvEscape(v) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// A starter CSV with this board's fields as headers and one example row.
function downloadTemplate(board, columns, people) {
  const targets = importTargets(columns);
  const example = targets.map((t) => {
    switch (t.key) {
      case 'title': return 'Write the launch email';
      case 'description': return 'Draft, review and schedule';
      case 'status': return board.statuses[0]?.name || '';
      case 'priority': return 'High';
      case 'assignee_id': return people[0]?.name || '';
      case 'due_date': return new Date().toISOString().slice(0, 10);
      default: return '';
    }
  });
  const csv = [targets.map((t) => t.label), example].map((r) => r.map(csvEscape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${board.name.replace(/[^\w-]+/g, '_')}_tasks_template.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Import tasks from an Excel / CSV file: pick the file, check how its columns
// line up with task fields, review the rows, then create them in one go.
// `allowNewColumns` (admin) lets extra headers become new board columns;
// `createColumns` makes that the default for every unmatched header.
// `inline` renders as a page section instead of a modal.
export default function TaskImportModal({ board, columns, people, onClose, onImport, allowNewColumns, createColumns, inline }) {
  const [sheet, setSheet] = useState(null); // { fileName, headers, rows }
  const [mapping, setMapping] = useState([]);
  const [newCols, setNewCols] = useState({}); // spreadsheet column index → { label, field_type, options }
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const targets = useMemo(() => importTargets(columns), [columns]);
  const matchPerson = useMemo(() => peopleMatcher(people), [people]);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  // New columns the current mapping would create, shaped like board columns
  // (field_key "new:<i>") so rows convert exactly as they will once saved.
  const pendingColumns = useMemo(
    () =>
      mapping
        .map((key, i) => (isNewColumnKey(key) && newCols[i] ? { ...newCols[i], id: `new:${i}`, field_key: `new:${i}` } : null))
        .filter(Boolean),
    [mapping, newCols]
  );
  const allColumns = useMemo(() => [...columns, ...pendingColumns], [columns, pendingColumns]);

  const parsed = useMemo(() => {
    if (!sheet) return [];
    return sheet.rows.map((row, i) => ({ line: i + 1, ...rowToTask(row, mapping, { board, columns: allColumns, matchPerson, line: i + 1 }) }));
  }, [sheet, mapping, board, allColumns, matchPerson]);

  // Only columns the file actually fills are worth a preview column.
  const previewColumns = allColumns.filter((c) => mapping.includes(`data.${c.field_key}`));
  const ready = parsed;
  const withWarnings = ready.filter((r) => r.warnings.length > 0).length;

  // Every distinct name in the assignee column and who it resolved to.
  const assigneeSummary = useMemo(() => {
    const col = mapping.indexOf('assignee_id');
    if (!sheet || col === -1) return null;
    const seen = new Map();
    for (const row of sheet.rows) {
      const text = String(row[col] ?? '').trim();
      if (!text) continue;
      const key = text.toLowerCase();
      const entry = seen.get(key) || { text, count: 0, ...matchPerson(text) };
      entry.count += 1;
      seen.set(key, entry);
    }
    return [...seen.values()];
  }, [sheet, mapping, matchPerson]);

  async function handleFile(file) {
    if (!file) return;
    setReading(true);
    setError('');
    try {
      const { headers, rows, title } = await readSpreadsheet(file);
      setSheet({ fileName: file.name, headers, rows, title });
      setMapping(autoMap(headers, columns, { createNew: allowNewColumns && createColumns, rows }));
      setNewCols(Object.fromEntries(headers.map((h, i) => [i, { label: h, ...inferColumnType(rows.map((r) => r[i])) }])));
    } catch (err) {
      setError(err.message || 'Could not read that file.');
    } finally {
      setReading(false);
    }
  }

  function setTarget(i, key) {
    // One spreadsheet column per task field — taking a field frees it elsewhere.
    setMapping((m) => m.map((k, j) => (j === i ? key : k === key && key ? '' : k)));
  }

  function setNewColType(i, fieldType) {
    setNewCols((c) => {
      const col = { ...c[i], field_type: fieldType };
      // Switching to a dropdown: offer the values the file actually uses.
      if (fieldType === 'select' && !col.options) {
        col.options = [...new Set(sheet.rows.map((r) => String(r[i] ?? '').trim().replace(/,/g, ' ')).filter(Boolean))].slice(0, 50).join(', ');
      }
      return { ...c, [i]: col };
    });
  }

  async function handleImport() {
    setSaving(true);
    setError('');
    try {
      const newColumns = pendingColumns.map((c) => ({ ref: c.field_key, label: c.label, field_type: c.field_type, options: c.options }));
      await onImport(ready.map((r) => r.task), sheet.fileName, newColumns);
      onClose(ready.length, sheet.title);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const titleMapped = mapping.includes('title');

  return (
    <Shell inline={inline} onClose={saving ? undefined : () => onClose()}>
        <div className="new-track-head">
          <div>
            <h2>Import tasks</h2>
            <p className="new-track-steps">
              {sheet ? `${sheet.fileName} · ${sheet.rows.length} row${sheet.rows.length === 1 ? '' : 's'}` : 'From an Excel (.xlsx) or CSV file'}
            </p>
          </div>
          {!inline && (
            <button type="button" className="new-track-close" onClick={() => onClose()} disabled={saving} title="Close">×</button>
          )}
        </div>

        {!sheet ? (
          <>
            <label
              className={`dropzone task-import-drop${dragOver ? ' drag-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFile(e.dataTransfer.files?.[0]);
              }}
            >
              <input
                type="file"
                accept=".xlsx,.csv,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: 'none' }}
                onChange={(e) => {
                  handleFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <strong>{reading ? 'Reading…' : 'Drop a file here, or click to choose'}</strong>
              <small>The first row must be the column headers. Up to {MAX_IMPORT_ROWS} tasks per file.</small>
            </label>
            <div className="field-hint">
              <p style={{ margin: '0 0 6px' }}>
                Headers such as <em>Title / Task</em>, <em>Description</em>, <em>Status</em>, <em>Priority</em>,{' '}
                <em>Assignee / Assigned to</em> and <em>Due date</em> are matched automatically, as are this board&apos;s own column names.
              </p>
              <p style={{ margin: 0 }}>
                Assignees are matched to board members by exact name (case doesn&apos;t matter) or email.{' '}
                <button type="button" className="link-btn" onClick={() => downloadTemplate(board, columns, people)}>
                  Download a CSV template
                </button>
              </p>
            </div>
          </>
        ) : (
          <>
            <h3 className="task-import-heading">Columns</h3>
            <div className="task-import-mapping">
              {sheet.headers.map((h, i) => (
                <div key={i} className="task-import-map-row">
                  <span className="task-import-src" title={h}>{h}</span>
                  <span className="task-muted">→</span>
                  <select className="input input-sm" value={mapping[i]} onChange={(e) => setTarget(i, e.target.value)}>
                    <option value="">Don&apos;t import</option>
                    {allowNewColumns && <option value={newColumnKey(i)}>＋ New column “{h}”</option>}
                    {targets.map((t) => (
                      <option key={t.key} value={t.key}>{t.label}</option>
                    ))}
                  </select>
                  {isNewColumnKey(mapping[i]) && newCols[i] && (
                    <select
                      className="input input-sm task-import-type"
                      value={newCols[i].field_type}
                      onChange={(e) => setNewColType(i, e.target.value)}
                      title="Type of the new column"
                    >
                      {TASK_FIELD_TYPES.filter((t) => t.id !== 'file').map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
            {!titleMapped && (
              <p className="field-hint">No column is set as the task title, so each task will be named after the first text in its row.</p>
            )}
            {pendingColumns.length > 0 && (
              <p className="field-hint">
                Will add {pendingColumns.length} new column{pendingColumns.length === 1 ? '' : 's'} to the board:{' '}
                {pendingColumns.map((c) => `${c.label} (${TASK_FIELD_TYPES.find((t) => t.id === c.field_type)?.label})`).join(', ')}.
              </p>
            )}

            {assigneeSummary && assigneeSummary.length > 0 && (
              <>
                <h3 className="task-import-heading">Assignees</h3>
                <div className="task-import-people">
                  {assigneeSummary.map((a) => (
                    <span key={a.text} className={`task-import-person${a.person ? ' matched' : ' unmatched'}`} title={a.problem || a.person?.email}>
                      {a.person ? '✓' : '⚠'} {a.text}
                      {a.person && a.person.name !== a.text ? ` → ${a.person.name}` : ''}
                      <small> · {a.count}</small>
                    </span>
                  ))}
                </div>
                {assigneeSummary.some((a) => !a.person) && (
                  <p className="field-hint">
                    ⚠ names don&apos;t match any board member, so those tasks will be unassigned. To assign them, add the person to the
                    board (👤 Create user or Settings → Members) with exactly that name, then import again.
                  </p>
                )}
              </>
            )}

            <h3 className="task-import-heading">
              Preview
              <span className="task-muted">
                {' '}· {ready.length} ready{withWarnings ? ` · ${withWarnings} with notes` : ''}
              </span>
            </h3>
            <div className="task-table-wrap task-import-preview">
              <table className="data-table task-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Assignee</th>
                    <th>Due</th>
                    {previewColumns.map((c) => (
                      <th key={c.field_key}>{c.label}</th>
                    ))}
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.slice(0, PREVIEW_ROWS).map((r) => (
                    <tr key={r.line}>
                      <td className="task-muted">{r.line}</td>
                      <td>{r.task.title || <span className="cell-empty">—</span>}</td>
                      <td><Pill color={statusColor(board.statuses, r.task.status)}>{r.task.status}</Pill></td>
                      <td><Pill color={priorityColor(r.task.priority)}>{r.task.priority}</Pill></td>
                      <td>{peopleById.get(r.task.assignee_id)?.name || <span className="cell-empty">Unassigned</span>}</td>
                      <td>{r.task.due_date ? formatDay(r.task.due_date) : <span className="cell-empty">—</span>}</td>
                      {previewColumns.map((c) => (
                        <td key={c.field_key}><ColumnValue column={c} value={r.task.data[c.field_key]} /></td>
                      ))}
                      <td className="task-import-notes">
                        {r.warnings.join('; ') || <span className="cell-empty">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsed.length > PREVIEW_ROWS && (
              <p className="field-hint">Showing the first {PREVIEW_ROWS} of {parsed.length} rows.</p>
            )}
          </>
        )}

        {error && <div className="top-error">{error}</div>}

        <div className="modal-actions">
          {sheet && (
            <button type="button" className="btn btn-ghost" style={{ marginRight: 'auto' }} disabled={saving} onClick={() => setSheet(null)}>
              ← Choose another file
            </button>
          )}
          {!inline && <button type="button" className="btn btn-ghost" onClick={() => onClose()} disabled={saving}>Cancel</button>}
          {sheet && (
            <button type="button" className="btn btn-primary" disabled={saving || ready.length === 0} onClick={handleImport}>
              {saving ? 'Importing…' : `Import ${ready.length} task${ready.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
    </Shell>
  );
}

function Shell({ inline, onClose, children }) {
  if (inline) return <div className="table-panel task-import-page">{children}</div>;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg task-import-modal" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// Task board + activity log exports, shaped for lib/exportData.js.

function day(value) {
  return value ? String(value).slice(0, 10) : '';
}

function stamp(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function columnText(column, value) {
  if (value === '' || value === null || value === undefined) return column.field_type === 'checkbox' ? 'No' : '';
  if (column.field_type === 'file') return value?.name || '';
  if (column.field_type === 'checkbox') return value ? 'Yes' : 'No';
  return String(value);
}

export const ACTIVITY_COLUMNS = ['#', 'When', 'Who', 'Action', 'Task', 'Summary', 'Field', 'Old value', 'New value', 'Reverted'];

// One row per changed field, so old → new values line up in a spreadsheet.
export function activityRows(activity) {
  const rows = [];
  for (const a of activity) {
    const reverted = a.reverted_at ? `by ${a.reverted_by_name || 'admin'} on ${stamp(a.reverted_at)}` : '';
    const base = [a.id, stamp(a.created_at), a.user_name, a.action.replace(/_/g, ' '), a.task_title || '', a.summary];
    if (!a.changes?.length) rows.push([...base, '', '', '', reverted]);
    else a.changes.forEach((c) => rows.push([...base, c.label, c.oldText || '', c.newText || '', reverted]));
  }
  return rows;
}

export function taskBoardExportTable({ board, columns, people, tasks, activity }) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const header = [
    'Title', 'Status', 'Priority', 'Assignee', 'Assignee email', 'Due date', 'Description',
    ...columns.map((c) => c.label),
    'Created', 'Created by', 'Last updated', 'Updated by',
  ];
  const rows = tasks.map((t) => {
    const assignee = byId.get(t.assignee_id);
    return [
      t.title,
      t.status,
      t.priority,
      assignee?.name || (t.assignee_id ? 'Former member' : 'Unassigned'),
      assignee?.email || '',
      day(t.due_date),
      t.description || '',
      ...columns.map((c) => columnText(c, t.data?.[c.field_key])),
      stamp(t.created_at),
      byId.get(t.created_by)?.name || '',
      stamp(t.updated_at),
      byId.get(t.updated_by)?.name || '',
    ];
  });
  return {
    title: board.name,
    subtitle: `${board.visibility === 'public' ? 'Public' : 'Private'} board${board.description ? ` · ${board.description}` : ''}`,
    columns: header,
    rows,
    // Excel gets the full activity log as a second sheet.
    sheets: activity ? [{ name: 'Activity log', columns: ACTIVITY_COLUMNS, rows: activityRows(activity) }] : [],
  };
}

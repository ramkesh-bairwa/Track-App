// Shared (client + server) constants for the task assigner.

export const DEFAULT_STATUSES = [
  { name: 'To do', color: '#8B93A5' },
  { name: 'In progress', color: '#4FA6E8' },
  { name: 'In review', color: '#E8A33D' },
  { name: 'Done', color: '#35C2A6' },
  { name: 'Blocked', color: '#E5646B' },
];

export const PRIORITIES = [
  { name: 'Low', color: '#8B93A5' },
  { name: 'Medium', color: '#4FA6E8' },
  { name: 'High', color: '#E8A33D' },
  { name: 'Urgent', color: '#E5646B' },
];

// Field types an admin can add as extra task columns.
export const TASK_FIELD_TYPES = [
  { id: 'text', label: 'Text' },
  { id: 'textarea', label: 'Long text' },
  { id: 'number', label: 'Number' },
  { id: 'date', label: 'Date' },
  { id: 'select', label: 'Dropdown', supportsOptions: true },
  { id: 'checkbox', label: 'Checkbox' },
  { id: 'link', label: 'Link' },
  { id: 'email', label: 'Email' },
  { id: 'file', label: 'File' },
];

export const MAX_TASK_FILE_BYTES = 2 * 1024 * 1024;

// Screenshots / images attached to any task, kept in task.data under this
// key. Column keys are slugs with no leading "_", so they can't collide.
export const TASK_IMAGES_KEY = '_images';
export const MAX_TASK_IMAGES = 8;

// Extra board members a task is shared with (user ids, in task.data). On a
// private board they see the task — and its history — like its assignee.
export const TASK_COLLABORATORS_KEY = '_collaborators';

export function taskCollaborators(task) {
  const list = task?.data?.[TASK_COLLABORATORS_KEY];
  return Array.isArray(list) ? list : [];
}

// Assigned to, created by, or shared with this user.
export function isOnTask(task, userId) {
  return task.assignee_id === userId || task.created_by === userId || taskCollaborators(task).includes(userId);
}

// Most tasks one spreadsheet import may create.
export const MAX_IMPORT_ROWS = 1000;

// Built-in task fields, in display order. Custom columns come after these.
export const BUILTIN_TASK_FIELDS = [
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'assignee_id', label: 'Assignee' },
  { key: 'due_date', label: 'Due date' },
  { key: 'description', label: 'Description' },
];

export function taskFieldTypeMeta(id) {
  return TASK_FIELD_TYPES.find((t) => t.id === id) || TASK_FIELD_TYPES[0];
}

export function statusColor(statuses, name) {
  return (statuses || []).find((s) => s.name === name)?.color || '#8B93A5';
}

export function priorityColor(name) {
  return PRIORITIES.find((p) => p.name === name)?.color || '#8B93A5';
}

export function permissionLabel(member) {
  if (member.can_add && member.can_edit && member.can_delete) return 'All';
  const parts = ['View'];
  if (member.can_add) parts.push('Add');
  if (member.can_edit) parts.push('Edit');
  if (member.can_delete) parts.push('Delete');
  return parts.join(' · ');
}

const personKey = (s) => String(s ?? '').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();

// Finds the person a spreadsheet's assignee cell means, among `people`
// ({ id, name, email }). In order: exact email, exact name (case, spacing
// and dots ignored), then a unique partial — "Ramkesh" or "Ramkesh B" for
// "Ramkesh Bairwa", or "ramkesh" for ramkesh@podup.com. Two candidates at
// the same step is ambiguous and never guessed.
// → { person } | { person: null, problem }
export function matchPersonName(text, people) {
  const key = personKey(text);
  if (!key) return { person: null };
  const pick = (list, what) => {
    const unique = [...new Map(list.map((p) => [p.id, p])).values()];
    if (unique.length === 1) return { person: unique[0] };
    if (unique.length > 1) return { person: null, problem: `more than one person ${what} "${text}"` };
    return null;
  };
  const words = key.split(' ');
  return (
    pick(people.filter((p) => personKey(p.email) === key), 'has the email') ||
    pick(people.filter((p) => personKey(p.name) === key), 'is named') ||
    pick(
      people.filter((p) => {
        const nameWords = personKey(p.name).split(' ');
        return words.length <= nameWords.length && words.every((w, i) => nameWords[i].startsWith(w)) && words[0] === nameWords[0];
      }),
      'matches'
    ) ||
    pick(people.filter((p) => words.length === 1 && personKey(String(p.email).split('@')[0]) === key), 'matches') || {
      person: null,
      problem: `nobody in MyTrack is named "${text}"`,
    }
  );
}

// Task table columns (built-in + custom), shared by the board listing and its settings.
const BUILTIN_COLUMN_LABELS = { title: 'Task', status: 'Status', priority: 'Priority', assignee: 'Assignee', due: 'Due', updated: 'Updated' };

// Table columns in display order: the admin's saved order first, then any
// column it doesn't mention yet (e.g. one added since) at its default spot.
export function orderTaskColumns(saved, columns) {
  const defaults = ['title', 'status', 'priority', 'assignee', 'due', ...columns.map((c) => `c:${c.id}`), 'updated'];
  const order = (saved || []).filter((k) => defaults.includes(k));
  defaults.forEach((key, i) => {
    if (order.includes(key)) return;
    const prev = defaults.slice(0, i).reverse().find((k) => order.includes(k));
    order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, key);
  });
  const byKey = new Map(columns.map((c) => [`c:${c.id}`, c]));
  return order.map((key) => ({ key, label: byKey.get(key)?.label ?? BUILTIN_COLUMN_LABELS[key], custom: byKey.get(key) || null }));
}

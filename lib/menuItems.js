// Every item a user can show or hide from their menus (profile → Accessibility).
// users.hidden_menus stores the ids they've hidden, so anything added here
// later shows up for everyone by default.
import { TOOLS } from './toolRegistry';

export const MENU_ITEMS = [
  { id: 'tasks', label: 'Task assigner', icon: 'fa-list-check', where: 'Sidebar and top bar' },
  { id: 'expenses', label: 'Daily expenses', icon: 'fa-wallet', where: 'Sidebar' },
  { id: 'routine', label: 'Daily routine', icon: 'fa-sun', where: 'Sidebar' },
  { id: 'calendar', label: 'Calendar', icon: 'fa-calendar-days', where: 'Sidebar' },
  { id: 'activity', label: 'Activity', icon: 'fa-clock-rotate-left', where: 'Sidebar' },
  { id: 'screenshots', label: 'Screenshots', icon: 'fa-camera', where: 'Sidebar', adminOnly: true },
  { id: 'downloader', label: 'Image downloader', icon: 'fa-cloud-arrow-down', where: 'Sidebar' },
  { id: 'records', label: 'My records', icon: 'fa-folder', where: 'Sidebar' },
  { id: 'notes', label: 'Notes', icon: 'fa-note-sticky', where: 'Sidebar and top bar' },
  { id: 'add-user', label: 'Add user', icon: 'fa-user-plus', where: 'Top bar' },
  { id: 'users', label: 'Users', icon: 'fa-users', where: 'Top bar' },
  { id: 'photo-editor', label: 'Photo editor', icon: 'fa-wand-magic-sparkles', where: 'Top bar' },
  { id: 'code', label: 'Save code & saved code', icon: 'fa-code', where: 'Top bar' },
  { id: 'security-test', label: 'Test site', icon: 'fa-shield-halved', where: 'Top bar' },
  { id: 'tools', label: 'Tools section', icon: 'fa-toolbox', where: 'Sidebar' },
  ...TOOLS.map((t) => ({ id: `tool-${t.slug}`, label: t.label, icon: t.icon, where: 'Tools', group: 'Tools' })),
];

const IDS = new Set(MENU_ITEMS.map((m) => m.id));

// Accepts the stored JSON text (or an array) and keeps only known ids.
export function parseHiddenMenus(value) {
  let list = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value);
    } catch {
      list = [];
    }
  }
  return Array.isArray(list) ? [...new Set(list.filter((id) => IDS.has(id)))] : [];
}

export const menuShown = (user, id) => !(user?.hidden_menus || []).includes(id);

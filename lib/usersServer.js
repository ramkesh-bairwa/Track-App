// Server helpers for the Users page. Scope is deliberately narrow: you see
// accounts you created plus people who share a task board with you, and you
// can only edit the accounts you created — never anyone else's. Admins see
// every account, so they can make other people admins.
import { query } from './db';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function listUsersFor(me) {
  const rows = await query(
    `SELECT u.id, u.name, u.email, u.avatar, u.created_at, u.created_by, u.is_admin,
            (u.created_by = ?) AS managed
       FROM users u
      WHERE u.id <> ?
        AND (
          ? OR u.created_by = ?
          OR u.id IN (SELECT m.user_id FROM task_members m JOIN task_boards b ON b.id = m.board_id WHERE b.owner_id = ?)
          OR u.id IN (SELECT b.owner_id FROM task_members m JOIN task_boards b ON b.id = m.board_id WHERE m.user_id = ?)
        )
      ORDER BY u.created_at DESC, u.id DESC`,
    [me.id, me.id, me.is_admin ? 1 : 0, me.id, me.id, me.id]
  );
  // Boards *I* administer that each person is on (with their permissions).
  const memberships = await query(
    `SELECT m.user_id, b.uuid, b.name, m.can_add, m.can_edit, m.can_delete
       FROM task_members m JOIN task_boards b ON b.id = m.board_id
      WHERE b.owner_id = ?
      ORDER BY b.name`,
    [me.id]
  );
  const byUser = new Map();
  memberships.forEach((m) => {
    if (!byUser.has(m.user_id)) byUser.set(m.user_id, []);
    byUser.get(m.user_id).push({
      uuid: m.uuid,
      name: m.name,
      can_add: Boolean(m.can_add),
      can_edit: Boolean(m.can_edit),
      can_delete: Boolean(m.can_delete),
    });
  });
  return rows.map((r) => ({ ...r, managed: Boolean(r.managed), is_admin: Boolean(r.is_admin), boards: byUser.get(r.id) || [] }));
}

export async function myAdminBoards(me) {
  return query('SELECT id, uuid, name FROM task_boards WHERE owner_id = ? ORDER BY name', [me.id]);
}

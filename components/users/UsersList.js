'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar, formatDateTime } from '@/components/tasks/taskUi';
import { permissionLabel } from '@/lib/taskConfig';
import UserFormModal from '@/components/users/UserFormModal';
import ExportMenu from '@/components/ExportMenu';

export default function UsersList({ users, isAdmin }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('all');
  const [editing, setEditing] = useState(null); // null | 'new' | user
  const [adminError, setAdminError] = useState('');
  const [savingAdmin, setSavingAdmin] = useState(null);

  async function setAdmin(u, value) {
    const verb = value ? 'Make' : 'Remove';
    if (!window.confirm(`${verb} ${u.name} ${value ? 'an admin? They’ll see and can delete everyone’s screenshots, and manage admins.' : 'as an admin?'}`)) return;
    setAdminError('');
    setSavingAdmin(u.id);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_admin: value }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not change admin access.');
      router.refresh();
    } catch (err) {
      setAdminError(err.message);
    } finally {
      setSavingAdmin(null);
    }
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (scope === 'managed' && !u.managed) return false;
      if (scope === 'others' && u.managed) return false;
      if (!q) return true;
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.boards.some((b) => b.name.toLowerCase().includes(q));
    });
  }, [users, search, scope]);

  const managedCount = users.filter((u) => u.managed).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p>{isAdmin ? 'Every account. As an admin you can make other people admins.' : 'People you created accounts for, and everyone who shares a task board with you.'}</p>
        </div>
        <div className="page-head-actions">
          <ExportMenu
            getTable={() => ({
              title: 'Users',
              columns: ['Name', 'Email', 'Created by you', 'Joined', 'Your boards (permissions)'],
              rows: shown.map((u) => [
                u.name,
                u.email,
                u.managed ? 'Yes' : 'No',
                formatDateTime(u.created_at),
                u.boards.map((b) => `${b.name} (${permissionLabel(b)})`).join('; '),
              ]),
            })}
          />
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>＋ Add user</button>
        </div>
      </div>

      {adminError && <div className="top-error">{adminError}</div>}
      <div className="table-panel">
        <div className="table-toolbar">
          <div className="tabs track-type-tabs">
            {[
              ['all', `All (${users.length})`],
              ['managed', `Created by you (${managedCount})`],
              ['others', `Others (${users.length - managedCount})`],
            ].map(([key, label]) => (
              <button key={key} type="button" className={`tab-btn${scope === key ? ' active' : ''}`} onClick={() => setScope(key)}>
                {label}
              </button>
            ))}
          </div>
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input type="search" className="input search-input" placeholder="Search name, email, board…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="task-table-wrap">
          <table className="data-table task-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Your boards</th>
                <th>Joined</th>
                {isAdmin && <th>Admin</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id} onDoubleClick={() => u.managed && setEditing(u)}>
                  <td>
                    <span className="task-assignee">
                      <Avatar person={u} size={26} />
                      <strong>{u.name}</strong>
                      {u.managed && <span className="task-role-badge admin">Created by you</span>}
                      {u.is_admin && <span className="task-role-badge admin">Admin</span>}
                    </span>
                  </td>
                  <td>{u.email}</td>
                  <td>
                    {u.boards.length === 0 ? (
                      <span className="cell-empty">—</span>
                    ) : (
                      <div className="user-boards">
                        {u.boards.map((b) => (
                          <Link key={b.uuid} href={`/dashboard/tasks/${b.uuid}`} className="task-role-badge" title={permissionLabel(b)}>
                            {b.name} · {permissionLabel(b)}
                          </Link>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="task-muted">{formatDateTime(u.created_at)}</td>
                  {isAdmin && (
                    <td>
                      <button type="button" className={`btn btn-sm${u.is_admin ? ' btn-danger' : ''}`} disabled={savingAdmin === u.id} onClick={() => setAdmin(u, !u.is_admin)}>
                        {u.is_admin ? 'Remove admin' : 'Make admin'}
                      </button>
                    </td>
                  )}
                  <td>
                    {u.managed ? (
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(u)}>✎ Edit</button>
                    ) : (
                      <span className="task-muted" style={{ fontSize: 12 }} title="Only the person themselves, or whoever created it, can change this account">{u.created_by ? 'Created by someone else' : 'Registered themselves'}</span>
                    )}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5}>
                    <div className="cell-inner cell-empty" style={{ padding: '24px 14px' }}>
                      {users.length === 0 ? 'No users yet — click “＋ Add user” to create one.' : 'Nobody matches.'}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="field-hint" style={{ marginTop: 10 }}>
        You can edit the name, email and password of accounts you created. Board permissions are changed in each board’s Settings → Members.
      </p>

      {editing && (
        <UserFormModal
          user={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </>
  );
}

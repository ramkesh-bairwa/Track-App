'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import ThemeToggle from '@/components/ThemeToggle';
import ProfileModal from '@/components/ProfileModal';
import TrackIcon from '@/components/TrackIcon';
import { NewTrackButton } from '@/components/NewTrackModal';
import TopbarTools from '@/components/TopbarTools';
import { chromeColorStyle } from '@/lib/color';
import { menuShown } from '@/lib/menuItems';
import { TOOLS } from '@/lib/toolRegistry';

const DRAG_MIME = 'application/x-mytrack-track-id';
const RECORDS_KEY = 'mytrack_records_open';
const TOOLS_KEY = 'mytrack_tools_open';

function buildTree(tracks) {
  const byId = new Map(tracks.map((t) => [t.id, { ...t, children: [] }]));
  const roots = [];
  byId.forEach((node) => {
    const parent = node.parent_id ? byId.get(node.parent_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  return roots;
}

// The URL segment is a track's uuid (or, briefly, a bare numeric id for an
// old link before it redirects) — resolve it to the internal numeric id that
// the rest of this component's bookkeeping (expanded set, drag/drop) uses.
function activeTrackIdFromPath(pathname, tracks) {
  const match = pathname.match(/^\/dashboard\/tracks\/([^/]+)/);
  if (!match) return null;
  const segment = match[1];
  const track = tracks.find((t) => t.uuid === segment || String(t.id) === segment);
  return track ? track.id : null;
}

function ancestorIds(tracks, id) {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const ids = new Set();
  let current = id != null ? byId.get(id) : null;
  while (current && current.parent_id) {
    ids.add(current.parent_id);
    current = byId.get(current.parent_id);
  }
  return ids;
}

// Every id that can't be a valid drop target for the track being dragged:
// itself, plus every one of its own descendants (dropping there would be a cycle).
function invalidDropTargets(tracks, draggingId) {
  const invalid = new Set([draggingId]);
  if (draggingId == null) return invalid;
  const byParent = new Map();
  tracks.forEach((t) => {
    const key = t.parent_id ?? 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(t.id);
  });
  const stack = [draggingId];
  while (stack.length) {
    const current = stack.pop();
    (byParent.get(current) || []).forEach((childId) => {
      if (!invalid.has(childId)) {
        invalid.add(childId);
        stack.push(childId);
      }
    });
  }
  return invalid;
}

export default function Sidebar({ user, tracks }) {
  const pathname = usePathname();
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState(user);
  const [profileOpen, setProfileOpen] = useState(false);
  const activeId = activeTrackIdFromPath(pathname, tracks);
  const [expanded, setExpanded] = useState(() => ancestorIds(tracks, activeId));
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [dndError, setDndError] = useState('');
  // "My records" starts closed (so server and browser render the same), then
  // restores what you left it as; viewing a track always opens it.
  const [recordsOpen, setRecordsOpenState] = useState(activeId != null);
  function setRecordsOpen(open) {
    setRecordsOpenState(open);
    try {
      localStorage.setItem(RECORDS_KEY, open ? '1' : '0');
    } catch {}
  }
  useEffect(() => {
    try {
      if (localStorage.getItem(RECORDS_KEY) === '1') setRecordsOpenState(true);
    } catch {}
  }, []);
  useEffect(() => {
    if (activeId != null) setRecordsOpenState(true);
  }, [activeId]);

  // "Tools" opens and closes the same way, and opens while you're on a tool.
  const onTool = pathname.startsWith('/dashboard/tools');
  const [toolsOpen, setToolsOpenState] = useState(onTool);
  function setToolsOpen(open) {
    setToolsOpenState(open);
    try {
      localStorage.setItem(TOOLS_KEY, open ? '1' : '0');
    } catch {}
  }
  useEffect(() => {
    try {
      if (localStorage.getItem(TOOLS_KEY) === '1') setToolsOpenState(true);
    } catch {}
  }, []);
  useEffect(() => {
    if (onTool) setToolsOpenState(true);
  }, [onTool]);
  const shownTools = TOOLS.filter((t) => menuShown(user, `tool-${t.slug}`));
  const fullTree = useMemo(() => buildTree(tracks), [tracks]);
  const invalidTargets = useMemo(() => invalidDropTargets(tracks, draggingId), [tracks, draggingId]);
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);

  // Every track that has at least one child — the set of nodes "collapse/expand all" acts on.
  const parentIds = useMemo(() => {
    const ids = new Set();
    tracks.forEach((t) => {
      if (t.parent_id != null) ids.add(t.parent_id);
    });
    return ids;
  }, [tracks]);
  const allExpanded = parentIds.size > 0 && Array.from(parentIds).every((id) => expanded.has(id));

  function toggleAllExpanded() {
    setExpanded(allExpanded ? new Set() : new Set(parentIds));
  }

  // Auto-expand the path to whichever track is currently open — its
  // ancestors, so you can see where it lives, and the track itself, so its
  // own sub-tracks show without needing a precise click on the tiny arrow.
  useEffect(() => {
    const toAdd = ancestorIds(tracks, activeId);
    if (activeId != null) toAdd.add(activeId);
    if (toAdd.size === 0) return;
    setExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      toAdd.forEach((id) => {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [activeId, tracks]);

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  async function moveTrack(trackId, parentId) {
    if (byId.get(trackId)?.parent_id === parentId) return;
    const res = await fetch(`/api/tracks/${trackId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_id: parentId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setDndError(json.error || 'Could not move this track.');
      setTimeout(() => setDndError(''), 4000);
      return;
    }
    if (parentId != null) setExpanded((prev) => new Set(prev).add(parentId));
    router.refresh();
  }

  function handleDragStart(e, id) {
    // The expand/collapse toggle sits inside the draggable row — without this,
    // a click on it that jitters even a pixel gets read as a drag start
    // instead of a click, so the toggle button's onClick never fires and the
    // sub-track list appears to just not open.
    if (e.target.closest('button')) {
      e.preventDefault();
      return;
    }
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DRAG_MIME, String(id));
  }

  function handleDragEnd() {
    setDraggingId(null);
    setDragOverId(null);
  }

  function handleDragOverTarget(e, id) {
    if (draggingId == null || invalidTargets.has(id)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(id);
  }

  function handleDragLeaveTarget(id) {
    setDragOverId((prev) => (prev === id ? null : prev));
  }

  function handleDrop(e, parentId) {
    e.preventDefault();
    setDragOverId(null);
    const draggedId = Number(e.dataTransfer.getData(DRAG_MIME));
    if (!draggedId) return;
    moveTrack(draggedId, parentId);
  }

  async function reorderSiblings(parentId, draggedId, targetId) {
    const key = parentId ?? null;
    const siblings = tracks.filter((t) => (t.parent_id ?? null) === key);
    const fromIndex = siblings.findIndex((t) => t.id === draggedId);
    const toIndex = siblings.findIndex((t) => t.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    const next = siblings.slice();
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    const res = await fetch('/api/tracks/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: next.map((t) => t.id) }),
    });
    if (!res.ok) {
      setDndError('Could not reorder these tracks.');
      setTimeout(() => setDndError(''), 4000);
      return;
    }
    router.refresh();
  }

  // Dropping directly on another track: if they're already siblings (same
  // parent — including two top-level tracks, both with a NULL parent), this
  // reorders them relative to each other. Otherwise it nests the dragged
  // track under the one it was dropped on, same as before.
  function handleDropOnTrack(e, targetId) {
    e.preventDefault();
    setDragOverId(null);
    const draggedId = Number(e.dataTransfer.getData(DRAG_MIME));
    if (!draggedId || draggedId === targetId) return;
    const draggedTrack = byId.get(draggedId);
    const targetTrack = byId.get(targetId);
    if (!draggedTrack || !targetTrack) return;
    const sameParent = (draggedTrack.parent_id ?? null) === (targetTrack.parent_id ?? null);
    if (sameParent) {
      reorderSiblings(targetTrack.parent_id ?? null, draggedId, targetId);
    } else {
      moveTrack(draggedId, targetId);
    }
  }

  const initials = (currentUser?.name || '?').trim().slice(0, 1).toUpperCase();

  function renderNodes(nodes, depth) {
    return (
      <ul className={depth === 0 ? 'sidebar-list' : 'sidebar-list sidebar-sublist'}>
        {nodes.map((node) => {
          const href = `/dashboard/tracks/${node.uuid}`;
          const active = pathname === href;
          const hasChildren = node.children.length > 0;
          const isOpen = expanded.has(node.id);
          const isDropTarget = dragOverId === node.id;
          const isInvalidTarget = draggingId != null && invalidTargets.has(node.id);
          return (
            <li key={node.id}>
              <div
                className={`sidebar-link-row${isDropTarget ? ' drag-over' : ''}${node.id === draggingId ? ' dragging' : ''}${isInvalidTarget ? ' drag-invalid' : ''}`}
                style={{ paddingLeft: depth * 14 }}
                draggable
                onDragStart={(e) => handleDragStart(e, node.id)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOverTarget(e, node.id)}
                onDragLeave={() => handleDragLeaveTarget(node.id)}
                onDrop={(e) => handleDropOnTrack(e, node.id)}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    className="sidebar-tree-toggle"
                    onClick={() => toggle(node.id)}
                    title={isOpen ? 'Collapse' : 'Expand'}
                  >
                    {isOpen ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="sidebar-tree-toggle-spacer" />
                )}
                <Link
                  href={href}
                  className={`sidebar-link${active ? ' active' : ''}`}
                  title={
                    hasChildren && active
                      ? 'Click to collapse/expand its sub-tracks'
                      : 'Drag to move under another track'
                  }
                  onClick={(e) => {
                    // Already viewing this track — clicking it again would just
                    // re-navigate to the same page and do nothing visible, so
                    // treat it as a collapse/expand toggle for its children instead.
                    if (hasChildren && active) {
                      e.preventDefault();
                      toggle(node.id);
                    }
                  }}
                >
                  <span
                    className="sidebar-track-icon"
                    style={{ background: `${node.color || '#35C2A6'}22`, color: node.color || '#35C2A6' }}
                  >
                    <TrackIcon track={node} />
                  </span>
                  <span className="sidebar-link-name">{node.name}</span>
                </Link>
              </div>
              {hasChildren && isOpen && renderNodes(node.children, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <aside className="sidebar" style={chromeColorStyle(user?.sidebar_color)}>
      <Link href="/dashboard" className="sidebar-brand">
        <span className="mark">MT</span>
        <span>MyTrack</span>
      </Link>

      {menuShown(user, 'tasks') && (
        <Link
          href="/dashboard/tasks"
          className={`sidebar-tasks-link${pathname.startsWith('/dashboard/tasks') ? ' active' : ''}`}
        >
          <i className="fa-solid fa-list-check" />
          <span>Task assigner</span>
        </Link>
      )}
      {menuShown(user, 'expenses') && (
        <Link
          href="/dashboard/expenses"
          className={`sidebar-tasks-link${pathname.startsWith('/dashboard/expenses') ? ' active' : ''}`}
        >
          <i className="fa-solid fa-wallet" />
          <span>Daily expenses</span>
        </Link>
      )}
      {menuShown(user, 'routine') && (
        <Link
          href="/dashboard/routine"
          className={`sidebar-tasks-link${pathname.startsWith('/dashboard/routine') ? ' active' : ''}`}
        >
          <i className="fa-solid fa-sun" />
          <span>Daily routine</span>
        </Link>
      )}
      {menuShown(user, 'notes') && (
        <Link
          href="/dashboard/notes"
          className={`sidebar-tasks-link${pathname.startsWith('/dashboard/notes') ? ' active' : ''}`}
        >
          <i className="fa-solid fa-note-sticky" />
          <span>Notes</span>
        </Link>
      )}
      {menuShown(user, 'calendar') && (
        <Link
          href="/dashboard/calendar"
          className={`sidebar-tasks-link${pathname.startsWith('/dashboard/calendar') ? ' active' : ''}`}
        >
          <i className="fa-solid fa-calendar-days" />
          <span>Calendar</span>
        </Link>
      )}
      {menuShown(user, 'activity') && (
        <Link
          href="/dashboard/activity"
          className={`sidebar-tasks-link${pathname.startsWith('/dashboard/activity') ? ' active' : ''}`}
        >
          <i className="fa-solid fa-clock-rotate-left" />
          <span>Activity</span>
        </Link>
      )}
      {user?.is_admin && menuShown(user, 'screenshots') && (
        <Link
          href="/dashboard/screenshots"
          className={`sidebar-tasks-link${pathname.startsWith('/dashboard/screenshots') ? ' active' : ''}`}
        >
          <i className="fa-solid fa-camera" />
          <span>Screenshots</span>
        </Link>
      )}
      {menuShown(user, 'downloader') && (
        <Link
          href="/dashboard/downloader"
          className={`sidebar-tasks-link${pathname.startsWith('/dashboard/downloader') ? ' active' : ''}`}
        >
          <i className="fa-solid fa-cloud-arrow-down" />
          <span>Image downloader</span>
        </Link>
      )}
      {menuShown(user, 'tools') && shownTools.length > 0 && (
        <>
          <div className={`sidebar-records${toolsOpen ? ' open' : ''}${onTool ? ' active' : ''}`}>
            <button
              type="button"
              className="sidebar-records-toggle"
              onClick={() => setToolsOpen(!toolsOpen)}
              aria-expanded={toolsOpen}
              title={toolsOpen ? 'Hide tools' : 'Show tools'}
            >
              <i className="fa-solid fa-toolbox" />
              <span>Tools</span>
              <span className="sidebar-records-count">{shownTools.length}</span>
              <span className="sidebar-records-caret">{toolsOpen ? '▾' : '▸'}</span>
            </button>
          </div>
          {toolsOpen && (
            <ul className="sidebar-list sidebar-records-list sidebar-tools-list">
              <li>
                <Link href="/dashboard/tools" className={`sidebar-link${pathname === '/dashboard/tools' ? ' active' : ''}`}>
                  <i className="fa-solid fa-table-cells-large" />
                  <span>All tools</span>
                </Link>
              </li>
              {shownTools.map((t) => (
                <li key={t.slug}>
                  <Link
                    href={`/dashboard/tools/${t.slug}`}
                    className={`sidebar-link${pathname.startsWith(`/dashboard/tools/${t.slug}`) ? ' active' : ''}`}
                  >
                    <i className={`fa-solid ${t.icon}`} />
                    <span>{t.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="sidebar-tools">
        <TopbarTools variant="sidebar" hidden={user?.hidden_menus} />
      </div>

      {menuShown(user, 'records') && (
        <>
          {/* Every track lives under this one "My records" parent. Dropping a
              track on it makes that track top-level. */}
          <div
            className={`sidebar-records${recordsOpen ? ' open' : ''}${activeId != null ? ' active' : ''}${dragOverId === 'root' ? ' drag-over' : ''}`}
            onDragOver={(e) => {
              if (draggingId == null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDragOverId('root');
            }}
            onDragLeave={() => handleDragLeaveTarget('root')}
            onDrop={(e) => handleDrop(e, null)}
          >
            <button
              type="button"
              className="sidebar-records-toggle"
              onClick={() => setRecordsOpen(!recordsOpen)}
              aria-expanded={recordsOpen}
              title={recordsOpen ? 'Hide your records' : 'Show your records'}
            >
              <i className={`fa-solid ${recordsOpen ? 'fa-folder-open' : 'fa-folder'}`} />
              <span>My records</span>
              {tracks.length > 0 && <span className="sidebar-records-count">{tracks.filter((t) => t.parent_id == null).length}</span>}
              <span className="sidebar-records-caret">{recordsOpen ? '▾' : '▸'}</span>
            </button>
            <span className="sidebar-section-actions">
              {recordsOpen && parentIds.size > 0 && (
                <button
                  type="button"
                  className="sidebar-new"
                  onClick={toggleAllExpanded}
                  title={allExpanded ? 'Collapse all' : 'Expand all'}
                >
                  {allExpanded ? '▾▾' : '▸▸'}
                </button>
              )}
              <NewTrackButton className="sidebar-new" title="New track">＋</NewTrackButton>
            </span>
          </div>

          {dndError && <p className="sidebar-dnd-error">{dndError}</p>}

          {recordsOpen && (
            <div className="sidebar-records-list">
              {tracks.length === 0 ? (
                <p style={{ padding: '8px', color: 'var(--text-faint)', fontSize: '12.5px' }}>
                  No tracks yet.
                </p>
              ) : (
                renderNodes(fullTree, 0)
              )}
            </div>
          )}
        </>
      )}

      <div className="sidebar-foot">
        <div className="sidebar-foot-row">
          <button
            type="button"
            className="sidebar-user-btn"
            onClick={() => setProfileOpen(true)}
            title="Edit profile"
          >
            <span className="avatar">
              {currentUser?.avatar ? <img src={currentUser.avatar} alt="" /> : initials}
            </span>
            <span className="sidebar-user">{currentUser?.name}</span>
          </button>
          <ThemeToggle />
        </div>
        <button className="btn btn-ghost btn-sm btn-block" onClick={handleLogout}>Log out</button>
      </div>

      {profileOpen && (
        <ProfileModal
          user={currentUser}
          onClose={() => setProfileOpen(false)}
          onSaved={(updated) => {
            setCurrentUser((prev) => ({ ...prev, ...updated }));
            router.refresh();
          }}
        />
      )}
    </aside>
  );
}

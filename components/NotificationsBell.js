'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { timeAgo } from '@/components/tasks/taskUi';

// 🔔 in the top bar: mentions and other notifications for the signed-in
// user. Polls every 30 seconds while the tab is visible.
export default function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread: 0 });
  const ref = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=20');
      if (res.ok) setData(await res.json());
    } catch {
      // offline — keep what we have
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 30000);
    window.addEventListener('focus', load);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function markRead(body) {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
    load();
  }

  function openItem(n) {
    if (!n.read_at) markRead({ ids: [n.id] });
    setOpen(false);
    if (n.url) router.push(n.url);
  }

  return (
    <div className="notif" ref={ref}>
      <button
        type="button"
        className="tasks-menu-trigger notif-trigger"
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        aria-expanded={open}
      >
        <i className="fa-solid fa-bell" />
        {data.unread > 0 && <span className="notif-count">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="menu">
          <div className="notif-head">
            <strong>Notifications</strong>
            {data.unread > 0 && (
              <button type="button" className="log-link" onClick={() => markRead({ all: true })}>Mark all read</button>
            )}
          </div>
          {data.items.length === 0 ? (
            <p className="notif-empty">Nothing yet. When someone @mentions you in a task comment, it shows up here.</p>
          ) : (
            <div className="notif-list">
              {data.items.map((n) => (
                <button key={n.id} type="button" className={`notif-item${n.read_at ? '' : ' unread'}`} onClick={() => openItem(n)}>
                  <span className="notif-dot" />
                  <span className="notif-text">
                    <span className="notif-title">{n.title}</span>
                    {n.body && <span className="notif-body">{n.body}</span>}
                    <span className="notif-time">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

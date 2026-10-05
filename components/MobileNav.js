'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import ProfileMenu from '@/components/ProfileMenu';
import { chromeColorStyle } from '@/lib/color';
import { menuShown } from '@/lib/menuItems';
import { TOOLS } from '@/lib/toolRegistry';

// Section names for the mobile header, matched on the path after /dashboard/.
const SECTION_TITLES = {
  tasks: 'Tasks',
  expenses: 'Daily expenses',
  routine: 'Daily routine',
  notes: 'Notes',
  tools: 'Tools',
  calendar: 'Calendar',
  activity: 'Activity',
  screenshots: 'Screenshots',
  downloader: 'Image downloader',
  code: 'Code',
  'photo-editor': 'Photo editor',
  users: 'Users',
  'login-history': 'Login history',
  'security-test': 'Test site',
};

function pageTitle(pathname, tracks) {
  const parts = pathname.split('/').filter(Boolean).slice(1); // drop "dashboard"
  if (parts.length === 0) return 'MyTrack';
  if (parts[0] === 'tracks') {
    if (parts[1] === 'new') return 'New track';
    return tracks.find((t) => t.uuid === parts[1])?.name || 'Track';
  }
  if (parts[0] === 'tools' && parts[1]) {
    return TOOLS.find((t) => t.slug === parts[1])?.label || 'Tools';
  }
  return SECTION_TITLES[parts[0]] || 'MyTrack';
}

export default function MobileNav({ user, tracks }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // Close drawer on navigation
  useEffect(() => { setOpen(false); }, [pathname]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // Nested pages (a track, a note, a tool…) get a back button instead of the menu button.
  const depth = pathname.split('/').filter(Boolean).length;
  const nested = depth > 2;

  const tabs = [
    { href: '/dashboard', label: 'Home', icon: 'fa-house', exact: true },
    menuShown(user, 'tasks') && { href: '/dashboard/tasks', label: 'Tasks', icon: 'fa-list-check' },
    menuShown(user, 'notes') && { href: '/dashboard/notes', label: 'Notes', icon: 'fa-note-sticky' },
    menuShown(user, 'tools') && { href: '/dashboard/tools', label: 'Tools', icon: 'fa-toolbox' },
    menuShown(user, 'calendar') && { href: '/dashboard/calendar', label: 'Calendar', icon: 'fa-calendar-days' },
  ].filter(Boolean).slice(0, 4);

  const isActive = (tab) =>
    tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);

  return (
    <>
      <div className="mobile-topbar" style={chromeColorStyle(user?.topbar_color)}>
        {nested ? (
          <button className="mobile-icon-btn" onClick={() => router.back()} aria-label="Go back">
            <i className="fa-solid fa-chevron-left" />
          </button>
        ) : (
          <button className="mobile-menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">
            <span /><span /><span />
          </button>
        )}
        <span className="mobile-topbar-title">{pageTitle(pathname, tracks)}</span>
        <div className="mobile-topbar-right">
          <ProfileMenu user={user} />
        </div>
      </div>

      <nav className="mobile-tabbar" aria-label="Main">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`mobile-tab${isActive(tab) ? ' active' : ''}`}
          >
            <i className={`fa-solid ${tab.icon}`} />
            <span>{tab.label}</span>
          </Link>
        ))}
        <button
          type="button"
          className={`mobile-tab${open ? ' active' : ''}`}
          onClick={() => setOpen(true)}
        >
          <i className="fa-solid fa-bars" />
          <span>Menu</span>
        </button>
      </nav>

      {open && (
        <div className="mobile-drawer-overlay" onClick={() => setOpen(false)}>
          <div className="mobile-drawer" onClick={(e) => e.stopPropagation()}>
            <Sidebar user={user} tracks={tracks} />
          </div>
        </div>
      )}
    </>
  );
}

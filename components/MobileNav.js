'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { chromeColorStyle } from '@/lib/color';

export default function MobileNav({ user, tracks }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close drawer on navigation
  useEffect(() => { setOpen(false); }, [pathname]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  return (
    <>
      <div className="mobile-topbar" style={chromeColorStyle(user?.topbar_color)}>
        <button className="mobile-menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">
          <span /><span /><span />
        </button>
        <span className="mobile-topbar-title">MyTrack</span>
        <div style={{ width: 40 }} />
      </div>

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

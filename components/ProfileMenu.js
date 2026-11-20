'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import ProfileModal from '@/components/ProfileModal';
import PrivacyModal from '@/components/PrivacyModal';
import AppearanceModal from '@/components/AppearanceModal';
import BackupModal from '@/components/BackupModal';
import AccessibilityModal from '@/components/AccessibilityModal';
import DataTransferModal from '@/components/DataTransferModal';
import AppLockModal from '@/components/AppLockModal';
import SyncModal from '@/components/SyncModal';
import ServerConnectionModal from '@/components/ServerConnectionModal';

export default function ProfileMenu({ user, desktop = false }) {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState(user);
  const [open, setOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [showAccessibility, setShowAccessibility] = useState(false);
  const [showData, setShowData] = useState(false);
  const [showAppLock, setShowAppLock] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const initials = (currentUser?.name || '?').trim().slice(0, 1).toUpperCase();

  return (
    <div className="profile-menu" ref={menuRef}>
      <button
        type="button"
        className="profile-menu-trigger"
        onClick={() => setOpen((o) => !o)}
        title="Account"
      >
        <span className="avatar">
          {currentUser?.avatar ? <img src={currentUser.avatar} alt="" /> : initials}
        </span>
      </button>

      {open && (
        <div className="profile-menu-dropdown">
          <div className="profile-menu-header">
            <span className="profile-menu-name">{currentUser?.name}</span>
            <span className="profile-menu-email">{currentUser?.email}</span>
          </div>
          <button
            type="button"
            className="profile-menu-item"
            onClick={() => {
              setOpen(false);
              setShowProfile(true);
            }}
          >
            Edit profile
          </button>
          <button
            type="button"
            className="profile-menu-item"
            onClick={() => {
              setOpen(false);
              setShowPrivacy(true);
            }}
          >
            Privacy
          </button>
          <button
            type="button"
            className="profile-menu-item"
            onClick={() => {
              setOpen(false);
              setShowAppearance(true);
            }}
          >
            Appearance
          </button>
          <button
            type="button"
            className="profile-menu-item"
            onClick={() => {
              setOpen(false);
              setShowAccessibility(true);
            }}
          >
            Accessibility
          </button>
          <button
            type="button"
            className="profile-menu-item"
            onClick={() => {
              setOpen(false);
              setShowBackup(true);
            }}
          >
            Backup
          </button>
          <button
            type="button"
            className="profile-menu-item"
            onClick={() => {
              setOpen(false);
              setShowAppLock(true);
            }}
          >
            App lock
          </button>
          <button
            type="button"
            className="profile-menu-item"
            onClick={() => {
              setOpen(false);
              setShowData(true);
            }}
          >
            Export / import data
          </button>
          {desktop && (
            <button
              type="button"
              className="profile-menu-item"
              onClick={() => {
                setOpen(false);
                setShowServer(true);
              }}
            >
              Server connection
            </button>
          )}
          {currentUser?.is_admin && (
            <button
              type="button"
              className="profile-menu-item"
              onClick={() => {
                setOpen(false);
                setShowSync(true);
              }}
            >
              Sync (web ⇄ desktop)
            </button>
          )}
          <button
            type="button"
            className="profile-menu-item"
            onClick={() => {
              setOpen(false);
              router.push('/dashboard/login-history');
            }}
          >
            Login history
          </button>
          <button
            type="button"
            className="profile-menu-item"
            onClick={() => {
              setOpen(false);
              router.push('/download');
            }}
          >
            📱 Get the app
          </button>
          <button
            type="button"
            className="profile-menu-item profile-menu-item-danger"
            onClick={handleLogout}
          >
            Log out
          </button>
        </div>
      )}

      {/* Rendered at the page root, so the top bar's own color settings don't leak into them. */}
      {(showProfile || showPrivacy || showAccessibility || showBackup || showAppearance || showData || showAppLock || showSync || showServer) &&
        createPortal(
          <>
            {showProfile && (
              <ProfileModal
                user={currentUser}
                onClose={() => setShowProfile(false)}
                onSaved={(updated) => {
                  setCurrentUser((prev) => ({ ...prev, ...updated }));
                  router.refresh();
                }}
              />
            )}
            {showPrivacy && <PrivacyModal onClose={() => setShowPrivacy(false)} />}
            {showAccessibility && (
              <AccessibilityModal
                user={currentUser}
                onClose={() => setShowAccessibility(false)}
                onSaved={(updated) => {
                  setCurrentUser((prev) => ({ ...prev, ...updated }));
                  router.refresh();
                }}
              />
            )}
            {showBackup && <BackupModal user={currentUser} onClose={() => setShowBackup(false)} />}
            {showData && <DataTransferModal user={currentUser} onClose={() => setShowData(false)} />}
            {showAppLock && <AppLockModal onClose={() => setShowAppLock(false)} />}
            {showSync && <SyncModal onClose={() => setShowSync(false)} />}
            {showServer && <ServerConnectionModal user={currentUser} onClose={() => setShowServer(false)} />}
            {showAppearance && (
              <AppearanceModal
                user={currentUser}
                onClose={() => setShowAppearance(false)}
                onSaved={(updated) => {
                  setCurrentUser((prev) => ({ ...prev, ...updated }));
                  router.refresh();
                }}
              />
            )}
          </>,
          document.body
        )}
    </div>
  );
}

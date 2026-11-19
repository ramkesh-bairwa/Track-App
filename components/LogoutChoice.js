'use client';

import { useState } from 'react';
import { lockAppNow } from '@/components/AppLock';
import AppLockModal from '@/components/AppLockModal';

// "Log out" with two choices:
//   • Lock MyTrack — stay signed in; the app lock screen covers everything
//     until the app lock password (or login password) is entered.
//   • Sign out — end the session; signing in again needs email + password.
// renderTrigger(open) draws the button that opens the choice. Menus that
// close when clicked render <LogoutChoiceModal onClose> themselves instead.
export default function LogoutChoice({ renderTrigger }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {renderTrigger(() => setOpen(true))}
      {open && <LogoutChoiceModal onClose={() => setOpen(false)} />}
    </>
  );
}

export function LogoutChoiceModal({ onClose }) {
  const [open, setOpenState] = useState(true);
  const [busy, setBusy] = useState(false);
  const [needsLock, setNeedsLock] = useState(false);
  const [setup, setSetup] = useState(false);
  const setOpen = (v) => {
    setOpenState(v);
    if (!v && !setup) onClose();
  };

  function lockNow() {
    if (lockAppNow()) {
      setOpen(false);
      return;
    }
    setNeedsLock(true);
  }

  async function signOut() {
    setBusy(true);
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/login';
  }

  return (
    <>
      {open && (
        <div className="modal-overlay" onClick={busy ? undefined : () => setOpen(false)}>
          <div className="modal modal-sm logout-choice" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Log out">
            <h2>Log out</h2>
            <div className="logout-options">
              <button type="button" className="logout-option" onClick={lockNow} disabled={busy}>
                <span className="logout-option-icon">🔒</span>
                <span>
                  <strong>Lock MyTrack</strong>
                  <small>Stay signed in. The lock screen covers the app until your app lock password is entered — nothing else is closed.</small>
                </span>
              </button>
              {needsLock && (
                <div className="logout-needs-lock">
                  <span>You haven’t set an app lock password yet.</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      setSetup(true);
                      setOpenState(false);
                    }}
                  >
                    Set up app lock
                  </button>
                </div>
              )}
              <button type="button" className="logout-option danger" onClick={signOut} disabled={busy}>
                <span className="logout-option-icon">⎋</span>
                <span>
                  <strong>{busy ? 'Signing out…' : 'Sign out of this session'}</strong>
                  <small>End the session on this device. You’ll need your email and password to sign in again.</small>
                </span>
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {setup && (
        <AppLockModal
          onClose={() => {
            setSetup(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { captureSelfie, rememberLoginPhotos } from '@/lib/captureSelfie';

// Fired by the App lock settings when the lock is turned on or off.
export const APP_LOCK_EVENT = 'mytrack:app-lock';
// Fired by "Log out → Lock MyTrack" to lock right now. The lock sets
// event.detail.locked = true when it did lock (an app lock password is set).
export const APP_LOCK_NOW_EVENT = 'mytrack:app-lock-now';

// Lock MyTrack now; false when no app lock password is set up.
export function lockAppNow() {
  const detail = { locked: false };
  window.dispatchEvent(new CustomEvent(APP_LOCK_NOW_EVENT, { detail }));
  return detail.locked;
}

// Covers the whole app until the app lock password is entered: when MyTrack
// is opened, and (on the website, lockOnLeave) again whenever the user comes
// back from another app, window or tab. Leaving for a file picker or into an
// embedded preview (iframe) doesn't count. The desktop app doesn't lock on
// leave: it signs out when it quits (Mac log out / restart / shut down).
export default function AppLock({ enabled: initialEnabled, lockOnLeave = true, user, photos = true }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [locked, setLocked] = useState(initialEnabled);
  const [password, setPassword] = useState('');
  const [useLogin, setUseLogin] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const inputRef = useRef(null);
  const pickingFile = useRef(false);
  const photo = useRef(null); // { at, promise } — photo of whoever came back
  const lastPhotoAt = useRef(0);

  // Someone is back at MyTrack while it's locked: take their photo now (it's
  // attached to the unlock attempt — right or wrong password — in Login
  // history). At most one every 10 seconds.
  const takePhoto = useCallback(() => {
    if (!photos || Date.now() - lastPhotoAt.current < 10000) return;
    lastPhotoAt.current = Date.now();
    photo.current = { promise: captureSelfie().catch(() => ({ photo: null })) };
  }, [photos]);

  // Rendered on every dashboard page: keep this browser's copy of the login
  // photos setting current for the next visit to the login page.
  useEffect(() => rememberLoginPhotos(photos), [photos]);

  const attachPhoto = useCallback((eventId) => {
    const pending = photo.current;
    if (!eventId || !pending) return;
    pending.promise.then(({ photo: dataUrl }) => {
      if (!dataUrl) return;
      fetch('/api/auth/login-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, photo: dataUrl }),
      }).catch(() => {});
    });
  }, []);

  const lock = useCallback(() => {
    setLocked(true);
    setPassword('');
    setError('');
    setUseLogin(false);
  }, []);

  useEffect(() => {
    function onChange(e) {
      setEnabled(Boolean(e.detail?.enabled));
      if (!e.detail?.enabled) setLocked(false);
    }
    window.addEventListener(APP_LOCK_EVENT, onChange);
    return () => window.removeEventListener(APP_LOCK_EVENT, onChange);
  }, []);

  useEffect(() => {
    function onLockNow(e) {
      if (!enabled) return;
      lock();
      e.detail.locked = true;
    }
    window.addEventListener(APP_LOCK_NOW_EVENT, onLockNow);
    return () => window.removeEventListener(APP_LOCK_NOW_EVENT, onLockNow);
  }, [enabled, lock]);

  useEffect(() => {
    if (!enabled || !lockOnLeave) return undefined;
    function onClick(e) {
      if (e.target instanceof HTMLInputElement && e.target.type === 'file') pickingFile.current = true;
    }
    function onBlur() {
      // Let focus settle: moving into an iframe also blurs the window.
      setTimeout(() => {
        if (document.activeElement?.tagName === 'IFRAME') return;
        if (pickingFile.current) return;
        if (!document.hasFocus()) lock();
      }, 0);
    }
    function onFocus() {
      pickingFile.current = false;
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') lock();
    }
    document.addEventListener('click', onClick, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, lockOnLeave, lock]);

  // Nothing behind the lock can be clicked, typed into or tabbed to.
  useEffect(() => {
    const shell = document.querySelector('.app-shell');
    if (!shell) return undefined;
    shell.inert = locked;
    if (locked) {
      inputRef.current?.focus();
      if (document.hasFocus() && document.visibilityState === 'visible') takePhoto();
      const back = () => {
        inputRef.current?.focus();
        takePhoto();
      };
      const onVisible = () => document.visibilityState === 'visible' && takePhoto();
      window.addEventListener('focus', back);
      document.addEventListener('visibilitychange', onVisible);
      return () => {
        window.removeEventListener('focus', back);
        document.removeEventListener('visibilitychange', onVisible);
        shell.inert = false;
      };
    }
    return undefined;
  }, [locked, takePhoto]);

  async function unlock(e) {
    e.preventDefault();
    if (!password) return;
    setChecking(true);
    setError('');
    try {
      const res = await fetch('/api/auth/app-lock/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, useLoginPassword: useLogin }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      attachPhoto(json.eventId);
      if (!res.ok) throw new Error(json.error || 'Could not unlock.');
      setLocked(false);
      setPassword('');
    } catch (err) {
      setError(err.message);
      setPassword('');
      inputRef.current?.focus();
    } finally {
      setChecking(false);
    }
  }

  async function logOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  if (!enabled || !locked) return null;

  const initial = (user?.name || '?').trim().slice(0, 1).toUpperCase();

  return (
    <div className="app-lock" role="dialog" aria-modal="true" aria-label="MyTrack is locked">
      <form className="app-lock-card" onSubmit={unlock}>
        <span className="avatar app-lock-avatar">{user?.avatar ? <img src={user.avatar} alt="" /> : initial}</span>
        <h2>MyTrack is locked</h2>
        <p className="field-hint">
          {useLogin ? 'Enter your login password to unlock.' : `Enter your app lock password${user?.name ? `, ${user.name.split(' ')[0]}` : ''}.`}
        </p>
        <input
          ref={inputRef}
          className="input"
          type="password"
          autoComplete="off"
          autoFocus
          placeholder={useLogin ? 'Login password' : 'App lock password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="top-error">{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={checking || !password}>
          {checking ? 'Checking…' : '🔓 Unlock'}
        </button>
        <div className="app-lock-links">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setUseLogin((v) => !v);
              setPassword('');
              setError('');
              inputRef.current?.focus();
            }}
          >
            {useLogin ? 'Use app lock password' : 'Forgot it? Use login password'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={logOut}>Log out</button>
        </div>
      </form>
    </div>
  );
}

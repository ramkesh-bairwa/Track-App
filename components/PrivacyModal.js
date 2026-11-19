'use client';

import { useEffect, useState } from 'react';
import { rememberLoginPhotos } from '@/lib/captureSelfie';

export default function PrivacyModal({ onClose }) {
  const [loaded, setLoaded] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [requireDelete, setRequireDelete] = useState(false);
  const [requireEdit, setRequireEdit] = useState(false);
  const [photosOn, setPhotosOn] = useState(true);
  const [photosBusy, setPhotosBusy] = useState(false);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/privacy')
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        setHasPassword(Boolean(json.hasActionPassword));
        setRequireDelete(Boolean(json.requireDelete));
        setRequireEdit(Boolean(json.requireEdit));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    fetch('/api/auth/login-history/settings')
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        setPhotosOn(json.enabled !== false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function togglePhotos(enabled) {
    setError('');
    setNotice('');
    setPhotosBusy(true);
    const previous = photosOn;
    setPhotosOn(enabled); // optimistic
    try {
      const res = await fetch('/api/auth/login-history/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not change it.');
      setPhotosOn(json.enabled);
      rememberLoginPhotos(json.enabled);
    } catch (err) {
      setPhotosOn(previous); // roll back
      setError(err.message);
    } finally {
      setPhotosBusy(false);
    }
  }

  async function patchPrivacy(body) {
    const res = await fetch('/api/auth/privacy', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Could not save privacy settings.');
    setHasPassword(Boolean(json.hasActionPassword));
    setRequireDelete(Boolean(json.requireDelete));
    setRequireEdit(Boolean(json.requireEdit));
  }

  async function handleSavePassword(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!newPassword) return;
    if (newPassword.length < 6) {
      setError('Privacy password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    if (hasPassword && !oldPassword) {
      setError('Enter your current privacy password to change it.');
      return;
    }
    setSaving(true);
    try {
      await patchPrivacy({ oldPassword, newPassword });
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice(hasPassword ? 'Privacy password updated.' : 'Privacy password created.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(key, value) {
    setError('');
    setNotice('');
    try {
      await patchPrivacy({ [key]: value });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Privacy</h2>
        {error && <div className="top-error">{error}</div>}
        {notice && <div className="top-notice">{notice}</div>}

        {loaded && (
          <>
            <form onSubmit={handleSavePassword}>
              <p className="modal-section-title" style={{ paddingTop: 0, borderTop: 'none' }}>
                {hasPassword ? 'Update privacy password' : 'Create a privacy password'}
              </p>
              {!hasPassword && (
                <p className="field-hint" style={{ marginTop: -8, marginBottom: 14 }}>
                  This is separate from your login password. Once set, you can require it for
                  deleting or editing things.
                </p>
              )}
              {hasPassword && (
                <div className="field-group">
                  <label className="field-label" htmlFor="privacy-old-password">Current privacy password</label>
                  <input
                    id="privacy-old-password"
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                  />
                </div>
              )}
              <div className="field-group">
                <label className="field-label" htmlFor="privacy-new-password">
                  {hasPassword ? 'New privacy password' : 'Privacy password'}
                </label>
                <input
                  id="privacy-new-password"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="privacy-confirm-password">Confirm password</label>
                <input
                  id="privacy-confirm-password"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <div className="modal-actions" style={{ justifyContent: 'flex-start', paddingTop: 0 }}>
                <button type="submit" className="btn btn-sm" disabled={saving || !newPassword}>
                  {saving ? 'Saving…' : hasPassword ? 'Update password' : 'Create password'}
                </button>
              </div>
            </form>

            <p className="modal-section-title">Require it for</p>
            <label className="checkbox-row" style={{ marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={requireDelete}
                disabled={!hasPassword}
                onChange={(e) => {
                  setRequireDelete(e.target.checked);
                  handleToggle('requireDelete', e.target.checked);
                }}
              />
              <span>Deleting tracks, columns, or entries</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={requireEdit}
                disabled={!hasPassword}
                onChange={(e) => {
                  setRequireEdit(e.target.checked);
                  handleToggle('requireEdit', e.target.checked);
                }}
              />
              <span>Editing entries or columns</span>
            </label>
            {!hasPassword && (
              <p className="field-hint">Set a privacy password above to turn these on.</p>
            )}

            <p className="modal-section-title">Security camera</p>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={photosOn}
                disabled={photosBusy}
                onChange={(e) => togglePhotos(e.target.checked)}
              />
              <span>Take a camera photo when I sign in, and when MyTrack is opened or unlocked</span>
            </label>
            <p className="field-hint">
              {photosOn
                ? 'Photos are added to your Login history. Turn this off to never use the camera — sign-ins and openings are still recorded, just without a photo.'
                : 'The camera is not used. Sign-ins, openings and unlocks are still recorded in Login history, without a photo.'}
            </p>
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

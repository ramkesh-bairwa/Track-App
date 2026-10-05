'use client';

import { useRef, useState } from 'react';

const MAX_AVATAR_BYTES = 1.5 * 1024 * 1024;

export default function ProfileModal({ user, onClose, onSaved }) {
  const [name, setName] = useState(user?.name || '');
  const [avatar, setAvatar] = useState(user?.avatar || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError('That image is too large. Please pick one under 1.5MB.');
      return;
    }
    setError('');
    const reader = new FileReader();
    reader.onload = () => setAvatar(reader.result);
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (newPassword && newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }
    if (newPassword && newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword && !currentPassword) {
      setError('Enter your current password to set a new one.');
      return;
    }

    const body = {};
    if (name.trim() && name.trim() !== user?.name) body.name = name.trim();
    if (avatar !== (user?.avatar || '')) body.avatar = avatar;
    if (newPassword) {
      body.currentPassword = currentPassword;
      body.newPassword = newPassword;
    }

    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Could not save your profile.');
        setSaving(false);
        return;
      }
      onSaved(json.user);
      onClose();
    } catch {
      setError('Something went wrong. Try again.');
      setSaving(false);
    }
  }

  const initials = (user?.name || '?').trim().slice(0, 1).toUpperCase();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit profile</h2>
        {error && <div className="top-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="profile-avatar-row">
            <span className="avatar avatar-lg">
              {avatar ? <img src={avatar} alt="" /> : initials}
            </span>
            <div className="profile-avatar-actions">
              <button type="button" className="btn btn-sm" onClick={() => fileInputRef.current?.click()}>
                Change photo
              </button>
              {avatar && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAvatar('')}>
                  Remove photo
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
            </div>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="profile-name">Name</label>
            <input
              id="profile-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="profile-email">Email</label>
            <input id="profile-email" className="input" value={user?.email || ''} disabled />
            <p className="field-hint">Email can't be changed yet.</p>
          </div>

          <p className="modal-section-title">Change password</p>
          <div className="field-group">
            <label className="field-label" htmlFor="current-password">Current password</label>
            <input
              id="current-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Leave blank to keep your password"
            />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="new-password">New password</label>
            <input
              id="new-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="confirm-password">Confirm new password</label>
            <input
              id="confirm-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

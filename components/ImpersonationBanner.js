'use client';

import { useState } from 'react';
import '@/components/users/user-admin.css';

// Shown while an admin uses "Open as this user".
export default function ImpersonationBanner({ user, admin }) {
  const [busy, setBusy] = useState(false);
  async function back() {
    setBusy(true);
    const res = await fetch('/api/admin/impersonate/stop', { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    window.location.href = json.userId ? `/dashboard/users/${json.userId}` : '/login';
  }
  return (
    <div className="imp-banner" role="status">
      <span>
        👁 You’re using MyTrack as <strong>{user.name}</strong> ({user.email}). Everything you do is recorded as done by {admin.name}.
      </span>
      <button type="button" className="btn btn-sm" onClick={back} disabled={busy}>
        {busy ? 'Going back…' : 'Back to my account'}
      </button>
    </div>
  );
}

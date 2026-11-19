'use client';

import { useEffect } from 'react';
import { captureSelfie } from '@/lib/captureSelfie';

// Opened by the desktop app in a hidden window when the computer is started,
// unlocked or woken: takes one camera photo and records a system event.
// The app's launch secret comes in the URL hash (never sent to the server
// as part of the URL). Sets the title to "done" so the app can close it.
export default function CapturePhotoPage() {
  useEffect(() => {
    const token = window.location.hash.slice(1);
    const kind = new URLSearchParams(window.location.search).get('kind') || 'system_start';
    (async () => {
      let result = 'error';
      try {
        // The camera can take a moment to be free right after a boot or an
        // unlock — try twice before giving up on the photo.
        let shot = await captureSelfie({ timeoutMs: 10000 });
        if (!shot.photo && ['inuse', 'timeout', 'blank', 'error'].includes(shot.reason)) {
          await new Promise((r) => setTimeout(r, 3000));
          shot = await captureSelfie({ timeoutMs: 10000 });
        }
        const res = await fetch('/api/system-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-mytrack-local': token },
          body: JSON.stringify({ kind, photo: shot.photo || undefined }),
        });
        result = `${shot.photo ? 'saved with photo' : `saved without photo (camera: ${shot.reason})`} · server ${res.status}`;
      } catch (err) {
        result = `error: ${err?.message || err}`;
      } finally {
        document.title = `done:${result}`;
      }
    })();
  }, []);
  return null;
}

'use client';

import { useEffect } from 'react';
import { captureSelfie } from '@/lib/captureSelfie';

// Desktop app: each time a MyTrack window opens, take a security photo of
// whoever is in front of it and add it to Login history. Once per window
// (sessionStorage starts empty in every new window).
export default function DesktopOpenPhoto() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem('mytrack-open-photo')) return;
      sessionStorage.setItem('mytrack-open-photo', '1');
    } catch {
      return;
    }
    const timer = setTimeout(async () => {
      const { photo } = await captureSelfie().catch(() => ({ photo: null }));
      fetch('/api/auth/app-open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo: photo || undefined }),
      }).catch(() => {});
    }, 1200);
    return () => clearTimeout(timer);
  }, []);
  return null;
}

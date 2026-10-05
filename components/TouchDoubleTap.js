'use client';

import { useEffect } from 'react';

// Phones don't reliably fire `dblclick` (iOS Safari never does), so every
// "double-click to edit" in the app was unreachable on touch screens. This
// turns two quick taps on the same spot into a real dblclick event, which
// React's onDoubleClick handlers pick up like a mouse double-click.
const MAX_DELAY = 350; // ms between the two taps
const MAX_DISTANCE = 30; // px the second tap may land from the first
const SKIP = 'input, textarea, select, [contenteditable="true"], .ProseMirror';

export default function TouchDoubleTap() {
  useEffect(() => {
    let last = null; // { time, x, y, target }
    let moved = false;
    let lastSynth = 0;

    function onTouchStart(e) {
      moved = e.touches.length > 1;
    }
    function onTouchMove() {
      moved = true;
    }
    function onTouchEnd(e) {
      const touch = e.changedTouches[0];
      if (moved || !touch || e.touches.length > 0) {
        last = null;
        return;
      }
      const target = e.target instanceof Element ? e.target : null;
      if (!target || target.closest(SKIP)) {
        last = null;
        return;
      }
      const now = Date.now();
      const isDouble =
        last &&
        now - last.time <= MAX_DELAY &&
        Math.hypot(touch.clientX - last.x, touch.clientY - last.y) <= MAX_DISTANCE &&
        (last.target === target || last.target.contains(target) || target.contains(last.target));

      if (!isDouble) {
        last = { time: now, x: touch.clientX, y: touch.clientY, target };
        return;
      }
      last = null;
      // Let the second tap's click run first, as with a mouse (click, click, dblclick).
      setTimeout(() => {
        if (!target.isConnected) return;
        lastSynth = Date.now();
        target.dispatchEvent(
          new MouseEvent('dblclick', {
            bubbles: true,
            cancelable: true,
            view: window,
            detail: 2,
            clientX: touch.clientX,
            clientY: touch.clientY,
          })
        );
      }, 0);
    }
    // Some mobile browsers do send their own dblclick; drop it if we just sent one.
    function onNativeDblClick(e) {
      if (e.isTrusted && Date.now() - lastSynth < 600) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('dblclick', onNativeDblClick, true);
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('dblclick', onNativeDblClick, true);
    };
  }, []);

  return null;
}

'use client';

import { useEffect, useRef } from 'react';

// Thin progress line across the top of the page while something the user
// started is in flight: a page navigation, or any request fired within a
// moment of a click / submit / Enter / select change (saves, deletes, loads).
// Background traffic — 30s polling, focus refreshes, location heartbeats,
// typing autosave — starts outside that window and never shows the bar.
const ACTION_WINDOW = 1000; // ms after a user action that a fetch still counts as "theirs"
const MIN_VISIBLE = 250; // keep the bar up at least this long so it doesn't just flicker
const MAX_PENDING = 15000; // give up on an op that never settles (e.g. navigation to the same URL)

export default function TopLoader() {
  const barRef = useRef(null);

  useEffect(() => {
    const bar = barRef.current;
    let active = 0;
    let progress = 0;
    let shownAt = 0;
    let trickle = null;
    let hideTimer = null;
    let lastAction = 0;
    let navPending = false;
    let navTimer = null;

    const render = () => {
      bar.style.transform = `scaleX(${progress})`;
    };

    const show = () => {
      clearTimeout(hideTimer);
      if (trickle) return;
      shownAt = Date.now();
      progress = 0.08;
      bar.style.transition = 'none';
      render();
      bar.getBoundingClientRect(); // restart from the left before animating
      bar.style.transition = '';
      bar.classList.add('is-active');
      trickle = setInterval(() => {
        // creep toward 90% — fast at first, slower the closer it gets
        progress += (0.9 - progress) * 0.12;
        render();
      }, 200);
    };

    const finish = () => {
      const wait = Math.max(0, MIN_VISIBLE - (Date.now() - shownAt));
      hideTimer = setTimeout(() => {
        clearInterval(trickle);
        trickle = null;
        progress = 1;
        render();
        hideTimer = setTimeout(() => {
          bar.classList.remove('is-active');
          hideTimer = setTimeout(() => {
            progress = 0;
            bar.style.transition = 'none';
            render();
          }, 300);
        }, 200);
      }, wait);
    };

    const begin = () => {
      active += 1;
      if (active === 1) show();
    };
    const end = () => {
      active = Math.max(0, active - 1);
      if (active === 0) finish();
    };

    const startNav = () => {
      if (navPending) return;
      navPending = true;
      begin();
      navTimer = setTimeout(endNav, MAX_PENDING);
    };
    function endNav() {
      if (!navPending) return;
      navPending = false;
      clearTimeout(navTimer);
      end();
    }

    // --- user actions ------------------------------------------------------
    const markAction = () => {
      lastAction = Date.now();
    };
    const onKeyDown = (e) => {
      if (e.key === 'Enter') markAction();
    };

    const onClick = (e) => {
      markAction();
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.('a[href]');
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      // same page (or just a #hash jump) — nothing will load
      if (url.pathname === location.pathname && url.search === location.search) return;
      startNav();
    };

    // --- navigation completes when Next commits the new URL -----------------
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    const wrapHistory = (orig) =>
      function (state, title, url) {
        const before = location.pathname + location.search;
        const result = orig.apply(this, arguments);
        if (url != null && location.pathname + location.search !== before) endNav();
        return result;
      };
    history.pushState = wrapHistory(origPush);
    history.replaceState = wrapHistory(origReplace);

    const onPopState = () => {
      // back/forward: the URL has already changed; show the bar while the page loads
      startNav();
      setTimeout(endNav, 400);
    };

    // --- requests the user started -------------------------------------------
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      const track =
        Date.now() - lastAction < ACTION_WINDOW &&
        !init?.keepalive && // unload-time saves
        !headers.has('Next-Router-Prefetch'); // Next prefetching links in the background
      if (!track) return origFetch.apply(window, arguments);
      begin();
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          end();
        }
      };
      const guard = setTimeout(done, MAX_PENDING);
      return origFetch.apply(window, arguments).finally(() => {
        clearTimeout(guard);
        done();
      });
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', markAction, true);
    document.addEventListener('change', markAction, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('popstate', onPopState);

    return () => {
      window.fetch = origFetch;
      history.pushState = origPush;
      history.replaceState = origReplace;
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('submit', markAction, true);
      document.removeEventListener('change', markAction, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('popstate', onPopState);
      clearInterval(trickle);
      clearTimeout(hideTimer);
      clearTimeout(navTimer);
    };
  }, []);

  return <div ref={barRef} className="top-loader" aria-hidden="true" />;
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// "Share from this device": while the IMEI tab is open on a phone or laptop,
// its GPS position is sent to /api/devices/<id>/location so the device shows
// up on the map elsewhere. Browsers stop this when the tab closes or the
// phone locks, so the screen is kept awake while sharing.

const STORE_KEY = 'mytrack.sharingDevice';
const MIN_INTERVAL_MS = 20000; // at most one report per 20 s…
const MIN_MOVE_M = 25; // …unless the device moved this far
const HEARTBEAT_MS = 30000; // resend the last fix so a still device stays "online"

const GEO_ERRORS = {
  1: 'Location permission was denied. Allow location for this site in the browser settings, then share again.',
  2: 'This device can’t get a location fix right now (no GPS or Wi‑Fi). Still trying…',
  3: 'Waiting for a location fix…',
};

// Metres between two lat/lon points (haversine).
function distance(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const readStored = () => {
  try {
    return Number(localStorage.getItem(STORE_KEY)) || null;
  } catch {
    return null;
  }
};
const writeStored = (id) => {
  try {
    if (id) localStorage.setItem(STORE_KEY, String(id));
    else localStorage.removeItem(STORE_KEY);
  } catch {}
};

// Returns { sharingId, status, start(id), stop() }. `onSent` runs after each report.
export function useDeviceSharing({ deviceIds, onSent }) {
  const [sharingId, setSharingId] = useState(null);
  const [status, setStatus] = useState(null); // { text, bad, sentAt, accuracy }
  const watchRef = useRef(null);
  const heartbeatRef = useRef(null);
  const lockRef = useRef(null);
  const fixRef = useRef(null); // latest { lat, lon, accuracy }
  const sentRef = useRef(null); // last sent { lat, lon, t }
  const idRef = useRef(null);
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;

  const keepAwake = useCallback(async () => {
    try {
      if (navigator.wakeLock && document.visibilityState === 'visible' && !lockRef.current) {
        lockRef.current = await navigator.wakeLock.request('screen');
        lockRef.current.addEventListener('release', () => {
          lockRef.current = null;
        });
      }
    } catch {}
  }, []);

  const stop = useCallback((message) => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    clearInterval(heartbeatRef.current);
    lockRef.current?.release().catch(() => {});
    watchRef.current = null;
    heartbeatRef.current = null;
    lockRef.current = null;
    fixRef.current = null;
    sentRef.current = null;
    idRef.current = null;
    writeStored(null);
    setSharingId(null);
    setStatus(message ? { text: message, bad: true } : null);
  }, []);

  const send = useCallback(async () => {
    const id = idRef.current;
    const fix = fixRef.current;
    if (!id || !fix) return;
    sentRef.current = { ...fix, t: Date.now() };
    try {
      const res = await fetch(`/api/devices/${id}/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: fix.lat, longitude: fix.lon, accuracy: fix.accuracy }),
      });
      if (res.status === 401) return stop('You were signed out, so sharing stopped. Sign in and share again.');
      if (res.status === 404) return stop('This device was removed from My devices, so sharing stopped.');
      if (!res.ok) throw new Error();
      setStatus({ text: 'Sharing', sentAt: Date.now(), accuracy: fix.accuracy });
      onSentRef.current?.();
    } catch {
      setStatus((s) => ({ ...s, text: 'Couldn’t reach MyTrack — will retry.', bad: true }));
    }
  }, [stop]);

  const start = useCallback(
    (id) => {
      if (!window.isSecureContext) {
        setStatus({ text: 'Browsers only share location over HTTPS or on localhost. Open MyTrack through an https:// address on this device.', bad: true });
        return;
      }
      if (!navigator.geolocation) {
        setStatus({ text: 'This browser can’t share its location.', bad: true });
        return;
      }
      if (watchRef.current != null) stop();
      idRef.current = id;
      writeStored(id);
      setSharingId(id);
      setStatus({ text: 'Getting a location fix…' });
      watchRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const fix = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };
          fixRef.current = fix;
          const last = sentRef.current;
          if (!last || Date.now() - last.t >= MIN_INTERVAL_MS || distance(last, fix) >= MIN_MOVE_M) send();
        },
        (err) => {
          if (err.code === 1) stop(GEO_ERRORS[1]);
          else setStatus((s) => ({ ...s, text: GEO_ERRORS[err.code] || err.message, bad: err.code === 2 }));
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
      );
      heartbeatRef.current = setInterval(() => {
        if (sentRef.current && Date.now() - sentRef.current.t >= HEARTBEAT_MS - 1000) send();
      }, HEARTBEAT_MS);
      keepAwake();
    },
    [keepAwake, send, stop]
  );

  // Pick sharing back up when this page is reopened on the same device.
  useEffect(() => {
    if (!deviceIds || idRef.current) return;
    const stored = readStored();
    if (stored && deviceIds.includes(stored)) start(stored);
    else if (stored) writeStored(null);
  }, [deviceIds, start]);

  // The screen wake lock is dropped whenever the tab is hidden; take it again on return.
  useEffect(() => {
    const onVisible = () => {
      if (idRef.current && document.visibilityState === 'visible') {
        keepAwake();
        send();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [keepAwake, send]);

  // Stop the GPS watch (but keep the "resume" flag) when leaving the page.
  useEffect(
    () => () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      clearInterval(heartbeatRef.current);
      lockRef.current?.release().catch(() => {});
    },
    []
  );

  return { sharingId, status, start, stop: () => stop() };
}

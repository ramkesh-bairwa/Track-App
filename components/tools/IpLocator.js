'use client';

import { useState } from 'react';
import ImeiPanel from './ImeiPanel';
import TileMap from './TileMap';
import './ip-locator.css';


const GPS_ERRORS = {
  1: 'Location permission was denied. Allow location for this site in the browser’s settings, then try again.',
  2: 'This device couldn’t work out its location (no GPS or Wi‑Fi fix). Try again outdoors or with Wi‑Fi on.',
  3: 'Timed out waiting for a location fix. Try again.',
};

// The device's own position from the browser (GPS on phones, Wi‑Fi/IP on laptops).
function readGps() {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) {
      reject(new Error('The browser only shares GPS location over HTTPS or on localhost. On a phone, open MyTrack through an https:// address.'));
      return;
    }
    if (!navigator.geolocation) {
      reject(new Error('This browser can’t share its location.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      (err) => reject(new Error(GPS_ERRORS[err.code] || err.message || 'Couldn’t get the location.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}

const formatMetres = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

async function api(body) {
  const res = await fetch('/api/tools/ip-locator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Something went wrong.');
  return json;
}

function Row({ label, value, mono }) {
  if (value == null || value === '') return null;
  return (
    <div className="ipl-row">
      <dt>{label}</dt>
      <dd className={mono ? 'tool-mono' : undefined}>{value}</dd>
    </div>
  );
}

export default function IpLocator() {
  const [mode, setMode] = useState('ip'); // 'ip' | 'imei'
  const [ip, setIp] = useState('');
  const [busy, setBusy] = useState(null); // 'ip' | 'self' | 'gps'
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [zoom, setZoom] = useState(11);
  const [copied, setCopied] = useState(false);

  async function lookup(self) {
    if (busy || (!self && !ip.trim())) return;
    setBusy(self ? 'self' : 'ip');
    setError('');
    setCopied(false);
    try {
      const json = await api(self ? {} : { ip: ip.trim() });
      setResult(json);
      setZoom(json.localNetwork ? 10 : 11);
      if (self) setIp(json.ip);
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setBusy(null);
    }
  }

  async function locateDevice() {
    if (busy) return;
    setBusy('gps');
    setError('');
    setCopied(false);
    try {
      const pos = await readGps();
      const { latitude, longitude, accuracy, altitude } = pos.coords;
      setResult({ gps: true, latitude, longitude, accuracy, altitude, at: pos.timestamp });
      setZoom(accuracy > 2000 ? 12 : 16);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const hasCoords = result && result.latitude != null && result.longitude != null;
  const coords = hasCoords ? `${result.latitude.toFixed(6)}, ${result.longitude.toFixed(6)}` : '';
  const place = result ? [result.city, result.region, result.country].filter(Boolean).join(', ') : '';

  async function copyCoords() {
    try {
      await navigator.clipboard.writeText(coords);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <div className="ipl">
      <div className="ipl-tabs" role="tablist" aria-label="Look up by">
        <button type="button" role="tab" aria-selected={mode === 'ip'} className={mode === 'ip' ? 'active' : ''} onClick={() => setMode('ip')}>
          <i className="fa-solid fa-network-wired" aria-hidden="true" /> IP address
        </button>
        <button type="button" role="tab" aria-selected={mode === 'imei'} className={mode === 'imei' ? 'active' : ''} onClick={() => setMode('imei')}>
          <i className="fa-solid fa-mobile-screen" aria-hidden="true" /> IMEI number
        </button>
      </div>

      {mode === 'imei' ? <ImeiPanel /> : (
      <>
      <form
        className="tool-panel"
        onSubmit={(e) => {
          e.preventDefault();
          lookup(false);
        }}
      >
        <div className="ipl-form">
          <div className="ipl-input">
            <label className="field-label" htmlFor="ipl-ip">IP address</label>
            <input
              id="ipl-ip"
              className="input tool-mono"
              type="text"
              placeholder="e.g. 8.8.8.8 or 2001:4860:4860::8888"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={!!busy || !ip.trim()}>
            <i className={`fa-solid ${busy === 'ip' ? 'fa-spinner fa-spin' : 'fa-magnifying-glass-location'}`} aria-hidden="true" /> Locate
          </button>
          <button type="button" className="btn" onClick={() => lookup(true)} disabled={!!busy}>
            <i className={`fa-solid ${busy === 'self' ? 'fa-spinner fa-spin' : 'fa-house-signal'}`} aria-hidden="true" /> Use my IP
          </button>
        </div>
        <p className="tool-muted ipl-hint">
          An IP address only gives an approximate location — the city or your provider’s nearest hub, sometimes tens of km off. The IP a phone or laptop
          shows in its Wi‑Fi settings (192.168.x.x, 10.x.x.x…) is a local address with no location of its own; it’s located through your network’s public IP.
        </p>
        <div className="ipl-gps">
          <div>
            <strong>Need the real GPS position of a phone or laptop?</strong>
            <span className="tool-muted">Open this page on that device and press the button — the browser will ask for permission.</span>
          </div>
          <button type="button" className="btn" onClick={locateDevice} disabled={!!busy}>
            <i className={`fa-solid ${busy === 'gps' ? 'fa-spinner fa-spin' : 'fa-satellite-dish'}`} aria-hidden="true" /> Use this device’s GPS
          </button>
        </div>
      </form>

      {error && <div className="top-error" role="alert">{error}</div>}

      {result && (
        <div className="ipl-result">
          <div className="tool-panel ipl-details">
            {result.gps ? (
              <div className="ipl-head">
                <span className="ipl-flag" aria-hidden="true"><i className="fa-solid fa-satellite-dish" /></span>
                <div>
                  <strong>This device</strong>
                  <div className="tool-muted">Browser location · accurate to about {formatMetres(result.accuracy)}</div>
                </div>
              </div>
            ) : (
              <div className="ipl-head">
                <span className="ipl-flag" aria-hidden="true">{result.flag || <i className="fa-solid fa-globe" />}</span>
                <div>
                  <strong className="tool-mono">{result.localNetwork ? result.localNetwork.typed : result.ip}</strong>
                  <div className="tool-muted">
                    {place || 'Unknown place'}
                    {result.self && ' · your public IP'}
                  </div>
                </div>
              </div>
            )}
            {result.localNetwork && (
              <div className="ipl-note">
                {result.localNetwork.loopback ? (
                  <><span className="tool-mono">{result.localNetwork.typed}</span> means “this computer”, so this is the location of the network MyTrack is on.</>
                ) : (
                  <>
                    <span className="tool-mono">{result.localNetwork.typed}</span> is a local network address, so it has no location of its own. Shown instead: your
                    network’s public IP <span className="tool-mono">{result.ip}</span> — right if that device is on the same Wi‑Fi as MyTrack. For a phone on mobile
                    data, look up the public IP it shows on a “what is my IP” site, or use its GPS below.
                  </>
                )}
              </div>
            )}
            {hasCoords && (
              <div className="ipl-coords">
                <div>
                  <span className="tool-muted">{result.gps ? 'GPS coordinates' : 'Approx. coordinates'}</span>
                  <div className="tool-mono ipl-coord-text">{coords}</div>
                </div>
                <button type="button" className="btn btn-sm" onClick={copyCoords}>
                  <i className={`fa-solid ${copied ? 'fa-check' : 'fa-copy'}`} aria-hidden="true" /> {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
            <dl className="ipl-rows">
              <Row label="Accuracy" value={result.gps ? `± ${formatMetres(result.accuracy)}` : null} />
              <Row label="Altitude" value={result.gps && result.altitude != null ? `${Math.round(result.altitude)} m` : null} />
              <Row label="Read at" value={result.gps ? new Date(result.at).toLocaleTimeString() : null} />
              <Row label="City" value={result.city} />
              <Row label="Region" value={result.region} />
              <Row label="Postal code" value={result.postal} />
              <Row label="Country" value={result.country && `${result.country}${result.countryCode ? ` (${result.countryCode})` : ''}`} />
              <Row label="Continent" value={result.continent} />
              <Row label="Timezone" value={result.timezone && `${result.timezone}${result.utcOffset ? ` (UTC${result.utcOffset})` : ''}`} />
              <Row label="ISP" value={result.isp} />
              <Row label="Organisation" value={result.org !== result.isp ? result.org : null} />
              <Row label="ASN" value={result.asn != null ? `AS${result.asn}` : null} mono />
              <Row label="Type" value={result.type} />
            </dl>
            {hasCoords && (
              <div className="tool-row ipl-links">
                <a className="btn btn-sm btn-ghost" href={`https://www.google.com/maps?q=${result.latitude},${result.longitude}`} target="_blank" rel="noopener noreferrer">
                  <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" /> Google Maps
                </a>
                <a
                  className="btn btn-sm btn-ghost"
                  href={`https://www.openstreetmap.org/?mlat=${result.latitude}&mlon=${result.longitude}#map=${zoom}/${result.latitude}/${result.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" /> OpenStreetMap
                </a>
              </div>
            )}
          </div>

          {hasCoords && (
            <div className="tool-panel ipl-map-panel">
              <TileMap lat={result.latitude} lon={result.longitude} zoom={zoom} accuracy={result.gps ? result.accuracy : undefined} viewKey={result.gps ? `gps:${result.at}` : `ip:${result.ip}`} />
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}

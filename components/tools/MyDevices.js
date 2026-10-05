'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import { checkImei } from '@/lib/imei';
import TileMap from './TileMap';
import { useDeviceSharing } from './useDeviceSharing';

// "My devices" on the IMEI tab: the user's own phones/laptops and their IMEIs,
// saved so they're ready for a police complaint or a CEIR block — and, when a
// device shares its location from this page, where it is on a map.

const ONLINE_MS = 90 * 1000; // reported within this long → "Online"
const POLL_MS = 15000;

async function api(url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Something went wrong.');
  return json;
}

const EMPTY = { name: '', imei: '', imei2: '', notes: '' };
const spaced = (imei) => imei.replace(/^(\d{2})(\d{6})(\d{6})(\d)$/, '$1 $2 $3 $4');

function ago(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

const formatMetres = (m) => (m == null ? '' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const hasLocation = (d) => d.last_lat != null && d.last_lon != null;
const seenAgo = (d) => (d.last_seen_at ? Date.now() - new Date(d.last_seen_at).getTime() : Infinity);

function Presence({ device, sharingHere }) {
  if (sharingHere) return <span className="tool-badge ok"><i className="fa-solid fa-satellite-dish" aria-hidden="true" /> Sharing from here</span>;
  if (!hasLocation(device)) return <span className="tool-badge">Location never shared</span>;
  const age = seenAgo(device);
  if (age < ONLINE_MS) return <span className="tool-badge ok"><span className="ipl-dot" aria-hidden="true" /> Online</span>;
  return <span className="tool-badge warn">Last seen {ago(age)}</span>;
}

function ImeiHint({ value }) {
  const r = checkImei(value);
  if (!r) return null;
  return <span className={`ipl-field-hint${r.ok ? ' ok' : ' bad'}`}>{r.ok ? `✓ ${r.parts.imei}` : r.message}</span>;
}

export default function MyDevices({ onUse }) {
  const [devices, setDevices] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(null); // { id?, name, imei, imei2, notes } while adding/editing
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [copied, setCopied] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [zoom, setZoom] = useState(16);
  const [, tick] = useState(0);

  const reload = useCallback(
    () =>
      api('/api/devices')
        .then(({ devices: list }) => {
          setDevices(list);
          setLoadError('');
        })
        .catch((err) => setLoadError(err.message)),
    []
  );

  useEffect(() => {
    reload();
  }, [reload]);

  // Keep locations and "Online / Last seen" fresh while the page is visible.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
      tick((n) => n + 1);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [reload]);

  const deviceIds = useMemo(() => devices?.map((d) => d.id) ?? null, [devices]);
  const sharing = useDeviceSharing({ deviceIds, onSent: reload });
  const selected = devices?.find((d) => d.id === selectedId && hasLocation(d)) || null;

  const locate = (d) => {
    setSelectedId(d.id);
    setZoom(d.last_accuracy > 2000 ? 12 : 16);
    requestAnimationFrame(() => document.getElementById('ipl-dev-map')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const openForm = (device) => {
    setFormError('');
    setForm(device ? { id: device.id, name: device.name, imei: device.imei, imei2: device.imei2 || '', notes: device.notes || '' } : EMPTY);
  };

  async function save(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError('');
    const body = { name: form.name, imei: form.imei, imei2: form.imei2, notes: form.notes };
    try {
      if (form.id) {
        const { device } = await api(`/api/devices/${form.id}`, 'PATCH', body);
        setDevices((list) => list.map((d) => (d.id === device.id ? device : d)));
      } else {
        const { device } = await api('/api/devices', 'POST', body);
        setDevices((list) => [...list, device].sort((a, b) => a.name.localeCompare(b.name)));
      }
      setForm(null);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function copy(imei) {
    try {
      await navigator.clipboard.writeText(imei);
      setCopied(imei);
      setTimeout(() => setCopied(''), 1500);
    } catch {}
  }

  const use = (imei) => {
    onUse(imei);
    document.getElementById('ipl-imei')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const ImeiLine = ({ label, imei }) => (
    <div className="ipl-dev-imei">
      <span className="tool-muted">{label}</span>
      <span className="tool-mono">{spaced(imei)}</span>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => copy(imei)} title="Copy IMEI" aria-label={`Copy ${label}`}>
        <i className={`fa-solid ${copied === imei ? 'fa-check' : 'fa-copy'}`} aria-hidden="true" />
      </button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => use(imei)} title="Check this IMEI and see what to do if it’s lost">
        Use
      </button>
    </div>
  );

  return (
    <div className="tool-panel">
      <div className="ipl-dev-head">
        <div>
          <h2>My devices</h2>
          <p className="tool-muted">Save your phones’ IMEIs now — you’ll need them for a police complaint or to block a lost phone, and you can’t dial *#06# on a phone you don’t have.</p>
        </div>
        {!form && devices && !loadError && (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => openForm(null)}>
            <i className="fa-solid fa-plus" aria-hidden="true" /> Add device
          </button>
        )}
      </div>

      {loadError && <div className="top-error" role="alert">{loadError}</div>}
      {!devices && !loadError && <div className="tool-muted">Loading…</div>}

      {form && (
        <form className="ipl-dev-form" onSubmit={save}>
          <div className="ipl-dev-grid">
            <div>
              <label className="field-label" htmlFor="dev-name">Device name</label>
              <input id="dev-name" className="input" value={form.name} onChange={set('name')} placeholder="e.g. My Pixel 8" maxLength={100} autoFocus />
            </div>
            <div>
              <label className="field-label" htmlFor="dev-imei">IMEI</label>
              <input id="dev-imei" className="input tool-mono" inputMode="numeric" value={form.imei} onChange={set('imei')} placeholder="15 digits — dial *#06#" maxLength={24} autoComplete="off" />
              <ImeiHint value={form.imei} />
            </div>
            <div>
              <label className="field-label" htmlFor="dev-imei2">Second IMEI <span className="tool-muted">(dual-SIM, optional)</span></label>
              <input id="dev-imei2" className="input tool-mono" inputMode="numeric" value={form.imei2} onChange={set('imei2')} placeholder="15 digits" maxLength={24} autoComplete="off" />
              <ImeiHint value={form.imei2} />
            </div>
            <div>
              <label className="field-label" htmlFor="dev-notes">Notes <span className="tool-muted">(optional)</span></label>
              <input id="dev-notes" className="input" value={form.notes} onChange={set('notes')} placeholder="Colour, purchase date, invoice no.…" maxLength={300} />
            </div>
          </div>
          {formError && <div className="top-error" role="alert">{formError}</div>}
          <div className="tool-row">
            <button type="submit" className="btn btn-sm btn-primary" disabled={saving || !form.name.trim() || !checkImei(form.imei)?.ok}>
              <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`} aria-hidden="true" /> {form.id ? 'Save changes' : 'Save device'}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setForm(null)} disabled={saving}>Cancel</button>
          </div>
        </form>
      )}

      {!sharing.sharingId && sharing.status?.bad && <div className="top-error" role="alert">{sharing.status.text}</div>}
      {devices && devices.length === 0 && !form && <div className="tool-empty">No devices saved yet.</div>}
      {devices && devices.length > 0 && (
        <div className="ipl-dev-list">
          {devices.map((d) => (
            <div key={d.id} className="ipl-dev">
              <span className="ipl-dev-icon" aria-hidden="true"><i className="fa-solid fa-mobile-screen" /></span>
              <div className="ipl-dev-main">
                <strong>{d.name}</strong>
                <ImeiLine label={d.imei2 ? 'IMEI 1' : 'IMEI'} imei={d.imei} />
                {d.imei2 && <ImeiLine label="IMEI 2" imei={d.imei2} />}
                {d.notes && <div className="tool-muted ipl-dev-notes">{d.notes}</div>}
                <div className="ipl-dev-status">
                  <Presence device={d} sharingHere={sharing.sharingId === d.id} />
                  {hasLocation(d) && (
                    <button type="button" className={`btn btn-sm${selectedId === d.id ? ' btn-primary' : ''}`} onClick={() => locate(d)}>
                      <i className="fa-solid fa-location-crosshairs" aria-hidden="true" /> Locate
                    </button>
                  )}
                  {sharing.sharingId === d.id ? (
                    <button type="button" className="btn btn-sm btn-danger" onClick={sharing.stop}>
                      <i className="fa-solid fa-stop" aria-hidden="true" /> Stop sharing
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => sharing.start(d.id)}
                      title="Open this page on that phone or laptop and press this there"
                    >
                      <i className="fa-solid fa-satellite-dish" aria-hidden="true" /> Share from this device
                    </button>
                  )}
                </div>
                {sharing.sharingId === d.id && sharing.status && (
                  <div className={`ipl-dev-share${sharing.status.bad ? ' bad' : ''}`} role="status">
                    {sharing.status.text}
                    {sharing.status.sentAt && ` · last sent ${new Date(sharing.status.sentAt).toLocaleTimeString()}`}
                    {sharing.status.accuracy != null && ` · ±${formatMetres(sharing.status.accuracy)}`}
                    {!sharing.status.bad && ' · keep this page open'}
                  </div>
                )}
              </div>
              <div className="ipl-dev-actions">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => openForm(d)} title="Edit" aria-label={`Edit ${d.name}`}>
                  <i className="fa-solid fa-pen" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  title="Delete"
                  aria-label={`Delete ${d.name}`}
                  onClick={() =>
                    setConfirm({
                      title: 'Delete device?',
                      message: `“${d.name}” and its IMEI will be removed from MyTrack.`,
                      onConfirm: async () => {
                        await api(`/api/devices/${d.id}`, 'DELETE');
                        setDevices((list) => list.filter((x) => x.id !== d.id));
                        if (form?.id === d.id) setForm(null);
                      },
                    })
                  }
                >
                  <i className="fa-solid fa-trash" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="ipl-dev-map" id="ipl-dev-map">
          <div className="ipl-dev-map-head">
            <div>
              <strong>{selected.name}</strong>
              <div className="tool-muted">
                {seenAgo(selected) < ONLINE_MS ? 'Online now' : `Last seen ${ago(seenAgo(selected))}`}
                {selected.last_accuracy != null && ` · accurate to about ${formatMetres(selected.last_accuracy)}`}
                {selected.last_ip && <> · IP <span className="tool-mono">{selected.last_ip}</span></>}
              </div>
              <div className="tool-mono ipl-coord-text">{selected.last_lat.toFixed(6)}, {selected.last_lon.toFixed(6)}</div>
            </div>
            <div className="tool-row">
              <a className="btn btn-sm btn-ghost" href={`https://www.google.com/maps?q=${selected.last_lat},${selected.last_lon}`} target="_blank" rel="noopener noreferrer">
                <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" /> Google Maps
              </a>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() =>
                  setConfirm({
                    title: 'Forget location?',
                    message: `The last location saved for “${selected.name}” will be cleared. If it’s still sharing, it will reappear on its next report.`,
                    confirmLabel: 'Forget',
                    onConfirm: async () => {
                      await api(`/api/devices/${selected.id}/location`, 'DELETE');
                      setSelectedId(null);
                      await reload();
                    },
                  })
                }
              >
                <i className="fa-solid fa-eraser" aria-hidden="true" /> Forget location
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelectedId(null)} aria-label="Close map">
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="ipl-map-panel ipl-dev-map-frame">
            <TileMap lat={selected.last_lat} lon={selected.last_lon} zoom={zoom} accuracy={selected.last_accuracy} label={selected.name} viewKey={`device:${selected.id}`} />
          </div>
        </div>
      )}

      {devices?.length > 0 && (
        <p className="tool-muted ipl-hint">
          To put a phone or laptop on the map, open this page <strong>on that device</strong>, signed in to your account, and press <em>Share from this device</em>.
          It reports its location while the page stays open (the screen is kept on); closing the tab or locking the phone stops it, and the map then shows where it
          was last seen. Phones need MyTrack over HTTPS for this.
        </p>
      )}

      {confirm && <ConfirmModal danger confirmLabel="Delete" {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

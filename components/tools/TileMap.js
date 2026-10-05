'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

// Interactive OpenStreetMap view (Leaflet): drag to pan, wheel / pinch /
// double-click / +− to zoom. A pin marks the point, with a circle for its
// accuracy when known. The view re-centres when `lat`/`lon`/`zoom` or
// `viewKey` change; later position updates with the same `viewKey` just move
// the pin, so a user who panned or zoomed isn't thrown back.

const pinIcon = (L, label) =>
  L.divIcon({
    className: 'ipl-leaflet-pin',
    html: `${label ? `<span class="ipl-pin-label"></span>` : ''}<i class="fa-solid fa-location-dot"></i>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
  });

export default function TileMap({ lat, lon, zoom = 13, accuracy, label, viewKey }) {
  const boxRef = useRef(null);
  const mapRef = useRef(null); // { L, map, marker, circle }
  const viewRef = useRef(null);

  // Create the map once (Leaflet needs `window`, so it's loaded on the client only).
  useEffect(() => {
    let cancelled = false;
    import('leaflet').then((mod) => {
      if (cancelled || !boxRef.current || mapRef.current) return;
      const L = mod.default || mod;
      const map = L.map(boxRef.current, { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView([lat, lon], zoom);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      }).addTo(map);
      const marker = L.marker([lat, lon], { icon: pinIcon(L, label), keyboard: false }).addTo(map);
      mapRef.current = { L, map, marker, circle: null, label };
      viewRef.current = viewKey ?? `${lat},${lon},${zoom}`;
      sync();
    });
    return () => {
      cancelled = true;
      mapRef.current?.map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move the pin / accuracy circle, and re-centre when the view key changes.
  function sync() {
    const m = mapRef.current;
    if (!m) return;
    const { L, map, marker } = m;
    marker.setLatLng([lat, lon]);
    if (m.label !== label) {
      m.label = label;
      marker.setIcon(pinIcon(L, label));
    }
    const labelEl = marker.getElement()?.querySelector('.ipl-pin-label');
    if (labelEl && labelEl.textContent !== label) labelEl.textContent = label; // set as text, never HTML
    if (accuracy > 0) {
      if (m.circle) m.circle.setLatLng([lat, lon]).setRadius(accuracy);
      else m.circle = L.circle([lat, lon], { radius: accuracy, color: '#3b82f6', weight: 1.5, fillOpacity: 0.15, interactive: false }).addTo(map);
    } else if (m.circle) {
      m.circle.remove();
      m.circle = null;
    }
    const key = viewKey ?? `${lat},${lon},${zoom}`;
    if (key !== viewRef.current) {
      viewRef.current = key;
      map.setView([lat, lon], zoom);
    }
  }

  useEffect(sync); // cheap; runs after every render with the latest props

  return (
    <div className="ipl-map-wrap">
      <div ref={boxRef} className="ipl-map" role="application" aria-label={`Map around ${lat.toFixed(4)}, ${lon.toFixed(4)}`} />
      <button
        type="button"
        className="ipl-recenter"
        onClick={() => mapRef.current?.map.setView([lat, lon], Math.max(mapRef.current.map.getZoom(), zoom))}
        title="Centre on the pin"
        aria-label="Centre on the pin"
      >
        <i className="fa-solid fa-crosshairs" aria-hidden="true" />
      </button>
    </div>
  );
}

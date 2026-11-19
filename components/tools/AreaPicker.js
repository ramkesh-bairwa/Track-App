'use client';

import { useEffect, useRef, useState } from 'react';
import './screenshot-tool.css';

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// Browser "Selected area": the captured screen fills the whole display
// (full screen); drag a box anywhere on it. Click = keep everything.
// onDone(canvas, box) — canvas: the chosen part; box: { x, y, width, height }
// in image pixels, or null for the whole image.
export default function AreaPicker({ image, onDone, onCancel }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const [start, setStart] = useState(null);
  const [box, setBox] = useState(null);
  const [cursor, setCursor] = useState(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    const el = wrap.current;
    el.requestFullscreen?.().catch(() => {});
    el.focus();
    const c = canvas.current;
    c.width = image.width;
    c.height = image.height;
    c.getContext('2d').drawImage(image, 0, 0);
    const onFs = () => {
      if (!document.fullscreenElement) cancelRef.current();
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [image]);

  // Where the picture sits on screen (it's letter-boxed to fit).
  function layout() {
    const r = wrap.current.getBoundingClientRect();
    const k = Math.min(r.width / image.width, r.height / image.height);
    return { k, ox: (r.width - image.width * k) / 2, oy: (r.height - image.height * k) / 2 };
  }
  const at = (e) => [e.clientX, e.clientY];
  function finish(a, b) {
    const { k, ox, oy } = layout();
    const toImg = ([x, y]) => [clamp01((x - ox) / k, image.width), clamp01((y - oy) / k, image.height)];
    const [x1, y1] = toImg(a);
    const [x2, y2] = toImg(b);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    if (w < 4 && h < 4) return onDone(image, null);
    const c = canvasOf(w, h);
    c.getContext('2d').drawImage(image, Math.min(x1, x2), Math.min(y1, y2), w, h, 0, 0, c.width, c.height);
    onDone(c, { x: Math.round(Math.min(x1, x2)), y: Math.round(Math.min(y1, y2)), width: c.width, height: c.height });
  }
  const clamp01 = (v, max) => Math.min(max, Math.max(0, v));
  const sel = box && { left: Math.min(box[0][0], box[1][0]), top: Math.min(box[0][1], box[1][1]), width: Math.abs(box[1][0] - box[0][0]), height: Math.abs(box[1][1] - box[0][1]) };
  const k = wrap.current ? layout().k : 1;

  return (
    <div
      ref={wrap}
      className="shot-area"
      tabIndex={-1}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      onContextMenu={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setStart(at(e));
        setBox([at(e), at(e)]);
      }}
      onPointerMove={(e) => {
        setCursor(at(e));
        if (start) setBox([start, at(e)]);
      }}
      onPointerUp={(e) => {
        if (!start) return;
        const a = start;
        setStart(null);
        finish(a, at(e));
      }}
    >
      <canvas ref={canvas} className="shot-area-img" />
      {!sel && <div className="shot-area-dim" />}
      {sel && (
        <>
          {/* Four shades around the box, so only the chosen area stays bright. */}
          <div className="shot-area-shade" style={{ left: 0, top: 0, right: 0, height: sel.top }} />
          <div className="shot-area-shade" style={{ left: 0, top: sel.top + sel.height, right: 0, bottom: 0 }} />
          <div className="shot-area-shade" style={{ left: 0, top: sel.top, width: sel.left, height: sel.height }} />
          <div className="shot-area-shade" style={{ left: sel.left + sel.width, top: sel.top, right: 0, height: sel.height }} />
          <div className="shot-area-box" style={sel} />
        </>
      )}
      {sel && (
        <div className="shot-area-size" style={{ left: sel.left + sel.width + 8, top: sel.top + sel.height + 8 }}>
          {Math.round(sel.width / k)} × {Math.round(sel.height / k)}
        </div>
      )}
      {cursor && (
        <>
          <div className="shot-area-hair x" style={{ top: cursor[1] }} />
          <div className="shot-area-hair y" style={{ left: cursor[0] }} />
        </>
      )}
      {!start && <div className="shot-area-hint">Drag to select an area · Click to keep the whole screen · Esc to cancel</div>}
    </div>
  );
}

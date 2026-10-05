'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import './gif-maker.css';

const MAX_CLIP = 15; // seconds of video
const MAX_FRAMES = 300;
const MIN_WIDTH = 16;
const MAX_WIDTH = 1200;
const BIG_BYTES = 15 * 1024 * 1024;

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const bytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' ? n : fallback;
};
const nextTick = () => new Promise((r) => setTimeout(r, 0));
const baseName = (name) => name.replace(/\.[^.]+$/, '') || 'animation';

class Cancelled extends Error {}

// Where to draw a w×h source inside a W×H frame.
function fitRect(w, h, W, H, fit) {
  const s = fit === 'cover' ? Math.max(W / w, H / h) : Math.min(W / w, H / h);
  const dw = w * s;
  const dh = h * s;
  return [(W - dw) / 2, (H - dh) / 2, dw, dh];
}

function seek(video, t) {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', done);
      resolve();
    };
    const timer = setTimeout(() => {
      video.removeEventListener('seeked', done);
      reject(new Error('The video stopped responding while seeking.'));
    }, 8000);
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

function loadVideo(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error('This browser can’t decode that video. Try an MP4 (H.264) or WebM file.'));
    v.src = url;
  });
}

// Evenly spaced frame indexes, for building a shared palette from a sample.
const sampleIndexes = (total, max) =>
  total <= max ? [...Array(total).keys()] : [...Array(max).keys()].map((i) => Math.round((i * (total - 1)) / (max - 1)));

async function encodeGif({ total, W, H, draw, delayFor, repeat, colors, shared, onProgress, isCancelled }) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';

  let palette = null;
  if (shared) {
    // Pool a subsample of pixels from up to 24 frames (≈600k pixels total).
    const picks = sampleIndexes(total, 24);
    const step = Math.max(1, Math.ceil((W * H * picks.length) / 600_000));
    const perFrame = Math.ceil((W * H) / step);
    const pool = new Uint8ClampedArray(perFrame * picks.length * 4);
    let o = 0;
    for (let k = 0; k < picks.length; k += 1) {
      if (isCancelled()) throw new Cancelled();
      await draw(picks[k], ctx);
      const { data } = ctx.getImageData(0, 0, W, H);
      for (let p = 0; p < W * H; p += step) {
        pool.set(data.subarray(p * 4, p * 4 + 4), o);
        o += 4;
      }
      onProgress({ stage: 'Building palette', done: k + 1, total: picks.length });
      await nextTick();
    }
    palette = quantize(pool.subarray(0, o), colors);
  }

  const gif = GIFEncoder();
  for (let i = 0; i < total; i += 1) {
    if (isCancelled()) throw new Cancelled();
    await draw(i, ctx);
    const { data } = ctx.getImageData(0, 0, W, H);
    const pal = palette || quantize(data, colors);
    const index = applyPalette(data, pal);
    // A shared palette goes once, as the global table on frame 0.
    gif.writeFrame(index, W, H, { palette: palette ? (i === 0 ? pal : undefined) : pal, delay: delayFor(i), repeat });
    onProgress({ stage: 'Encoding', done: i + 1, total });
    await nextTick();
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

function DropZone({ accept, multiple, onFiles, icon, children }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={`tool-drop${over ? ' over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles([...e.dataTransfer.files]);
      }}
    >
      <i className={`fa-solid ${icon} gif-drop-icon`} />
      {children}
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          onFiles([...e.target.files]);
          e.target.value = '';
        }}
      />
    </label>
  );
}

// Images or a short video clip → animated GIF, encoded in the browser with gifenc.
export default function GifMaker() {
  const [mode, setMode] = useState('images');
  const [frames, setFrames] = useState([]); // { id, url, name, w, h, delay }
  const [delay, setDelay] = useState('200');
  const [width, setWidth] = useState('480');
  const [bg, setBg] = useState('#ffffff');
  const [fit, setFit] = useState('contain');
  const [loop, setLoop] = useState('forever');
  const [loopCount, setLoopCount] = useState('3');
  const [paletteMode, setPaletteMode] = useState('frame');
  const [colors, setColors] = useState('256');

  const [video, setVideo] = useState(null); // { url, name, duration, w, h }
  const [vStart, setVStart] = useState('0');
  const [vDur, setVDur] = useState('3');
  const [fps, setFps] = useState(10);
  const [vWidth, setVWidth] = useState('360');

  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [dragId, setDragId] = useState(null);

  const images = useRef(new Map()); // frame id → decoded <img>
  const cancelRef = useRef(false);
  const previewRef = useRef(null);
  const live = useRef({ frames: [], video: null, result: null });

  useEffect(() => {
    live.current = { frames, video, result };
  }, [frames, video, result]);

  useEffect(() => () => {
    cancelRef.current = true;
    live.current.frames.forEach((f) => URL.revokeObjectURL(f.url));
    if (live.current.video) URL.revokeObjectURL(live.current.video.url);
    if (live.current.result) URL.revokeObjectURL(live.current.result.url);
  }, []);

  const addImages = useCallback(async (files) => {
    const list = files.filter((f) => f.type.startsWith('image/'));
    if (!list.length) {
      if (files.length) setError('Those files aren’t images.');
      return;
    }
    setError('');
    const added = [];
    const failed = [];
    for (const file of list) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      try {
        await img.decode();
        const id = uid();
        images.current.set(id, img);
        added.push({ id, url, name: file.name || 'pasted image', w: img.naturalWidth, h: img.naturalHeight, delay: '' });
      } catch {
        URL.revokeObjectURL(url);
        failed.push(file.name || 'pasted image');
      }
    }
    if (failed.length) setError(`Couldn’t read ${failed.join(', ')}.`);
    if (!live.current.frames.length && added.length) setWidth(String(Math.min(added[0].w, 480)));
    setFrames((cur) => [...cur, ...added]);
  }, []);

  function pickVideo(files) {
    const file = files.find((f) => f.type.startsWith('video/'));
    if (!file) {
      if (files.length) setError('That isn’t a video file.');
      return;
    }
    setError('');
    if (video) URL.revokeObjectURL(video.url);
    setVideo({ url: URL.createObjectURL(file), name: file.name, duration: 0, w: 0, h: 0 });
    setVStart('0');
  }

  // Paste images straight into the frame list.
  useEffect(() => {
    if (mode !== 'images') return undefined;
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (files.some((f) => f.type.startsWith('image/'))) {
        e.preventDefault();
        addImages(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [mode, addImages]);

  function removeFrame(id) {
    setFrames((cur) => {
      const f = cur.find((x) => x.id === id);
      if (f) URL.revokeObjectURL(f.url);
      images.current.delete(id);
      return cur.filter((x) => x.id !== id);
    });
  }

  function moveFrame(from, to) {
    setFrames((cur) => {
      if (to < 0 || to >= cur.length || from === to) return cur;
      const next = [...cur];
      const [f] = next.splice(from, 1);
      next.splice(to, 0, f);
      return next;
    });
  }

  function clearFrames() {
    frames.forEach((f) => URL.revokeObjectURL(f.url));
    images.current.clear();
    setFrames([]);
  }

  const setFrameDelay = (id, value) => setFrames((cur) => cur.map((f) => (f.id === id ? { ...f, delay: value } : f)));

  // Output geometry and frame count for the current mode.
  const plan = useMemo(() => {
    if (mode === 'images') {
      if (!frames.length) return null;
      const W = clamp(Math.round(num(width, 480)), MIN_WIDTH, MAX_WIDTH);
      const H = Math.max(1, Math.round((W * frames[0].h) / frames[0].w));
      return { W, H, total: frames.length };
    }
    if (!video?.w) return null;
    const W = clamp(Math.round(num(vWidth, 360)), MIN_WIDTH, MAX_WIDTH);
    const H = Math.max(1, Math.round((W * video.h) / video.w));
    const start = clamp(num(vStart, 0), 0, Math.max(0, video.duration - 0.05));
    const dur = clamp(num(vDur, 3), 0.1, Math.min(MAX_CLIP, video.duration - start));
    const total = clamp(Math.round(dur * fps), 1, MAX_FRAMES);
    return { W, H, total, start, dur };
  }, [mode, frames, width, video, vWidth, vStart, vDur, fps]);

  // Rough size: LZW-packed 8-bit pixels land around 0.3–0.8 bytes each.
  const estimate = plan ? plan.W * plan.H * plan.total * 0.55 : 0;

  async function generate() {
    if (!plan || progress) return;
    setError('');
    cancelRef.current = false;
    const { W, H, total } = plan;
    // gifenc's repeat is extra plays after the first: 0 = forever, -1 = play once.
    const times = Math.max(1, Math.round(num(loopCount, 1)));
    const repeat = loop === 'forever' ? 0 : times === 1 ? -1 : times - 1;
    const baseDelay = clamp(num(delay, 200), 20, 60000);
    let draw;
    let delayFor;
    let name;
    let source = null;

    try {
      if (mode === 'images') {
        const list = frames.map((f) => ({ img: images.current.get(f.id), delay: f.delay }));
        draw = async (i, ctx) => {
          const { img } = list[i];
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, W, H);
          ctx.drawImage(img, ...fitRect(img.naturalWidth, img.naturalHeight, W, H, fit));
        };
        delayFor = (i) => clamp(num(list[i].delay, baseDelay), 20, 60000);
        name = `${baseName(frames[0].name)}.gif`;
      } else {
        setProgress({ stage: 'Loading video', done: 0, total });
        source = await loadVideo(video.url);
        const { start } = plan;
        const end = Math.max(0, source.duration - 0.001);
        draw = async (i, ctx) => {
          await seek(source, Math.min(end, start + i / fps));
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, W, H);
          ctx.drawImage(source, 0, 0, W, H);
        };
        delayFor = () => Math.round(1000 / fps);
        name = `${baseName(video.name)}.gif`;
      }

      const blob = await encodeGif({
        total,
        W,
        H,
        draw,
        delayFor,
        repeat,
        colors: Number(colors),
        shared: paletteMode === 'shared',
        onProgress: setProgress,
        isCancelled: () => cancelRef.current,
      });
      if (result) URL.revokeObjectURL(result.url);
      setResult({ url: URL.createObjectURL(blob), size: blob.size, W, H, frames: total, name });
    } catch (err) {
      if (!(err instanceof Cancelled)) setError(err.message || 'Couldn’t make the GIF.');
    } finally {
      if (source) source.removeAttribute('src');
      setProgress(null);
    }
  }

  function discardResult() {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
  }

  const busy = Boolean(progress);
  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <>
      <div className="gif-tabs" role="tablist" aria-label="Source">
        {[['images', 'fa-images', 'Images'], ['video', 'fa-video', 'Video clip']].map(([key, icon, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            className={`gif-tab${mode === key ? ' on' : ''}`}
            onClick={() => setMode(key)}
            disabled={busy}
          >
            <i className={`fa-solid ${icon}`} /> {label}
          </button>
        ))}
      </div>
      <div className="tool-split gif-tool">
        <div>
          <div className="tool-panel">
            <h2>Settings</h2>

            {mode === 'images' ? (
              <>
                <div className="field-group">
                  <label className="field-label" htmlFor="gif-delay">Frame delay (ms)</label>
                  <input id="gif-delay" className="input" type="number" min="20" max="60000" step="10" value={delay} onChange={(e) => setDelay(e.target.value)} />
                  <p className="field-hint">{Math.round(1000 / clamp(num(delay, 200), 20, 60000) * 10) / 10} frames per second. Override single frames in the list.</p>
                </div>
                <div className="field-group">
                  <label className="field-label" htmlFor="gif-width">Width (px)</label>
                  <input id="gif-width" className="input" type="number" min={MIN_WIDTH} max={MAX_WIDTH} value={width} onChange={(e) => setWidth(e.target.value)} />
                  <p className="field-hint">Height follows the first image’s shape{plan ? ` — ${plan.W}×${plan.H}` : ''}.</p>
                </div>
                <div className="field-group gif-2col">
                  <div>
                    <label className="field-label" htmlFor="gif-fit">Other sizes</label>
                    <select id="gif-fit" className="input" value={fit} onChange={(e) => setFit(e.target.value)}>
                      <option value="contain">Fit (letterbox)</option>
                      <option value="cover">Fill (crop)</option>
                    </select>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="gif-bg">Background</label>
                    <div className="gif-color">
                      <input id="gif-bg" type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
                      <span className="tool-mono">{bg}</span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="field-group gif-2col">
                  <div>
                    <label className="field-label" htmlFor="gif-start">Start (s)</label>
                    <input id="gif-start" className="input" type="number" min="0" step="0.1" max={video?.duration || undefined} value={vStart} onChange={(e) => setVStart(e.target.value)} />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="gif-dur">Length (s)</label>
                    <input id="gif-dur" className="input" type="number" min="0.1" max={MAX_CLIP} step="0.1" value={vDur} onChange={(e) => setVDur(e.target.value)} />
                  </div>
                </div>
                <p className="field-hint gif-hint-top">
                  Up to {MAX_CLIP} s.{' '}
                  <button type="button" className="gif-link" disabled={!video} onClick={() => previewRef.current && setVStart(previewRef.current.currentTime.toFixed(1))}>
                    Start at the player’s position
                  </button>
                </p>
                <div className="field-group">
                  <label className="field-label" htmlFor="gif-fps">Frame rate — {fps} fps</label>
                  <input id="gif-fps" className="gif-range" type="range" min="5" max="20" value={fps} onChange={(e) => setFps(Number(e.target.value))} />
                </div>
                <div className="field-group">
                  <label className="field-label" htmlFor="gif-vwidth">Width (px)</label>
                  <input id="gif-vwidth" className="input" type="number" min={MIN_WIDTH} max={MAX_WIDTH} value={vWidth} onChange={(e) => setVWidth(e.target.value)} />
                  {plan && <p className="field-hint">{plan.W}×{plan.H}, {plan.total} frames.</p>}
                </div>
              </>
            )}

            <div className="field-group gif-2col">
              <div>
                <label className="field-label" htmlFor="gif-loop">Loop</label>
                <select id="gif-loop" className="input" value={loop} onChange={(e) => setLoop(e.target.value)}>
                  <option value="forever">Forever</option>
                  <option value="count">Play N times</option>
                </select>
              </div>
              {loop === 'count' && (
                <div>
                  <label className="field-label" htmlFor="gif-loops">Times</label>
                  <input id="gif-loops" className="input" type="number" min="1" max="100" value={loopCount} onChange={(e) => setLoopCount(e.target.value)} />
                </div>
              )}
            </div>
            <div className="field-group gif-2col">
              <div>
                <label className="field-label" htmlFor="gif-palette">Palette</label>
                <select id="gif-palette" className="input" value={paletteMode} onChange={(e) => setPaletteMode(e.target.value)}>
                  <option value="frame">Per frame</option>
                  <option value="shared">Shared</option>
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="gif-colors">Colours</label>
                <select id="gif-colors" className="input" value={colors} onChange={(e) => setColors(e.target.value)}>
                  {['256', '128', '64', '32', '16'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <p className="field-hint gif-hint-top">
              Per frame gives the best colour; a shared palette is smaller and stops colours flickering between frames.
            </p>

            {plan && (
              <p className={`gif-estimate${estimate > BIG_BYTES ? ' big' : ''}`}>
                <i className={`fa-solid ${estimate > BIG_BYTES ? 'fa-triangle-exclamation' : 'fa-scale-balanced'}`} />
                {' '}Up to about {bytes(Math.round(estimate))} ({plan.total} frames at {plan.W}×{plan.H}).
                {estimate > BIG_BYTES && ' That’s a heavy GIF — lower the width, frame rate or length.'}
              </p>
            )}

            {busy ? (
              <div className="gif-progress" aria-live="polite">
                <div className="gif-progress-head">
                  <span>{progress.stage}… {progress.total > 0 && `${progress.done} / ${progress.total}`}</span>
                  <button type="button" className="btn btn-sm" onClick={() => (cancelRef.current = true)}>Cancel</button>
                </div>
                <progress max="100" value={pct} aria-label="GIF progress">{pct}%</progress>
              </div>
            ) : (
              <button type="button" className="btn btn-primary btn-block gif-make" onClick={generate} disabled={!plan}>
                <i className="fa-solid fa-wand-magic-sparkles" /> Make GIF
              </button>
            )}
          </div>
        </div>

        <div>
          {error && <div className="top-error" role="alert">{error}</div>}

          {result && (
            <div className="tool-panel">
              <h2>Your GIF</h2>
              <div className="gif-result">
                <div className="gif-checker">
                  <img src={result.url} alt={`Animated GIF, ${result.frames} frames`} width={result.W} height={result.H} />
                </div>
                <div className="tool-row gif-result-meta">
                  <span className="tool-badge ok">{bytes(result.size)}</span>
                  <span className="tool-muted">{result.W}×{result.H}</span>
                  <span className="tool-muted">{result.frames} frames</span>
                  <span className="gif-spacer" />
                  <a className="btn btn-primary btn-sm" href={result.url} download={result.name}>
                    <i className="fa-solid fa-download" /> Download .gif
                  </a>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={discardResult} aria-label="Discard GIF">
                    <i className="fa-solid fa-xmark" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {mode === 'images' ? (
            <div className="tool-panel">
              <div className="gif-panel-head">
                <h2>Frames{frames.length > 0 && <span className="tool-muted"> · {frames.length}</span>}</h2>
                {frames.length > 0 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={clearFrames} disabled={busy}>Clear all</button>
                )}
              </div>
              <DropZone accept="image/*" multiple onFiles={addImages} icon="fa-images">
                <strong>Drop images here, click to choose, or paste</strong>
                <span className="tool-muted">PNG, JPEG, WebP, GIF (first frame), SVG…</span>
              </DropZone>
              {frames.length > 0 && (
                <ol className="gif-frames">
                  {frames.map((f, i) => (
                    <li
                      key={f.id}
                      className={`gif-frame${dragId === f.id ? ' dragging' : ''}`}
                      draggable={!busy}
                      onDragStart={(e) => {
                        setDragId(f.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => setDragId(null)}
                      onDragOver={(e) => {
                        if (dragId) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (dragId) moveFrame(frames.findIndex((x) => x.id === dragId), i);
                        setDragId(null);
                      }}
                    >
                      <span className="gif-frame-num">{i + 1}</span>
                      <div className="gif-thumb" style={{ background: bg }}>
                        <img src={f.url} alt="" draggable={false} />
                      </div>
                      <div className="gif-frame-info">
                        <span className="gif-frame-name" title={f.name}>{f.name}</span>
                        <span className="tool-muted">{f.w}×{f.h}</span>
                        <label className="gif-frame-delay">
                          <input
                            className="input"
                            type="number"
                            min="20"
                            step="10"
                            placeholder={`${clamp(num(delay, 200), 20, 60000)}`}
                            value={f.delay}
                            onChange={(e) => setFrameDelay(f.id, e.target.value)}
                            aria-label={`Delay for frame ${i + 1} in milliseconds`}
                          />
                          <span className="tool-muted">ms</span>
                        </label>
                      </div>
                      <div className="gif-frame-actions">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveFrame(i, i - 1)} disabled={i === 0 || busy} aria-label={`Move frame ${i + 1} up`}>
                          <i className="fa-solid fa-arrow-up" />
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveFrame(i, i + 1)} disabled={i === frames.length - 1 || busy} aria-label={`Move frame ${i + 1} down`}>
                          <i className="fa-solid fa-arrow-down" />
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm gif-remove" onClick={() => removeFrame(f.id)} disabled={busy} aria-label={`Remove frame ${i + 1}`}>
                          <i className="fa-solid fa-trash" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {frames.length === 1 && <p className="tool-muted gif-hint-top">Add at least one more image to animate.</p>}
            </div>
          ) : (
            <div className="tool-panel">
              <div className="gif-panel-head">
                <h2>Video</h2>
                {video && <span className="tool-muted gif-video-name" title={video.name}>{video.name}</span>}
              </div>
              {video ? (
                <>
                  <video
                    ref={previewRef}
                    className="gif-video"
                    src={video.url}
                    controls
                    muted
                    playsInline
                    aria-label="Video preview"
                    onLoadedMetadata={(e) => {
                      const v = e.currentTarget;
                      setVideo((cur) => cur && { ...cur, duration: v.duration, w: v.videoWidth, h: v.videoHeight });
                      setVWidth(String(Math.min(v.videoWidth || 360, 480)));
                    }}
                    onError={() => setError('This browser can’t play that video. Try an MP4 (H.264) or WebM file.')}
                  />
                  {video.w > 0 && (
                    <p className="tool-muted gif-hint-top">
                      {video.w}×{video.h} · {Number.isFinite(video.duration) ? `${video.duration.toFixed(1)} s` : 'unknown length'}
                    </p>
                  )}
                  <div className="gif-hint-top">
                    <DropZone accept="video/*" onFiles={pickVideo} icon="fa-arrows-rotate">
                      <span>Choose a different video</span>
                    </DropZone>
                  </div>
                </>
              ) : (
                <DropZone accept="video/*" onFiles={pickVideo} icon="fa-video">
                  <strong>Drop a video here or click to choose</strong>
                  <span className="tool-muted">MP4, WebM, MOV (if your browser plays it) — a clip of up to {MAX_CLIP} s becomes the GIF</span>
                </DropZone>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

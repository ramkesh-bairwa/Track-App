'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import './screen-recorder.css';

const MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
];

const QUALITY = {
  '720': { label: '720p', video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, bps: 4_000_000 },
  '1080': { label: '1080p', video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, bps: 8_000_000 },
  source: { label: 'Source', video: { frameRate: { ideal: 30 } }, bps: 12_000_000 },
};

const pad = (n) => String(n).padStart(2, '0');
const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  return `${h ? `${h}:` : ''}${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
const bytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 100 * 1024 * 1024 ? 1 : 0)} MB`;
};
const fileStamp = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}`;

// Recorded time so far, excluding pauses.
function activeMs(s) {
  if (!s?.startedAt) return 0;
  return (s.pausedAt || performance.now()) - s.startedAt - s.pausedTotal;
}

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
}

// MediaRecorder's webm has no duration in its header, so Chrome shows ∞ and
// can't seek until it has scanned to the end once. Nudge it there and back.
function fixDuration(video) {
  if (video.duration !== Infinity) return;
  const back = () => {
    video.removeEventListener('timeupdate', back);
    video.currentTime = 0;
  };
  video.addEventListener('timeupdate', back);
  video.currentTime = 1e101;
}

function Recording({ rec, onDelete }) {
  return (
    <li className="rec-item">
      <video
        className="rec-video"
        src={rec.url}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => fixDuration(e.currentTarget)}
        aria-label={`Preview of ${rec.name}`}
      />
      <div className="rec-meta">
        <strong className="rec-name" title={rec.name}>{rec.name}</strong>
        <div className="tool-row tool-muted">
          <span><i className="fa-solid fa-clock" /> {clock(rec.duration)}</span>
          <span><i className="fa-solid fa-weight-hanging" /> {bytes(rec.size)}</span>
          <span className="tool-badge">{rec.ext.toUpperCase()}</span>
          {rec.width > 0 && <span>{rec.width}×{rec.height}</span>}
          {rec.audio && <span><i className="fa-solid fa-volume-high" /> {rec.audio}</span>}
        </div>
        <div className="tool-row rec-actions">
          <a className="btn btn-primary btn-sm" href={rec.url} download={rec.name}>
            <i className="fa-solid fa-download" /> Download
          </a>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => onDelete(rec.id)}>
            <i className="fa-solid fa-trash" /> Delete
          </button>
        </div>
      </div>
    </li>
  );
}

// Records a screen, window or tab entirely in the browser with MediaRecorder.
// Nothing is uploaded; recordings live as object URLs until the page closes.
export default function ScreenRecorder() {
  const [supported, setSupported] = useState(true);
  const [phase, setPhase] = useState('idle'); // idle | picking | countdown | recording | paused
  const [count, setCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [systemAudio, setSystemAudio] = useState(true);
  const [mic, setMic] = useState(false);
  const [quality, setQuality] = useState('1080');
  const [useCountdown, setUseCountdown] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [recordings, setRecordings] = useState([]);
  const [live, setLive] = useState(null); // the stream being recorded, for the live preview

  const session = useRef(null); // { streams, audioCtx, recorder, chunks, ... }
  const recordingsRef = useRef([]);
  const countdownTimer = useRef(null);
  const liveVideo = useRef(null);

  useEffect(() => {
    setSupported(Boolean(navigator.mediaDevices?.getDisplayMedia) && typeof MediaRecorder !== 'undefined');
  }, []);

  useEffect(() => {
    recordingsRef.current = recordings;
  }, [recordings]);

  useEffect(() => {
    if (liveVideo.current) liveVideo.current.srcObject = live;
  }, [live]);

  // Release every track and the audio graph; safe to call more than once.
  const release = useCallback(() => {
    const s = session.current;
    clearInterval(countdownTimer.current);
    if (!s) return;
    s.streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
    s.audioCtx?.close().catch(() => {});
    clearInterval(s.tick);
    session.current = null;
    setLive(null);
  }, []);

  useEffect(() => () => {
    const rec = session.current?.recorder;
    if (rec) rec.onstop = null;
    if (rec && rec.state !== 'inactive') rec.stop();
    release();
    recordingsRef.current.forEach((r) => URL.revokeObjectURL(r.url));
  }, [release]);

  // Warn before closing the tab mid-recording.
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

  const finish = useCallback(() => {
    const s = session.current;
    if (!s) return;
    const duration = activeMs(s);
    const type = s.recorder.mimeType || s.mime || 'video/webm';
    const blob = new Blob(s.chunks, { type: type.split(';')[0] });
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const { width = 0, height = 0 } = s.videoTrack.getSettings?.() || {};
    release();
    setPhase('idle');
    setElapsed(0);
    if (!blob.size) {
      setError('The recording came out empty. Try again, and keep sharing for at least a second.');
      return;
    }
    const rec = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      url: URL.createObjectURL(blob),
      name: `screen-recording-${fileStamp(new Date(s.wallStart))}.${ext}`,
      size: blob.size,
      duration,
      ext,
      width,
      height,
      audio: s.audioLabel,
    };
    setRecordings((list) => [rec, ...list]);
  }, [release]);

  const beginRecording = useCallback(() => {
    const s = session.current;
    if (!s) return;
    try {
      const opts = { videoBitsPerSecond: QUALITY[s.quality].bps };
      if (s.mime) opts.mimeType = s.mime;
      const recorder = new MediaRecorder(s.stream, opts);
      s.recorder = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data?.size) s.chunks.push(e.data);
      };
      recorder.onstop = finish;
      recorder.onerror = (e) => {
        setError(`Recording failed: ${e.error?.message || 'unknown error'}.`);
      };
      recorder.start(1000);
      s.startedAt = performance.now();
      s.wallStart = Date.now();
      s.tick = setInterval(() => setElapsed(activeMs(s)), 250);
      setPhase('recording');
    } catch (err) {
      release();
      setPhase('idle');
      setError(`This browser couldn't start recording: ${err.message}`);
    }
  }, [finish, release]);

  const stop = useCallback(() => {
    const s = session.current;
    if (!s) return;
    if (s.recorder && s.recorder.state !== 'inactive') {
      s.recorder.stop(); // → onstop → finish()
    } else {
      release();
      setPhase('idle');
    }
  }, [release]);

  async function start() {
    setError('');
    setNotice('');
    if (!supported) return;
    setPhase('picking');
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: QUALITY[quality].video,
        audio: systemAudio,
        // Chrome-only hints; other browsers ignore them.
        selfBrowserSurface: 'include',
        systemAudio: systemAudio ? 'include' : 'exclude',
      });
    } catch (err) {
      setPhase('idle');
      if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
        setNotice('Screen sharing was cancelled — nothing was recorded.');
      } else {
        setError(`Couldn't start screen capture: ${err.message || err.name}`);
      }
      return;
    }

    const notes = [];
    const streams = [display];
    const videoTrack = display.getVideoTracks()[0];
    const displayAudio = display.getAudioTracks()[0];
    if (systemAudio && !displayAudio) notes.push('No tab/system audio was shared, so the video has no sound from the screen.');

    let micTrack = null;
    if (mic) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        streams.push(micStream);
        micTrack = micStream.getAudioTracks()[0];
      } catch (err) {
        notes.push(
          err.name === 'NotAllowedError'
            ? 'Microphone access was blocked, so recording continues without the mic.'
            : `Microphone unavailable (${err.message || err.name}), so recording continues without it.`,
        );
      }
    }

    // One audio track for MediaRecorder: mix mic and screen audio when both.
    let audioCtx = null;
    let audioTrack = displayAudio || micTrack || null;
    let audioLabel = displayAudio ? 'Screen audio' : micTrack ? 'Mic' : '';
    if (displayAudio && micTrack) {
      try {
        audioCtx = new AudioContext();
        const dest = audioCtx.createMediaStreamDestination();
        audioCtx.createMediaStreamSource(new MediaStream([displayAudio])).connect(dest);
        audioCtx.createMediaStreamSource(new MediaStream([micTrack])).connect(dest);
        audioTrack = dest.stream.getAudioTracks()[0];
        audioLabel = 'Screen + mic';
      } catch {
        notes.push('Couldn’t mix the mic with screen audio; only screen audio is recorded.');
      }
    }

    const stream = new MediaStream(audioTrack ? [videoTrack, audioTrack] : [videoTrack]);
    session.current = {
      streams,
      audioCtx,
      stream,
      videoTrack,
      quality,
      mime: pickMimeType(),
      chunks: [],
      pausedTotal: 0,
      pausedAt: 0,
      audioLabel,
    };
    // The browser's own "Stop sharing" bar ends the video track.
    videoTrack.addEventListener('ended', stop);
    setLive(stream);
    if (notes.length) setNotice(notes.join(' '));

    if (useCountdown) {
      setPhase('countdown');
      setCount(3);
      let n = 3;
      countdownTimer.current = setInterval(() => {
        n -= 1;
        if (n <= 0) {
          clearInterval(countdownTimer.current);
          beginRecording();
        } else {
          setCount(n);
        }
      }, 1000);
    } else {
      beginRecording();
    }
  }

  function togglePause() {
    const s = session.current;
    if (!s?.recorder) return;
    if (s.recorder.state === 'recording') {
      s.recorder.pause();
      s.pausedAt = performance.now();
      setPhase('paused');
    } else if (s.recorder.state === 'paused') {
      s.pausedTotal += performance.now() - s.pausedAt;
      s.pausedAt = 0;
      s.recorder.resume();
      setPhase('recording');
    }
  }

  function remove(id) {
    setRecordings((list) => {
      const rec = list.find((r) => r.id === id);
      if (rec) URL.revokeObjectURL(rec.url);
      return list.filter((r) => r.id !== id);
    });
  }

  const busy = phase !== 'idle';
  const active = phase === 'recording' || phase === 'paused';

  return (
    <div className="tool-split">
      <div className="tool-panel">
        <h2>Options</h2>
        {!supported && (
          <div className="top-error" role="alert">
            This browser can’t record the screen. Use a recent desktop Chrome, Edge, Firefox or Safari —
            phones and tablets don’t support screen capture.
          </div>
        )}
        <fieldset className="rec-fieldset" disabled={busy || !supported}>
          <legend className="field-label">Audio</legend>
          <label className="checkbox-row rec-check">
            <input type="checkbox" checked={systemAudio} onChange={(e) => setSystemAudio(e.target.checked)} />
            <span>Include tab / system audio</span>
          </label>
          <label className="checkbox-row rec-check">
            <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} />
            <span>Include microphone</span>
          </label>
          <p className="field-hint">
            Tab audio is offered by Chrome and Edge; tick “Share audio” in the picker. System audio for a whole screen
            works on Windows and ChromeOS.
          </p>
        </fieldset>
        <fieldset className="rec-fieldset" disabled={busy || !supported}>
          <legend className="field-label">Quality</legend>
          <div className="rec-seg" role="radiogroup" aria-label="Quality">
            {Object.entries(QUALITY).map(([key, q]) => (
              <label key={key} className={`rec-seg-opt${quality === key ? ' on' : ''}`}>
                <input type="radio" name="rec-quality" value={key} checked={quality === key} onChange={() => setQuality(key)} />
                {q.label}
              </label>
            ))}
          </div>
          <p className="field-hint">“Source” keeps the shared surface’s own resolution.</p>
        </fieldset>
        <label className="checkbox-row rec-check">
          <input
            type="checkbox"
            checked={useCountdown}
            disabled={busy || !supported}
            onChange={(e) => setUseCountdown(e.target.checked)}
          />
          <span>3-second countdown before recording</span>
        </label>
        <p className="field-hint">
          <i className="fa-solid fa-lock" /> Everything stays in this browser — nothing is uploaded.
        </p>
      </div>

      <div>
        <div className="tool-panel rec-stage">
          {notice && (
            <div className="rec-notice" role="status">
              <i className="fa-solid fa-circle-info" />
              <span>{notice}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNotice('')} aria-label="Dismiss message">
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          )}
          {error && <div className="top-error" role="alert">{error}</div>}

          <div className={`rec-screen${live ? ' live' : ''}`}>
            <video ref={liveVideo} className="rec-live" muted autoPlay playsInline aria-label="Live preview of what is being recorded" hidden={!live} />
            {!live && (
              <div className="rec-placeholder">
                <i className="fa-solid fa-display" />
                <span>{phase === 'picking' ? 'Choose what to share in the browser’s picker…' : 'Pick a screen, window or tab to start.'}</span>
              </div>
            )}
            {phase === 'countdown' && (
              <div className="rec-countdown" aria-live="assertive">
                <span key={count}>{count}</span>
              </div>
            )}
          </div>

          <div className="rec-controls">
            {active ? (
              <>
                <span className={`rec-timer${phase === 'paused' ? ' paused' : ''}`} role="timer" aria-live="off">
                  <span className="rec-dot" aria-hidden="true" />
                  {phase === 'paused' ? 'Paused' : 'REC'} <span className="tool-mono">{clock(elapsed)}</span>
                </span>
                <div className="tool-row">
                  <button type="button" className="btn btn-sm" onClick={togglePause}>
                    <i className={`fa-solid ${phase === 'paused' ? 'fa-play' : 'fa-pause'}`} /> {phase === 'paused' ? 'Resume' : 'Pause'}
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={stop}>
                    <i className="fa-solid fa-stop" /> Stop
                  </button>
                </div>
              </>
            ) : phase === 'countdown' ? (
              <>
                <span className="tool-muted">Recording starts in {count}…</span>
                <button type="button" className="btn btn-sm" onClick={stop}>Cancel</button>
              </>
            ) : (
              <button type="button" className="btn btn-primary rec-start" onClick={start} disabled={!supported || phase === 'picking'}>
                <i className="fa-solid fa-circle-dot" /> {phase === 'picking' ? 'Waiting for picker…' : 'Start recording'}
              </button>
            )}
          </div>
        </div>

        <div className="tool-panel">
          <h2>Recordings this session{recordings.length > 0 && <span className="tool-muted"> · {recordings.length}</span>}</h2>
          {recordings.length === 0 ? (
            <div className="tool-empty">Your recordings appear here. They’re lost when you leave the page, so download the ones you want.</div>
          ) : (
            <ul className="rec-list">
              {recordings.map((r) => <Recording key={r.id} rec={r} onDelete={remove} />)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

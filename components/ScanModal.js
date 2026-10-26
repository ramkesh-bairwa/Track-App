'use client';

import { useEffect, useRef, useState } from 'react';

// Hacker-style "security scan" modal. It animates through the real file list the
// server returned (read-only) — files appear one by one with a progress bar,
// then a summary. Nothing is executed; it only visualises the scan.
export default function ScanModal({ output, onClose }) {
  const lines = output.split('\n');
  const target = (lines.find((l) => l.startsWith('Scanning ')) || '').replace('Scanning ', '').trim();
  const fileLines = lines.filter((l) => l.startsWith('[ OK ]'));
  const summary = (lines.find((l) => l.startsWith('——')) || '').replace(/——/g, '').trim();
  const total = fileLines.length;

  const [shown, setShown] = useState(0);
  const [done, setDone] = useState(false);
  const streamRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    let i = 0;
    timer.current = setInterval(() => {
      i += Math.max(1, Math.round(total / 90)); // finish in ~90 ticks
      if (i >= total) {
        i = total;
        clearInterval(timer.current);
        setShown(total);
        setTimeout(() => setDone(true), 250);
      } else {
        setShown(i);
      }
    }, 22);
    return () => clearInterval(timer.current);
  }, [total]);

  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [shown]);

  const pct = total ? Math.round((shown / total) * 100) : 100;
  const current = shown > 0 ? fileLines[Math.min(shown, total) - 1].replace('[ OK ]', '').trim().split(/\s{2,}/)[0] : '';
  const blocks = Math.round((pct / 100) * 34);

  return (
    <div className="scan-overlay" onClick={done ? onClose : undefined}>
      <div className="scan-modal" onClick={(e) => e.stopPropagation()}>
        <div className="scan-modal-head">
          <span className="scan-modal-title">
            <span className={`scan-pulse${done ? ' ok' : ''}`} />
            {done ? 'SCAN COMPLETE' : 'SECURITY SCAN RUNNING'}
          </span>
          <button type="button" className="scan-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="scan-target">target&nbsp;&gt;&nbsp;{target || 'app directory'}</div>

        <div className="scan-stream" ref={streamRef}>
          {fileLines.slice(0, shown).map((l, i) => (
            <div key={i} className="scan-line">
              <span className="scan-ok">[OK]</span> {l.replace('[ OK ]', '').trim()}
            </div>
          ))}
          {!done && <div className="scan-line scan-cur">▸ scanning {current}<span className="scan-caret" /></div>}
        </div>

        <div className="scan-bar">
          <span className="scan-bar-track">
            {'█'.repeat(blocks)}<span className="scan-bar-empty">{'░'.repeat(34 - blocks)}</span>
          </span>
          <span className="scan-pct">{pct}%</span>
        </div>

        <div className="scan-foot">
          {done ? (
            <>
              <span className="scan-done-msg">✓ {summary || `${total} files · 0 issues`}</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Close</button>
            </>
          ) : (
            <span className="scan-foot-run">scanned {Math.min(shown, total)} / {total} files…</span>
          )}
        </div>
      </div>
    </div>
  );
}

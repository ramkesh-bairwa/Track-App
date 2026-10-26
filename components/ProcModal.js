'use client';

import { useEffect, useRef, useState } from 'react';

// Hacker-style processing modal. The intro steps are chosen for the actual
// command, and once the server replies the REAL output streams in line by line
// with the progress bar filling to 100%. Nothing here is faked beyond the
// short intro — the body is the command's genuine result.
const INTRO = {
  dns: ['resolving nameservers', 'querying DNS records'],
  ping: ['sending ICMP echo requests', 'measuring round-trip time'],
  ssl: ['opening TLS handshake', 'fetching certificate chain'],
  whois: ['contacting WHOIS registry', 'parsing registration'],
  ls: ['indexing directory', 'reading file table'],
  scan: ['indexing project tree', 'reading file table', 'hashing entries'],
  netinfo: ['reading network interfaces'],
  ports: ['probing listening sockets'],
  connections: ['reading active sockets'],
  ps: ['reading process table'],
  top: ['sampling cpu / memory'],
  myheaders: ['requesting http response headers'],
  services: ['listing running services'],
  firewall: ['reading firewall rules'],
  lastlogin: ['reading auth log'],
  git_status: ['inspecting working tree'],
  git_log: ['reading commit history'],
  db_backup: ['locking tables', 'dumping schema', 'exporting rows'],
};

function introFor(id) {
  const cmd = (id || '').split(' ')[0];
  return [
    'auth: admin session verified',
    'opening secure channel',
    ...(INTRO[cmd] || ['resolving command handler', 'running checks']),
  ];
}

const MAX_LINES = 160;

export default function ProcModal({ label, id, result, onClose }) {
  const [shown, setShown] = useState([]);
  const [pct, setPct] = useState(6);
  const [done, setDone] = useState(false);
  const queue = useRef(introFor(id).map((t) => ({ kind: 'step', text: t })));
  const complete = useRef(false);
  const streamRef = useRef(null);
  const closeRef = useRef(null);

  // When the real result lands, queue its lines + a summary and allow 100%.
  useEffect(() => {
    if (!result) return;
    const raw = result.download ? [result.output] : String(result.output || '').split('\n');
    const lines = raw.slice(0, MAX_LINES);
    queue.current.push(...lines.map((t) => ({ kind: result.ok ? (t.startsWith('[') ? 'file' : 'res') : 'err', text: t })));
    if (raw.length > MAX_LINES) queue.current.push({ kind: 'dim', text: `… +${raw.length - MAX_LINES} more lines (full output in terminal)` });
    queue.current.push({ kind: result.ok ? 'ok' : 'err', text: result.ok ? `✓ done · ${result.ms}ms` : `✗ exit 1 · ${result.ms}ms` });
    complete.current = true;
  }, [result]);

  // Single reveal loop drains the queue and drives the progress bar.
  useEffect(() => {
    const iv = setInterval(() => {
      setShown((s) => (queue.current.length ? [...s, queue.current.shift()] : s));
      setPct((p) => {
        if (complete.current && queue.current.length === 0) return 100;
        return complete.current ? Math.min(98, p + 5) : Math.min(80, p + 2);
      });
      if (complete.current && queue.current.length === 0) {
        setDone(true);
        clearInterval(iv);
      }
    }, 24);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [shown]);

  useEffect(() => { if (done) closeRef.current?.focus(); }, [done]);

  const blocks = Math.round((pct / 100) * 34);
  const errored = done && result && !result.ok;

  return (
    <div className="scan-overlay" onClick={done ? onClose : undefined}>
      <div className="scan-modal" onClick={(e) => e.stopPropagation()}>
        <div className="scan-modal-head">
          <span className="scan-modal-title">
            <span className={`scan-pulse${done ? (errored ? ' err' : ' ok') : ''}`} />
            {done ? (errored ? 'FAILED' : 'DONE') : 'EXECUTING'}
          </span>
          {done && <button type="button" className="scan-close" onClick={onClose} aria-label="Close">✕</button>}
        </div>

        <div className="scan-target">task&nbsp;&gt;&nbsp;{label}</div>

        <div className="scan-stream" ref={streamRef}>
          {shown.map((l, i) => {
            if (l.kind === 'step') return <div key={i} className="scan-line"><span className="scan-ok">[OK]</span> {l.text}</div>;
            if (l.kind === 'file') return <div key={i} className="scan-line scan-res">{l.text}</div>;
            if (l.kind === 'res') return <div key={i} className="scan-line scan-res">{l.text}</div>;
            if (l.kind === 'err') return <div key={i} className="scan-line scan-errline">{l.text}</div>;
            if (l.kind === 'dim') return <div key={i} className="scan-line scan-dim">{l.text}</div>;
            return <div key={i} className="scan-line scan-okline">{l.text}</div>;
          })}
          {!done && <div className="scan-line scan-cur">▸ working<span className="scan-caret" /></div>}
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
              <span className={errored ? 'scan-errline' : 'scan-done-msg'}>
                {errored ? '✗ command failed' : `✓ ${label} complete`}
              </span>
              <button ref={closeRef} type="button" className="btn btn-primary btn-sm" onClick={onClose}>Close</button>
            </>
          ) : (
            <span className="scan-foot-run">processing {label}…</span>
          )}
        </div>
      </div>
    </div>
  );
}

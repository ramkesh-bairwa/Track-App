'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ProcModal from '@/components/ProcModal';

// Hacker-style terminal for admins. It does NOT run free-text commands — each
// chip triggers one fixed, server-side action (see lib/serverConsole.js). The
// input line is a filter/selector for those actions, not a shell.

function useBootLines() {
  const lines = [
    'MyTrack server console v1.0',
    'secure channel established · admin session',
    'type a command name or click a chip below · "help" lists all',
    '',
  ];
  return lines;
}

// Collapse '.', '..' and slashes to a clean path, never climbing above the app
// root (root = ''). Used so `cd` / `ls` stay inside the project folder.
function joinPath(cwd, arg) {
  const a = (arg || '').trim();
  const base = a.startsWith('~') || a.startsWith('/') ? '' : cwd; // ~… or /… → from app root
  const stack = [];
  for (const part of `${base}/${a.replace(/^[/~]+/, '')}`.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

// Common shell commands people try — we show a clear "why" instead of a bare
// "command not found". They are NOT run; this console has no arbitrary shell.
const BLOCKED = new Set([
  'sudo', 'su', 'rm', 'mv', 'cp', 'chmod', 'chown', 'kill', 'killall',
  'bash', 'sh', 'zsh', 'exec', 'curl', 'wget', 'nc', 'ncat', 'nmap',
  'apt', 'apt-get', 'yum', 'dnf', 'brew', 'systemctl', 'service',
  'nano', 'vim', 'vi', 'cat', 'echo', 'mkdir', 'touch', 'wsl', 'ssh', 'scp',
]);

export default function ServerConsole({ actions, user, root = '' }) {
  const boot = useBootLines();
  const [history, setHistory] = useState(() => boot.map((text) => ({ kind: 'sys', text })));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [cmdHistory, setCmdHistory] = useState([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [cwd, setCwd] = useState(''); // current dir, relative to the app root
  const [full, setFull] = useState(false); // in-app fullscreen (covers app area)
  const [nativeFull, setNativeFull] = useState(false); // real browser fullscreen
  const [proc, setProc] = useState(null); // { id, label } while a command runs
  const [procResult, setProcResult] = useState(null); // the command's real result
  const [min, setMin] = useState(false); // minimized (amber dot)
  const router = useRouter();
  const wrapRef = useRef(null);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const expanded = full || nativeFull;

  // Esc leaves the in-app fullscreen; lock page scroll while expanded.
  useEffect(() => {
    if (!expanded) return undefined;
    const onEsc = (e) => { if (e.key === 'Escape' && full) setFull(false); };
    window.addEventListener('keydown', onEsc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onEsc);
      document.body.style.overflow = prev;
    };
  }, [expanded, full]);

  // Keep nativeFull in sync with the actual browser fullscreen state.
  useEffect(() => {
    const onChange = () => setNativeFull(Boolean(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  function toggleNativeFull() {
    const el = wrapRef.current;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    } else if (el) {
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    }
  }

  const who = (user.name || 'admin').toLowerCase().replace(/\s+/g, '');
  const prompt = `${who}@mytrack:~${cwd ? `/${cwd}` : ''}$`;

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [history, busy]);

  // Keep the command input focused so you never have to click first. Refocus
  // after output changes and whenever the processing modal closes.
  useEffect(() => {
    if (!proc && !busy) inputRef.current?.focus();
  }, [proc, busy, history]);

  function push(entry) {
    setHistory((h) => [...h, entry]);
  }


  async function runAction(action, arg = '', echo = true) {
    if (busy) return;
    if (echo) push({ kind: 'cmd', text: `${prompt} ${action.id}${arg ? ` ${arg}` : ''}` });
    setBusy(true);
    const label = `${action.id}${arg ? ` ${arg}` : ''}`;
    // Every command opens the dynamic processing modal; its real output streams
    // in once the server replies (see ProcModal).
    setProc({ id: label, label });
    setProcResult(null);
    const started = Date.now();
    try {
      const sendArg = action.id === 'ls' ? joinPath(cwd, arg) : arg;
      const res = await fetch('/api/admin/console', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action.id, arg: sendArg }),
      });
      const json = await res.json().catch(() => ({}));
      const ms = json.ms ?? Date.now() - started;
      if (!res.ok) {
        setProcResult({ ok: false, output: json.error || `Request failed (${res.status}).`, ms });
      } else if (json.download && json.filename) {
        const url = URL.createObjectURL(new Blob([json.output], { type: 'application/sql' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = json.filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setProcResult({ ok: true, download: true, output: `✓ ${json.filename} downloaded (${json.output.length.toLocaleString()} bytes)`, ms });
      } else {
        setProcResult({ ok: json.ok, output: json.output, ms });
      }
    } catch (err) {
      setProcResult({ ok: false, output: `Network error: ${err.message}`, ms: Date.now() - started });
    }
  }

  // Called when the modal's Close is pressed: drop the result into the terminal
  // scrollback (full output), close the modal, and return focus to the input.
  function closeProc() {
    const r = procResult;
    if (r) {
      if (r.download) {
        push({ kind: 'ok', text: r.output });
      } else {
        push({ kind: r.ok ? 'out' : 'err', text: r.output });
        push({ kind: 'meta', text: `[${r.ok ? 'done' : 'exit 1'} · ${r.ms}ms]` });
      }
    }
    setProc(null);
    setProcResult(null);
    setBusy(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function submit(e) {
    e.preventDefault();
    const raw = input.trim();
    if (!raw) return;
    setCmdHistory((h) => [...h, raw]);
    setHistIdx(-1);
    setInput('');

    if (raw.toLowerCase() === 'clear' || raw.toLowerCase() === 'cls') {
      setHistory(boot.map((text) => ({ kind: 'sys', text })));
      return;
    }
    // Split "ls app/lib" → command "ls", arg "app/lib".
    const [first, ...rest] = raw.split(/\s+/);
    const cmd = first.toLowerCase();
    const arg = rest.join(' ');

    // `cd` and `pwd` are handled here because they act on the browser-side
    // current dir (bounded to the app folder; `chdir` on the server verifies).
    if (cmd === 'cd') {
      changeDir(arg);
      return;
    }
    if (cmd === 'pwd') {
      push({ kind: 'cmd', text: `${prompt} pwd` });
      push({ kind: 'out', text: `${root}${cwd ? `/${cwd}` : ''}` });
      return;
    }

    const match = actions.find((a) => a.id === cmd);
    if (match) {
      runAction(match, match.arg ? arg : '');
    } else {
      push({ kind: 'cmd', text: `${prompt} ${raw}` });
      if (BLOCKED.has(cmd)) {
        push({ kind: 'err', text: `${cmd}: not allowed here.` });
        push({ kind: 'out', text: 'This is a safe admin console — it runs only the fixed commands in "help", not root or arbitrary shell commands. For root/sudo access use SSH or the Hostinger terminal.' });
      } else {
        push({ kind: 'err', text: `command not found: ${first} — type "help" to see what's available` });
      }
    }
  }

  // Move into a subfolder of the app. The server confirms it's a real dir under
  // the project root, so this can never reach the Desktop or the wider server.
  async function changeDir(arg) {
    push({ kind: 'cmd', text: `${prompt} cd ${arg}` });
    const target = joinPath(cwd, arg);
    if (target === cwd) { inputRef.current?.focus(); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/console', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'chdir', arg: target }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) setCwd(json.output);
      else push({ kind: 'err', text: json.output || json.error || `cd: ${arg}: not found` });
    } catch (err) {
      push({ kind: 'err', text: `Network error: ${err.message}` });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!cmdHistory.length) return;
      const i = histIdx < 0 ? cmdHistory.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(i);
      setInput(cmdHistory[i]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx < 0) return;
      const i = histIdx + 1;
      if (i >= cmdHistory.length) { setHistIdx(-1); setInput(''); }
      else { setHistIdx(i); setInput(cmdHistory[i]); }
    }
  }

  return (
    <div ref={wrapRef} className={`term-wrap${expanded ? ' term-full' : ''}${min ? ' term-min' : ''}`}>
      <div className="term-head">
        <button
          type="button"
          className="term-dot red"
          title="Close console"
          onClick={() => {
            if (document.fullscreenElement || document.webkitFullscreenElement) toggleNativeFull();
            router.push('/dashboard');
          }}
        >
          <span className="term-dot-glyph">✕</span>
        </button>
        <button
          type="button"
          className="term-dot amber"
          title={min ? 'Restore' : 'Minimize'}
          onClick={() => setMin((m) => !m)}
        >
          <span className="term-dot-glyph">{min ? '+' : '–'}</span>
        </button>
        <button
          type="button"
          className="term-dot green"
          title={expanded ? 'Restore size' : 'Maximize'}
          onClick={() => { if (min) setMin(false); setFull((f) => !f); }}
        >
          <span className="term-dot-glyph">⤢</span>
        </button>
        <span className="term-title">root console — {user.email}{min ? '  ·  (minimized)' : ''}</span>
        <span className="term-head-btns">
          <button
            type="button"
            className="term-full-btn"
            onClick={() => setFull((f) => !f)}
            title={full ? 'Exit (Esc)' : 'Expand inside the app'}
          >
            {full ? '✕ Exit' : '⛶ Expand'}
          </button>
          <button
            type="button"
            className="term-full-btn"
            onClick={toggleNativeFull}
            title="Fill the whole screen (F11-style)"
          >
            {nativeFull ? '✕ Exit full screen' : '⤢ Full screen'}
          </button>
        </span>
      </div>

      <div className="term-chips">
        {actions.filter((a) => a.chip).map((a) => (
          <button
            key={a.id}
            type="button"
            className={`term-chip${a.danger ? ' danger' : ''}`}
            disabled={busy}
            onClick={() => runAction(a)}
            title={a.id}
          >
            {a.danger ? '⚠ ' : a.download ? '⬇ ' : '▸ '}{a.label}
          </button>
        ))}
      </div>

      <div className="term-body" ref={bodyRef} onClick={() => inputRef.current?.focus()}>
        {history.map((entry, i) => (
          <pre key={i} className={`term-line term-${entry.kind}`}>{entry.text}</pre>
        ))}
        <form className="term-input-row" onSubmit={submit} onClick={() => inputRef.current?.focus()}>
          <span className="term-prompt">{prompt}</span>
          {/* The real input is transparent and overlays the row; we render the
              typed text ourselves so a block cursor can sit right after it. */}
          <span className="term-typed">
            <span className="term-typed-text">{input}</span>
            {!busy && <span className="term-cursor" />}
          </span>
          <input
            ref={inputRef}
            className="term-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy}
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            aria-label="Console command"
          />
        </form>
      </div>

      <p className="term-foot">
        Fixed admin actions only — this console can’t run arbitrary commands. ↑/↓ for history · “help” · “clear”.
      </p>

      {proc && <ProcModal label={proc.label} id={proc.id} result={procResult} onClose={closeProc} />}
    </div>
  );
}

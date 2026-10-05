'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compareText, revertHunk, checkCode } from '@/lib/codeDiff';
import { highlightCode } from '@/lib/codeHighlight';
import { languageLabel, languageForName } from '@/lib/codeLanguages';
import { downloadBlob, safeFilename } from '@/lib/exportData';
import { timeAgo, formatDateTime } from '@/components/tasks/taskUi';

const CONTEXT = 3; // unchanged lines kept around each change when folding

function Code({ html }) {
  // highlightCode() returns escaped HTML with the original characters only.
  return <span dangerouslySetInnerHTML={{ __html: html || '&nbsp;' }} />;
}

function Segs({ segs, side }) {
  return segs.map((s, i) =>
    s.changed ? (
      <mark key={i} className={`cmp-char ${side}`}>{s.text}</mark>
    ) : (
      <span key={i}>{s.text}</span>
    )
  );
}

// ---------- step 1: what to compare against ----------

function SourcePicker({ file, current, onPick, onClose }) {
  const [tab, setTab] = useState('versions');
  const [versions, setVersions] = useState(null);
  const [files, setFiles] = useState(null);
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/code/${file.uuid}/versions`).then((r) => r.json()).then((j) => {
      setVersions(j.versions || []);
      if (!j.versions?.length) setTab('paste');
    }).catch(() => setVersions([]));
    fetch('/api/code').then((r) => r.json()).then((j) => setFiles((j.files || []).filter((f) => f.uuid !== file.uuid))).catch(() => setFiles([]));
  }, [file.uuid]);

  async function pickVersion(v, i) {
    setLoading(true);
    setError('');
    try {
      const j = await fetch(`/api/code/${file.uuid}/versions/${v.id}`).then((r) => r.json());
      if (!j.version) throw new Error('Could not load that version.');
      onPick({ label: `Version ${versions.length - i}${v.label ? ` — ${v.label}` : ''} (${formatDateTime(v.created_at)})`, content: j.version.content || '', language: j.version.language });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  async function pickFile(f) {
    setLoading(true);
    setError('');
    try {
      const j = await fetch(`/api/code/${f.uuid}`).then((r) => r.json());
      if (!j.file) throw new Error('Could not load that file.');
      onPick({ label: f.name, content: j.file.content || '', language: j.file.language });
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  async function pasteFromFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) setPasted(await f.text());
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="new-track-head">
          <div>
            <h2>Compare “{file.name}” with…</h2>
            <p className="new-track-steps">Your current code goes on the right; differences and problems are marked there.</p>
          </div>
          <button type="button" className="new-track-close" onClick={onClose} title="Close">×</button>
        </div>
        <div className="tabs track-type-tabs" style={{ marginBottom: 12 }}>
          {[['versions', `Saved versions${versions ? ` (${versions.length})` : ''}`], ['files', 'Another file'], ['paste', 'Paste code']].map(([k, l]) => (
            <button key={k} type="button" className={`tab-btn${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        {tab === 'versions' && (
          <div className="cmp-pick-list">
            {versions === null && <p className="task-muted">Loading…</p>}
            {versions?.length === 0 && (
              <p className="task-muted">No saved versions yet. Each time you choose “Save code”, a version is kept here to compare against.</p>
            )}
            {versions?.map((v, i) => (
              <button key={v.id} type="button" className="cmp-pick" disabled={loading} onClick={() => pickVersion(v, i)}>
                <strong>Version {versions.length - i}{v.label ? ` — ${v.label}` : ''}{i === 0 ? ' · latest' : ''}</strong>
                <small title={formatDateTime(v.created_at)}>{timeAgo(v.created_at)} · {languageLabel(v.language)} · {Number(v.size).toLocaleString()} chars</small>
              </button>
            ))}
          </div>
        )}
        {tab === 'files' && (
          <div className="cmp-pick-list">
            {files === null && <p className="task-muted">Loading…</p>}
            {files?.length === 0 && <p className="task-muted">No other saved code files.</p>}
            {files?.map((f) => (
              <button key={f.uuid} type="button" className="cmp-pick" disabled={loading} onClick={() => pickFile(f)}>
                <strong>{f.name}</strong>
                <small>{languageLabel(f.language)} · updated {timeAgo(f.updated_at)}</small>
              </button>
            ))}
          </div>
        )}
        {tab === 'paste' && (
          <>
            <textarea
              className="input input-mono cmp-paste"
              placeholder="Paste the code to compare with…"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              spellCheck={false}
              autoFocus
            />
            <div className="modal-actions">
              <label className="btn btn-ghost" style={{ marginRight: 'auto' }}>
                Open a file…
                <input type="file" style={{ display: 'none' }} onChange={pasteFromFile} />
              </label>
              <button type="button" className="btn btn-primary" disabled={!pasted.trim()} onClick={() => onPick({ label: 'Pasted code', content: pasted, language: null })}>
                Compare
              </button>
            </div>
          </>
        )}
        {error && <div className="top-error">{error}</div>}
        {tab !== 'paste' && current !== undefined && (
          <p className="field-hint">Tip: “Paste code” compares against anything — code from a colleague, another project, or a website.</p>
        )}
      </div>
    </div>
  );
}

// ---------- step 2: the comparison ----------

// `initialSource` skips the picker (used by the quick paste-and-compare);
// without `file.uuid` there are no versions to pick from.
export default function CodeCompare({ file, current, language, onApply, onClose, initialSource = null, rightLabel: rightName }) {
  const [source, setSource] = useState(initialSource); // { label, content, language }
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [fold, setFold] = useState(true);
  const [view, setView] = useState('split');
  const [swapped, setSwapped] = useState(false);
  const [openFolds, setOpenFolds] = useState(() => new Set());
  const [current_, setCurrentHunk] = useState(0);
  const [showProblems, setShowProblems] = useState(true);
  const scrollRef = useRef(null);

  const leftText = swapped ? current : source?.content;
  const rightText = swapped ? source?.content : current;
  const lang = language || languageForName(file.name);
  const currentLabel = rightName || `${file.name} (current)`;
  const leftLabel = swapped ? currentLabel : source?.label;
  const rightLabel = swapped ? source?.label : currentLabel;

  const result = useMemo(
    () => (source ? compareText(leftText, rightText, { ignoreWhitespace, ignoreCase }) : null),
    [source, leftText, rightText, ignoreWhitespace, ignoreCase]
  );
  const problems = useMemo(() => (source ? checkCode(rightText, lang) : []), [source, rightText, lang]);
  const problemsByLine = useMemo(() => {
    const m = new Map();
    problems.forEach((p) => m.set(p.line, [...(m.get(p.line) || []), p]));
    return m;
  }, [problems]);

  // Rows to draw: long unchanged stretches fold into one "⋯ N lines" row.
  const items = useMemo(() => {
    if (!result) return [];
    const { rows } = result;
    const near = new Array(rows.length).fill(false);
    rows.forEach((r, i) => {
      if (r.kind !== 'equal' || problemsByLine.has(r.rightNo)) {
        for (let k = Math.max(0, i - CONTEXT); k <= Math.min(rows.length - 1, i + CONTEXT); k += 1) near[k] = true;
      }
    });
    const out = [];
    for (let i = 0; i < rows.length; ) {
      if (!fold || near[i] || openFolds.has(i)) {
        out.push({ type: 'row', row: rows[i], index: i });
        i += 1;
        continue;
      }
      let j = i;
      while (j < rows.length && !near[j] && !openFolds.has(j)) j += 1;
      if (j - i < 4) {
        for (let k = i; k < j; k += 1) out.push({ type: 'row', row: rows[k], index: k });
      } else out.push({ type: 'fold', start: i, count: j - i });
      i = j;
    }
    return out;
  }, [result, fold, openFolds, problemsByLine]);

  const hunks = result?.hunks || [];
  const totalRows = result?.rows.length || 1;

  const jumpToRow = useCallback((rowIndex) => {
    // A folded row has no element yet — unfold its stretch first.
    setOpenFolds((s) => {
      if (document.getElementById(`cmp-row-${rowIndex}`)) return s;
      const next = new Set(s);
      for (let k = rowIndex - CONTEXT; k <= rowIndex + CONTEXT; k += 1) next.add(k);
      next.add(rowIndex);
      return next;
    });
    requestAnimationFrame(() => document.getElementById(`cmp-row-${rowIndex}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }, []);

  const goHunk = useCallback((i) => {
    if (!hunks.length) return;
    const n = (i + hunks.length) % hunks.length;
    setCurrentHunk(n);
    jumpToRow(hunks[n].start);
  }, [hunks, jumpToRow]);

  useEffect(() => {
    const onKey = (e) => {
      if (!source) return;
      if (e.key === 'Escape') onClose();
      else if ((e.altKey && e.key === 'ArrowDown') || (e.key === 'F7' && !e.shiftKey)) { e.preventDefault(); goHunk(current_ + 1); }
      else if ((e.altKey && e.key === 'ArrowUp') || (e.key === 'F7' && e.shiftKey)) { e.preventDefault(); goHunk(current_ - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [source, goHunk, current_, onClose]);

  if (!source) return <SourcePicker file={file} current={current} onPick={setSource} onClose={onClose} />;

  const { stats } = result;
  const lineHtml = (text) => highlightCode(text ?? '', lang);
  const canRevert = !swapped && Boolean(onApply);
  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.filter((p) => p.severity === 'warning').length;

  function revert(hunkIndex) {
    onApply(revertHunk(result, hunkIndex));
  }

  function downloadPatch() {
    const lines = [`--- ${leftLabel}`, `+++ ${rightLabel}`];
    for (const h of hunks) {
      const rows = result.rows.slice(Math.max(0, h.start - CONTEXT), h.end + CONTEXT + 1);
      const first = rows.find((r) => r.leftNo || r.rightNo) || {};
      lines.push(`@@ -${first.leftNo || 0} +${first.rightNo || 0} @@`);
      for (const r of rows) {
        if (r.kind === 'equal') lines.push(` ${r.left}`);
        if (r.kind === 'del' || r.kind === 'mod') lines.push(`-${r.left}`);
        if (r.kind === 'add' || r.kind === 'mod') lines.push(`+${r.right}`);
      }
    }
    downloadBlob(new Blob([`${lines.join('\n')}\n`], { type: 'text/x-diff' }), `${safeFilename(file.name, 'code')}.diff`);
  }

  const marker = (r) => {
    const ps = r.rightNo ? problemsByLine.get(r.rightNo) : null;
    if (!ps || !showProblems) return null;
    const worst = ps.some((p) => p.severity === 'error') ? 'error' : ps.some((p) => p.severity === 'warning') ? 'warning' : 'info';
    return (
      <span className={`cmp-problem ${worst}`} title={ps.map((p) => p.message).join('\n')}>
        {worst === 'error' ? '⛔' : worst === 'warning' ? '⚠' : 'ℹ'}
      </span>
    );
  };
  const problemClass = (r) => {
    if (!showProblems || !r.rightNo) return '';
    const ps = problemsByLine.get(r.rightNo);
    if (!ps) return '';
    return ps.some((p) => p.severity === 'error') ? ' has-error' : ps.some((p) => p.severity === 'warning') ? ' has-warning' : ' has-info';
  };
  const revertBtn = (r, i) =>
    canRevert && r.hunk != null && hunks[r.hunk].start === i ? (
      <button type="button" className="cmp-revert" title="Undo this change in your code (take the left side)" onClick={() => revert(r.hunk)}>↶</button>
    ) : null;

  const renderSplitRow = ({ row: r, index: i }) => (
    <tr id={`cmp-row-${i}`} key={i} className={`cmp-row ${r.kind}${r.hunk === current_ && r.hunk != null ? ' current' : ''}`}>
      <td className="cmp-no">{r.leftNo ?? ''}</td>
      <td className={`cmp-code left ${r.kind}`}>
        {r.left == null ? null : r.kind === 'mod' ? <Segs segs={r.leftSegs} side="del" /> : <Code html={lineHtml(r.left)} />}
      </td>
      <td className="cmp-no">{r.rightNo ?? ''}</td>
      <td className={`cmp-code right ${r.kind}${problemClass(r)}`}>
        {r.right == null ? null : r.kind === 'mod' ? <Segs segs={r.rightSegs} side="add" /> : <Code html={lineHtml(r.right)} />}
      </td>
      <td className="cmp-mark">{marker(r)}{revertBtn(r, i)}</td>
    </tr>
  );

  const renderUnifiedRow = ({ row: r, index: i }) => {
    const cells = [];
    if (r.kind === 'equal') {
      cells.push(['equal', r.leftNo, r.rightNo, ' ', <Code key="c" html={lineHtml(r.right)} />]);
    } else {
      if (r.left != null) cells.push(['del', r.leftNo, '', '−', r.kind === 'mod' ? <Segs key="c" segs={r.leftSegs} side="del" /> : <Code key="c" html={lineHtml(r.left)} />]);
      if (r.right != null) cells.push(['add', '', r.rightNo, '+', r.kind === 'mod' ? <Segs key="c" segs={r.rightSegs} side="add" /> : <Code key="c" html={lineHtml(r.right)} />]);
    }
    return cells.map(([kind, ln, rn, sign, code], k) => (
      <tr id={k === 0 ? `cmp-row-${i}` : undefined} key={`${i}-${k}`} className={`cmp-row ${kind}${r.hunk === current_ && r.hunk != null ? ' current' : ''}`}>
        <td className="cmp-no">{ln}</td>
        <td className="cmp-no">{rn}</td>
        <td className="cmp-sign">{sign}</td>
        <td className={`cmp-code ${kind}${kind !== 'del' ? problemClass(r) : ''}`}>{code}</td>
        <td className="cmp-mark">{kind !== 'del' && marker(r)}{k === 0 && revertBtn(r, i)}</td>
      </tr>
    ));
  };

  const cols = 5;

  return (
    <div className="cmp-overlay">
      <div className="cmp-head">
        <div className="cmp-titles">
          <span className="cmp-side-label left" title={leftLabel}>◀ {leftLabel}</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSwapped((v) => !v)} title="Swap sides">⇄</button>
          <span className="cmp-side-label right" title={rightLabel}>{rightLabel} ▶</span>
        </div>
        <div className="cmp-stats">
          {stats.identical ? (
            <span className="cmp-chip same">✓ Identical</span>
          ) : (
            <>
              <span className="cmp-chip add">+{stats.added} added</span>
              <span className="cmp-chip del">−{stats.removed} removed</span>
              <span className="cmp-chip mod">~{stats.modified} changed</span>
            </>
          )}
          <button type="button" className={`cmp-chip problems${errors ? ' has-errors' : ''}${showProblems ? '' : ' off'}`} onClick={() => setShowProblems((v) => !v)} title="Show / hide problems found in the right-hand code">
            {errors ? `⛔ ${errors} error${errors === 1 ? '' : 's'}` : '✓ No errors'}{warnings ? ` · ⚠ ${warnings}` : ''}{problems.length - errors - warnings ? ` · ℹ ${problems.length - errors - warnings}` : ''}
          </button>
        </div>
        <div className="cmp-tools">
          <button type="button" className="btn btn-sm" disabled={!hunks.length} onClick={() => goHunk(current_ - 1)} title="Previous change (Alt+↑ / Shift+F7)">↑</button>
          <span className="cmp-count">{hunks.length ? `${Math.min(current_ + 1, hunks.length)} / ${hunks.length}` : '0 changes'}</span>
          <button type="button" className="btn btn-sm" disabled={!hunks.length} onClick={() => goHunk(current_ + 1)} title="Next change (Alt+↓ / F7)">↓</button>
          <select className="input input-sm" value={view} onChange={(e) => setView(e.target.value)} title="Layout">
            <option value="split">Side by side</option>
            <option value="unified">Inline</option>
          </select>
          <label className="checkbox-row"><input type="checkbox" checked={ignoreWhitespace} onChange={(e) => setIgnoreWhitespace(e.target.checked)} /><span>Ignore spaces</span></label>
          <label className="checkbox-row"><input type="checkbox" checked={ignoreCase} onChange={(e) => setIgnoreCase(e.target.checked)} /><span>Ignore case</span></label>
          <label className="checkbox-row"><input type="checkbox" checked={fold} onChange={(e) => { setFold(e.target.checked); setOpenFolds(new Set()); }} /><span>Hide unchanged</span></label>
          <button type="button" className="btn btn-sm" onClick={downloadPatch} disabled={!hunks.length} title="Download the differences as a .diff file">⬇ .diff</button>
          {file.uuid ? (
            <button type="button" className="btn btn-sm" onClick={() => setSource(null)}>Compare with…</button>
          ) : null}
          <button type="button" className="btn btn-sm btn-primary" onClick={onClose} title="Close (Esc)">Done</button>
        </div>
      </div>

      <div className="cmp-body">
        <div className="cmp-scroll" ref={scrollRef}>
          {stats.identical && <div className="cmp-banner">Both sides are exactly the same.</div>}
          <table className={`cmp-table ${view}`}>
            <colgroup>
              {view === 'split' ? (
                <><col className="cmp-col-no" /><col /><col className="cmp-col-no" /><col /><col className="cmp-col-mark" /></>
              ) : (
                <><col className="cmp-col-no" /><col className="cmp-col-no" /><col className="cmp-col-sign" /><col /><col className="cmp-col-mark" /></>
              )}
            </colgroup>
            <tbody>
              {items.map((it) =>
                it.type === 'fold' ? (
                  <tr key={`f${it.start}`} className="cmp-fold">
                    <td colSpan={cols}>
                      <button
                        type="button"
                        onClick={() => setOpenFolds((s) => {
                          const next = new Set(s);
                          for (let k = it.start; k < it.start + it.count; k += 1) next.add(k);
                          return next;
                        })}
                      >
                        ⋯ {it.count} unchanged line{it.count === 1 ? '' : 's'} — show
                      </button>
                    </td>
                  </tr>
                ) : view === 'split' ? renderSplitRow(it) : renderUnifiedRow(it)
              )}
            </tbody>
          </table>
        </div>

        {/* Overview strip on the right edge: every change and problem, click to jump. */}
        <div className="cmp-ruler" title="Changes and problems in the whole file — click to jump">
          {result.rows.map((r, i) => (r.kind === 'equal' ? null : (
            <button
              key={`c${i}`}
              type="button"
              className={`cmp-ruler-mark ${r.kind}`}
              style={{ top: `${(i / totalRows) * 100}%`, height: `max(3px, ${100 / totalRows}%)` }}
              onClick={() => { if (r.hunk != null) setCurrentHunk(r.hunk); jumpToRow(i); }}
            />
          )))}
          {showProblems && result.rows.map((r, i) => {
            const ps = r.rightNo ? problemsByLine.get(r.rightNo) : null;
            if (!ps) return null;
            const worst = ps.some((p) => p.severity === 'error') ? 'error' : ps.some((p) => p.severity === 'warning') ? 'warning' : 'info';
            return (
              <button
                key={`p${i}`}
                type="button"
                className={`cmp-ruler-problem ${worst}`}
                style={{ top: `${(i / totalRows) * 100}%` }}
                title={ps.map((p) => `Line ${p.line}: ${p.message}`).join('\n')}
                onClick={() => jumpToRow(i)}
              />
            );
          })}
        </div>
      </div>

      {showProblems && problems.length > 0 && (
        <div className="cmp-problems">
          <strong>Problems in {rightLabel}</strong>
          <div className="cmp-problem-list">
            {problems.slice(0, 200).map((p, k) => (
              <button
                key={k}
                type="button"
                className={`cmp-problem-item ${p.severity}`}
                onClick={() => {
                  const i = result.rows.findIndex((r) => r.rightNo === p.line);
                  if (i !== -1) jumpToRow(i);
                }}
              >
                <span>{p.severity === 'error' ? '⛔' : p.severity === 'warning' ? '⚠' : 'ℹ'}</span>
                <span className="cmp-problem-line">Line {p.line}</span>
                <span>{p.message}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="cmp-legend">
        <span><i className="sw add" /> added</span>
        <span><i className="sw del" /> removed</span>
        <span><i className="sw mod" /> changed (exact characters marked)</span>
        <span>⛔ ⚠ ℹ problems in the right side</span>
        {canRevert && <span>↶ undo one change in your code</span>}
        <span>{languageLabel(lang)}</span>
      </div>
    </div>
  );
}

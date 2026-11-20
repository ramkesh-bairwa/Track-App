'use client';

import { useState } from 'react';

const TABLE_LABELS = {
  tracks: 'Tracks & sub-tracks',
  track_entries: 'Records',
  notes: 'Notes',
  code_snippets: 'Saved code',
  calendar_activities: 'Calendar activities',
  calendar_leaves: 'Leaves',
  user_devices: 'Devices',
  test_projects: 'Testing projects',
  task_boards: 'Task boards',
  tasks: 'Tasks',
  user_activity: 'Activity log',
  track_activity: 'Track history',
};

async function downloadExport(options) {
  const res = await fetch(`/api/data-transfer/export${options ? `?${new URLSearchParams(options)}` : ''}`);
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || 'Could not export your data.');
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'mytrack-data.json';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const EXPORT_FORMATS = [
  { id: 'xlsx', label: 'Excel', hint: '.xlsx — one tab per track and per table' },
  { id: 'json', label: 'JSON', hint: '.json — can be imported back here' },
  { id: 'sql', label: 'SQL', hint: '.sql — load into MySQL / MariaDB' },
];

function exportNote(format, content, scope) {
  if (content === 'empty') {
    if (format === 'sql') return 'CREATE TABLE statements for every table — run it to set up a new, empty MyTrack database.';
    if (format === 'json') return 'Every table with its columns and types, no rows.';
    return 'A Summary tab listing every table and its columns, plus one empty tab per table with its column headings.';
  }
  const who = scope === 'all' ? 'every user’s data' : 'your data';
  if (format === 'sql') return `The table structure plus INSERT statements for ${who}.${scope === 'all' ? ' Loading it replaces the tables in the target database.' : ''}`;
  if (format === 'json') return scope === 'all' ? 'Every table and row of the database.' : 'Use “Import” below (here or in the other app) to load this file.';
  return `Easy-to-read tabs for each track’s records, then one tab per table with ${who}. Passwords and tokens are hidden.`;
}

function Counts({ tables }) {
  const rows = Object.entries(TABLE_LABELS).filter(([t]) => tables?.[t]);
  if (rows.length === 0) return <p className="field-hint">Nothing in it.</p>;
  return (
    <ul className="data-transfer-counts">
      {rows.map(([t, label]) => (
        <li key={t}>
          <span>{label}</span>
          <strong>{tables[t]}</strong>
        </li>
      ))}
    </ul>
  );
}

// Export this account's data to a file, or import one made by the website
// or the desktop app.
export default function DataTransferModal({ user, onClose }) {
  const [exporting, setExporting] = useState(false);
  const [format, setFormat] = useState('xlsx');
  const [content, setContent] = useState('data');
  const [scope, setScope] = useState('mine');
  const [file, setFile] = useState(null); // { name, data, counts }
  const [mode, setMode] = useState('merge');
  const [usePassword, setUsePassword] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function handleExport() {
    setExporting(true);
    setError('');
    try {
      await downloadExport({ format, content, scope });
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  async function pickFile(e) {
    const picked = e.target.files?.[0];
    e.target.value = '';
    setResult(null);
    setError('');
    if (!picked) return;
    const text = await picked.text();
    // A SQL dump (Export → SQL): imported by running it against the database.
    if (/\.sql$/i.test(picked.name) || (!/\.json$/i.test(picked.name) && !text.trimStart().startsWith('{'))) {
      setFile({ name: picked.name, sql: text, isSql: true });
      return;
    }
    try {
      const data = JSON.parse(text);
      if (data?.format !== 'mytrack-export') throw new Error();
      const counts = Object.fromEntries(Object.entries(data.tables || {}).map(([t, rows]) => [t, rows.length]));
      setFile({ name: picked.name, data, counts });
    } catch {
      setFile(null);
      setError('That file is not a MyTrack export (.json) or SQL file (.sql).');
    }
  }

  async function handleImport() {
    if (file?.isSql) {
      const ok = window.confirm(
        'Run this SQL file against the database?\n\nBest on a new or empty database. If the same data is already here, it may conflict.'
      );
      if (!ok) return;
      setImporting(true);
      setError('');
      try {
        const res = await fetch('/api/data-transfer/import-sql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: file.sql }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'SQL import failed.');
        setResult({ sql: true });
        setFile(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setImporting(false);
      }
      return;
    }
    if (mode === 'replace') {
      const ok = window.confirm(
        'Replace all your data in this app with the file’s data?\n\nA copy of your current data downloads first, so you can bring it back.'
      );
      if (!ok) return;
    }
    setImporting(true);
    setError('');
    try {
      if (mode === 'replace') await downloadExport();
      const res = await fetch('/api/data-transfer/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, usePassword, data: file.data }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Import failed.');
      setResult(json);
      setFile(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  const otherAccount =
    file && !file.isSql && file.data?.account?.email && file.data.account.email.toLowerCase() !== String(user?.email).toLowerCase();

  return (
    <div className="modal-overlay" onClick={importing ? undefined : onClose}>
      <div className="modal data-transfer-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Import / export data</h2>
        <p className="field-hint" style={{ marginBottom: 16 }}>
          Move your data between the MyTrack website and the desktop app. Export it here, then import the file in the other one.
        </p>

        <section className="data-transfer-section">
          <h3>Export</h3>
          <p className="field-hint">
            Tracks, records, notes, saved code, calendar, devices, testing projects, your task boards and your history.
          </p>

          <div className="field-label" style={{ marginTop: 10 }}>Format</div>
          <div className="task-visibility-options three">
            {EXPORT_FORMATS.map((f) => (
              <label key={f.id} className={`task-visibility${format === f.id ? ' selected' : ''}`}>
                <input type="radio" name="export-format" checked={format === f.id} onChange={() => setFormat(f.id)} />
                <span>
                  <strong>{f.label}</strong>
                  <small>{f.hint}</small>
                </span>
              </label>
            ))}
          </div>

          <div className="field-label" style={{ marginTop: 10 }}>What to include</div>
          <div className="task-visibility-options">
            <label className={`task-visibility${content === 'data' ? ' selected' : ''}`}>
              <input type="radio" name="export-content" checked={content === 'data'} onChange={() => setContent('data')} />
              <span>
                <strong>With data</strong>
                <small>Every table and all its rows.</small>
              </span>
            </label>
            <label className={`task-visibility${content === 'empty' ? ' selected' : ''}`}>
              <input type="radio" name="export-content" checked={content === 'empty'} onChange={() => setContent('empty')} />
              <span>
                <strong>Empty database</strong>
                <small>Only the structure — tables and columns, no rows.</small>
              </span>
            </label>
          </div>

          {user?.is_admin && content === 'data' && (
            <>
              <div className="field-label" style={{ marginTop: 10 }}>Whose data</div>
              <div className="task-visibility-options">
                <label className={`task-visibility${scope === 'mine' ? ' selected' : ''}`}>
                  <input type="radio" name="export-scope" checked={scope === 'mine'} onChange={() => setScope('mine')} />
                  <span>
                    <strong>My data</strong>
                    <small>Only what this account owns.</small>
                  </span>
                </label>
                <label className={`task-visibility${scope === 'all' ? ' selected' : ''}`}>
                  <input type="radio" name="export-scope" checked={scope === 'all'} onChange={() => setScope('all')} />
                  <span>
                    <strong>Whole database</strong>
                    <small>Every user’s data (admin only).</small>
                  </span>
                </label>
              </div>
            </>
          )}

          <p className="field-hint" style={{ marginTop: 8 }}>{exportNote(format, content, scope)}</p>
          <button type="button" className="btn btn-primary" onClick={handleExport} disabled={exporting || importing}>
            {exporting ? 'Exporting…' : `⇩ Download ${EXPORT_FORMATS.find((f) => f.id === format).label}`}
          </button>
        </section>

        <section className="data-transfer-section">
          <h3>Import</h3>
          <label className="btn">
            {file ? 'Choose another file…' : 'Choose export file…'}
            <input type="file" accept=".json,application/json,.sql" onChange={pickFile} style={{ display: 'none' }} disabled={importing} />
          </label>

          {file?.isSql && (
            <div className="data-transfer-preview">
              <p className="field-hint">
                <strong>{file.name}</strong> — SQL file
              </p>
              <p className="field-hint" style={{ color: 'var(--warn)' }}>
                This runs the SQL straight against the database (a restore). Best on a new or empty
                database — if the same data is already here, it may conflict. Admin only.
              </p>
              <div className="modal-actions">
                <button type="button" className="btn btn-primary" onClick={handleImport} disabled={importing}>
                  {importing ? 'Running…' : 'Run SQL file'}
                </button>
              </div>
            </div>
          )}

          {file && !file.isSql && (
            <div className="data-transfer-preview">
              <p className="field-hint">
                <strong>{file.name}</strong> — exported {new Date(file.data.exported_at).toLocaleString()}
                {file.data.account?.email ? ` from ${file.data.account.email}` : ''}
              </p>
              {otherAccount && (
                <p className="field-hint" style={{ color: 'var(--danger)' }}>
                  This file is from a different account. Its data will be added to yours ({user.email}).
                </p>
              )}
              <Counts tables={file.counts} />

              <div className="task-visibility-options" style={{ marginTop: 12 }}>
                <label className={`task-visibility${mode === 'merge' ? ' selected' : ''}`}>
                  <input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} />
                  <span>
                    <strong>Add as copies</strong>
                    <span className="field-hint" style={{ display: 'block' }}>Keeps what’s here and adds the file’s data next to it.</span>
                  </span>
                </label>
                <label className={`task-visibility${mode === 'replace' ? ' selected' : ''}`}>
                  <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                  <span>
                    <strong>Replace my data</strong>
                    <span className="field-hint" style={{ display: 'block' }}>Makes this app match the file exactly. Your current data downloads first.</span>
                  </span>
                </label>
              </div>

              {file.data.account?.password && (
                <label className="checkbox-row" style={{ marginTop: 10 }}>
                  <input type="checkbox" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} />
                  <span style={{ fontSize: 13 }}>Also use the password, privacy password and profile settings from the file</span>
                </label>
              )}

              <div className="modal-actions">
                <button type="button" className="btn btn-primary" onClick={handleImport} disabled={importing}>
                  {importing ? 'Importing…' : mode === 'replace' ? 'Replace my data' : 'Import'}
                </button>
              </div>
            </div>
          )}

          {result?.sql && (
            <div className="task-notice" style={{ marginTop: 12 }}>
              SQL imported — the database was restored from the file.
              <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>Reload to see it</button>
            </div>
          )}

          {result && !result.sql && (
            <div className="task-notice" style={{ marginTop: 12 }}>
              Imported. <Counts tables={result.added} />
              {result.peopleCreated?.length > 0 && (
                <p className="field-hint">
                  Created accounts for board members who weren’t here yet: {result.peopleCreated.join(', ')}. Set their passwords from the Users page.
                </p>
              )}
              {result.passwordCopied && <p className="field-hint">Your password now matches the one in the file.</p>}
              <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>Reload to see it</button>
            </div>
          )}
        </section>

        {error && <div className="top-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={importing}>Close</button>
        </div>
      </div>
    </div>
  );
}

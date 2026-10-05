'use client';

import { useState } from 'react';

const initialActionState = { running: false, result: null, error: '' };

export default function BackupModal({ user, onClose }) {
  const [codeState, setCodeState] = useState(initialActionState);
  const [dbState, setDbState] = useState(initialActionState);

  async function run(kind, setState) {
    setState({ running: true, result: null, error: '' });
    try {
      const res = await fetch(`/api/backup/${kind}`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Backup failed.');
      setState({ running: false, result: json, error: '' });
    } catch (err) {
      setState({ running: false, result: null, error: err.message });
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <h2>Backup</h2>
        <p className="field-hint" style={{ marginBottom: 14 }}>
          Uploads to your Google Drive — pick just the code, just the database, or both whenever you need to.
        </p>

        <div className="backup-drive-status">
          {user?.has_google_drive ? (
            <span>Google Drive connected{user.google_email ? ` as ${user.google_email}` : ''}.</span>
          ) : (
            <span>Google Drive isn't connected yet — backups will fail until it is.</span>
          )}
          <a href="/api/auth/google/start" className="btn btn-sm">
            {user?.has_google_drive ? 'Reconnect' : 'Connect Google Drive'}
          </a>
        </div>

        <div className="backup-action">
          <div className="backup-action-info">
            <strong>Code</strong>
            <p className="field-hint">Zips the project's source (plus credentials/.env).</p>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => run('code', setCodeState)} disabled={codeState.running}>
            {codeState.running ? 'Uploading…' : 'Backup code'}
          </button>
        </div>
        {codeState.error && <div className="top-error">{codeState.error}</div>}
        {codeState.result && (
          <div className="backup-result-row ok">
            <span>✓</span>
            <span>Uploaded as {codeState.result.filename}</span>
          </div>
        )}

        <div className="backup-action">
          <div className="backup-action-info">
            <strong>Database</strong>
            <p className="field-hint">Dumps the full database as a .sql file.</p>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => run('database', setDbState)} disabled={dbState.running}>
            {dbState.running ? 'Uploading…' : 'Backup database'}
          </button>
        </div>
        {dbState.error && <div className="top-error">{dbState.error}</div>}
        {dbState.result && (
          <div className="backup-result-row ok">
            <span>✓</span>
            <span>Uploaded as {dbState.result.filename}</span>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

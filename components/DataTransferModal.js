'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// Profile menu → "Export / import data". Export downloads the chosen modules
// as one JSON file; import reads such a file (e.g. exported locally) and adds
// the chosen modules to this account. Nothing already here is overwritten.

const LABELS = {
  notes: 'Notes',
  tracks: 'Tracks (records)',
  tasks: 'Task boards',
  code: 'Saved code',
  calendar: 'Calendar (leaves & activities)',
  expenses: 'Expenses',
  routine: 'Daily routine',
};

// What a module in an export file holds, for the "found in this file" list.
function fileCount(key, data) {
  if (!data) return 0;
  const n = (v) => (Array.isArray(v) ? v.length : 0);
  switch (key) {
    case 'tracks':
      return `${n(data.tracks)} track${n(data.tracks) === 1 ? '' : 's'}, ${n(data.entries)} record${n(data.entries) === 1 ? '' : 's'}`;
    case 'tasks':
      return `${n(data.boards)} board${n(data.boards) === 1 ? '' : 's'}, ${n(data.tasks)} task${n(data.tasks) === 1 ? '' : 's'}`;
    case 'code':
      return n(data.snippets);
    case 'calendar':
      return n(data.leaves) + n(data.activities);
    case 'routine':
      return n(data.items);
    default:
      return n(data);
  }
}

function ModuleList({ items, selected, onToggle, disabled }) {
  return (
    <div className="data-module-list">
      {items.map((m) => (
        <label key={m.key} className={`data-module${m.empty ? ' is-empty' : ''}`}>
          <input
            type="checkbox"
            checked={selected.includes(m.key)}
            disabled={disabled || m.empty}
            onChange={() => onToggle(m.key)}
          />
          <span className="data-module-label">{m.label}</span>
          <span className="data-module-count">{m.count}</span>
        </label>
      ))}
    </div>
  );
}

export default function DataTransferModal({ onClose }) {
  const router = useRouter();
  const [tab, setTab] = useState('export');
  const [error, setError] = useState('');

  // export
  const [summary, setSummary] = useState(null);
  const [exportSel, setExportSel] = useState([]);
  const [exporting, setExporting] = useState(false);

  // import
  const [file, setFile] = useState(null); // { name, data }
  const [importSel, setImportSel] = useState([]);
  const [importing, setImporting] = useState(false);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [results, setResults] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/data/summary')
      .then((res) => res.json())
      .then((json) => {
        if (cancelled || !json.modules) return;
        setSummary(json.modules);
        setExportSel(json.modules.filter((m) => m.count > 0).map((m) => m.key));
      })
      .catch(() => !cancelled && setError('Could not load your data summary.'));
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (setter) => (key) => setter((sel) => (sel.includes(key) ? sel.filter((k) => k !== key) : [...sel, key]));

  async function handleExport() {
    setExporting(true);
    setError('');
    try {
      const res = await fetch(`/api/data/export?modules=${exportSel.join(',')}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Export failed.');
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'mytrack-export.json';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  async function handleFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    setResults(null);
    setError('');
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data?.format !== 'mytrack-data' || typeof data.modules !== 'object') throw new Error();
      setFile({ name: f.name, data });
      setImportSel(Object.keys(data.modules).filter((k) => LABELS[k]));
    } catch {
      setFile(null);
      setError('That file is not a MyTrack export. Export it from Profile → Export / import data first.');
    }
  }

  async function handleImport() {
    setImporting(true);
    setError('');
    try {
      const res = await fetch('/api/data/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: file.data, modules: importSel, update: updateExisting }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Import failed — nothing was changed.');
      setResults(json.results);
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  const exportItems = (summary || []).map((m) => ({ ...m, empty: m.count === 0 }));
  const importItems = file
    ? Object.keys(file.data.modules)
        .filter((k) => LABELS[k])
        .map((k) => ({ key: k, label: LABELS[k], count: fileCount(k, file.data.modules[k]) }))
    : [];

  return (
    <div className="modal-overlay" onClick={exporting || importing ? undefined : onClose}>
      <div className="modal data-transfer-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Export / import data</h2>
        <p className="field-hint" style={{ marginBottom: 12 }}>
          Move your data between MyTrack sites — export it here, then import the file on the other site (for example local → live).
        </p>

        <div className="tabs" role="tablist" style={{ marginBottom: 14 }}>
          <button type="button" role="tab" aria-selected={tab === 'export'} className={`tab-btn${tab === 'export' ? ' active' : ''}`} onClick={() => { setTab('export'); setError(''); }}>
            ⬇ Export
          </button>
          <button type="button" role="tab" aria-selected={tab === 'import'} className={`tab-btn${tab === 'import' ? ' active' : ''}`} onClick={() => { setTab('import'); setError(''); }}>
            ⬆ Import
          </button>
        </div>

        {error && <div className="top-error">{error}</div>}

        {tab === 'export' && (
          <>
            {!summary ? (
              <p className="field-hint">Loading…</p>
            ) : (
              <ModuleList items={exportItems} selected={exportSel} onToggle={toggle(setExportSel)} disabled={exporting} />
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={exporting}>Close</button>
              <button type="button" className="btn btn-primary" onClick={handleExport} disabled={exporting || !exportSel.length}>
                {exporting ? 'Exporting…' : `Download ${exportSel.length === exportItems.length ? 'everything' : 'selected'}`}
              </button>
            </div>
          </>
        )}

        {tab === 'import' && (
          <>
            <label className="data-file-pick">
              <input type="file" accept="application/json,.json" onChange={handleFile} disabled={importing} />
              <span className="btn">📂 Choose export file…</span>
              <span className="data-file-name">{file ? file.name : 'No file chosen'}</span>
            </label>

            {file && !results && (
              <>
                <p className="field-hint" style={{ margin: '12px 0 8px' }}>
                  Found in this file{file.data.exported_from ? ` (from ${file.data.exported_from})` : ''} — pick what to add to this account:
                </p>
                <ModuleList items={importItems} selected={importSel} onToggle={toggle(setImportSel)} disabled={importing} />
                <label className="data-update-toggle">
                  <input type="checkbox" checked={updateExisting} disabled={importing} onChange={(e) => setUpdateExisting(e.target.checked)} />
                  <span>
                    Update items imported before with this file&apos;s version
                    <small className="field-hint">
                      New items are always added. Anything not in the file is left alone, and an item you edited here more recently keeps your newer version.
                    </small>
                  </span>
                </label>
              </>
            )}

            {results && (
              <div className="data-results">
                {results.map((r) => (
                  <div key={r.key} className="backup-result-row ok">
                    <span>✓</span>
                    <span>
                      <strong>{r.label}:</strong> {r.summary}
                      {r.detail ? ` · ${r.detail}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={importing}>
                {results ? 'Done' : 'Close'}
              </button>
              {file && !results && (
                <button type="button" className="btn btn-primary" onClick={handleImport} disabled={importing || !importSel.length}>
                  {importing ? 'Importing…' : 'Import selected'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { NewCodeFileModal } from '@/components/TopbarTools';
import { languageLabel } from '@/lib/codeLanguages';
import { timeAgo, formatDateTime } from '@/components/tasks/taskUi';
import ExportMenu from '@/components/ExportMenu';
import CodeQuickCompare from '@/components/code/CodeQuickCompare';

export default function CodeList({ files }) {
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? files.filter((f) => f.name.toLowerCase().includes(q) || languageLabel(f.language).toLowerCase().includes(q)) : files;
  }, [files, search]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Saved code</h1>
          <p>Code you want to keep for later — snippets, configs, queries, commands.</p>
        </div>
        <div className="page-head-actions">
          <ExportMenu
            label="⬇ Export list"
            getTable={async () => {
              // Includes the code itself, fetched per file.
              const full = await Promise.all(
                shown.map((f) => fetch(`/api/code/${f.uuid}`).then((r) => r.json()).then((j) => j.file).catch(() => null))
              );
              return {
                title: 'Saved code',
                columns: ['Name', 'Language', 'Last updated', 'Code'],
                rows: shown.map((f, i) => [f.name, languageLabel(f.language), formatDateTime(f.updated_at), full[i]?.content || '']),
              };
            }}
          />
          <button type="button" className="btn" onClick={() => setShowCompare(true)}>⇄ Compare code</button>
          <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>＋ Save code</button>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="empty-state">
          <h3>No saved code yet</h3>
          <p>Click “Save code”, give the file a name like <code>helpers.js</code>, and paste your code.</p>
          <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>＋ Save code</button>
        </div>
      ) : (
        <>
          <input
            type="search"
            className="input dashboard-search-input"
            placeholder="Search files…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="track-grid">
            {shown.map((f) => (
              <Link key={f.uuid} href={`/dashboard/code/${f.uuid}`} className="track-card">
                <div className="track-card-top">
                  <span className="track-card-icon" style={{ background: '#6C7BFF22', color: '#6C7BFF' }}>
                    <i className="fa-solid fa-file-code" />
                  </span>
                  <h3 style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 13.5 }}>{f.name}</h3>
                </div>
                <p>{languageLabel(f.language)}</p>
                <div className="track-card-meta">
                  <span>{Number(f.size).toLocaleString()} chars</span>
                  <span title={formatDateTime(f.updated_at)}>{timeAgo(f.updated_at)}</span>
                </div>
              </Link>
            ))}
            {shown.length === 0 && <p className="task-muted">No files match “{search}”.</p>}
          </div>
        </>
      )}
      {showNew && <NewCodeFileModal onClose={() => setShowNew(false)} />}
      {showCompare && <CodeQuickCompare onClose={() => setShowCompare(false)} />}
    </>
  );
}

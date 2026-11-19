'use client';

import { useEffect, useState, useCallback } from 'react';

export default function TestingFeedbackClient({ initialProjects }) {
  const [projects, setProjects] = useState(initialProjects || []);
  const [selected, setSelected] = useState(initialProjects?.[0]?.uuid || null);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState('');

  const current = projects.find((p) => p.uuid === selected) || null;

  const counts = issues.reduce(
    (a, x) => {
      const s = x.status || 'open';
      a[s] = (a[s] || 0) + 1;
      return a;
    },
    { pass: 0, fail: 0, warn: 0 }
  );

  const STATUS_STYLE = {
    pass: { bg: '#e7f6ec', color: '#1b7a3d', label: 'PASS' },
    fail: { bg: '#fdecec', color: '#c0392b', label: 'FAIL' },
    warn: { bg: '#fff6e0', color: '#9a6b00', label: 'WARN' },
    open: { bg: '#eef0f2', color: '#555', label: 'OPEN' },
  };

  const loadIssues = useCallback(async (uuid) => {
    if (!uuid) {
      setIssues([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/testing/feedback?project=${encodeURIComponent(uuid)}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load feedback.');
      setIssues(data.issues || []);
    } catch (err) {
      setError(err.message);
      setIssues([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIssues(selected);
  }, [selected, loadIssues]);

  async function refreshProjects() {
    try {
      const res = await fetch('/api/testing/projects', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) setProjects(data.projects || []);
    } catch {}
  }

  async function createProject(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/testing/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), base_url: baseUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create project.');
      setName('');
      setBaseUrl('');
      await refreshProjects();
      setSelected(data.uuid);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function deleteProject(uuid, name) {
    if (!confirm(`Delete project "${name}" and all its test feedback?`)) return;
    try {
      const res = await fetch(`/api/testing/projects?uuid=${encodeURIComponent(uuid)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not delete project.');
      const left = projects.filter((p) => p.uuid !== uuid);
      setProjects(left);
      if (selected === uuid) setSelected(left[0]?.uuid || null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteIssue(id) {
    try {
      const res = await fetch(`/api/testing/feedback?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not delete issue.');
      setIssues((prev) => prev.filter((x) => x.id !== id));
      refreshProjects();
    } catch (err) {
      setError(err.message);
    }
  }

  async function clearAll() {
    if (!current) return;
    if (!confirm(`Clear ALL ${issues.length} issue(s) for "${current.name}"?`)) return;
    try {
      const res = await fetch(
        `/api/testing/feedback?project=${encodeURIComponent(current.uuid)}&all=1`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not clear issues.');
      setIssues([]);
      refreshProjects();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 24 }}>
        <i className="fa-solid fa-vial-circle-check" style={{ marginRight: 10, color: '#35C2A6' }} />
        Testing feedback
      </h1>
      <p style={{ color: 'var(--muted, #888)', marginTop: 0 }}>
        UI / responsive issues pushed here by the automation tester, with screenshots.
      </p>

      {error && (
        <div style={{ background: '#fdecec', color: '#b00', padding: '8px 12px', borderRadius: 8, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left: projects + new project form */}
        <div style={{ flex: '0 0 280px', minWidth: 260 }}>
          <form onSubmit={createProject} style={cardStyle}>
            <strong style={{ display: 'block', marginBottom: 8 }}>New project</strong>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              style={inputStyle}
            />
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="Base URL (e.g. http://localhost:3000)"
              style={inputStyle}
            />
            <button type="submit" disabled={creating} style={btnStyle}>
              {creating ? 'Adding…' : 'Add project'}
            </button>
          </form>

          <div style={{ ...cardStyle, marginTop: 14, padding: 0, overflow: 'hidden' }}>
            {projects.length === 0 ? (
              <div style={{ padding: 14, color: '#999' }}>No projects yet. Add one above.</div>
            ) : (
              projects.map((p) => (
                <div
                  key={p.uuid}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    borderLeft: `3px solid ${p.uuid === selected ? '#35C2A6' : 'transparent'}`,
                    background: p.uuid === selected ? 'rgba(53,194,166,.08)' : 'transparent',
                  }}
                >
                  <button
                    onClick={() => setSelected(p.uuid)}
                    style={{
                      flex: 1,
                      textAlign: 'left',
                      padding: '10px 14px',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: '#999' }}>
                      {p.base_url || 'no URL'} · {p.issue_count} issue{p.issue_count === 1 ? '' : 's'}
                    </div>
                  </button>
                  <button
                    onClick={() => deleteProject(p.uuid, p.name)}
                    title="Delete project"
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: '#c33',
                      cursor: 'pointer',
                      padding: '0 12px',
                      fontSize: 15,
                    }}
                  >
                    <i className="fa-solid fa-trash" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: issues for the selected project */}
        <div style={{ flex: 1, minWidth: 320 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {current ? `Test cases · ${current.name}` : 'Select a project'}
              {current && (
                <>
                  <span style={{ ...badgeStyle, background: '#e7f6ec', color: '#1b7a3d' }}>
                    {counts.pass} passed
                  </span>
                  <span style={{ ...badgeStyle, background: '#fdecec', color: '#c0392b' }}>
                    {counts.fail} failed
                  </span>
                  {counts.warn > 0 && (
                    <span style={{ ...badgeStyle, background: '#fff6e0', color: '#9a6b00' }}>
                      {counts.warn} warn
                    </span>
                  )}
                </>
              )}
            </strong>
            {current && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => loadIssues(selected)} style={{ ...btnStyle, width: 'auto', padding: '6px 12px' }}>
                  <i className="fa-solid fa-rotate" style={{ marginRight: 6 }} />
                  Refresh
                </button>
                {issues.length > 0 && (
                  <button
                    onClick={clearAll}
                    style={{ ...btnStyle, width: 'auto', padding: '6px 12px', background: '#c33' }}
                  >
                    <i className="fa-solid fa-trash" style={{ marginRight: 6 }} />
                    Clear all
                  </button>
                )}
              </div>
            )}
          </div>

          {loading ? (
            <div style={{ padding: 20, color: '#999' }}>Loading…</div>
          ) : !current ? (
            <div style={cardStyle}>Pick a project on the left.</div>
          ) : issues.length === 0 ? (
            <div style={cardStyle}>
              No issues yet. Run the tester against this project:
              <pre style={preStyle}>python mytrack_tester.py</pre>
            </div>
          ) : (
            issues.map((iss, i) => (
              <div
                key={iss.id ?? i}
                style={{
                  ...cardStyle,
                  marginBottom: 12,
                  borderLeft: `4px solid ${(STATUS_STYLE[iss.status] || STATUS_STYLE.open).color}`,
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      ...badgeStyle,
                      background: (STATUS_STYLE[iss.status] || STATUS_STYLE.open).bg,
                      color: (STATUS_STYLE[iss.status] || STATUS_STYLE.open).color,
                    }}
                  >
                    {(STATUS_STYLE[iss.status] || STATUS_STYLE.open).label}
                  </span>
                  <span style={badgeStyle}>{iss.screen || 'UI'}</span>
                  <strong style={{ flex: 1 }}>{iss.title}</strong>
                  <button
                    onClick={() => deleteIssue(iss.id)}
                    title="Delete this issue"
                    style={{ border: 'none', background: 'transparent', color: '#c33', cursor: 'pointer', fontSize: 15 }}
                  >
                    <i className="fa-solid fa-trash" />
                  </button>
                </div>
                {iss.description && (
                  <p style={{ margin: '8px 0', color: '#555', whiteSpace: 'pre-wrap' }}>{iss.description}</p>
                )}
                {iss.url && (
                  <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>{iss.url}</div>
                )}
                {iss.screenshot_path && (
                  <a href={iss.screenshot_path} target="_blank" rel="noreferrer">
                    <img
                      src={iss.screenshot_path}
                      alt={iss.title}
                      style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #eee' }}
                    />
                  </a>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const cardStyle = {
  background: 'var(--card, #fff)',
  border: '1px solid var(--border, #eee)',
  borderRadius: 12,
  padding: 14,
};
const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  marginBottom: 8,
  border: '1px solid #ddd',
  borderRadius: 8,
  boxSizing: 'border-box',
};
const btnStyle = {
  width: '100%',
  padding: '9px 12px',
  background: '#35C2A6',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  fontWeight: 600,
};
const badgeStyle = {
  background: '#eef7f4',
  color: '#1f8c74',
  fontSize: 12,
  fontWeight: 700,
  padding: '2px 8px',
  borderRadius: 999,
};
const preStyle = {
  background: '#f6f6f6',
  padding: '8px 10px',
  borderRadius: 6,
  marginTop: 8,
  fontSize: 13,
};

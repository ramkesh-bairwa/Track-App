'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

// Searchable, categorised directory of all 1000 tool ideas. Built tools link
// straight to their page; the rest open a catalog detail page.
export default function ToolsCatalog({ tools, categories }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tools.filter((t) => {
      if (cat !== 'All' && t.category !== cat) return false;
      if (!needle) return true;
      return t.name.toLowerCase().includes(needle) || t.category.toLowerCase().includes(needle);
    });
  }, [tools, q, cat]);

  // Group the filtered list by category for display.
  const groups = useMemo(() => {
    const m = new Map();
    for (const t of filtered) {
      if (!m.has(t.category)) m.set(t.category, []);
      m.get(t.category).push(t);
    }
    return [...m.entries()];
  }, [filtered]);

  return (
    <div className="tcat">
      <div className="tcat-bar">
        <div className="tcat-search">
          <i className="fa-solid fa-magnifying-glass" />
          <input
            className="input"
            placeholder={`Search ${tools.length} tools…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search tools"
          />
          {q && <button type="button" className="tcat-clear" onClick={() => setQ('')} aria-label="Clear">✕</button>}
        </div>
        <span className="tcat-count">{filtered.length} of {tools.length}</span>
      </div>

      <div className="tcat-cats">
        <button type="button" className={`tcat-chip${cat === 'All' ? ' active' : ''}`} onClick={() => setCat('All')}>
          All
        </button>
        {categories.map((c) => (
          <button key={c} type="button" className={`tcat-chip${cat === c ? ' active' : ''}`} onClick={() => setCat(c)}>
            {c}
          </button>
        ))}
      </div>

      {groups.length === 0 && <p className="tcat-empty">No tools match “{q}”.</p>}

      {groups.map(([category, items]) => (
        <section key={category} className="tcat-group">
          <h3 className="tcat-group-head">
            {category} <span className="tcat-group-count">{items.length}</span>
          </h3>
          <div className="tcat-grid">
            {items.map((t) => (
              <Link key={t.slug} href={t.href} className={`tcat-item${t.working ? ' ready' : ''}`}>
                <span className="tcat-item-name">{t.name}</span>
                <span className="tcat-item-badge">{t.working ? 'Open' : 'Planned'}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

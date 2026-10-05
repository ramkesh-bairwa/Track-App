'use client';

import { useState } from 'react';
import { CODE_LANGUAGES } from '@/lib/codeLanguages';
import CodeCompare from '@/components/code/CodeCompare';

// Paste two pieces of code and compare them — nothing is saved.
export default function CodeQuickCompare({ onClose }) {
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [language, setLanguage] = useState('javascript');
  const [open, setOpen] = useState(false);

  const load = (setter) => async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) setter(await f.text());
  };

  if (open) {
    return (
      <CodeCompare
        file={{ uuid: null, name: 'Right side' }}
        rightLabel="Right side"
        current={right}
        language={language}
        initialSource={{ label: 'Left side', content: left }}
        onApply={setRight}
        onClose={() => setOpen(false)}
      />
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg cmp-quick" onClick={(e) => e.stopPropagation()}>
        <div className="new-track-head">
          <div>
            <h2>Compare code</h2>
            <p className="new-track-steps">Paste the original on the left and the new code on the right. Differences and problems are marked on the right.</p>
          </div>
          <button type="button" className="new-track-close" onClick={onClose} title="Close">×</button>
        </div>
        <div className="cmp-quick-grid">
          {[['Left — original', left, setLeft], ['Right — new / to check', right, setRight]].map(([label, value, setter]) => (
            <div key={label} className="field-group">
              <label className="field-label cmp-quick-label">
                {label}
                <label className="link-btn">
                  Open file…
                  <input type="file" style={{ display: 'none' }} onChange={load(setter)} />
                </label>
              </label>
              <textarea className="input input-mono cmp-paste" value={value} onChange={(e) => setter(e.target.value)} spellCheck={false} placeholder="Paste code…" />
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <select className="input input-sm" style={{ marginRight: 'auto', maxWidth: 180 }} value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
            {CODE_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!left && !right} onClick={() => setOpen(true)}>⇄ Compare</button>
        </div>
      </div>
    </div>
  );
}

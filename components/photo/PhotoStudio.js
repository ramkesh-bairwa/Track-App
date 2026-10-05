'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import PhotoEditor, { TOOL_COUNT } from '@/components/photo/PhotoEditor';
import CollageMaker from '@/components/photo/CollageMaker';
import PdfEditor from '@/components/pdf/PdfEditor';

const MODES = [
  { id: 'edit', label: 'Photo editor', icon: 'fa-solid fa-wand-magic-sparkles', blurb: `${TOOL_COUNT}+ tools to edit, enhance and upscale a photo.` },
  { id: 'collage', label: 'Collage maker', icon: 'fa-solid fa-table-cells-large', blurb: 'Combine several photos in 40+ layouts.' },
  { id: 'pdf', label: 'PDF editor', icon: 'fa-solid fa-file-pdf', blurb: 'Sign, annotate, reorder, merge and split PDFs.' },
];

// One page, three tools. Each tool stays mounted once opened, so switching
// tabs never throws away work in progress.
export default function PhotoStudio() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const mode = MODES.some((m) => m.id === params.get('mode')) ? params.get('mode') : 'edit';
  const [visited, setVisited] = useState(() => new Set([mode]));
  const [handoff, setHandoff] = useState(null);

  function go(id) {
    setVisited((v) => new Set(v).add(id));
    router.replace(id === 'edit' ? pathname : `${pathname}?mode=${id}`, { scroll: false });
  }
  if (!visited.has(mode)) setVisited((v) => new Set(v).add(mode));

  const active = MODES.find((m) => m.id === mode);
  return (
    <>
      <div className="page-head studio-head">
        <div>
          <h1>{active.label}</h1>
          <p>{active.blurb} Everything runs in your browser — files are never uploaded.</p>
        </div>
        <div className="tabs track-type-tabs studio-tabs" role="tablist">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} className={`tab-btn${mode === m.id ? ' active' : ''}`} onClick={() => go(m.id)}>
              <i className={m.icon} /> {m.label}
            </button>
          ))}
        </div>
      </div>
      <div hidden={mode !== 'edit'}>
        {visited.has('edit') && <PhotoEditor active={mode === 'edit'} incoming={handoff} onIncomingUsed={() => setHandoff(null)} />}
      </div>
      <div hidden={mode !== 'collage'}>
        {visited.has('collage') && (
          <CollageMaker
            active={mode === 'collage'}
            onEditInEditor={(canvas, name) => {
              setHandoff({ canvas, name });
              go('edit');
            }}
          />
        )}
      </div>
      <div hidden={mode !== 'pdf'}>{visited.has('pdf') && <PdfEditor active={mode === 'pdf'} />}</div>
    </>
  );
}

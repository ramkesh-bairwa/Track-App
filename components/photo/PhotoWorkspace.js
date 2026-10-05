'use client';

import Link from 'next/link';
import PhotoEditor from '@/components/photo/PhotoEditor';
import PhotoCombine from '@/components/photo/PhotoCombine';

// The photo section: edit a single photo, or combine several into one.
export default function PhotoWorkspace({ mode }) {
  return (
    <>
      <div className="tabs track-type-tabs photo-modes" role="tablist" aria-label="Photo tools">
        <Link href="/dashboard/photo-editor" role="tab" aria-selected={mode !== 'combine'} className={`tab-btn${mode !== 'combine' ? ' active' : ''}`}>
          <i className="fa-solid fa-wand-magic-sparkles" /> Edit a photo
        </Link>
        <Link href="/dashboard/photo-editor?mode=combine" role="tab" aria-selected={mode === 'combine'} className={`tab-btn${mode === 'combine' ? ' active' : ''}`}>
          <i className="fa-solid fa-images" /> Combine photos
        </Link>
      </div>
      {mode === 'combine' ? <PhotoCombine /> : <PhotoEditor />}
    </>
  );
}

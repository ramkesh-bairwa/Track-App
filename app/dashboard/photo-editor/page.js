import { Suspense } from 'react';
import PhotoStudio from '@/components/photo/PhotoStudio';

export const metadata = { title: 'Photo studio · MyTrack' };

export default function PhotoEditorPage() {
  return (
    <Suspense fallback={null}>
      <PhotoStudio />
    </Suspense>
  );
}

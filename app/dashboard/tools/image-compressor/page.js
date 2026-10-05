import ToolShell from '@/components/tools/ToolShell';
import ImageCompressor from '@/components/tools/ImageCompressor';

export const metadata = { title: 'Image Compressor · MyTrack' };

export default function Page() {
  return <ToolShell slug="image-compressor"><ImageCompressor /></ToolShell>;
}

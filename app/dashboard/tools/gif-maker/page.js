import ToolShell from '@/components/tools/ToolShell';
import GifMaker from '@/components/tools/GifMaker';

export const metadata = { title: 'GIF Maker · MyTrack' };

export default function Page() {
  return <ToolShell slug="gif-maker"><GifMaker /></ToolShell>;
}

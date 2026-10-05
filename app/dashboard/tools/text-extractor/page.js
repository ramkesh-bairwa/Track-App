import ToolShell from '@/components/tools/ToolShell';
import TextExtractor from '@/components/tools/TextExtractor';

export const metadata = { title: 'Text Extractor · MyTrack' };

export default function Page() {
  return <ToolShell slug="text-extractor"><TextExtractor /></ToolShell>;
}

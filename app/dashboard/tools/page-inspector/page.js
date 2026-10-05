import ToolShell from '@/components/tools/ToolShell';
import PageInspector from '@/components/tools/PageInspector';

export const metadata = { title: 'Page Inspector · MyTrack' };

export default function Page() {
  return <ToolShell slug="page-inspector"><PageInspector /></ToolShell>;
}

import ToolShell from '@/components/tools/ToolShell';
import HtmlViewer from '@/components/tools/HtmlViewer';

export const metadata = { title: 'HTML Viewer · MyTrack' };

export default function Page() {
  return <ToolShell slug="html-viewer"><HtmlViewer /></ToolShell>;
}

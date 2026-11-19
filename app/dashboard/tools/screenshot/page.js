import ToolShell from '@/components/tools/ToolShell';
import ScreenshotTool from '@/components/tools/ScreenshotTool';

export const metadata = { title: 'Screenshot · MyTrack' };

export default function Page() {
  return <ToolShell slug="screenshot"><ScreenshotTool /></ToolShell>;
}

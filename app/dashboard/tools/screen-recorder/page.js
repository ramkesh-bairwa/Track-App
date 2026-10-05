import ToolShell from '@/components/tools/ToolShell';
import ScreenRecorder from '@/components/tools/ScreenRecorder';

export const metadata = { title: 'Screen Recorder · MyTrack' };

export default function Page() {
  return <ToolShell slug="screen-recorder"><ScreenRecorder /></ToolShell>;
}

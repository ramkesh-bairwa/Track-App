import ToolShell from '@/components/tools/ToolShell';
import ResponsiveTester from '@/components/tools/ResponsiveTester';

export const metadata = { title: 'Responsive Tester · MyTrack' };

export default function Page() {
  return <ToolShell slug="responsive-tester"><ResponsiveTester /></ToolShell>;
}

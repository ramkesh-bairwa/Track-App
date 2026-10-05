import ToolShell from '@/components/tools/ToolShell';
import UrlChecker from '@/components/tools/UrlChecker';

export const metadata = { title: 'URL Checker · MyTrack' };

export default function Page() {
  return <ToolShell slug="url-checker"><UrlChecker /></ToolShell>;
}

import ToolShell from '@/components/tools/ToolShell';
import IpLocator from '@/components/tools/IpLocator';

export const metadata = { title: 'IP Locator · MyTrack' };

export default function Page() {
  return <ToolShell slug="ip-locator"><IpLocator /></ToolShell>;
}

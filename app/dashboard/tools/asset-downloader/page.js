import ToolShell from '@/components/tools/ToolShell';
import AssetDownloader from '@/components/tools/AssetDownloader';

export const metadata = { title: 'Asset Downloader · MyTrack' };

export default function Page() {
  return <ToolShell slug="asset-downloader"><AssetDownloader /></ToolShell>;
}

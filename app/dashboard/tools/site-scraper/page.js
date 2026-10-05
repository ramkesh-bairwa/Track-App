import ToolShell from '@/components/tools/ToolShell';
import SiteScraper from '@/components/tools/SiteScraper';

export const metadata = { title: 'Website Scraper · MyTrack' };

export default function Page() {
  return <ToolShell slug="site-scraper"><SiteScraper /></ToolShell>;
}

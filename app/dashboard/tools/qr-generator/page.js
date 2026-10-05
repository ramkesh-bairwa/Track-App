import ToolShell from '@/components/tools/ToolShell';
import QrGenerator from '@/components/tools/QrGenerator';

export const metadata = { title: 'QR Generator · MyTrack' };

export default function Page() {
  return <ToolShell slug="qr-generator"><QrGenerator /></ToolShell>;
}

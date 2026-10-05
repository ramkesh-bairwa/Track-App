import Link from 'next/link';
import { TOOLS } from '@/lib/toolRegistry';
import '@/components/tools/tools.css';

export const metadata = { title: 'Tools · MyTrack' };

export default function ToolsPage() {
  return (
    <div className="tool-page">
      <div className="page-head">
        <div>
          <h1>Tools</h1>
          <p>Handy utilities for screens, images, pages and links. Choose which appear in your sidebar from profile → Accessibility.</p>
        </div>
      </div>
      <div className="tool-cards">
        {TOOLS.map((t) => (
          <Link key={t.slug} href={`/dashboard/tools/${t.slug}`} className="tool-card">
            <span className="tool-card-icon"><i className={`fa-solid ${t.icon}`} /></span>
            <div>
              <strong>{t.label}</strong>
              <span>{t.description}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

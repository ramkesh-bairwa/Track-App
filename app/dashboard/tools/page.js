import Link from 'next/link';
import { TOOLS } from '@/lib/toolRegistry';
import { curatedTools, shownCategories, categoryMenu } from '@/lib/toolsCatalog';
import ToolsCatalog from '@/components/tools/ToolsCatalog';
import '@/components/tools/tools.css';

export const metadata = { title: 'Tools · MyTrack' };

export default function ToolsPage() {
  const tools = curatedTools();
  const menu = categoryMenu();
  const cats = shownCategories();

  return (
    <div className="tool-page">
      <div className="page-head">
        <div>
          <h1>Tools</h1>
          <p>{tools.length} ready-to-use utilities across {cats.length} categories — every one works right here in your browser.</p>
        </div>
      </div>

      <h2 className="tool-section-title">Featured <span className="tool-section-count">{TOOLS.length}</span></h2>
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

      <h2 className="tool-section-title">Browse by category <span className="tool-section-count">{menu.length}</span></h2>
      <div className="tcat-menu">
        {menu.map((c) => (
          <Link key={c.slug} href={`/dashboard/tools/category/${c.slug}`} className="tcat-menu-tile">
            <span className="tcat-menu-icon"><i className={`fa-solid ${c.icon}`} /></span>
            <span className="tcat-menu-name">{c.name}</span>
            <span className="tcat-menu-count">{c.count} tools</span>
          </Link>
        ))}
      </div>

      <h2 className="tool-section-title">All tools <span className="tool-section-count">{tools.length}</span></h2>
      <p className="tool-section-sub">Search across every utility. They all run offline in your browser — nothing is uploaded.</p>
      <ToolsCatalog tools={tools} categories={cats} />
    </div>
  );
}

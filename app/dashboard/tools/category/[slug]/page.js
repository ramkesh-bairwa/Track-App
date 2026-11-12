import Link from 'next/link';
import { notFound } from 'next/navigation';
import { categoryBySlug, toolsInCategory, categoryIcon } from '@/lib/toolsCatalog';
import '@/components/tools/tools.css';

export function generateMetadata({ params }) {
  const cat = categoryBySlug(params.slug);
  return { title: cat ? `${cat} tools · MyTrack` : 'Tools · MyTrack' };
}

export default function CategoryPage({ params }) {
  const category = categoryBySlug(params.slug);
  if (!category) notFound();
  const tools = toolsInCategory(category);

  return (
    <div className="tool-page">
      <div className="track-breadcrumbs">
        <span className="track-breadcrumb-item">
          <Link href="/dashboard/tools">Tools</Link>
          <span className="track-breadcrumb-sep">/</span>
        </span>
        <span className="track-breadcrumb-item"><span>{category}</span></span>
      </div>

      <div className="page-head">
        <div>
          <h1><i className={`fa-solid ${categoryIcon(category)}`} style={{ marginRight: 10, color: 'var(--accent)' }} />{category}</h1>
          <p>{tools.length} tools · {tools.filter((t) => t.working).length} ready to use</p>
        </div>
      </div>

      <div className="tcat-grid">
        {tools.map((t) => (
          <Link key={t.slug} href={t.href} className={`tcat-item${t.working ? ' ready' : ''}`}>
            <span className="tcat-item-name">{t.name}</span>
            <span className="tcat-item-badge">{t.working ? 'Open' : 'Planned'}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

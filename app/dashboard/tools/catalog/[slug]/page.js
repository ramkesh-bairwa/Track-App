import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { catalogBySlug, categoryIcon, isShown } from '@/lib/toolsCatalog';
import { miniToolBySlug } from '@/lib/miniTools';
import { pdfToolBySlug } from '@/lib/pdfFileTools';
import { imageToolBySlug } from '@/lib/imageTools';
import { qrToolBySlug } from '@/lib/qrTools';
import { mediaToolBySlug } from '@/lib/mediaTools';
import MiniTool from '@/components/tools/MiniTool';
import PdfTool from '@/components/tools/PdfTool';
import ImageTool from '@/components/tools/ImageTool';
import QrTool from '@/components/tools/QrTool';
import MediaTool from '@/components/tools/MediaTool';
import '@/components/tools/tools.css';

export function generateMetadata({ params }) {
  const tool = catalogBySlug(params.slug);
  return { title: tool ? `${tool.name} · MyTrack` : 'Tool · MyTrack' };
}

export default function CatalogToolPage({ params }) {
  const tool = catalogBySlug(params.slug);
  // Only working tools in the core categories are reachable; everything else
  // has been removed from the catalog.
  if (!tool || !isShown(tool)) notFound();
  if (tool.real) redirect(tool.href); // built tool — send to the real page

  const hasPdf = Boolean(pdfToolBySlug(params.slug));
  const hasImage = Boolean(imageToolBySlug(params.slug));
  const hasQr = Boolean(qrToolBySlug(params.slug));
  const hasMedia = Boolean(mediaToolBySlug(params.slug));
  const hasMini = Boolean(miniToolBySlug(params.slug));

  return (
    <div className="tool-page">
      <div className="track-breadcrumbs">
        <span className="track-breadcrumb-item">
          <Link href="/dashboard/tools">Tools</Link>
          <span className="track-breadcrumb-sep">/</span>
        </span>
        <span className="track-breadcrumb-item">
          <Link href={`/dashboard/tools/category/${slugForCategory(tool.category)}`}>{tool.category}</Link>
          <span className="track-breadcrumb-sep">/</span>
        </span>
        <span className="track-breadcrumb-item"><span>{tool.name}</span></span>
      </div>

      <div className="page-head">
        <div className="tool-head">
          <span className="tool-head-icon"><i className={`fa-solid ${categoryIcon(tool.category)}`} /></span>
          <div>
            <h1>{tool.name}</h1>
            <p>{tool.category} · runs in your browser</p>
          </div>
        </div>
      </div>

      {hasPdf ? <PdfTool slug={params.slug} />
        : hasImage ? <ImageTool slug={params.slug} />
        : hasQr ? <QrTool slug={params.slug} />
        : hasMedia ? <MediaTool slug={params.slug} />
        : hasMini ? <MiniTool slug={params.slug} />
        : null}
    </div>
  );
}

function slugForCategory(cat) {
  return cat.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

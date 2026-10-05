import Link from 'next/link';
import { toolBySlug } from '@/lib/toolRegistry';
import './tools.css';

// The frame every tool page sits in: back link, icon, title and description
// from lib/toolRegistry.js, then the tool itself.
export default function ToolShell({ slug, actions, children }) {
  const tool = toolBySlug(slug);
  return (
    <div className="tool-page">
      <Link href="/dashboard/tools" className="tool-back">← All tools</Link>
      <div className="page-head">
        <div className="tool-head">
          <span className="tool-head-icon"><i className={`fa-solid ${tool.icon}`} /></span>
          <div>
            <h1>{tool.label}</h1>
            <p>{tool.description}</p>
          </div>
        </div>
        {actions && <div className="page-head-actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

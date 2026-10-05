import Link from 'next/link';

// Sits next to the profile icon in the topbar — the entry point into Notes.
export default function NotesMenu() {
  return (
    <Link href="/dashboard/notes" className="notes-menu-trigger" title="Notes">
      📝
    </Link>
  );
}

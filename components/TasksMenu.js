import Link from 'next/link';

// Sits in the topbar next to Notes — the entry point into the task assigner.
export default function TasksMenu() {
  return (
    <Link href="/dashboard/tasks" className="tasks-menu-trigger" title="Task assigner">
      <i className="fa-solid fa-list-check" />
      <span>Tasks</span>
    </Link>
  );
}

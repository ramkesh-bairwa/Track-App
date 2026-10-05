import { getCurrentUser } from '@/lib/auth';
import { listBoardsFor } from '@/lib/taskServer';
import TaskBoardsDashboard from '@/components/tasks/TaskBoardsDashboard';

export default async function TasksPage() {
  const user = await getCurrentUser();
  const boards = await listBoardsFor(user.id);
  // Plain JSON so dates and TINYINT flags cross into the client component cleanly.
  const plain = JSON.parse(JSON.stringify(boards)).map((b) => ({ ...b, is_admin: Boolean(b.is_admin) }));
  return <TaskBoardsDashboard boards={plain} />;
}

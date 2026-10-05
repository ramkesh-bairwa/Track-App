import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getBoardAccess, loadBoardPayload } from '@/lib/taskServer';
import TaskBoardView from '@/components/tasks/TaskBoardView';

export default async function TaskBoardPage({ params, searchParams }) {
  const user = await getCurrentUser();
  const access = await getBoardAccess(params.id, user);
  if (!access) notFound();
  const payload = JSON.parse(JSON.stringify(await loadBoardPayload(access, user)));
  return (
    <TaskBoardView
      initial={payload}
      me={{ id: user.id, name: user.name }}
      startWithImport={searchParams?.import === '1' && payload.tasks.length === 0}
    />
  );
}

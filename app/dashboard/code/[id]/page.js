import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import CodeEditor from '@/components/code/CodeEditor';

export default async function CodeFilePage({ params }) {
  const user = await getCurrentUser();
  const rows = await query('SELECT uuid, name, language, content, updated_at FROM code_snippets WHERE uuid = ? AND user_id = ?', [
    params.id,
    user.id,
  ]);
  if (!rows[0]) notFound();
  return <CodeEditor key={rows[0].uuid} file={JSON.parse(JSON.stringify(rows[0]))} />;
}

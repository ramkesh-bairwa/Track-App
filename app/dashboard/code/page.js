import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import CodeList from '@/components/code/CodeList';

export default async function CodePage() {
  const user = await getCurrentUser();
  const files = await query(
    `SELECT uuid, name, language, CHAR_LENGTH(COALESCE(content, '')) AS size, created_at, updated_at
       FROM code_snippets WHERE user_id = ? ORDER BY updated_at DESC`,
    [user.id]
  );
  return <CodeList files={JSON.parse(JSON.stringify(files))} />;
}

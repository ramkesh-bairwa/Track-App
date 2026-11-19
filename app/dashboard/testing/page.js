import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import TestingFeedbackClient from '@/components/testing/TestingFeedbackClient';

export const dynamic = 'force-dynamic';

export default async function TestingFeedbackPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  let projects = [];
  try {
    projects = await query(
      `SELECT p.uuid, p.name, p.base_url, p.created_at,
              (SELECT COUNT(*) FROM test_feedback f WHERE f.project_id = p.id) AS issue_count
       FROM test_projects p WHERE p.user_id = ? ORDER BY p.created_at DESC`,
      [user.id]
    );
  } catch {
    // tables not migrated yet — show the empty state with a hint
    projects = [];
  }

  return <TestingFeedbackClient initialProjects={projects} />;
}

import { getCurrentUser } from '@/lib/auth';
import { listUsersFor } from '@/lib/usersServer';
import UsersList from '@/components/users/UsersList';

export default async function UsersPage() {
  const user = await getCurrentUser();
  const users = JSON.parse(JSON.stringify(await listUsersFor(user)));
  return <UsersList users={users} isAdmin={user.is_admin} />;
}

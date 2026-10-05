import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import Sidebar from '@/components/Sidebar';
import ProfileMenu from '@/components/ProfileMenu';
import NotesMenu from '@/components/NotesMenu';
import TasksMenu from '@/components/TasksMenu';
import TopbarTools from '@/components/TopbarTools';
import MobileNav from '@/components/MobileNav';
import { chromeColorStyle, contentColorCss } from '@/lib/color';
import { menuShown } from '@/lib/menuItems';

export default async function DashboardLayout({ children }) {
  const user = await getCurrentUser();
  const tracks = user
    ? await query(
        'SELECT id, uuid, parent_id, name, icon, icon_type, color FROM tracks WHERE user_id = ? ORDER BY position ASC, id ASC',
        [user.id]
      )
    : [];

  return (
    <div className="app-shell">
      {user?.content_color && <style>{contentColorCss(user.content_color)}</style>}
      <Sidebar user={user} tracks={tracks} />
      <MobileNav user={user} tracks={tracks} />
      <div className="content-area">
        <div className="topbar" style={chromeColorStyle(user?.topbar_color)}>
          <TopbarTools hidden={user?.hidden_menus} />
          {menuShown(user, 'tasks') && <TasksMenu />}
          {menuShown(user, 'notes') && <NotesMenu />}
          <ProfileMenu user={user} />
        </div>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}

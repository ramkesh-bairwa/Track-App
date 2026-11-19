import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import Sidebar from '@/components/Sidebar';
import ProfileMenu from '@/components/ProfileMenu';
import NotesMenu from '@/components/NotesMenu';
import TasksMenu from '@/components/TasksMenu';
import TopbarTools from '@/components/TopbarTools';
import MobileNav from '@/components/MobileNav';
import NotificationsBell from '@/components/NotificationsBell';
import DesktopOpenPhoto from '@/components/DesktopOpenPhoto';
import { chromeColorStyle, contentColorCss } from '@/lib/color';
import { menuShown } from '@/lib/menuItems';
import { appLockHash } from '@/lib/appLock';
import { loginPhotosEnabled } from '@/lib/loginHistory';
import AppLock from '@/components/AppLock';
import ImpersonationBanner from '@/components/ImpersonationBanner';

export default async function DashboardLayout({ children }) {
  const user = await getCurrentUser();
  const tracks = user
    ? await query(
        'SELECT id, uuid, parent_id, name, icon, icon_type, color FROM tracks WHERE user_id = ? ORDER BY position ASC, id ASC',
        [user.id]
      )
    : [];
  // An admin using "Open as this user" isn't held up by that person's app lock.
  const appLocked = user && !user.impersonator ? Boolean(await appLockHash(user.id)) : false;
  const loginPhotos = user ? await loginPhotosEnabled(user.id) : true;

  return (
    <>
    <div className="app-shell">
      {user?.content_color && <style>{contentColorCss(user.content_color)}</style>}
      <Sidebar user={user} tracks={tracks} />
      <MobileNav user={user} tracks={tracks} />
      <div className="content-area">
        {user?.impersonator && <ImpersonationBanner user={{ name: user.name, email: user.email }} admin={user.impersonator} />}
        <div className="topbar" style={chromeColorStyle(user?.topbar_color)}>
          <TopbarTools hidden={user?.hidden_menus} isAdmin={user?.is_admin} />
          {menuShown(user, 'tasks') && <TasksMenu />}
          {menuShown(user, 'notes') && <NotesMenu />}
          {user && <NotificationsBell />}
          <ProfileMenu user={user} desktop={process.env.MYTRACK_DESKTOP === '1'} />
        </div>
        <main className="main">{children}</main>
        {user && process.env.MYTRACK_DESKTOP === '1' && <DesktopOpenPhoto photos={loginPhotos} />}
      </div>
    </div>
    {user && <AppLock enabled={appLocked} lockOnLeave={process.env.MYTRACK_DESKTOP !== '1'} user={{ name: user.name, avatar: user.avatar }} photos={loginPhotos} />}
    </>
  );
}

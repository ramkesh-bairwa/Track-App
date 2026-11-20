import AttendanceView from '@/components/attendance/AttendanceView';

export const metadata = { title: 'Attendance · MyTrack' };

export default function AttendancePage() {
  return (
    <div className="ua-page">
      <h1 className="page-title">Attendance &amp; timesheet</h1>
      <p className="ua-muted" style={{ marginBottom: 16 }}>Check in when you start and check out when you stop. Your hours per day are added up below.</p>
      <AttendanceView />
    </div>
  );
}

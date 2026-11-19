import Link from 'next/link';

export const metadata = { title: 'Download MyTrack' };

// Public page (not under /dashboard, so no login needed) listing the installable
// apps. The files are served from /public/downloads on the server.
const DOWNLOADS = {
  mac: '/downloads/MyTrack-mac.dmg',
  windows: '/downloads/MyTrack-windows.zip',
  android: '/downloads/MyTrack-android.apk',
};

function Platform({ icon, title, note, href, cta, steps }) {
  return (
    <div className="dl-card">
      <div className="dl-icon">{icon}</div>
      <h2>{title}</h2>
      <p className="dl-note">{note}</p>
      {href ? (
        <a className="dl-btn" href={href} download>
          {cta}
        </a>
      ) : (
        <span className="dl-btn dl-btn-soon">{cta}</span>
      )}
      {steps ? (
        <ol className="dl-steps">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

export default function DownloadPage() {
  return (
    <main className="dl-page">
      <header className="dl-head">
        <h1>Get MyTrack</h1>
        <p>Install the app on your computer or phone. One account everywhere — it syncs with the website.</p>
      </header>

      <section className="dl-grid">
        <Platform
          icon="🍎"
          title="macOS"
          note="Apple Silicon (M1–M4). Runs its own database — no setup."
          href={DOWNLOADS.mac}
          cta="Download .dmg"
          steps={[
            'Open the .dmg and drag MyTrack to Applications.',
            'First launch: right-click MyTrack → Open → Open (it’s unsigned).',
          ]}
        />
        <Platform
          icon="🪟"
          title="Windows"
          note="Windows 10/11 (64-bit). Portable — unzip and run."
          href={DOWNLOADS.windows}
          cta="Download .zip"
          steps={[
            'Unzip the folder anywhere (e.g. Desktop).',
            'Run MyTrack.exe. If SmartScreen warns: More info → Run anyway.',
          ]}
        />
        <Platform
          icon="🤖"
          title="Android"
          note="Android 7+. Connects to this server over the internet."
          href={DOWNLOADS.android}
          cta="Download .apk"
          steps={[
            'Open the .apk on your phone.',
            'Allow “Install from this source” if asked, then Install.',
          ]}
        />
        <Platform
          icon="🍏"
          title="iPhone / iPad"
          note="Apple blocks direct .ipa installs without a developer account."
          cta="Via Expo / TestFlight"
          steps={[
            'Install “Expo Go” from the App Store.',
            'Ask the admin for the project QR / link, then scan it in Expo Go.',
          ]}
        />
      </section>

      <footer className="dl-foot">
        <Link href="/">← Back to MyTrack</Link>
      </footer>

      <style
        dangerouslySetInnerHTML={{
          __html: `
          :root { color-scheme: dark; }
          body { margin:0; }
          .dl-page { min-height:100vh; background:#0f172a; color:#f1f5f9;
            font-family: system-ui,-apple-system,Segoe UI,Roboto,sans-serif; padding:48px 20px; }
          .dl-head { max-width:960px; margin:0 auto 36px; text-align:center; }
          .dl-head h1 { font-size:40px; margin:0 0 10px; color:#38bdf8; }
          .dl-head p { color:#94a3b8; font-size:17px; margin:0; }
          .dl-grid { max-width:960px; margin:0 auto; display:grid;
            grid-template-columns: repeat(auto-fit, minmax(220px,1fr)); gap:18px; }
          .dl-card { background:#1e293b; border:1px solid #334155; border-radius:16px;
            padding:24px; display:flex; flex-direction:column; }
          .dl-icon { font-size:40px; }
          .dl-card h2 { font-size:22px; margin:10px 0 6px; }
          .dl-note { color:#94a3b8; font-size:14px; margin:0 0 16px; min-height:40px; }
          .dl-btn { display:inline-block; text-align:center; background:#38bdf8; color:#042f3d;
            font-weight:700; padding:12px 16px; border-radius:10px; text-decoration:none; }
          .dl-btn-soon { background:#334155; color:#cbd5e1; }
          .dl-steps { color:#94a3b8; font-size:13px; line-height:1.5; margin:16px 0 0; padding-left:18px; }
          .dl-foot { max-width:960px; margin:40px auto 0; text-align:center; }
          .dl-foot a { color:#38bdf8; text-decoration:none; }
        `,
        }}
      />
    </main>
  );
}

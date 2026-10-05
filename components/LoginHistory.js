'use client';

import { useState } from 'react';
import { DATE_LOCALE } from '@/lib/dateLocale';

function when(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(DATE_LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function LoginHistory({ logins }) {
  const [zoom, setZoom] = useState(null);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Login history</h1>
          <p>Every successful login to your account, with a webcam photo of whoever signed in (captured only when the camera was allowed). If you see a login you don’t recognise, change your password.</p>
        </div>
      </div>

      {logins.length === 0 ? (
        <div className="empty-state"><h3>No logins recorded yet</h3><p>Your next login will appear here.</p></div>
      ) : (
        <div className="login-history">
          {logins.map((l) => (
            <div key={l.uuid} className="login-row">
              <button
                type="button"
                className={`login-photo${l.hasPhoto ? '' : ' none'}`}
                onClick={() => l.hasPhoto && setZoom(l.uuid)}
                title={l.hasPhoto ? 'Click to enlarge' : 'No photo (camera not allowed)'}
              >
                {l.hasPhoto ? <img src={`/api/auth/login-photo/${l.uuid}`} alt="Login photo" loading="lazy" /> : <i className="fa-solid fa-user-slash" />}
              </button>
              <div className="login-info">
                <strong>{when(l.at)}</strong>
                <span className="task-muted">{l.device}{l.ip ? ` · ${l.ip}` : ''}</span>
              </div>
              {!l.hasPhoto && <span className="task-muted login-nophoto">no photo</span>}
            </div>
          ))}
        </div>
      )}

      {zoom && (
        <div className="modal-overlay" onClick={() => setZoom(null)}>
          <img className="login-zoom" src={`/api/auth/login-photo/${zoom}`} alt="Login photo" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}

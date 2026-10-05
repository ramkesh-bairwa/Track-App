'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { captureSelfie } from '@/lib/captureSelfie';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // Best-effort webcam photo: capture it if the camera is allowed, but a
      // blocked/missing camera must never stop you from logging in.
      setPhase('📷 Taking a security photo…');
      const { photo } = await captureSelfie();
      setPhase(photo ? 'Checking your details…' : 'No camera photo — logging in…');
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, photo: photo || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        setPhase('');
        setError(json.error || 'Could not log in.');
        setLoading(false);
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } catch {
      setPhase('');
      setError('Something went wrong. Try again.');
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="mark">MT</span>
          <h1>MyTrack</h1>
        </div>
        <h2 className="auth-title">Welcome back</h2>
        <p className="auth-sub">Log in to pick up where you left off.</p>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field-group">
            <label className="field-label" htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="password">Password</label>
            <div className="password-field">
              <input
                id="password"
                className="input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                title={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`} />
              </button>
            </div>
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? 'Logging in…' : 'Log in'}
          </button>
          {phase && <p className="login-capture-status">{phase}</p>}
        </form>
        <p className="auth-hint">For your account’s security, a webcam photo is taken when you log in (if you allow the camera). You can still log in without it.</p>

        <p className="auth-foot">
          No account yet? <Link href="/register">Create one</Link>
        </p>
      </div>
    </div>
  );
}

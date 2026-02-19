'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const configError =
    searchParams.get('config') === 'missing-jwt-secret' ||
    searchParams.get('config') === 'missing-api-base-url'
      ? 'Service configuration is incomplete. Please contact support.'
      : '';
  const oauthErrorCode = searchParams.get('error') ?? '';
  const oauthError =
    oauthErrorCode === 'google_config_missing'
      ? 'Google sign-in is not configured yet. Please contact support.'
      : oauthErrorCode === 'google_login_not_found'
        ? 'No account was found for that Google user. Create an account first.'
        : oauthErrorCode === 'google_oauth_failed'
          ? 'Google sign-in could not be completed. Please try again.'
          : '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.message ?? 'Invalid credentials');
        setLoading(false);
        return;
      }

      router.replace('/app/home');
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  function handleGoogleSignIn() {
    window.location.href = '/api/auth/google/start?mode=login';
  }

  return (
    <div className="w-full max-w-md">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-sky-500 flex items-center justify-center">
            <span className="text-white font-bold text-sm">S</span>
          </div>
          <span className="text-slate-900 font-semibold text-lg">Sales AI</span>
        </div>
        <p className="text-slate-600 text-sm">Login to your workspace</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8">
        <div className="mb-4 flex items-center justify-between text-sm">
          <Link href="/" className="text-slate-400 hover:text-white transition-colors">
            Back to home
          </Link>
          <Link href="/signup" className="text-sky-300 hover:text-sky-200 transition-colors">
            Create account
          </Link>
        </div>
        {configError && (
          <p className="mb-4 text-amber-300 text-sm bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            {configError}
          </p>
        )}
        {!configError && oauthError && (
          <p className="mb-4 text-amber-300 text-sm bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            {oauthError}
          </p>
        )}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          className="mb-4 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm font-medium text-slate-100 hover:border-slate-500 hover:bg-slate-700 transition-colors"
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px] font-semibold text-slate-900">
            G
          </span>
          Continue with Google
        </button>
        <div className="mb-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-800" />
          <span className="text-[11px] uppercase tracking-wider text-slate-500">or</span>
          <div className="h-px flex-1 bg-slate-800" />
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Password</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg py-2.5 text-sm transition-colors"
          >
            {loading ? 'Logging in…' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}

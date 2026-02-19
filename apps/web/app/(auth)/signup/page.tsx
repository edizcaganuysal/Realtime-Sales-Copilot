'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export default function SignupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [name, setName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const oauthErrorCode = searchParams.get('error') ?? '';
  const oauthError =
    oauthErrorCode === 'google_config_missing'
      ? 'Google sign-up is not configured yet. Please contact support.'
      : oauthErrorCode === 'google_signup_requires_org'
        ? 'Account name is required to continue with Google.'
        : oauthErrorCode === 'google_oauth_failed'
          ? 'Google sign-up could not be completed. Please try again.'
          : '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, orgName, email, password }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(Array.isArray(data?.message) ? data.message[0] : (data?.message ?? 'Signup failed'));
        setLoading(false);
        return;
      }

      router.push('/app/home');
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  function handleGoogleSignup() {
    const org = orgName.trim();
    if (!org) {
      setError('Account name is required to continue with Google.');
      return;
    }
    const target = `/api/auth/google/start?mode=signup&orgName=${encodeURIComponent(org)}`;
    window.location.href = target;
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
        <p className="text-slate-600 text-sm">Create your workspace</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8">
        <div className="mb-4 flex items-center justify-between text-sm">
          <Link href="/" className="text-slate-400 hover:text-white transition-colors">
            Back to home
          </Link>
          <Link href="/login" className="text-sky-300 hover:text-sky-200 transition-colors">
            Already have an account?
          </Link>
        </div>
        {oauthError && (
          <p className="mb-4 text-amber-300 text-sm bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            {oauthError}
          </p>
        )}
        <button
          type="button"
          onClick={handleGoogleSignup}
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
            <label className="block text-sm text-slate-300 mb-1.5">Full name</label>
            <input
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              placeholder="Jane Doe"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Account name</label>
            <input
              type="text"
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              placeholder="Acme Sales"
            />
          </div>

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
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              placeholder="At least 8 characters"
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
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}

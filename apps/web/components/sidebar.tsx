'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Home,
  PhoneCall,
  Target,
  Building2,
  CreditCard,
  Settings,
  LogOut,
  Bot,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MeResponse } from '@live-sales-coach/shared';

const TOP_NAV = [
  { href: '/app/home', label: 'Home', icon: Home },
  { href: '/app/calls', label: 'Calls', icon: PhoneCall },
  { href: '/app/ai-calls', label: 'AI Calls', icon: Bot },
  { href: '/app/agents', label: 'Strategy', icon: Target },
  { href: '/app/context', label: 'Context', icon: Building2 },
  { href: '/app/billing', label: 'Billing', icon: CreditCard },
];

const BOTTOM_NAV = [{ href: '/app/settings', label: 'Settings', icon: Settings }];

interface SidebarProps {
  me: MeResponse;
}

export function Sidebar({ me }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [creditsBalance, setCreditsBalance] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCredits() {
      const res = await fetch('/api/org/credits', { cache: 'no-store' });
      if (!active || !res.ok) return;
      const data = await res.json().catch(() => null);
      if (!active) return;
      if (typeof data?.balance === 'number') {
        setCreditsBalance(data.balance);
      }
    }

    void loadCredits();
    const intervalId = setInterval(() => {
      void loadCredits();
    }, 30000);
    const refreshListener = () => {
      void loadCredits();
    };
    window.addEventListener('credits:refresh', refreshListener);

    return () => {
      active = false;
      clearInterval(intervalId);
      window.removeEventListener('credits:refresh', refreshListener);
    };
  }, []);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  }

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
      <div className="flex items-center gap-2 border-b border-slate-800 px-5 py-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-500">
          <span className="text-xs font-bold text-white">S</span>
        </div>
        <span className="text-sm font-semibold text-white">Sales AI</span>
      </div>

      <div className="border-b border-slate-800 px-4 py-3">
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wider text-sky-300">Credits balance</p>
          <p className="text-sm font-semibold text-sky-200">
            {creditsBalance === null ? '--' : new Intl.NumberFormat('en-US').format(creditsBalance)}
          </p>
          <div className="mt-2 flex gap-2">
            <Link
              href="/app/billing?tab=add-credits"
              className="inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
            >
              Add credits
            </Link>
            <Link
              href="/app/billing?tab=upgrade"
              className="inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
            >
              Upgrade plan
            </Link>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        <div className="space-y-0.5">
          {TOP_NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/app/home' && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors',
                  active
                    ? 'border-sky-500/20 bg-sky-500/10 text-sky-300'
                    : 'border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-white',
                )}
              >
                <Icon size={16} />
                {label}
              </Link>
            );
          })}
        </div>

        <div className="space-y-0.5 pt-2">
          {BOTTOM_NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors',
                  active
                    ? 'border-sky-500/20 bg-sky-500/10 text-sky-300'
                    : 'border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-white',
                )}
              >
                <Icon size={16} />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="border-t border-slate-800 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{me.user.name}</p>
            <p className="truncate text-xs text-slate-500">{me.user.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="shrink-0 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-white"
            title="Sign out"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}

'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Home,
  Phone,
  PhoneCall,
  Bot,
  BookOpen,
  Settings,
  ShieldCheck,
  Users,
  LogOut,
  Building2,
  CreditCard,
  ClipboardList,
  BrainCircuit,
  ArrowUp,
  PlusCircle,
  Copy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MeResponse } from '@live-sales-coach/shared';
import { Modal } from '@/components/ui/modal';

const NAV = [
  { href: '/app/home', label: 'Home', icon: Home },
  { href: '/app/dialer/new', label: 'Dialer', icon: Phone },
  { href: '/app/calls', label: 'Calls', icon: PhoneCall },
  { href: '/app/agents', label: 'Agents', icon: Bot },
  { href: '/app/training', label: 'Training', icon: BookOpen },
  { href: '/app/settings', label: 'Settings', icon: Settings },
];

const ADMIN_NAV = [
  { href: '/app/admin/governance', label: 'Manage', icon: ShieldCheck },
  { href: '/app/admin/ai', label: 'AI', icon: BrainCircuit },
  { href: '/app/admin/requests', label: 'Requests', icon: ClipboardList },
  { href: '/app/admin/context', label: 'Context', icon: Building2 },
  { href: '/app/billing', label: 'Billing', icon: CreditCard },
  { href: '/app/billing?tab=upgrade', label: 'Upgrade', icon: ArrowUp },
  { href: '/app/billing?tab=add-credits', label: 'Add credits', icon: PlusCircle },
  { href: '/app/admin/users', label: 'Users', icon: Users },
  { href: '/app/admin/agents', label: 'Agents', icon: Bot },
];

interface SidebarProps {
  me: MeResponse;
}

export function Sidebar({ me }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isPrivileged = me.user.role === 'ADMIN' || me.user.role === 'MANAGER';
  const isAdmin = me.user.role === 'ADMIN';
  const [creditsBalance, setCreditsBalance] = useState<number | null>(null);
  const [showAdminPrompt, setShowAdminPrompt] = useState(false);
  const [copied, setCopied] = useState(false);

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

  function handleBillingAction(tab: 'add-credits' | 'upgrade') {
    if (isAdmin) {
      router.push(`/app/billing?tab=${tab}`);
      return;
    }
    setCopied(false);
    setShowAdminPrompt(true);
  }

  async function copyAdminMessage() {
    const text = `Please add credits or upgrade plan for ${me.org.name}.`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const activeBillingTab = searchParams.get('tab') ?? 'overview';

  return (
    <aside className="flex flex-col w-60 shrink-0 bg-slate-900 border-r border-slate-800 h-screen sticky top-0">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-800">
        <div className="w-7 h-7 rounded-md bg-sky-500 flex items-center justify-center">
          <span className="text-white font-bold text-xs">S</span>
        </div>
        <span className="text-white font-semibold text-sm">Sales AI</span>
      </div>

      <div className="px-4 py-3 border-b border-slate-800">
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wider text-sky-300">Credits balance</p>
          <p className="text-sm font-semibold text-sky-200">
            {creditsBalance === null ? '--' : new Intl.NumberFormat('en-US').format(creditsBalance)}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => handleBillingAction('add-credits')}
              className="inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
            >
              Add credits
            </button>
            <button
              type="button"
              onClick={() => handleBillingAction('upgrade')}
              className="inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
            >
              Upgrade plan
            </button>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
              pathname === href
                ? 'bg-sky-500/10 text-sky-300 border border-sky-500/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60 border border-transparent',
            )}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}

        {isPrivileged && (
          <>
            <div className="pt-3 pb-1 px-3">
              <span className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                Admin
              </span>
            </div>
            {ADMIN_NAV.map(({ href, label, icon: Icon }) => {
              const tabMatch = href.match(/tab=([^&]+)/);
              const isBillingBase = href === '/app/billing';
              const isActive = tabMatch
                ? pathname.startsWith('/app/billing') && activeBillingTab === tabMatch[1]
                : isBillingBase
                  ? pathname.startsWith('/app/billing') && activeBillingTab === 'overview'
                  : href === '/app/admin/context'
                    ? pathname === href
                  : pathname.startsWith(href);

              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                    isActive
                      ? 'bg-sky-500/10 text-sky-300 border border-sky-500/20'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60 border border-transparent',
                  )}
                >
                  <Icon size={16} />
                  {label}
                </Link>
              );
            })}
          </>
        )}
      </nav>

      <div className="border-t border-slate-800 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm text-white font-medium truncate">{me.user.name}</p>
            <p className="text-xs text-slate-500 truncate">{me.user.role}</p>
          </div>
          <button
            onClick={handleLogout}
            className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
            title="Sign out"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
      <Modal
        open={showAdminPrompt}
        onClose={() => setShowAdminPrompt(false)}
        title="Ask your admin"
        className="max-w-md"
      >
        <p className="text-sm text-slate-300">
          Ask your admin to add credits or upgrade your plan.
        </p>
        <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300">
          Please add credits or upgrade plan for {me.org.name}.
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={copyAdminMessage}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-slate-500 hover:text-white"
          >
            <Copy size={14} />
            {copied ? 'Copied' : 'Copy message'}
          </button>
          <button
            type="button"
            onClick={() => setShowAdminPrompt(false)}
            className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            Close
          </button>
        </div>
      </Modal>
    </aside>
  );
}

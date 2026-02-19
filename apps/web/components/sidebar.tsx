'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
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
  Package,
  CreditCard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MeResponse } from '@live-sales-coach/shared';

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
  { href: '/app/admin/company', label: 'Company', icon: Building2 },
  { href: '/app/admin/products', label: 'Products', icon: Package },
  { href: '/app/billing', label: 'Billing', icon: CreditCard },
  { href: '/app/admin/users', label: 'Users', icon: Users },
  { href: '/app/admin/agents', label: 'Agents', icon: Bot },
];

interface SidebarProps {
  me: MeResponse;
}

export function Sidebar({ me }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isPrivileged = me.user.role === 'ADMIN' || me.user.role === 'MANAGER';

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <aside className="flex flex-col w-60 shrink-0 bg-slate-900 border-r border-slate-800 h-screen sticky top-0">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-800">
        <div className="w-7 h-7 rounded-md bg-emerald-500 flex items-center justify-center">
          <span className="text-white font-bold text-xs">L</span>
        </div>
        <span className="text-white font-semibold text-sm">Live Sales Coach</span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
              pathname === href
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60',
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
            {ADMIN_NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                  pathname.startsWith(href)
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60',
                )}
              >
                <Icon size={16} />
                {label}
              </Link>
            ))}
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
    </aside>
  );
}

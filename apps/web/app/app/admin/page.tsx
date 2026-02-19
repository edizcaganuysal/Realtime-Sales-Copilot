import Link from 'next/link';
import { ArrowRight, Users, Package, CreditCard, ClipboardList, BookOpen } from 'lucide-react';

const QUICK_LINKS = [
  {
    href: '/app/admin/users',
    title: 'Users',
    description: 'Invite teammates and adjust permissions.',
    icon: Users,
  },
  {
    href: '/app/admin/context/offerings',
    title: 'Offerings',
    description: 'Manage offerings context used across agents and calls.',
    icon: Package,
  },
  {
    href: '/app/billing',
    title: 'Billing',
    description: 'Check plan details, credits, and ledger history.',
    icon: CreditCard,
  },
  {
    href: '/app/admin/requests',
    title: 'Requests',
    description: 'Track custom agent and fine-tuning requests.',
    icon: ClipboardList,
  },
  {
    href: '/app/admin/playbooks',
    title: 'Playbooks',
    description: 'Define call stages and coaching guidance.',
    icon: BookOpen,
  },
];

export default function AdminPage() {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Admin</h1>
        <p className="text-slate-400 mt-1">Quick access to core organization controls.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {QUICK_LINKS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-xl border border-slate-800 bg-slate-900/70 p-4 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded-lg bg-slate-800 p-1.5 text-sky-300">
                      <Icon size={14} />
                    </span>
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                  </div>
                  <p className="text-sm text-slate-400 mt-2">{item.description}</p>
                </div>
                <ArrowRight
                  size={16}
                  className="shrink-0 text-slate-500 group-hover:text-slate-300 transition-colors"
                />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

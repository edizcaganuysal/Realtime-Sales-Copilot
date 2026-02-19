import Link from 'next/link';
import { Bot, ArrowRight, Shield, Zap, Users } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';

const DRILLS = [
  {
    id: 'budget-blocker',
    title: 'Budget objection handling',
    detail: 'Practice reframing cost into measurable business value.',
    icon: Shield,
    href: '/app/dialer/new?mode=practice&persona=budget-blocker',
  },
  {
    id: 'time-waster',
    title: 'Time-pressure qualification',
    detail: 'Stay concise and qualify quickly when the buyer is rushed.',
    icon: Zap,
    href: '/app/dialer/new?mode=practice&persona=time-waster',
  },
  {
    id: 'competitor-loyalist',
    title: 'Competitor displacement',
    detail: 'Handle incumbent bias with clear differentiation and proof.',
    icon: Users,
    href: '/app/dialer/new?mode=practice&persona=competitor-loyalist',
  },
];

export default function TrainingPage() {
  return (
    <div className="p-8 space-y-6">
      <PageHeader
        title="Training"
        description="Run focused practice drills before live calls."
        actions={
          <Link
            href="/app/dialer/new?mode=practice"
            className="inline-flex items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-200 hover:bg-sky-500/20 transition-colors"
          >
            <Bot size={15} />
            Start practice call
          </Link>
        }
      />

      <div className="grid gap-3">
        {DRILLS.map((drill) => {
          const Icon = drill.icon;
          return (
            <div
              key={drill.id}
              className="rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 rounded-lg bg-slate-800 p-2 text-sky-300">
                    <Icon size={15} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{drill.title}</p>
                    <p className="text-sm text-slate-400 mt-1">{drill.detail}</p>
                  </div>
                </div>
                <Link
                  href={drill.href}
                  className="shrink-0 inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:border-sky-500/40 transition-colors"
                >
                  Practice
                  <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

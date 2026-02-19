import Link from 'next/link';

const STATS = [
  { label: 'Calls coached', value: '2M+' },
  { label: 'Average rep adoption', value: '91%' },
  { label: 'Time to first insight', value: '< 30s' },
];

const HIGHLIGHTS = [
  'Real-time next-line coaching during live calls',
  'Configurable AI agents aligned to your company playbook',
  'Post-call summaries with strengths, risks, and next actions',
  'Team governance controls for managers and admins',
];

export default function HomePage() {
  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 -z-10 h-72 bg-gradient-to-b from-emerald-100 to-transparent" />

      <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-14 sm:px-6 lg:px-8 lg:pt-20">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <p className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-700">
              AI sales coaching platform
            </p>
            <h1 className="mt-5 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              Coach every rep live, without adding manager overhead.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
              Sales AI listens to sales conversations in real time and gives clean, contextual guidance so reps stay sharp and consistent.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/book-demo"
                className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
              >
                Book demo
              </Link>
              <Link
                href="/book-demo?type=custom-agent"
                className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
              >
                Request custom agent
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">What teams get</p>
            <ul className="mt-4 space-y-3">
              {HIGHLIGHTS.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-slate-600">
                  <span className="mt-1 h-2 w-2 rounded-full bg-emerald-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {STATS.map((stat) => (
                <div key={stat.label} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-lg font-semibold text-slate-900">{stat.value}</p>
                  <p className="mt-1 text-xs text-slate-500">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid gap-4 md:grid-cols-3">
            <Link href="/product" className="rounded-xl border border-slate-200 p-5 transition-colors hover:bg-slate-50">
              <h2 className="text-base font-semibold text-slate-900">Product</h2>
              <p className="mt-2 text-sm text-slate-600">Explore live coaching, playbooks, and manager controls.</p>
            </Link>
            <Link href="/how-it-works" className="rounded-xl border border-slate-200 p-5 transition-colors hover:bg-slate-50">
              <h2 className="text-base font-semibold text-slate-900">How it works</h2>
              <p className="mt-2 text-sm text-slate-600">See how reps, managers, and AI work together in one loop.</p>
            </Link>
            <Link href="/pricing" className="rounded-xl border border-slate-200 p-5 transition-colors hover:bg-slate-50">
              <h2 className="text-base font-semibold text-slate-900">Pricing</h2>
              <p className="mt-2 text-sm text-slate-600">Simple tiers based on monthly coaching credits.</p>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

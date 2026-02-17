import Link from 'next/link';

const STAGES = ['Discovery', 'Pain', 'Solution', 'Close'] as const;

const NUDGES = ['Address objection', 'Ask a question', 'Tone: soften'] as const;

const CHECKLIST = [
  { text: 'Current tool identified', done: true },
  { text: 'Pain quantified', done: true },
  { text: 'Decision maker confirmed', done: false },
  { text: 'Timeline established', done: false },
] as const;

const FEATURES = [
  {
    icon: '✦',
    title: 'Clean live UI',
    description:
      '3 layout presets keep reps focused. Transcript stays collapsed until needed. MINIMAL, STANDARD, or TRANSCRIPT mode per call.',
  },
  {
    icon: '⚡',
    title: 'Real-time coaching',
    description:
      'One primary "What to say next" card, micro-nudge chips, and 2 on-demand alternatives — surfaced at exactly the right moment.',
  },
  {
    icon: '🔐',
    title: 'Team governance',
    description:
      'Control agent publishing, rep permissions, and layout defaults org-wide with 5 simple settings. No complexity overload.',
  },
] as const;

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <nav className="border-b border-slate-700/60 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 font-bold text-slate-900">
              L
            </div>
            <span className="text-lg font-semibold">Live Sales Coach</span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-sm text-slate-300 transition-colors hover:text-white"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-emerald-400"
            >
              Start Free Trial
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-6 py-24 text-center">
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-1.5 text-sm font-medium text-emerald-400">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          Real-time AI coaching — live on every call
        </div>

        <h1 className="mb-6 text-5xl font-bold tracking-tight md:text-7xl">
          Close more deals.
          <br />
          <span className="text-emerald-400">With AI by your side.</span>
        </h1>

        <p className="mx-auto mb-10 max-w-2xl text-xl text-slate-400">
          Live Sales Coach listens to your outbound calls in real time, surfaces the right thing to
          say next, and keeps reps on track — without overwhelming them.
        </p>

        <div className="flex items-center justify-center gap-4">
          <Link
            href="/signup"
            className="rounded-xl bg-emerald-500 px-8 py-3 text-lg font-semibold text-slate-900 transition-colors hover:bg-emerald-400"
          >
            Get Started Free
          </Link>
          <Link
            href="/demo"
            className="rounded-xl border border-slate-600 px-8 py-3 text-lg font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
          >
            Watch Demo
          </Link>
        </div>
      </section>

      {/* ── Live UI Preview ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <p className="mb-4 text-center text-sm font-medium text-slate-500 uppercase tracking-wider">
          Live Coach — Standard Layout
        </p>
        <div className="rounded-2xl border border-slate-700 bg-slate-800 p-6">
          {/* Window chrome */}
          <div className="mb-6 flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-red-500" />
            <div className="h-3 w-3 rounded-full bg-yellow-500" />
            <div className="h-3 w-3 rounded-full bg-green-500" />
            <span className="ml-2 font-mono text-sm text-slate-400">
              call:8a3f · Acme Corp · 4:32
            </span>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {/* Left: coaching */}
            <div className="col-span-2 space-y-4">
              {/* Stage indicator */}
              <div className="flex items-center gap-2">
                {STAGES.map((stage, i) => (
                  <div
                    key={stage}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      i === 1
                        ? 'bg-emerald-500 text-slate-900'
                        : 'bg-slate-700 text-slate-400'
                    }`}
                  >
                    {stage}
                  </div>
                ))}
              </div>

              {/* Primary suggestion — the centrepiece */}
              <div className="rounded-xl border border-emerald-500/30 bg-slate-700 p-4">
                <div className="mb-2 text-xs font-medium text-emerald-400 uppercase tracking-wide">
                  What to say next
                </div>
                <p className="text-base leading-relaxed text-white">
                  &ldquo;It sounds like response time is the core frustration. If we could cut
                  that from 4 hours to under 15 minutes, what would that mean for your
                  team&apos;s targets?&rdquo;
                </p>
                <button className="mt-3 text-xs text-slate-400 underline-offset-2 hover:text-slate-300 hover:underline">
                  More options →
                </button>
              </div>

              {/* Nudge chips */}
              <div className="flex flex-wrap gap-2">
                {NUDGES.map((nudge) => (
                  <span
                    key={nudge}
                    className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400"
                  >
                    {nudge}
                  </span>
                ))}
              </div>
            </div>

            {/* Right: checklist + transcript toggle */}
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-700 p-4">
                <div className="mb-3 text-xs font-medium text-slate-400 uppercase tracking-wide">
                  Discovery checklist
                </div>
                <div className="space-y-2">
                  {CHECKLIST.map((item) => (
                    <div key={item.text} className="flex items-center gap-2">
                      <div
                        className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
                          item.done
                            ? 'border-emerald-500 bg-emerald-500'
                            : 'border-slate-500'
                        }`}
                      >
                        {item.done && (
                          <span className="text-[10px] font-bold text-slate-900">✓</span>
                        )}
                      </div>
                      <span
                        className={`text-xs ${
                          item.done ? 'text-slate-500 line-through' : 'text-slate-300'
                        }`}
                      >
                        {item.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Transcript drawer trigger */}
              <button className="flex w-full items-center justify-between rounded-xl bg-slate-700 p-3 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-600">
                <span>Transcript</span>
                <span>↑ Show</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <h2 className="mb-12 text-center text-3xl font-bold">Everything your team needs</h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-slate-700 bg-slate-800 p-6"
            >
              <div className="mb-4 text-3xl">{f.icon}</div>
              <h3 className="mb-2 text-lg font-semibold">{f.title}</h3>
              <p className="text-sm leading-relaxed text-slate-400">{f.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-700/60 px-6 py-8 text-center text-sm text-slate-500">
        <p>© 2026 Live Sales Coach · Multi-tenant B2B sales coaching platform</p>
      </footer>
    </main>
  );
}

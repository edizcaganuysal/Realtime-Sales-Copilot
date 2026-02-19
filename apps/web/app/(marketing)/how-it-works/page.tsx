import Link from 'next/link';

const STEPS = [
  {
    title: '1. Connect your workflow',
    body: 'Pick your coaching defaults, rep permissions, and approved agents so every call starts from the same standard.',
  },
  {
    title: '2. Coach calls in real time',
    body: 'As reps talk, the assistant updates suggestions and context so they can adapt quickly without reading long scripts.',
  },
  {
    title: '3. Review and improve',
    body: 'After each call, managers get structured QA signals and reps get clear next actions for the next conversation.',
  },
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="max-w-3xl">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">How it works</h1>
        <p className="mt-4 text-lg leading-relaxed text-slate-600">
          A simple loop: set standards, coach live, measure outcomes.
        </p>
      </div>

      <div className="mt-10 space-y-4">
        {STEPS.map((step) => (
          <div key={step.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">{step.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/pricing"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
        >
          View pricing
        </Link>
        <Link
          href="/book-demo"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
        >
          Book demo
        </Link>
      </div>
    </div>
  );
}

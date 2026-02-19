import Link from 'next/link';

const BLOCKS = [
  {
    title: 'Live guidance panel',
    body: 'During calls, reps get one clear next line, context cards, and pace nudges that update in seconds.',
  },
  {
    title: 'Team playbooks',
    body: 'Define your own stages and checklist outcomes so coaching aligns with your process, not generic scripts.',
  },
  {
    title: 'Post-call QA',
    body: 'Each call ends with structured summaries, strengths, improvements, and execution risks for faster coaching follow-up.',
  },
  {
    title: 'Governance controls',
    body: 'Admins and managers control agent publishing, rep permissions, and defaults across the workspace.',
  },
];

export default function ProductPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="max-w-3xl">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">Product</h1>
        <p className="mt-4 text-lg leading-relaxed text-slate-600">
          Live Sales Coach gives reps a focused in-call assistant and gives managers a repeatable coaching system across every conversation.
        </p>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {BLOCKS.map((block) => (
          <div key={block.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">{block.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{block.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
        <h3 className="text-lg font-semibold text-slate-900">Need a tailored coaching profile?</h3>
        <p className="mt-2 text-sm text-slate-700">
          We can build a custom agent tuned to your segment, objection patterns, and qualification standards.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/book-demo?type=custom-agent"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
          >
            Request custom agent
          </Link>
          <Link
            href="/book-demo"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
          >
            Book demo
          </Link>
        </div>
      </div>
    </div>
  );
}

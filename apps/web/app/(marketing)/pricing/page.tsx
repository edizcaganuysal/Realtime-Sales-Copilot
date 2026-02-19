import Link from 'next/link';

const TIERS = [
  {
    name: 'Starter',
    credits: '2,500 credits/month',
    idealFor: 'Small teams getting started with live coaching',
  },
  {
    name: 'Pro',
    credits: '10,000 credits/month',
    idealFor: 'Growing sales teams running coaching every day',
    featured: true,
  },
  {
    name: 'Business',
    credits: '30,000 credits/month',
    idealFor: 'Larger orgs standardizing coaching across squads',
  },
];

const FEATURES = [
  'Live in-call suggestions',
  'Post-call summaries and QA insights',
  'Custom playbooks and stage checklists',
  'Agent governance and approval controls',
  'Admin and manager workspace controls',
];

export default function PricingPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="max-w-3xl">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">Pricing</h1>
        <p className="mt-4 text-lg leading-relaxed text-slate-600">
          All features included, higher tiers include more credits.
        </p>
      </div>

      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        {TIERS.map((tier) => (
          <div
            key={tier.name}
            className={
              'rounded-2xl border p-6 shadow-sm ' +
              (tier.featured
                ? 'border-emerald-300 bg-emerald-50'
                : 'border-slate-200 bg-white')
            }
          >
            <p className="text-sm font-semibold text-slate-900">{tier.name}</p>
            <p className="mt-3 text-2xl font-bold text-slate-900">{tier.credits}</p>
            <p className="mt-2 text-sm text-slate-600">{tier.idealFor}</p>
            <ul className="mt-5 space-y-2">
              {FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="mt-1 h-2 w-2 rounded-full bg-emerald-500" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/book-demo"
              className="mt-6 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
            >
              Book demo
            </Link>
          </div>
        ))}
      </div>

      <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Need high-volume support?</h2>
        <p className="mt-2 text-sm text-slate-600">
          Enterprise plans are available for dedicated onboarding, governance workflows, and larger monthly credit pools.
        </p>
        <Link
          href="/book-demo?type=enterprise"
          className="mt-4 inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
        >
          Enterprise
        </Link>
      </div>
    </div>
  );
}

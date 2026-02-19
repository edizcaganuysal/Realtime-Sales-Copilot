const ITEMS = [
  {
    title: 'Access control',
    text: 'Role-based permissions are enforced across admin, manager, and rep workflows to reduce unintended access.',
  },
  {
    title: 'Encrypted transport',
    text: 'Traffic between browser and services is delivered over TLS-enabled endpoints in production.',
  },
  {
    title: 'Operational visibility',
    text: 'Health checks and server logs are available for runtime monitoring and incident triage.',
  },
  {
    title: 'Data minimization',
    text: 'Only required call and coaching metadata is stored for product operation and review workflows.',
  },
];

export default function SecurityPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="max-w-3xl">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">Security</h1>
        <p className="mt-4 text-lg leading-relaxed text-slate-600">
          Security and reliability are built into the product baseline with practical controls for access, transport, and operations.
        </p>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {ITEMS.map((item) => (
          <div key={item.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">{item.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.text}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Need a security review package?</h2>
        <p className="mt-2 text-sm text-slate-600">
          We can walk through architecture, controls, and deployment posture with your security or procurement team.
        </p>
      </div>
    </div>
  );
}

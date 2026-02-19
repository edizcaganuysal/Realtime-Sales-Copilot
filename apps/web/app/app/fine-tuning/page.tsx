export default function FineTuningPage() {
  return (
    <div className="p-8 max-w-3xl">
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h1 className="text-xl font-semibold text-white">Fine-tuning</h1>
        <p className="mt-2 text-sm text-slate-400">
          Fine-tuning is in progress. This will adapt coaching to your calls, offerings, and objection
          patterns with stronger consistency.
        </p>
        <div className="mt-4 space-y-2 text-sm text-slate-300">
          <p>Planned data inputs:</p>
          <ul className="list-disc pl-5 text-slate-400">
            <li>Call recordings and transcripts</li>
            <li>Win/loss outcomes and follow-up notes</li>
            <li>Context and offerings history</li>
          </ul>
        </div>
        <button
          type="button"
          disabled
          className="mt-6 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-400"
        >
          Request fine-tuning
        </button>
      </div>
    </div>
  );
}

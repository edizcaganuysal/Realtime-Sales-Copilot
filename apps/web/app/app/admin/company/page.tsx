'use client';

import { useEffect, useMemo, useState } from 'react';

type CompanyProfile = {
  companyName: string;
  productName: string;
  productSummary: string;
  idealCustomerProfile: string;
  valueProposition: string;
  differentiators: string;
  proofPoints: string;
  repTalkingPoints: string;
  discoveryGuidance: string;
  qualificationGuidance: string;
  objectionHandling: string;
  competitorGuidance: string;
  pricingGuidance: string;
  implementationGuidance: string;
  faq: string;
  doNotSay: string;
};

const DEFAULT_PROFILE: CompanyProfile = {
  companyName: 'GTAPhotoPro',
  productName: 'GTAPhotoPro Real Estate Photo & Media',
  productSummary:
    'Capturing Real Estate Beauty in the Greater Toronto Area with interior photography, exterior photography, drone media, virtual tours, and virtual staging.',
  idealCustomerProfile:
    'Greater Toronto Area real-estate agents, broker teams, and developers who need faster listing launch, premium visuals, and one reliable media partner.',
  valueProposition:
    '- Standard listing photos are delivered in 24 hours for most shoots.\n- Client campaigns average +31% listing click-through and +19% more showing requests in the first 14 days.\n- Virtual staging lifts inquiry rate by ~24% on vacant properties.\n- Drone + twilight bundles improve premium-listing engagement by ~33%.',
  differentiators:
    '- Specialized in GTA real-estate media only, with one team covering interior, exterior, drone, tours, and staging.\n- 98.2% on-time delivery rate over the last 12 months.\n- 14 photographers on the active roster: 9 senior listing photographers, 5 certified drone pilots.\n- Standardized editing workflow keeps color style and composition consistent across broker teams.\n- One-vendor workflow reduces listing media coordination time by ~38%.',
  proofPoints:
    '- 3,180+ GTA properties photographed.\n- 640+ completed listing media packages in the last 12 months.\n- 4.9/5 average rating from 420+ verified reviews.\n- 24-hour standard photo turnaround achieved on 91% of shoots.\n- 46% of monthly bookings are repeat broker-team clients.\n- 87% of shoots include same-week booking availability.\n- 12,000+ edited portfolio photos across detached, condo, and luxury listings.\n- 22 partnered brokerages served in the GTA.',
  repTalkingPoints:
    '- Open with permission and one clear reason for the call.\n- Use one numeric argument per message: 24-hour turnaround, +31% click-through, or 4.9/5 review score.\n- Recommend one package at a time: Basic (1h), Full (1h30m), Drone Videography (2h).\n- Keep replies short: one question at a time, then pause.\n- End with one concrete next step: pilot listing booking or 15-minute package-fit call.',
  discoveryGuidance:
    '- Ask how they handle listing photos, drone, and staging today.\n- Ask average media turnaround and how many listings wait on photos each month.\n- Ask what breaks most: delays, inconsistent quality, weak hero shots, or vendor coordination.\n- Ask what they want this quarter: faster launch, more showings, or premium listing presentation.',
  qualificationGuidance:
    '- Need: confirm media speed or quality is costing momentum.\n- Timeline: ask next listing go-live date.\n- Decision process: solo agent decision vs broker/manager approval.\n- Volume: qualify monthly listings (1-5, 6-15, 16+).\n- Service mix: photo only vs photo + drone + staging.',
  objectionHandling:
    'BUDGET: ask if concern is per-listing price or monthly spend predictability.\nCOMPETITOR: ask what currently works and what still breaks, then compare 98.2% on-time delivery and one-vendor workflow.\nTIMING: align to next listing date and offer a pilot.\nNO NEED: ask one diagnostic question and exit politely if no pain.',
  competitorGuidance:
    '- Do not attack competitors; compare on speed, consistency, service breadth, and GTA familiarity.\n- If they use separate vendors for photo/drone/staging, position GTAPhotoPro as one accountable team.\n- Suggest a pilot listing benchmark to compare turnaround and quality objectively.',
  pricingGuidance:
    '- Prices are customized; ask property type, square footage, and deliverables first.\n- Use package framing: Basic (1h), Full (1h30m), Drone Videography (2h).\n- If exact price is unknown, commit to a same-day quote after one qualifier.',
  implementationGuidance:
    '- Start with one pilot listing to validate quality + turnaround.\n- Standard workflow: booking, shot-list confirmation, shoot, edit, delivery link in 24-48 hours.\n- For broker teams, assign recurring shoot windows and one coordination contact.\n- Review first 3 completed listings, then lock a monthly package cadence.',
  faq:
    'Q: What areas do you serve?\nA: Greater Toronto Area and nearby high-volume listing corridors.\n\nQ: What services are available?\nA: Interior/exterior photography, aerial media, virtual tours, and virtual staging.\n\nQ: How fast is delivery?\nA: Standard photos are usually delivered in 24 hours; expanded packages can take 24-48 hours.\n\nQ: How can prospects contact us?\nA: +1 647 901 6804 or gtaphotopro@gmail.com.',
  doNotSay:
    '- Do not guarantee sale price or sale speed outcomes.\n- Do not quote exact pricing without listing details.\n- Do not pressure prospects after a clear decline.\n- Avoid generic claims that are not tied to deliverables or metrics.',
};

const FIELDS: Array<{
  key: keyof CompanyProfile;
  label: string;
  hint: string;
  rows?: number;
}> = [
  { key: 'companyName', label: 'Company Name', hint: 'Used in call openings and context.' },
  { key: 'productName', label: 'Product Name', hint: 'What reps are selling.' },
  { key: 'productSummary', label: 'Product Summary', hint: 'One concise explanation.', rows: 3 },
  { key: 'idealCustomerProfile', label: 'Ideal Customer Profile', hint: 'Who is the best fit?', rows: 3 },
  { key: 'valueProposition', label: 'Value Proposition', hint: 'Use outcome-focused bullets with metrics.', rows: 5 },
  { key: 'differentiators', label: 'Competitive Advantages', hint: 'Why switch to your product?', rows: 5 },
  { key: 'proofPoints', label: 'Data & Proof Points', hint: 'Numeric facts reps can cite.', rows: 6 },
  { key: 'repTalkingPoints', label: 'Rep Talking Points', hint: 'Behavior and tone expectations.', rows: 5 },
  { key: 'discoveryGuidance', label: 'Discovery Guidance', hint: 'What to ask and uncover.', rows: 5 },
  { key: 'qualificationGuidance', label: 'Qualification Guidance', hint: 'Need, timeline, authority, rollout.', rows: 5 },
  { key: 'objectionHandling', label: 'Objection Handling', hint: 'Budget, timing, competitor, authority flows.', rows: 8 },
  { key: 'competitorGuidance', label: 'Competitor Positioning', hint: 'How to position without attacking.', rows: 4 },
  { key: 'pricingGuidance', label: 'Pricing Guidance', hint: 'What reps can/cannot say before quoting.', rows: 4 },
  { key: 'implementationGuidance', label: 'Implementation Guidance', hint: 'Pilot and rollout approach.', rows: 4 },
  { key: 'faq', label: 'Product FAQ', hint: 'Common question/answer pairs.', rows: 8 },
  { key: 'doNotSay', label: 'Compliance Guardrails', hint: 'Claims or language reps should avoid.', rows: 4 },
];

export default function AdminCompanyPage() {
  const [profile, setProfile] = useState<CompanyProfile>(DEFAULT_PROFILE);
  const [baseline, setBaseline] = useState<CompanyProfile>(DEFAULT_PROFILE);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'saved' | 'error' | null>(null);

  useEffect(() => {
    async function load() {
      const res = await fetch('/api/org/company-profile');
      const data = await res.json();
      const next = { ...DEFAULT_PROFILE, ...(data ?? {}) };
      setProfile(next);
      setBaseline(next);
      setLoading(false);
    }
    load().catch(() => setLoading(false));
  }, []);

  const dirty = useMemo(
    () => JSON.stringify(profile) !== JSON.stringify(baseline),
    [baseline, profile],
  );

  function patch<K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setStatus(null);
    const res = await fetch('/api/org/company-profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });
    setSaving(false);
    if (res.ok) {
      const saved = await res.json();
      const normalized = { ...DEFAULT_PROFILE, ...(saved ?? {}) };
      setProfile(normalized);
      setBaseline(normalized);
      setStatus('saved');
    } else {
      setStatus('error');
    }
    setTimeout(() => setStatus(null), 3000);
  }

  if (loading) {
    return (
      <div className="p-8 space-y-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-16 bg-slate-800 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-white">Company Info</h1>
        <p className="text-sm text-slate-500 mt-1">
          This context powers GTAPhotoPro live coaching and objection responses.
        </p>
      </div>

      <div className="space-y-4">
        {FIELDS.map((field) => (
          <section key={field.key} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="mb-2">
              <h2 className="text-sm font-medium text-white">{field.label}</h2>
              <p className="text-xs text-slate-500 mt-0.5">{field.hint}</p>
            </div>
            {field.rows && field.rows > 1 ? (
              <textarea
                value={profile[field.key]}
                rows={field.rows}
                onChange={(e) => patch(field.key, e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            ) : (
              <input
                value={profile[field.key]}
                onChange={(e) => patch(field.key, e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            )}
          </section>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Save company profile'}
        </button>
        {status === 'saved' && <span className="text-sm text-emerald-400">Saved</span>}
        {status === 'error' && (
          <span className="text-sm text-red-400">Failed to save</span>
        )}
      </div>
    </div>
  );
}

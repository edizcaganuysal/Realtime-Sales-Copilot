export interface OrgCompanyProfileInput {
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
}

export const EMPTY_COMPANY_PROFILE_DEFAULTS: OrgCompanyProfileInput = {
  companyName: '',
  productName: '',
  productSummary: '',
  idealCustomerProfile: '',
  valueProposition: '',
  differentiators: '',
  proofPoints: '',
  repTalkingPoints: '',
  discoveryGuidance: '',
  qualificationGuidance: '',
  objectionHandling: '',
  competitorGuidance: '',
  pricingGuidance: '',
  implementationGuidance: '',
  faq: '',
  doNotSay: '',
};

export const GTAPHOTOPRO_COMPANY_PROFILE_DEFAULTS: OrgCompanyProfileInput = {
  companyName: 'GTAPhotoPro',
  productName: 'GTAPhotoPro Real Estate Photo & Media',
  productSummary:
    'Capturing Real Estate Beauty in the Greater Toronto Area with interior photography, exterior photography, drone media, virtual tours, and virtual staging.',
  idealCustomerProfile:
    'Greater Toronto Area real-estate agents, broker teams, and developers who need faster listing launch, premium visuals, and one reliable media partner.',
  valueProposition:
    '- Standard listing photos are delivered in 24 hours for most shoots.\n' +
    '- Client campaigns average +31% listing click-through and +19% more showing requests in the first 14 days.\n' +
    '- Virtual staging lifts inquiry rate by ~24% on vacant properties.\n' +
    '- Drone + twilight bundles improve premium-listing engagement by ~33%.',
  differentiators:
    '- Specialized in GTA real-estate media only, with one team covering interior, exterior, drone, tours, and staging.\n' +
    '- 98.2% on-time delivery rate over the last 12 months.\n' +
    '- 14 photographers on the active roster: 9 senior listing photographers, 5 certified drone pilots.\n' +
    '- Standardized editing workflow keeps color style and composition consistent across broker teams.\n' +
    '- One-vendor workflow reduces listing media coordination time by ~38%.',
  proofPoints:
    '- 3,180+ GTA properties photographed.\n' +
    '- 640+ completed listing media packages in the last 12 months.\n' +
    '- 4.9/5 average rating from 420+ verified reviews.\n' +
    '- 24-hour standard photo turnaround achieved on 91% of shoots.\n' +
    '- 46% of monthly bookings are repeat broker-team clients.\n' +
    '- 87% of shoots include same-week booking availability.\n' +
    '- 12,000+ edited portfolio photos across detached, condo, and luxury listings.\n' +
    '- 22 partnered brokerages served in the GTA.',
  repTalkingPoints:
    '- Open with permission and one clear reason for the call.\n' +
    '- Use one numeric argument per message: 24-hour turnaround, +31% click-through, or 4.9/5 review score.\n' +
    '- Recommend one package at a time: Basic (1h), Full (1h30m), Drone Videography (2h).\n' +
    '- Keep replies short: one question at a time, then pause.\n' +
    '- End with one concrete next step: pilot listing booking or 15-minute package-fit call.',
  discoveryGuidance:
    '- Ask how they handle listing photos, drone, and staging today.\n' +
    '- Ask average media turnaround and how many listings wait on photos each month.\n' +
    '- Ask what breaks most: delays, inconsistent quality, weak hero shots, or vendor coordination.\n' +
    '- Ask what they want this quarter: faster launch, more showings, or premium listing presentation.',
  qualificationGuidance:
    '- Need: confirm media speed or quality is costing momentum.\n' +
    '- Timeline: ask next listing go-live date.\n' +
    '- Decision process: solo agent decision vs broker/manager approval.\n' +
    '- Volume: qualify monthly listings (1-5, 6-15, 16+).\n' +
    '- Service mix: photo only vs photo + drone + staging.',
  objectionHandling:
    'BUDGET:\n' +
    '- Ask if concern is per-listing price or monthly spend predictability.\n' +
    '- Reframe with outcomes: 24-hour delivery and higher inquiry rates can offset media cost quickly.\n' +
    'COMPETITOR / ALREADY USING SOMETHING:\n' +
    '- Ask what currently works and what still breaks (speed, consistency, availability).\n' +
    '- Position GTAPhotoPro on 98.2% on-time delivery, full-service bundle, and GTA specialization.\n' +
    'TIMING:\n' +
    '- Ask when the next listing photos are needed and align to that date.\n' +
    '- Offer a low-risk pilot on one listing instead of full vendor change.\n' +
    'NO NEED:\n' +
    '- Ask one diagnostic question about missed opportunities from weak listing visuals.\n' +
    '- If no pain exists, exit politely and ask permission to reconnect later.',
  competitorGuidance:
    '- Do not attack competitors; compare on speed, consistency, service breadth, and GTA market familiarity.\n' +
    '- If they use separate vendors for photo/drone/staging, position GTAPhotoPro as one accountable team.\n' +
    '- Emphasize a pilot listing benchmark to compare quality and turnaround objectively.',
  pricingGuidance:
    '- Prices are customized; ask property type, square footage, and deliverables first.\n' +
    '- Use package framing: Basic (1h), Full (1h30m), Drone Videography (2h).\n' +
    '- If exact price is unknown, commit to a same-day quote after one qualifier.',
  implementationGuidance:
    '- Start with one pilot listing to validate quality + turnaround.\n' +
    '- Standard workflow: booking, shot-list confirmation, shoot, edit, delivery link in 24-48 hours.\n' +
    '- For broker teams, assign recurring shoot windows and one coordination contact.\n' +
    '- Review first 3 completed listings, then lock a monthly package cadence.',
  faq:
    'Q: What areas do you serve?\n' +
    'A: Greater Toronto Area and nearby high-volume listing corridors.\n\n' +
    'Q: What services are available?\n' +
    'A: Interior/exterior photography, aerial media, virtual tours, and virtual staging.\n\n' +
    'Q: How fast is delivery?\n' +
    'A: Standard photos are usually delivered in 24 hours; expanded packages can take 24-48 hours.\n\n' +
    'Q: How can prospects contact us?\n' +
    'A: +1 647 901 6804 or gtaphotopro@gmail.com.',
  doNotSay:
    '- Do not guarantee sale price or sale speed outcomes.\n' +
    '- Do not quote exact pricing without listing details.\n' +
    '- Do not pressure a prospect after a clear decline.\n' +
    '- Avoid generic claims that are not tied to deliverables or metrics.',
};

// Backward-compatible alias so existing imports do not break immediately.
export const SKYROCKETX_COMPANY_PROFILE_DEFAULTS = GTAPHOTOPRO_COMPANY_PROFILE_DEFAULTS;

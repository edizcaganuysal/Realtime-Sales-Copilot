import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { hash } from 'bcryptjs';
import * as schema from './schema';

const STAGES = [
  {
    position: 0,
    name: 'Opening',
    goals: 'Build rapport and establish credibility quickly.',
    checklistJson: [
      'Introduce yourself and company',
      'State purpose of call clearly',
      'Get permission to continue',
      'Confirm prospect has 5 minutes',
    ],
  },
  {
    position: 1,
    name: 'Discovery',
    goals: 'Uncover pain points, current situation, and decision criteria.',
    checklistJson: [
      'Identify current tool or process',
      'Quantify pain or cost of status quo',
      'Confirm decision-maker is on the call',
      'Establish timeline for change',
      'Uncover budget range',
    ],
  },
  {
    position: 2,
    name: 'Pitch',
    goals: 'Present tailored value proposition aligned to discovered pain.',
    checklistJson: [
      'Recap their pain before pitching',
      'Present 2–3 relevant features only',
      'Tie each feature to their specific pain',
      'Share a relevant customer success story',
    ],
  },
  {
    position: 3,
    name: 'Objection',
    goals: 'Acknowledge, clarify, and resolve blockers without pressure.',
    checklistJson: [
      'Let prospect finish objection fully',
      'Acknowledge the concern genuinely',
      'Ask a clarifying question',
      'Address with evidence or reframe',
      'Confirm objection is resolved before moving on',
    ],
  },
  {
    position: 4,
    name: 'Close',
    goals: 'Secure a clear next step — demo, trial, or signed agreement.',
    checklistJson: [
      'Summarise agreed value',
      'Propose a specific clear next step',
      'Get date and time commitment',
      'Confirm all stakeholders for next step',
      'Send calendar invite before call ends',
    ],
  },
] as const;

const DEFAULT_AGENT_PROMPT = `You are an expert B2B sales coach listening to live outbound calls.

Rules:
- Output the single best next thing to say, written as natural spoken dialogue.
- Keep suggestions to one or two sentences maximum — never a list.
- Personalize every suggestion using the prospect pain and context from the transcript.
- When the rep talks too much, surfaces a SOFTEN_TONE or TOO_MUCH_TALKING nudge.
- When no question has been asked in 90 seconds, surface an ASK_QUESTION nudge.
- Never suggest filler phrases or generic pitches.
- Match the energy and pace of the conversation.`;

async function seed() {
  const pool = new Pool({
    connectionString: process.env['DATABASE_URL'],
    ssl:
      process.env['DATABASE_URL']?.includes('sslmode=require') ||
      process.env['NODE_ENV'] === 'production'
        ? { rejectUnauthorized: false }
        : undefined,
  });

  const db = drizzle(pool, { schema });

  const [org] = await db
    .insert(schema.orgs)
    .values({ name: 'Demo Organization' })
    .returning();

  if (!org) throw new Error('Failed to insert org');

  await db.insert(schema.orgSettings).values({
    orgId: org.id,
    requiresAgentApproval: true,
    allowRepAgentCreation: true,
    publisherPolicy: 'ADMIN_AND_MANAGERS',
    liveLayoutDefault: 'STANDARD',
    retentionDays: 90,
  });

  const adminEmail = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@example.com';
  const adminPassword = process.env['SEED_ADMIN_PASSWORD'] ?? 'Password123!';
  const passwordHash = await hash(adminPassword, 10);

  const [adminUser] = await db
    .insert(schema.users)
    .values({
      orgId: org.id,
      role: 'ADMIN',
      name: 'Admin User',
      email: adminEmail,
      passwordHash,
      status: 'ACTIVE',
    })
    .returning();

  if (!adminUser) throw new Error('Failed to insert admin user');

  const [playbook] = await db
    .insert(schema.playbooks)
    .values({
      orgId: org.id,
      name: 'Default Sales Playbook',
      isDefault: true,
    })
    .returning();

  if (!playbook) throw new Error('Failed to insert playbook');

  for (const stage of STAGES) {
    await db.insert(schema.playbookStages).values({
      playbookId: playbook.id,
      position: stage.position,
      name: stage.name,
      goals: stage.goals,
      checklistJson: stage.checklistJson,
      intentWeightsJson: {},
    });
  }

  await db.insert(schema.agents).values({
    orgId: org.id,
    ownerUserId: null,
    scope: 'ORG',
    status: 'APPROVED',
    name: 'Default Coach',
    prompt: DEFAULT_AGENT_PROMPT,
    configJson: {
      maxSuggestionTokens: 80,
      nudgesEnabled: true,
      alternativeCount: 2,
    },
  });

  console.log('');
  console.log('Seed complete');
  console.log(`  Org:      Demo Organization  (id: ${org.id})`);
  console.log(`  Admin:    ${adminEmail}`);
  console.log(`  Playbook: Default Sales Playbook  (${STAGES.length} stages)`);
  console.log(`  Agent:    Default Coach  [APPROVED, ORG]`);
  console.log('');

  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

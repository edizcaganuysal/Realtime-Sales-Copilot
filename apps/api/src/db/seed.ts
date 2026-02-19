import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { hash } from 'bcryptjs';
import * as schema from './schema';
import { GTAPHOTOPRO_COMPANY_PROFILE_DEFAULTS } from '../org/company-profile.defaults';
import { PROFESSIONAL_SALES_CALL_AGENT_PROMPT } from '../calls/professional-sales-agent.prompt';
import {
  GTAPHOTOPRO_DEMO_AGENT_NAME,
  GTAPHOTOPRO_DEMO_AGENT_PROMPT,
} from '../agents/gtaphotopro-demo.agent';

const STAGES = [
  {
    position: 0,
    name: 'Opening',
    goals: 'Open clearly, get permission, and establish context fast.',
    checklistJson: [
      'Introduce yourself and company',
      'Confirm now is a good time',
      'State purpose with one concrete value point',
      'Ask one opening discovery question',
    ],
  },
  {
    position: 1,
    name: 'Discovery',
    goals: 'Understand current process, friction, impact, and buying path.',
    checklistJson: [
      'Ask how they handle listing media today',
      'Identify biggest friction in current workflow',
      'Quantify impact of delays or inconsistency',
      'Confirm timeline for the next listing',
      'Clarify who else is involved in decisions',
    ],
  },
  {
    position: 2,
    name: 'Value Framing',
    goals: "Map GTAPhotoPro services to the prospect's stated pain.",
    checklistJson: [
      'Recap their pain in their own words',
      'Tie one service to one pain point',
      'Share one numeric proof point',
      'Confirm the proposed approach is relevant',
    ],
  },
  {
    position: 3,
    name: 'Objection Handling',
    goals: 'Handle objections with clarify-and-evidence flow.',
    checklistJson: [
      'Acknowledge objection without arguing',
      'Ask a clarifying question',
      'Respond with specific evidence',
      'Confirm if the concern is addressed',
    ],
  },
  {
    position: 4,
    name: 'Next Step',
    goals: 'Secure a concrete and scheduled follow-up action.',
    checklistJson: [
      'Propose one concrete next step',
      'Offer two scheduling options',
      'Confirm owner and timeline',
      'Confirm follow-up channel',
    ],
  },
] as const;

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
    .values({ name: 'GTAPhotoPro' })
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

  await db.insert(schema.orgCompanyProfiles).values({
    orgId: org.id,
    ...GTAPHOTOPRO_COMPANY_PROFILE_DEFAULTS,
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
    prompt: PROFESSIONAL_SALES_CALL_AGENT_PROMPT,
    configJson: {
      maxSuggestionTokens: 80,
      nudgesEnabled: true,
      alternativeCount: 3,
    },
  });

  await db.insert(schema.agents).values({
    orgId: org.id,
    ownerUserId: null,
    scope: 'ORG',
    status: 'APPROVED',
    name: GTAPHOTOPRO_DEMO_AGENT_NAME,
    prompt: GTAPHOTOPRO_DEMO_AGENT_PROMPT,
    configJson: {
      maxSuggestionTokens: 120,
      nudgesEnabled: false,
      alternativeCount: 3,
      style: 'specific-numeric',
    },
  });

  console.log('');
  console.log('Seed complete');
  console.log(`  Org:      GTAPhotoPro  (id: ${org.id})`);
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

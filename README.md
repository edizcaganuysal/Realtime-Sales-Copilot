# Live Sales Coach

A web-first, multi-tenant B2B sales coaching platform. AI listens to outbound calls in real time and gives reps clean, focused guidance — one suggestion at a time.

## Stack

| Layer        | Technology                                      |
| ------------ | ----------------------------------------------- |
| Web          | Next.js 15 (App Router) · TypeScript · Tailwind · shadcn/ui |
| API          | NestJS · WebSocket Gateway · TypeScript         |
| Database     | PostgreSQL 16                                   |
| Cache/PubSub | Redis 7                                         |
| Dialer       | Twilio outbound (MVP)                           |
| Monorepo     | pnpm workspaces · Turborepo                     |

## Repository Structure

```
live-sales-coach/
├── apps/
│   ├── web/          # Next.js frontend  → http://localhost:3000
│   └── api/          # NestJS backend    → http://localhost:3001
├── packages/
│   └── shared/       # Shared types, zod schemas, RBAC helpers, enums
├── infra/
│   ├── docker-compose.yml
│   └── .env.example
├── package.json      # pnpm workspace root
└── turbo.json
```

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9 — `npm i -g pnpm`
- [Docker Desktop](https://www.docker.com/) (for Postgres + Redis)

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Set up environment variables

```bash
# Copy the master example
cp infra/.env.example infra/.env

# Copy subsets into each app
cp infra/.env.example apps/api/.env
cp infra/.env.example apps/web/.env.local
```

Minimum required for local dev (everything else can stay as placeholder):

| Variable       | Value (dev default)                                |
| -------------- | -------------------------------------------------- |
| `DATABASE_URL` | `postgresql://lsc:lsc_dev_pass@localhost:5432/lsc_db` |
| `REDIS_URL`    | `redis://:lsc_redis_pass@localhost:6379`           |
| `JWT_SECRET`   | any long random string                             |

### 3. Start infrastructure (Postgres + Redis)

```bash
docker compose -f infra/docker-compose.yml up -d
```

Wait ~5 s for the health checks to pass.

### 4. Start all dev servers

```bash
pnpm dev
```

| App     | URL                          |
| ------- | ---------------------------- |
| Web     | http://localhost:3000        |
| API     | http://localhost:3001        |
| Health  | http://localhost:3001/health |

---

## Environment Variables Reference

### API — `apps/api/.env`

| Variable                | Description                          | Example                     |
| ----------------------- | ------------------------------------ | --------------------------- |
| `NODE_ENV`              | Environment                          | `development`               |
| `PORT`                  | API port                             | `3001`                      |
| `DATABASE_URL`          | PostgreSQL connection string         | `postgresql://...`          |
| `REDIS_URL`             | Redis connection string              | `redis://:pass@localhost:6379` |
| `JWT_SECRET`            | JWT signing secret                   | `a-long-random-secret`      |
| `JWT_EXPIRES_IN`        | JWT expiry                           | `7d`                        |
| `TWILIO_ACCOUNT_SID`    | Twilio Account SID                   | `ACxxx...`                  |
| `TWILIO_AUTH_TOKEN`     | Twilio Auth Token                    | `xxx...`                    |
| `TWILIO_PHONE_NUMBER`   | Outbound caller ID                   | `+15551234567`              |
| `TWILIO_TWIML_APP_SID`  | TwiML App SID                        | `APxxx...`                  |
| `TWILIO_WEBHOOK_BASE_URL` | Public base URL (ngrok in dev)     | `https://xyz.ngrok.io`      |
| `STT_PROVIDER`          | Speech-to-text provider              | `deepgram`                  |
| `STT_API_KEY`           | STT API key                          | `...`                       |
| `LLM_PROVIDER`          | LLM provider                         | `openai`                    |
| `LLM_API_KEY`           | LLM API key                          | `sk-...`                    |
| `LLM_MODEL`             | Model ID                             | `gpt-4o`                    |
| `LLM_BASE_URL`          | Optional custom base URL             | _(blank = use provider default)_ |

### Web — `apps/web/.env.local`

| Variable                | Description                | Example                  |
| ----------------------- | -------------------------- | ------------------------ |
| `NEXT_PUBLIC_API_URL`   | API base URL               | `http://localhost:3001`  |
| `NEXT_PUBLIC_WS_URL`    | WebSocket URL              | `ws://localhost:3001`    |
| `NEXT_PUBLIC_APP_NAME`  | Display name               | `Live Sales Coach`       |

---

## Useful Commands

```bash
# Run a single app
pnpm --filter @live-sales-coach/web dev
pnpm --filter @live-sales-coach/api dev

# Build everything
pnpm build

# Lint
pnpm lint

# Format
pnpm format

# Type-check
pnpm type-check

# Stop infra
docker compose -f infra/docker-compose.yml down
```

---

## Architecture

### Multi-Tenant RBAC

Roles: `ADMIN > MANAGER > REP`

| Action                   | ADMIN | MANAGER               | REP               |
| ------------------------ | ----- | --------------------- | ----------------- |
| Manage org settings      | ✓     |                       |                   |
| Publish ORG agents       | ✓     | if `ADMIN_AND_MANAGERS` |                 |
| Create personal agents   | ✓     | ✓                     | if org allows     |
| Approve personal agents  | ✓     | ✓                     |                   |
| View all org calls       | ✓     | ✓                     | own calls only    |

### Org Governance (5 settings)

```typescript
{
  requiresAgentApproval: boolean,
  allowRepAgentCreation: boolean,
  publisherPolicy: 'ADMIN_ONLY' | 'ADMIN_AND_MANAGERS',
  liveLayoutDefault: 'MINIMAL' | 'STANDARD' | 'TRANSCRIPT',
  retentionDays: 30 | 90 | 365,
}
```

### Live Coach UI Layouts

| Layout       | Suggestion   | Nudges              | Transcript           |
| ------------ | ------------ | ------------------- | -------------------- |
| `MINIMAL`    | Large card   | 1–2 chips           | Drawer button only   |
| `STANDARD`   | Large card   | 3 chips + checklist | Slide-over drawer    |
| `TRANSCRIPT` | Floating card | Minimal            | Center stage         |
# Sales-App

# Railway Deployment

## Services

Create two Railway services from this repository:

1. `api` service
- Root Directory: `/` (repository root)
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm --filter @live-sales-coach/api build`
- Start Command: `pnpm --filter @live-sales-coach/api start`

2. `web` service
- Root Directory: `/` (repository root)
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm --filter @live-sales-coach/web build`
- Start Command: `pnpm --filter @live-sales-coach/web start`

Deploy API first, then deploy web.

Recommended shared Railway variable (both services):

- `NIXPACKS_NODE_VERSION=22`

## Database Migrations

Run once after the API service has `DATABASE_URL` configured:

```bash
pnpm --filter @live-sales-coach/api db:migrate
```

Optional first-time seed:

```bash
pnpm --filter @live-sales-coach/api db:seed
```

## Environment Variables

Set these in Railway.

### API service (`apps/api`)

Required:

- `NODE_ENV=production`
- `DATABASE_URL=postgresql://...`
- `JWT_SECRET=<same-secret-used-by-web>`
- `WEB_ORIGIN=https://<your-web-domain>`
- `API_BASE_URL=https://<your-api-domain>`

Optional:

- `JWT_EXPIRES_IN=7d`
- `DATABASE_SSL=true` (recommended for external managed Postgres)
- `PG_POOL_MAX=10`
- `PG_IDLE_TIMEOUT_MS=30000`
- `PG_CONNECT_TIMEOUT_MS=10000`
- `OPENAI_API_KEY=<optional>`
- `LLM_API_KEY=<optional>`
- `LLM_PROVIDER=openai`
- `LLM_MODEL=gpt-5-mini`
- `DEEPGRAM_API_KEY=<optional>`
- `STT_API_KEY=<optional>`
- `STT_PROVIDER=deepgram`
- `TWILIO_ACCOUNT_SID=<optional>`
- `TWILIO_AUTH_TOKEN=<optional>`
- `TWILIO_FROM_NUMBER=+1...`
- `TWILIO_PHONE_NUMBER=+1...`
- `TWILIO_WEBHOOK_BASE_URL=https://<your-api-domain>`

Notes:

- CORS is controlled by `WEB_ORIGIN`.
- If `TWILIO_WEBHOOK_BASE_URL` is not set, API falls back to `API_BASE_URL`.
- If `OPENAI_API_KEY` is set, API can use it without `LLM_API_KEY`.
- If `DEEPGRAM_API_KEY` is set, API can use it without `STT_API_KEY`.

### Web service (`apps/web`)

Required:

- `NODE_ENV=production`
- `APP_BASE_URL=https://<your-web-domain>`
- `API_BASE_URL=https://<your-api-domain>`
- `JWT_SECRET=<same-secret-used-by-api>`

Optional:

- `NEXT_PUBLIC_WS_URL=wss://<your-api-domain>`
- `NEXT_PUBLIC_APP_NAME=Sales AI`
- `GOOGLE_CLIENT_ID=<optional>`
- `GOOGLE_CLIENT_SECRET=<optional>`
- `GOOGLE_OAUTH_REDIRECT_URI=<optional>`

Notes:

- Server-side API calls use `API_BASE_URL`.
- If `NEXT_PUBLIC_WS_URL` is not set, live call UI uses `API_BASE_URL` through `NEXT_PUBLIC_API_URL`.

## Twilio Webhooks and Media Stream

Use your API base domain.

Given:

- `API_BASE_URL=https://api.example.com`

Set:

- TwiML URL: `https://api.example.com/calls/twiml?callId=<call-id>`
- Status Callback URL: `https://api.example.com/calls/webhook/status`
- Media Stream URL: `wss://api.example.com/media-stream`

In this app, outbound call creation sets TwiML and status callback URLs automatically using `TWILIO_WEBHOOK_BASE_URL` or `API_BASE_URL`.

## Smoke Tests After Deploy

Run these after both services are green.

1. API health:

```bash
curl -sS https://<api-domain>/health
```

Expected: JSON with `"status":"ok"`.

2. Auth route reachable:

```bash
curl -i https://<api-domain>/auth/me
```

Expected: `401` without token.

3. Web login page:

- Open `https://<web-domain>/login`
- Confirm page renders.

4. End-to-end app:

- Log in with a valid user.
- Confirm redirect to `/app/home`.
- Open `/app/calls`.
- Start a mock call from `/app/dialer`.
- Confirm live suggestions/transcript appear.

5. CORS validation:

- In browser devtools from web domain, confirm API requests to API domain succeed without CORS errors.

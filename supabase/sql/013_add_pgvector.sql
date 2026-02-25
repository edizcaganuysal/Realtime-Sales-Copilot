-- ============================================================================
-- 013: pgvector extension + embedding_chunks table for RAG retrieval
-- ============================================================================
-- Enables semantic search over company context, products, and knowledge.
-- Used by the unified Copilot Engine to retrieve turn-relevant context.
-- ============================================================================

-- Enable pgvector (requires Supabase paid plan or self-hosted PG with pgvector)
create extension if not exists vector;

-- ── embedding_chunks table ──────────────────────────────────────────────────

create table if not exists public.embedding_chunks (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  source_type   text not null,           -- 'sales_context' | 'product' | 'support_context' | 'knowledge'
  source_id     text,                     -- product.id, agent.id, or null for org-level sources
  field         text not null,            -- e.g. 'proofPoints', 'valueProps', 'elevatorPitch'
  chunk_text    text not null,
  chunk_index   integer not null default 0,
  embedding     vector(1536) not null,    -- text-embedding-3-small output dimension
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

-- Fast org-scoped lookups (all retrieval queries filter by org_id)
create index if not exists idx_ec_org
  on public.embedding_chunks (org_id);

-- Source-type filtering for selective rebuilds
create index if not exists idx_ec_org_source
  on public.embedding_chunks (org_id, source_type);

-- IVFFlat vector similarity index for cosine distance
-- lists=100 is appropriate for up to ~100k rows; increase for larger datasets.
-- NOTE: This index requires at least one row to exist before creation in some
-- pgvector versions. If it fails on an empty table, it will be created
-- automatically on first upsert via a check in EmbeddingService.
create index if not exists idx_ec_embedding
  on public.embedding_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

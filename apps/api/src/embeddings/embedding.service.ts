import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { CreditsService } from '../credits/credits.service';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EmbeddingChunk {
  id: string;
  field: string;
  chunkText: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface RetrievalOptions {
  limit?: number;
  similarityThreshold?: number;
  timeoutMs?: number;
}

export interface ChunkInput {
  field: string;
  text: string;
  metadata?: Record<string, unknown>;
}

/** Precomputed fallback context per stage when RAG is unavailable. */
export type StagePack = Record<string, EmbeddingChunk[]>;

// ─── Constants ───────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const EMBED_API_TIMEOUT_MS = 5000;
const MMR_DEDUP_THRESHOLD = 0.92;

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly apiKey = process.env['LLM_API_KEY'] ?? '';

  /** In-memory stage-pack cache per org (rebuilt on context save). */
  private readonly stagePackCache = new Map<string, StagePack>();

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly creditsService: CreditsService,
  ) {}

  // ─── Embedding Generation ────────────────────────────────────────────────

  /** Embed a single text string. Returns 1536-dimensional vector. */
  async embed(text: string): Promise<number[]> {
    const [result] = await this.embedBatch([text]);
    return result!;
  }

  /** Embed a batch of texts (up to 2048 per OpenAI API call). */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
      signal: AbortSignal.timeout(EMBED_API_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Embedding API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const json = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
      usage?: { prompt_tokens?: number; total_tokens?: number };
    };

    return json.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }

  /**
   * Embed with a timeout — returns null if the API is too slow.
   * Used in the hot path (per-turn retrieval) where we can't block the call.
   */
  async embedWithTimeout(text: string, timeoutMs: number): Promise<number[] | null> {
    try {
      const result = await Promise.race([
        this.embed(text),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      return result;
    } catch (err) {
      this.logger.warn(`embedWithTimeout failed: ${(err as Error).message}`);
      return null;
    }
  }

  // ─── Retrieval ───────────────────────────────────────────────────────────

  /**
   * Retrieve the most relevant chunks for a query, scoped to an org.
   *
   * - Strict org_id filtering (never leaks across orgs)
   * - Cosine similarity threshold (default 0.25)
   * - MMR dedup (removes near-duplicates)
   * - Timeout fallback (returns [] on failure — caller uses stage-pack)
   */
  async retrieveRelevant(
    orgId: string,
    queryText: string,
    options: RetrievalOptions = {},
  ): Promise<EmbeddingChunk[]> {
    const limit = options.limit ?? 8;
    const threshold = options.similarityThreshold ?? 0.25;
    const timeoutMs = options.timeoutMs ?? 150;

    try {
      // Embed the query (with timeout)
      const embedding = await this.embedWithTimeout(queryText, Math.min(timeoutMs, 80));
      if (!embedding) {
        this.logger.warn(`Embedding timed out for org ${orgId} — RAG skipped`);
        return [];
      }

      const vectorLiteral = `[${embedding.join(',')}]`;

      // Fetch extra rows for MMR dedup, then filter
      const rows = await this.db.execute<{
        id: string;
        field: string;
        chunk_text: string;
        metadata: Record<string, unknown>;
        similarity: number;
      }>(sql`
        SELECT
          id,
          field,
          chunk_text,
          metadata,
          1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
        FROM embedding_chunks
        WHERE org_id = ${orgId}
          AND 1 - (embedding <=> ${vectorLiteral}::vector) > ${threshold}
        ORDER BY embedding <=> ${vectorLiteral}::vector
        LIMIT ${limit * 2}
      `);

      const candidates: EmbeddingChunk[] = (rows.rows ?? []).map((r) => ({
        id: r.id,
        field: r.field,
        chunkText: r.chunk_text,
        score: r.similarity,
        metadata: (r.metadata ?? {}) as Record<string, unknown>,
      }));

      return this.applyMMR(candidates, limit);
    } catch (err) {
      this.logger.warn(`RAG retrieval failed for org ${orgId}: ${(err as Error).message}`);
      return [];
    }
  }

  // ─── Upsert (Embedding Generation + Storage) ────────────────────────────

  /**
   * Chunk, embed, and upsert texts for a specific source.
   * Deletes old chunks for the source first, then inserts new ones.
   *
   * @param orgId      - Organization ID
   * @param sourceType - 'sales_context' | 'product' | 'support_context' | 'knowledge'
   * @param sourceId   - Product ID, agent ID, or null for org-level
   * @param chunks     - Array of { field, text, metadata? }
   */
  async upsertChunks(
    orgId: string,
    sourceType: string,
    sourceId: string | null,
    chunks: ChunkInput[],
  ): Promise<void> {
    if (chunks.length === 0) return;

    // Filter out empty/tiny chunks
    const validChunks = chunks.filter((c) => c.text.trim().length >= 20);
    if (validChunks.length === 0) return;

    try {
      // Embed all chunk texts in batch
      const texts = validChunks.map((c) => c.text);
      const embeddings = await this.embedBatch(texts);

      // Delete old chunks for this source
      if (sourceId) {
        await this.db
          .delete(schema.embeddingChunks)
          .where(
            and(
              eq(schema.embeddingChunks.orgId, orgId),
              eq(schema.embeddingChunks.sourceType, sourceType),
              eq(schema.embeddingChunks.sourceId, sourceId),
            ),
          );
      } else {
        await this.db
          .delete(schema.embeddingChunks)
          .where(
            and(
              eq(schema.embeddingChunks.orgId, orgId),
              eq(schema.embeddingChunks.sourceType, sourceType),
            ),
          );
      }

      // Insert new chunks
      const rows = validChunks.map((chunk, i) => ({
        orgId,
        sourceType,
        sourceId,
        field: chunk.field,
        chunkText: chunk.text,
        chunkIndex: i,
        embedding: embeddings[i]!,
        metadata: chunk.metadata ?? {},
      }));

      // Insert in batches of 100 to avoid query size limits
      for (let i = 0; i < rows.length; i += 100) {
        await this.db
          .insert(schema.embeddingChunks)
          .values(rows.slice(i, i + 100));
      }

      // Bill for embedding tokens
      const totalTokens = this.estimateTokenCount(texts.join(' '));
      void this.creditsService.debitForAiUsage(
        orgId,
        EMBEDDING_MODEL,
        totalTokens,
        0,
        'USAGE_EMBEDDING_REBUILD',
        { sourceType, sourceId, chunkCount: validChunks.length },
      );

      this.logger.log(
        `Embedded ${validChunks.length} chunks for org ${orgId} (${sourceType}/${sourceId ?? 'org'})`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to upsert embeddings for org ${orgId}: ${(err as Error).message}`,
      );
    }
  }

  // ─── Bulk Rebuild ────────────────────────────────────────────────────────

  /**
   * Rebuild all embeddings for an org from their current context.
   * Called when salesContext or products change.
   */
  async rebuildOrgEmbeddings(orgId: string): Promise<void> {
    try {
      // Load salesContext + companyProfile + products in parallel
      const [[ctx], [profile], products] = await Promise.all([
        this.db
          .select()
          .from(schema.salesContext)
          .where(eq(schema.salesContext.orgId, orgId))
          .limit(1),
        this.db
          .select()
          .from(schema.orgCompanyProfiles)
          .where(eq(schema.orgCompanyProfiles.orgId, orgId))
          .limit(1),
        this.db
          .select()
          .from(schema.products)
          .where(eq(schema.products.orgId, orgId)),
      ]);

      if (ctx) {
        const chunks = this.chunkSalesContext(ctx);
        await this.upsertChunks(orgId, 'sales_context', null, chunks);
      }

      if (profile) {
        const chunks = this.chunkCompanyProfile(profile);
        await this.upsertChunks(orgId, 'company_profile', null, chunks);
      }

      for (const product of products) {
        const chunks = this.chunkProduct(product);
        await this.upsertChunks(orgId, 'product', product.id, chunks);
      }

      // Rebuild stage-pack
      await this.rebuildStagePack(orgId);

      this.logger.log(`Full embedding rebuild complete for org ${orgId}`);
    } catch (err) {
      this.logger.error(
        `rebuildOrgEmbeddings failed for org ${orgId}: ${(err as Error).message}`,
      );
    }
  }

  // ─── Delete ──────────────────────────────────────────────────────────────

  async deleteChunks(orgId: string, sourceType?: string, sourceId?: string): Promise<void> {
    try {
      if (sourceType && sourceId) {
        await this.db
          .delete(schema.embeddingChunks)
          .where(
            and(
              eq(schema.embeddingChunks.orgId, orgId),
              eq(schema.embeddingChunks.sourceType, sourceType),
              eq(schema.embeddingChunks.sourceId, sourceId),
            ),
          );
      } else if (sourceType) {
        await this.db
          .delete(schema.embeddingChunks)
          .where(
            and(
              eq(schema.embeddingChunks.orgId, orgId),
              eq(schema.embeddingChunks.sourceType, sourceType),
            ),
          );
      } else {
        await this.db
          .delete(schema.embeddingChunks)
          .where(eq(schema.embeddingChunks.orgId, orgId));
      }
    } catch (err) {
      this.logger.error(`deleteChunks failed: ${(err as Error).message}`);
    }
  }

  // ─── Stage-Pack (RAG Fallback) ───────────────────────────────────────────

  /**
   * Get precomputed fallback chunks for a stage.
   * Used when RAG retrieval fails or times out.
   */
  getStagePack(orgId: string, stageName: string): EmbeddingChunk[] {
    const pack = this.stagePackCache.get(orgId);
    if (!pack) return [];
    return pack[stageName] ?? pack['_default'] ?? [];
  }

  /**
   * Rebuild the stage-pack for an org from their existing embedding chunks.
   * Selects top proof points + value props + product summaries.
   */
  async rebuildStagePack(orgId: string): Promise<void> {
    try {
      const rows = await this.db
        .select({
          field: schema.embeddingChunks.field,
          chunkText: schema.embeddingChunks.chunkText,
          metadata: schema.embeddingChunks.metadata,
        })
        .from(schema.embeddingChunks)
        .where(eq(schema.embeddingChunks.orgId, orgId))
        .limit(200);

      const proofPoints = rows
        .filter((r) => r.field === 'proofPoints' || r.field === 'caseStudies')
        .slice(0, 3)
        .map((r, i) => ({
          id: `sp-proof-${i}`,
          field: r.field,
          chunkText: r.chunkText,
          score: 1,
          metadata: (r.metadata ?? {}) as Record<string, unknown>,
        }));

      const valueProps = rows
        .filter((r) => r.field === 'globalValueProps' || r.field === 'valueProps')
        .slice(0, 3)
        .map((r, i) => ({
          id: `sp-vp-${i}`,
          field: r.field,
          chunkText: r.chunkText,
          score: 1,
          metadata: (r.metadata ?? {}) as Record<string, unknown>,
        }));

      const products = rows
        .filter((r) => r.field === 'elevatorPitch')
        .slice(0, 2)
        .map((r, i) => ({
          id: `sp-prod-${i}`,
          field: r.field,
          chunkText: r.chunkText,
          score: 1,
          metadata: (r.metadata ?? {}) as Record<string, unknown>,
        }));

      const defaultPack = [...proofPoints, ...valueProps, ...products];

      this.stagePackCache.set(orgId, { _default: defaultPack });
    } catch (err) {
      this.logger.warn(`rebuildStagePack failed for org ${orgId}: ${(err as Error).message}`);
    }
  }

  // ─── Chunking Helpers ────────────────────────────────────────────────────

  /**
   * Chunk a salesContext row into embedding-ready chunks.
   * Splits on paragraph boundaries; each chunk is 100-500 tokens.
   */
  private chunkSalesContext(ctx: typeof schema.salesContext.$inferSelect): ChunkInput[] {
    const chunks: ChunkInput[] = [];

    const textFields: Array<{ key: keyof typeof ctx; field: string }> = [
      { key: 'whatWeSell', field: 'whatWeSell' },
      { key: 'howItWorks', field: 'howItWorks' },
      { key: 'targetCustomer', field: 'targetCustomer' },
      { key: 'strategy', field: 'strategy' },
      { key: 'offerCategory', field: 'offerCategory' },
      { key: 'knowledgeAppendix', field: 'knowledgeAppendix' },
    ];

    for (const { key, field } of textFields) {
      const val = ctx[key];
      if (typeof val === 'string' && val.trim()) {
        for (const chunk of this.splitTextToChunks(val)) {
          chunks.push({ field, text: chunk });
        }
      }
    }

    // Array fields (jsonb) — proof points, value props, case studies, etc.
    const arrayFields: Array<{ key: keyof typeof ctx; field: string }> = [
      { key: 'globalValueProps', field: 'globalValueProps' },
      { key: 'proofPoints', field: 'proofPoints' },
      { key: 'caseStudies', field: 'caseStudies' },
      { key: 'buyingTriggers', field: 'buyingTriggers' },
      { key: 'targetRoles', field: 'targetRoles' },
      { key: 'industries', field: 'industries' },
      { key: 'competitors', field: 'competitors' },
      { key: 'positioningRules', field: 'positioningRules' },
      { key: 'discoveryQuestions', field: 'discoveryQuestions' },
      { key: 'qualificationRubric', field: 'qualificationRubric' },
      { key: 'allowedClaims', field: 'allowedClaims' },
      { key: 'forbiddenClaims', field: 'forbiddenClaims' },
      { key: 'salesPolicies', field: 'salesPolicies' },
      { key: 'escalationRules', field: 'escalationRules' },
    ];

    for (const { key, field } of arrayFields) {
      const val = ctx[key];
      if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === 'string' && item.trim().length >= 20) {
            chunks.push({ field, text: item.trim() });
          }
        }
      }
    }

    return chunks;
  }

  /**
   * Chunk a company profile row into embedding-ready chunks.
   */
  private chunkCompanyProfile(profile: typeof schema.orgCompanyProfiles.$inferSelect): ChunkInput[] {
    const chunks: ChunkInput[] = [];

    const textFields: Array<{ key: keyof typeof profile; field: string }> = [
      { key: 'productSummary', field: 'productSummary' },
      { key: 'idealCustomerProfile', field: 'idealCustomerProfile' },
      { key: 'valueProposition', field: 'valueProposition' },
      { key: 'differentiators', field: 'differentiators' },
      { key: 'proofPoints', field: 'proofPoints' },
      { key: 'repTalkingPoints', field: 'repTalkingPoints' },
      { key: 'discoveryGuidance', field: 'discoveryGuidance' },
      { key: 'qualificationGuidance', field: 'qualificationGuidance' },
      { key: 'objectionHandling', field: 'objectionHandling' },
      { key: 'competitorGuidance', field: 'competitorGuidance' },
      { key: 'pricingGuidance', field: 'pricingGuidance' },
      { key: 'implementationGuidance', field: 'implementationGuidance' },
      { key: 'faq', field: 'faq' },
      { key: 'doNotSay', field: 'doNotSay' },
    ];

    for (const { key, field } of textFields) {
      const val = profile[key];
      if (typeof val === 'string' && val.trim()) {
        for (const chunk of this.splitTextToChunks(val)) {
          chunks.push({ field, text: chunk });
        }
      }
    }

    return chunks;
  }

  /**
   * Chunk a product row into embedding-ready chunks.
   */
  private chunkProduct(product: typeof schema.products.$inferSelect): ChunkInput[] {
    const chunks: ChunkInput[] = [];
    const meta = { productName: product.name };

    if (product.elevatorPitch?.trim()) {
      chunks.push({
        field: 'elevatorPitch',
        text: `${product.name}: ${product.elevatorPitch}`,
        metadata: meta,
      });
    }

    // String array fields
    const stringArrayFields: Array<{ key: keyof typeof product; field: string }> = [
      { key: 'valueProps', field: 'valueProps' },
      { key: 'differentiators', field: 'differentiators' },
      { key: 'dontSay', field: 'dontSay' },
    ];

    for (const { key, field } of stringArrayFields) {
      const val = product[key];
      if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === 'string' && item.trim().length >= 20) {
            chunks.push({ field, text: item.trim(), metadata: meta });
          }
        }
      }
    }

    // JSON array fields (faqs, objections) — stringify each entry
    const jsonArrayFields: Array<{ key: keyof typeof product; field: string }> = [
      { key: 'faqs', field: 'faqs' },
      { key: 'objections', field: 'objections' },
    ];

    for (const { key, field } of jsonArrayFields) {
      const val = product[key];
      if (Array.isArray(val)) {
        for (const item of val) {
          const text = typeof item === 'string' ? item : JSON.stringify(item);
          if (text.trim().length >= 20) {
            chunks.push({ field, text: text.trim(), metadata: meta });
          }
        }
      }
    }

    // pricingRules is jsonb — stringify if it has content
    if (product.pricingRules && typeof product.pricingRules === 'object') {
      const text = JSON.stringify(product.pricingRules);
      if (text.length >= 20 && text !== '{}') {
        chunks.push({ field: 'pricingRules', text: `${product.name} pricing: ${text}`, metadata: meta });
      }
    }

    return chunks;
  }

  /**
   * Split a long text into paragraph-level chunks (~100-500 tokens each).
   * Uses \n\n as primary split, falls back to sentences for long paragraphs.
   */
  private splitTextToChunks(text: string, maxTokens = 400): string[] {
    const paragraphs = text
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 20);

    const chunks: string[] = [];

    for (const para of paragraphs) {
      const approxTokens = para.length / 4; // rough token estimate
      if (approxTokens <= maxTokens) {
        chunks.push(para);
      } else {
        // Split long paragraphs by sentences
        const sentences = para.split(/(?<=[.!?])\s+/);
        let current = '';
        for (const sentence of sentences) {
          if ((current.length + sentence.length) / 4 > maxTokens && current.length > 0) {
            chunks.push(current.trim());
            current = sentence;
          } else {
            current += (current ? ' ' : '') + sentence;
          }
        }
        if (current.trim().length >= 20) {
          chunks.push(current.trim());
        }
      }
    }

    return chunks;
  }

  // ─── MMR Dedup ───────────────────────────────────────────────────────────

  /**
   * Maximal Marginal Relevance — remove near-duplicate chunks.
   * If two chunks have cosine similarity > 0.92, keep only the higher-scored one.
   */
  private applyMMR(candidates: EmbeddingChunk[], limit: number): EmbeddingChunk[] {
    if (candidates.length <= limit) return candidates;

    const selected: EmbeddingChunk[] = [];

    for (const candidate of candidates) {
      if (selected.length >= limit) break;

      // Check if this candidate is too similar to any already selected chunk
      const isDuplicate = selected.some((s) => {
        const textSimilarity = this.jaccardSimilarity(s.chunkText, candidate.chunkText);
        return textSimilarity > MMR_DEDUP_THRESHOLD;
      });

      if (!isDuplicate) {
        selected.push(candidate);
      }
    }

    return selected;
  }

  /** Simple Jaccard similarity on word sets — fast proxy for semantic similarity. */
  private jaccardSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    return union > 0 ? intersection / union : 0;
  }

  // ─── Token Estimation ──────────────────────────────────────────────────

  private estimateTokenCount(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }
}

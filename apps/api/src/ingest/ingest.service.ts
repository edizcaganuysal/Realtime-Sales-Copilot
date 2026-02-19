import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { and, eq } from 'drizzle-orm';
import type { JwtPayload } from '@live-sales-coach/shared';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { EMPTY_COMPANY_PROFILE_DEFAULTS } from '../org/company-profile.defaults';
import { CreateWebsiteIngestDto } from './dto/create-website-ingest.dto';
import { QualityCompanyDto } from './dto/quality-company.dto';
import { QualityProductDto } from './dto/quality-product.dto';
import { createHash, randomUUID } from 'crypto';

type IngestionTarget = 'COMPANY' | 'PRODUCT';
type IngestionStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type UploadedPdfFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

type ExtractedField<T> = {
  value: T;
  confidence: number;
  citations: string[];
  suggested: boolean;
};

type SourceRef = {
  id: string;
  title: string;
  uri: string;
  text: string;
};

type CompanyExtractionResult = {
  kind: 'COMPANY';
  sources: Array<{ id: string; title: string; uri: string }>;
  fields: {
    company_overview: ExtractedField<string>;
    target_customers: ExtractedField<string>;
    value_props: ExtractedField<string[]>;
    tone_style: ExtractedField<string>;
    compliance_and_policies: ExtractedField<string[]>;
    forbidden_claims: ExtractedField<string[]>;
    competitor_positioning: ExtractedField<string[]>;
    escalation_rules: ExtractedField<string[]>;
    knowledge_base_appendix: ExtractedField<string>;
  };
};

type ProductExtractionResult = {
  kind: 'PRODUCT';
  sources: Array<{ id: string; title: string; uri: string }>;
  products: Array<{
    id: string;
    name: ExtractedField<string>;
    elevator_pitch: ExtractedField<string>;
    value_props: ExtractedField<string[]>;
    differentiators: ExtractedField<string[]>;
    pricing_rules: ExtractedField<Record<string, unknown>>;
    dont_say: ExtractedField<string[]>;
    faqs: ExtractedField<unknown[]>;
    objections: ExtractedField<unknown[]>;
  }>;
};

type IngestionResult = CompanyExtractionResult | ProductExtractionResult;

type CrawledAsset = {
  uri: string;
  title: string;
  contentText: string;
};

type IngestFocus = 'QUICK' | 'STANDARD' | 'DEEP';

type CrawlConfig = {
  focus: IngestFocus;
  maxPages: number;
  depth: number;
  pageCharCap: number;
  totalCharCap: number;
  timeCapMs: number;
  userRequestedPages: number;
  clamped: boolean;
  note: string | null;
};

const PDF_TEXT_CAP = 120_000;
const WEBSITE_PAGES_DEFAULT = 20;
const WEBSITE_MAX_PAGES_HARD_CAP = 80;
const MAX_FILES = 5;
const MAX_FILE_SIZE = 20 * 1024 * 1024;

const SALES_POLICY_SUGGESTED_DEFAULTS = [
  'Booking is confirmed after scope and timing are agreed in writing.',
  'Standard turnaround is shared before booking and may vary by package complexity.',
  'Reschedule and cancellation requests should be submitted as early as possible.',
  'Deposits or payment milestones are clarified before service delivery.',
  'Usage rights, licensing, and delivery terms are confirmed in the service agreement.',
];

const COMPETITOR_SUGGESTED_DEFAULTS = [
  'Position on service reliability, delivery speed, and quality consistency.',
  'Avoid negative competitor claims and focus on verifiable outcomes.',
  'Use side-by-side scope comparisons instead of broad superiority claims.',
];

const ESCALATION_SUGGESTED_DEFAULTS = [
  'Escalate custom pricing or contract exceptions to an admin or manager.',
  'Escalate legal, compliance, or licensing questions before making commitments.',
  'Escalate unusual delivery timelines or service-area exceptions for approval.',
];

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);
  private openaiClient: OpenAI | null = null;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async queueWebsiteJob(
    user: JwtPayload,
    target: IngestionTarget,
    dto: CreateWebsiteIngestDto,
  ) {
    this.ensureOpenAiConfigured();
    const normalizedInput = this.normalizeWebsiteInput(dto);
    const [job] = await this.db
      .insert(schema.ingestionJobs)
      .values({
        orgId: user.orgId,
        createdByUserId: user.sub,
        target,
        sourceType: 'WEBSITE',
        status: 'queued',
        input: normalizedInput,
        result: {
          progress: {
            stage: 'queued',
            message: 'Waiting to start',
            completed: 0,
            total: normalizedInput.maxPages,
          },
        },
        updatedAt: new Date(),
      })
      .returning({ id: schema.ingestionJobs.id });

    setTimeout(() => {
      void this.runWebsiteJob(job.id);
    }, 0);

    return { jobId: job.id };
  }

  async queuePdfJob(
    user: JwtPayload,
    target: IngestionTarget,
    files: UploadedPdfFile[],
  ) {
    this.ensureOpenAiConfigured();
    this.ensureStorageConfigured();
    if (!Array.isArray(files) || files.length === 0) {
      throw new BadRequestException('Upload at least one PDF file.');
    }
    if (files.length > MAX_FILES) {
      throw new BadRequestException(`You can upload up to ${MAX_FILES} files.`);
    }

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        throw new BadRequestException(`File too large: ${file.originalname}`);
      }
      if (!this.isPdfFile(file)) {
        throw new BadRequestException(`Unsupported file type: ${file.originalname}`);
      }
    }

    const [job] = await this.db
      .insert(schema.ingestionJobs)
      .values({
        orgId: user.orgId,
        createdByUserId: user.sub,
        target,
        sourceType: 'PDF',
        status: 'queued',
        input: {
          files: files.map((file) => ({
            name: file.originalname,
            size: file.size,
            type: file.mimetype,
          })),
        },
        result: {
          progress: {
            stage: 'queued',
            message: 'Waiting to start',
            completed: 0,
            total: files.length,
          },
        },
        updatedAt: new Date(),
      })
      .returning({ id: schema.ingestionJobs.id });

    const cloned = files.map((file) => ({
      ...file,
      buffer: Buffer.from(file.buffer),
    }));

    setTimeout(() => {
      void this.runPdfJob(job.id, cloned);
    }, 0);

    return { jobId: job.id };
  }

  async getJob(orgId: string, jobId: string) {
    const job = await this.requireJob(orgId, jobId);
    const assets = await this.db
      .select({
        id: schema.ingestionAssets.id,
        kind: schema.ingestionAssets.kind,
        uri: schema.ingestionAssets.uri,
        title: schema.ingestionAssets.title,
        createdAt: schema.ingestionAssets.createdAt,
      })
      .from(schema.ingestionAssets)
      .where(eq(schema.ingestionAssets.jobId, jobId));

    return {
      id: job.id,
      target: job.target,
      sourceType: job.sourceType,
      status: job.status,
      input: this.asRecord(job.input),
      result: this.asRecord(job.result),
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      assets,
    };
  }

  async applyJob(orgId: string, jobId: string, payload: Record<string, unknown>) {
    const job = await this.requireJob(orgId, jobId);
    if (job.status !== 'succeeded') {
      throw new BadRequestException('Job is not ready to apply.');
    }

    const result = this.asRecord(job.result);
    let applied: Record<string, unknown>;

    if (job.target === 'COMPANY') {
      applied = await this.applyCompanyResult(orgId, result, payload);
    } else {
      applied = await this.applyProductResult(orgId, result, payload);
    }

    await this.patchJob(job.id, {
      result: {
        ...result,
        appliedAt: new Date().toISOString(),
        applied,
      },
    });

    return { ok: true, applied };
  }

  async qualityCompany(dto: QualityCompanyDto) {
    this.ensureOpenAiConfigured();
    const payload = {
      companyName: dto.companyName ?? '',
      productName: dto.productName ?? '',
      productSummary: dto.productSummary ?? '',
      idealCustomerProfile: dto.idealCustomerProfile ?? '',
      valueProposition: dto.valueProposition ?? '',
      differentiators: dto.differentiators ?? '',
      proofPoints: dto.proofPoints ?? '',
      repTalkingPoints: dto.repTalkingPoints ?? '',
      discoveryGuidance: dto.discoveryGuidance ?? '',
      qualificationGuidance: dto.qualificationGuidance ?? '',
      objectionHandling: dto.objectionHandling ?? '',
      competitorGuidance: dto.competitorGuidance ?? '',
      pricingGuidance: dto.pricingGuidance ?? '',
      implementationGuidance: dto.implementationGuidance ?? '',
      faq: dto.faq ?? '',
      doNotSay: dto.doNotSay ?? '',
    };

    const raw = await this.runJsonCompletion({
      system:
        'You are a B2B sales enablement editor. Return concise, high-impact improvement suggestions in JSON.',
      user:
        'Review this company profile payload and suggest 3 to 6 edits. Output JSON with key suggestions as an array of objects: {id, field, title, message, proposedValue}. Keep each message actionable and concise.\n' +
        JSON.stringify(payload),
    });

    return { suggestions: this.normalizeSuggestions(raw) };
  }

  async qualityProduct(dto: QualityProductDto) {
    this.ensureOpenAiConfigured();
    const payload = {
      name: typeof dto.name === 'string' ? dto.name : '',
      elevator_pitch: typeof dto.elevator_pitch === 'string' ? dto.elevator_pitch : '',
      value_props: this.toStringArray(dto.value_props),
      differentiators: this.toStringArray(dto.differentiators),
      pricing_rules: this.toObject(dto.pricing_rules),
      dont_say: this.toStringArray(dto.dont_say),
      faqs: Array.isArray(dto.faqs) ? dto.faqs.slice(0, 20) : [],
      objections: Array.isArray(dto.objections) ? dto.objections.slice(0, 20) : [],
    };

    const raw = await this.runJsonCompletion({
      system:
        'You are a product messaging editor for sales teams. Return concise, high-impact improvement suggestions in JSON.',
      user:
        'Review this product payload and suggest 3 to 6 edits. Output JSON with key suggestions as an array of objects: {id, field, title, message, proposedValue}. Keep each message actionable and concise.\n' +
        JSON.stringify(payload),
    });

    return { suggestions: this.normalizeSuggestions(raw) };
  }

  aiFieldsStatus() {
    const enabled = Boolean(this.readEnv('OPENAI_API_KEY') || this.readEnv('LLM_API_KEY'));
    return {
      enabled,
      message: enabled
        ? ''
        : 'AI actions are unavailable. Add OPENAI_API_KEY to API environment variables.',
    };
  }

  async aiFieldDraft(input: {
    target: 'company' | 'product';
    fieldKey: string;
    currentState?: Record<string, unknown>;
  }) {
    this.ensureOpenAiConfigured();
    const target = input.target === 'product' ? 'product' : 'company';
    const fieldKey = this.readString(input.fieldKey, 160);
    if (!fieldKey) {
      throw new BadRequestException('fieldKey is required');
    }
    const currentState = this.toObject(input.currentState);

    const raw = await this.runJsonCompletion({
      system:
        'You are a concise sales writing assistant. Draft field values that are useful, realistic, and policy-safe.',
      user:
        `Target: ${target}\n` +
        `Field: ${fieldKey}\n` +
        'Rules:\n' +
        '- Use the provided currentState as the only context source.\n' +
        '- Keep output concise and practical.\n' +
        '- Use bullets when appropriate.\n' +
        '- Do not invent hard claims, pricing guarantees, or unverifiable stats.\n' +
        '- If uncertain, use cautious language like "Typically..." or placeholders.\n' +
        'Return JSON: {"text": string, "notes": string[], "warnings": string[]}\n' +
        `currentState:\n${JSON.stringify(currentState).slice(0, 16000)}`,
    });

    return {
      text: this.readString(raw.text, 9000),
      notes: this.toStringArray(raw.notes).slice(0, 6),
      warnings: this.toStringArray(raw.warnings).slice(0, 6),
    };
  }

  async aiFieldImprove(input: {
    target: 'company' | 'product';
    fieldKey: string;
    text: string;
    currentState?: Record<string, unknown>;
  }) {
    this.ensureOpenAiConfigured();
    const target = input.target === 'product' ? 'product' : 'company';
    const fieldKey = this.readString(input.fieldKey, 160);
    if (!fieldKey) {
      throw new BadRequestException('fieldKey is required');
    }
    const text = this.readString(input.text, 12000);
    if (!text) {
      throw new BadRequestException('text is required');
    }
    const currentState = this.toObject(input.currentState);

    const raw = await this.runJsonCompletion({
      system:
        'You are a concise sales writing editor. Improve clarity and professionalism while preserving intent and constraints.',
      user:
        `Target: ${target}\n` +
        `Field: ${fieldKey}\n` +
        'Rules:\n' +
        '- Use the provided currentState as context.\n' +
        '- Rewrite to be clearer and more professional.\n' +
        '- Keep concise and keep bullet structure if present.\n' +
        '- Do not invent hard claims, guarantees, or unverifiable specifics.\n' +
        '- If uncertainty exists, keep wording cautious.\n' +
        `Original text:\n${text}\n\n` +
        `currentState:\n${JSON.stringify(currentState).slice(0, 16000)}\n\n` +
        'Return JSON: {"text": string, "notes": string[], "warnings": string[]}',
    });

    return {
      text: this.readString(raw.text, 9000),
      notes: this.toStringArray(raw.notes).slice(0, 6),
      warnings: this.toStringArray(raw.warnings).slice(0, 6),
    };
  }

  private async runWebsiteJob(jobId: string) {
    try {
      const job = await this.requireJobById(jobId);
      const input = this.asRecord(job.input);
      const config = this.getCrawlConfigFromInput(input);
      await this.setJobRunning(job.id, {
        stage: 'crawl',
        message: 'Crawling website',
        completed: 0,
        total: config.maxPages,
      });

      const crawl = await this.crawlWebsite({
        url: this.readString(input.url),
        config,
        includePaths: this.readStringArray(input.includePaths),
        excludePaths: this.readStringArray(input.excludePaths),
      });

      await this.storeAssets(job.id, 'PAGE', crawl.assets);
      await this.patchJob(job.id, {
        result: {
          progress: {
            stage: 'structure',
            message: 'Structuring extracted content',
            completed: crawl.assets.length,
            total: crawl.assets.length,
          },
        },
      });

      const structured = await this.structureResult(job.target as IngestionTarget, crawl.assets);

      await this.db
        .update(schema.ingestionJobs)
        .set({
          status: 'succeeded',
          result: {
            ...(this.asRecord(job.result)),
            ...structured,
            stats: {
              assetCount: crawl.assets.length,
              totalChars: crawl.totalChars,
              pagesRequested: config.userRequestedPages,
              pagesUsed: config.maxPages,
              focus: config.focus,
              note: crawl.note,
            },
            note: crawl.note,
            progress: {
              stage: 'done',
              message: 'Extraction complete',
              completed: crawl.assets.length,
              total: crawl.assets.length,
            },
          },
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.ingestionJobs.id, job.id));
    } catch (error) {
      await this.failJob(jobId, error);
    }
  }

  private async runPdfJob(jobId: string, files: UploadedPdfFile[]) {
    try {
      const job = await this.requireJobById(jobId);
      await this.setJobRunning(job.id, {
        stage: 'pdf',
        message: 'Uploading and parsing documents',
        completed: 0,
        total: files.length,
      });

      const assets: CrawledAsset[] = [];
      let totalChars = 0;

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i]!;
        const uri = await this.uploadPdf(job.id, file);
        const extracted = this.extractPdfText(file.buffer);
        if (!extracted) {
          continue;
        }
        const remaining = PDF_TEXT_CAP - totalChars;
        if (remaining <= 0) {
          break;
        }
        const capped = extracted.slice(0, Math.min(24_000, remaining));
        assets.push({
          uri,
          title: file.originalname,
          contentText: capped,
        });
        totalChars += capped.length;
        await this.patchJob(job.id, {
          result: {
            progress: {
              stage: 'pdf',
              message: 'Uploading and parsing documents',
              completed: i + 1,
              total: files.length,
            },
          },
        });
      }

      if (assets.length === 0) {
        throw new BadRequestException('No readable PDF content was extracted.');
      }

      await this.storeAssets(job.id, 'PDF', assets);
      await this.patchJob(job.id, {
        result: {
          progress: {
            stage: 'structure',
            message: 'Structuring extracted content',
            completed: assets.length,
            total: assets.length,
          },
        },
      });

      const structured = await this.structureResult(job.target as IngestionTarget, assets);

      await this.db
        .update(schema.ingestionJobs)
        .set({
          status: 'succeeded',
          result: {
            ...(this.asRecord(job.result)),
            ...structured,
            stats: {
              assetCount: assets.length,
              totalChars,
            },
            progress: {
              stage: 'done',
              message: 'Extraction complete',
              completed: assets.length,
              total: assets.length,
            },
          },
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.ingestionJobs.id, job.id));
    } catch (error) {
      await this.failJob(jobId, error);
    }
  }

  private async setJobRunning(
    jobId: string,
    progress: { stage: string; message: string; completed: number; total: number },
  ) {
    await this.db
      .update(schema.ingestionJobs)
      .set({
        status: 'running',
        result: {
          progress,
        },
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.ingestionJobs.id, jobId));
  }

  private async patchJob(
    jobId: string,
    patch: {
      result?: Record<string, unknown>;
      status?: IngestionStatus;
      error?: string | null;
    },
  ) {
    const [existing] = await this.db
      .select({
        result: schema.ingestionJobs.result,
      })
      .from(schema.ingestionJobs)
      .where(eq(schema.ingestionJobs.id, jobId))
      .limit(1);

    if (!existing) return;

    const current = this.asRecord(existing.result);
    const nextResult = patch.result ? { ...current, ...patch.result } : current;

    await this.db
      .update(schema.ingestionJobs)
      .set({
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
        result: nextResult,
        updatedAt: new Date(),
      })
      .where(eq(schema.ingestionJobs.id, jobId));
  }

  private async failJob(jobId: string, error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Ingestion failed unexpectedly.';
    this.logger.error(`Ingestion job failed (${jobId}): ${message}`);
    await this.db
      .update(schema.ingestionJobs)
      .set({
        status: 'failed',
        error: message,
        updatedAt: new Date(),
      })
      .where(eq(schema.ingestionJobs.id, jobId));
  }

  private async requireJob(orgId: string, jobId: string) {
    const [job] = await this.db
      .select()
      .from(schema.ingestionJobs)
      .where(and(eq(schema.ingestionJobs.id, jobId), eq(schema.ingestionJobs.orgId, orgId)))
      .limit(1);

    if (!job) {
      throw new NotFoundException('Ingestion job not found.');
    }
    return job;
  }

  private async requireJobById(jobId: string) {
    const [job] = await this.db
      .select()
      .from(schema.ingestionJobs)
      .where(eq(schema.ingestionJobs.id, jobId))
      .limit(1);

    if (!job) {
      throw new NotFoundException('Ingestion job not found.');
    }
    return job;
  }

  private normalizeWebsiteInput(dto: CreateWebsiteIngestDto) {
    const focus = this.toFocus(dto.focus);
    const requestedRaw = this.readNumber(
      dto.pagesToScan ?? dto.maxPages,
      WEBSITE_PAGES_DEFAULT,
    );
    const requestedPages = Math.max(1, Math.floor(requestedRaw || WEBSITE_PAGES_DEFAULT));
    const clamped = requestedPages > WEBSITE_MAX_PAGES_HARD_CAP;
    const maxPages = Math.min(WEBSITE_MAX_PAGES_HARD_CAP, requestedPages);
    const config = this.buildCrawlConfig(focus, maxPages, requestedPages, clamped);
    return {
      url: this.normalizeUrl(dto.url),
      pagesToScan: requestedPages,
      maxPages: config.maxPages,
      focus: config.focus,
      note: config.note,
      includePaths: this.normalizePaths(dto.includePaths),
      excludePaths: this.normalizePaths(dto.excludePaths),
    };
  }

  private toFocus(raw: unknown): IngestFocus {
    const value =
      typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    if (value === 'QUICK' || value === 'DEEP') {
      return value;
    }
    return 'STANDARD';
  }

  private buildCrawlConfig(
    focus: IngestFocus,
    maxPages: number,
    requestedPages: number,
    clamped: boolean,
  ): CrawlConfig {
    if (focus === 'QUICK') {
      return {
        focus,
        maxPages,
        depth: 1,
        pageCharCap: 14_000,
        totalCharCap: 90_000,
        timeCapMs: 60_000,
        userRequestedPages: requestedPages,
        clamped,
        note: clamped ? `Scanned first ${maxPages} pages for speed.` : null,
      };
    }

    if (focus === 'DEEP') {
      return {
        focus,
        maxPages,
        depth: 3,
        pageCharCap: 22_000,
        totalCharCap: 180_000,
        timeCapMs: 120_000,
        userRequestedPages: requestedPages,
        clamped,
        note: clamped ? `Scanned first ${maxPages} pages for speed.` : null,
      };
    }

    return {
      focus: 'STANDARD',
      maxPages,
      depth: 2,
      pageCharCap: 18_000,
      totalCharCap: 140_000,
      timeCapMs: 90_000,
      userRequestedPages: requestedPages,
      clamped,
      note: clamped ? `Scanned first ${maxPages} pages for speed.` : null,
    };
  }

  private getCrawlConfigFromInput(input: Record<string, unknown>): CrawlConfig {
    const focus = this.toFocus(input.focus);
    const requestedRaw = this.readNumber(
      input.pagesToScan ?? input.maxPages,
      WEBSITE_PAGES_DEFAULT,
    );
    const requestedPages = Math.max(1, Math.floor(requestedRaw || WEBSITE_PAGES_DEFAULT));
    const clamped = requestedPages > WEBSITE_MAX_PAGES_HARD_CAP;
    const maxPages = Math.min(WEBSITE_MAX_PAGES_HARD_CAP, requestedPages);
    return this.buildCrawlConfig(focus, maxPages, requestedPages, clamped);
  }

  private normalizeUrl(raw: string) {
    const value = raw.trim();
    if (!value) throw new BadRequestException('Website URL is required.');
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    let parsed: URL;
    try {
      parsed = new URL(withScheme);
    } catch {
      throw new BadRequestException('Invalid website URL.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('Only http/https URLs are supported.');
    }
    parsed.hash = '';
    return parsed.toString();
  }

  private normalizePaths(value?: string[]) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .map((item) => (item.startsWith('/') ? item : `/${item}`))
      .slice(0, 25);
  }

  private async crawlWebsite(input: {
    url: string;
    config: CrawlConfig;
    includePaths: string[];
    excludePaths: string[];
  }): Promise<{ assets: CrawledAsset[]; totalChars: number; note: string | null }> {
    const startUrl = this.normalizeUrl(input.url);
    const base = new URL(startUrl);
    const queue: Array<{ url: string; depth: number; priority: number }> = [
      { url: startUrl, depth: 0, priority: 1000 },
    ];
    const visited = new Set<string>();
    const assets: CrawledAsset[] = [];
    let totalChars = 0;
    let guard = 0;
    const startedAt = Date.now();
    let note = input.config.note;

    while (
      queue.length > 0 &&
      assets.length < input.config.maxPages &&
      totalChars < input.config.totalCharCap &&
      guard < input.config.maxPages * 60
    ) {
      if (Date.now() - startedAt > input.config.timeCapMs) {
        note = note ?? `Scanned first ${assets.length} pages for speed.`;
        break;
      }

      guard += 1;
      queue.sort((a, b) => b.priority - a.priority);
      const next = queue.shift();
      if (!next) break;
      if (visited.has(next.url)) continue;
      visited.add(next.url);

      const page = await this.fetchHtml(next.url);
      if (!page) continue;

      const text = this.extractPageText(page.html);
      if (!text) continue;

      const remaining = input.config.totalCharCap - totalChars;
      if (remaining <= 0) break;

      const capped = text.slice(0, Math.min(input.config.pageCharCap, remaining));
      assets.push({
        uri: next.url,
        title: page.title || this.fallbackTitle(next.url),
        contentText: capped,
      });
      totalChars += capped.length;

      if (next.depth >= input.config.depth) continue;

      const links = this.extractInternalLinks(page.html, next.url, base, input.includePaths, input.excludePaths);
      for (const url of links) {
        if (visited.has(url)) continue;
        const parsed = new URL(url);
        const priority = this.rankPath(parsed.pathname, input.config.focus) - next.depth * 3;
        queue.push({
          url,
          depth: next.depth + 1,
          priority,
        });
      }
    }

    if (assets.length === 0) {
      throw new BadRequestException('No readable pages were extracted from the website.');
    }
    return { assets, totalChars, note };
  }

  private async fetchHtml(url: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'SalesAI-IngestionBot/1.0',
        },
      });
      if (!response.ok) return null;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) return null;
      const html = await response.text();
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? this.compactWhitespace(this.decodeHtml(titleMatch[1] || '')) : '';
      return { html, title };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private extractInternalLinks(
    html: string,
    currentUrl: string,
    base: URL,
    includePaths: string[],
    excludePaths: string[],
  ) {
    const links = new Set<string>();
    const regex = /href\s*=\s*["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(html)) !== null) {
      const raw = (match[1] || '').trim();
      if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) {
        continue;
      }
      let resolved: URL;
      try {
        resolved = new URL(raw, currentUrl);
      } catch {
        continue;
      }
      if (!['http:', 'https:'].includes(resolved.protocol)) continue;
      if (resolved.hostname !== base.hostname) continue;
      resolved.hash = '';
      resolved.search = '';
      if (/\.(jpg|jpeg|png|webp|gif|svg|pdf|zip|mp4|mp3)$/i.test(resolved.pathname)) continue;
      if (!this.pathAllowed(resolved.pathname, includePaths, excludePaths)) continue;
      links.add(resolved.toString());
    }

    return Array.from(links);
  }

  private pathAllowed(pathname: string, includePaths: string[], excludePaths: string[]) {
    const path = pathname || '/';
    if (includePaths.length > 0 && !includePaths.some((prefix) => path.startsWith(prefix))) {
      return false;
    }
    if (excludePaths.some((prefix) => path.startsWith(prefix))) {
      return false;
    }
    return true;
  }

  private rankPath(pathname: string, focus: IngestFocus) {
    const path = pathname.toLowerCase();
    let score = path === '/' || path === '' ? 18 : 0;

    const highSignal = [
      'service',
      'services',
      'portfolio',
      'pricing',
      'about',
      'faq',
      'contact',
      'package',
      'packages',
      'booking',
      'book',
      'product',
      'products',
      'solution',
      'solutions',
      'virtual-tour',
      'drone',
    ];
    const mediumSignal = ['docs', 'documentation', 'security', 'compliance', 'terms'];
    const lowSignal = ['privacy', 'accessibility', 'cookie', 'cookies'];
    const noisy = ['blog', 'news', 'career', 'jobs', 'press', 'login', 'signin', 'signup', 'account'];

    for (const key of highSignal) {
      if (path.includes(key)) score += 16;
    }
    for (const key of mediumSignal) {
      if (path.includes(key)) score += 7;
    }
    for (const key of noisy) {
      if (path.includes(key)) score -= 12;
    }

    if (focus !== 'DEEP') {
      for (const key of lowSignal) {
        if (path.includes(key)) score -= 18;
      }
    }

    if (focus === 'QUICK') {
      if (path.includes('service') || path.includes('pricing') || path.includes('package')) {
        score += 8;
      }
      if (path.includes('terms')) score -= 4;
    }

    return score;
  }

  private extractPageText(html: string) {
    const mainSection = this.extractMainSection(html);
    const stripped = mainSection
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<header[\s\S]*?<\/header>/gi, ' ')
      .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
      .replace(/<form[\s\S]*?<\/form>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    const decoded = this.decodeHtml(stripped);
    const compact = this.compactWhitespace(decoded);
    if (compact.length < 180) return '';
    return compact;
  }

  private extractMainSection(html: string) {
    const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
    if (main) return main;

    const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
    if (article) return article;

    const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];
    if (body) return body;

    return html;
  }

  private decodeHtml(input: string) {
    return input
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  private compactWhitespace(value: string) {
    return value.replace(/\s+/g, ' ').trim();
  }

  private fallbackTitle(url: string) {
    try {
      const parsed = new URL(url);
      return parsed.pathname === '/' ? parsed.hostname : `${parsed.hostname}${parsed.pathname}`;
    } catch {
      return url;
    }
  }

  private async storeAssets(jobId: string, kind: 'PDF' | 'PAGE', assets: CrawledAsset[]) {
    if (assets.length === 0) return;
    await this.db.insert(schema.ingestionAssets).values(
      assets.map((asset) => ({
        jobId,
        kind,
        uri: asset.uri,
        title: asset.title,
        contentText: asset.contentText,
        contentSha: createHash('sha256').update(asset.contentText).digest('hex'),
      })),
    );
  }

  private async uploadPdf(jobId: string, file: UploadedPdfFile) {
    const cfg = this.ensureStorageConfigured();
    const safeName = (file.originalname || 'document.pdf')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .slice(-120);
    const path = `${jobId}/${Date.now()}-${randomUUID()}-${safeName}`;
    const endpoint = `${cfg.url}/storage/v1/object/${encodeURIComponent(cfg.bucket)}/${path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        apikey: cfg.key,
        'x-upsert': 'true',
        'Content-Type': file.mimetype || 'application/pdf',
      },
      body: file.buffer,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new InternalServerErrorException(
        `Failed to upload PDF to Supabase Storage. ${text || response.statusText}`,
      );
    }
    return `supabase://${cfg.bucket}/${path}`;
  }

  private extractPdfText(buffer: Buffer) {
    const raw = buffer.toString('latin1');
    const chunks = new Set<string>();
    const parenthetical = raw.match(/\(([^()]{20,})\)/g) ?? [];
    for (const token of parenthetical) {
      const text = token.slice(1, -1).replace(/\\[nrt]/g, ' ');
      const cleaned = this.compactWhitespace(text.replace(/[^\x20-\x7E]/g, ' '));
      if (cleaned.length >= 30) chunks.add(cleaned);
      if (chunks.size >= 500) break;
    }
    if (chunks.size < 50) {
      const ascii = raw.match(/[A-Za-z][A-Za-z0-9 ,.;:()\-_'"/]{40,}/g) ?? [];
      for (const line of ascii) {
        const cleaned = this.compactWhitespace(line.replace(/[^\x20-\x7E]/g, ' '));
        if (cleaned.length >= 30) chunks.add(cleaned);
        if (chunks.size >= 700) break;
      }
    }
    const text = Array.from(chunks).join('\n');
    return text.slice(0, PDF_TEXT_CAP);
  }

  private async structureResult(target: IngestionTarget, assets: CrawledAsset[]): Promise<IngestionResult> {
    const sourceRefs = assets.map((asset, index) => ({
      id: `S${index + 1}`,
      title: asset.title,
      uri: asset.uri,
      text: asset.contentText.slice(0, 14_000),
    }));

    if (target === 'COMPANY') {
      return this.structureCompany(sourceRefs);
    }
    return this.structureProducts(sourceRefs);
  }

  private async structureCompany(sources: SourceRef[]): Promise<CompanyExtractionResult> {
    const raw = await this.runJsonCompletion({
      system:
        'You are a sales enablement analyst. Extract concise company messaging with confidence and citations from sources. Do not fabricate claims.',
      user:
        'Given these sources, produce JSON with key fields. Schema:\n' +
        '{ "fields": { "company_overview": {"value": string, "confidence": number, "citations": string[], "suggested": boolean}, "target_customers": {"value": string, "confidence": number, "citations": string[], "suggested": boolean}, "value_props": {"value": string[], "confidence": number, "citations": string[], "suggested": boolean}, "tone_style": {"value": string, "confidence": number, "citations": string[], "suggested": boolean}, "compliance_and_policies": {"value": string[], "confidence": number, "citations": string[], "suggested": boolean}, "forbidden_claims": {"value": string[], "confidence": number, "citations": string[], "suggested": boolean}, "competitor_positioning": {"value": string[], "confidence": number, "citations": string[], "suggested": boolean}, "escalation_rules": {"value": string[], "confidence": number, "citations": string[], "suggested": boolean}, "knowledge_base_appendix": {"value": string, "confidence": number, "citations": string[], "suggested": boolean} } }\n' +
        'Rules:\n' +
        '- compliance_and_policies means SALES & SERVICE POLICIES only: booking process, turnaround time, reschedule/cancellation, deposits/payment expectations, licensing/usage rights, service area/travel fees, on-site privacy expectations.\n' +
        '- Do not use privacy policy, WCAG, cookie, or generic legal site content as compliance_and_policies unless it directly impacts sales/service delivery.\n' +
        '- If no reliable evidence exists for competitor_positioning or escalation_rules, provide practical suggested defaults with low confidence, suggested=true, and citations=[].\n' +
        '- Keep text concise and citations must be source IDs like S1.\n' +
        this.renderSources(sources),
    });

    const valid = new Set(sources.map((source) => source.id));
    const fields = this.asRecord(raw.fields);
    const complianceAndPolicies = this.normalizeStringArrayField(
      fields.compliance_and_policies,
      valid,
    );
    const competitorPositioning = this.ensureSuggestedArrayField(
      this.normalizeStringArrayField(fields.competitor_positioning, valid),
      COMPETITOR_SUGGESTED_DEFAULTS,
    );
    const escalationRules = this.ensureSuggestedArrayField(
      this.normalizeStringArrayField(fields.escalation_rules, valid),
      ESCALATION_SUGGESTED_DEFAULTS,
    );

    return {
      kind: 'COMPANY',
      sources: sources.map((source) => ({ id: source.id, title: source.title, uri: source.uri })),
      fields: {
        company_overview: this.normalizeStringField(fields.company_overview, valid),
        target_customers: this.normalizeStringField(fields.target_customers, valid),
        value_props: this.normalizeStringArrayField(fields.value_props, valid),
        tone_style: this.normalizeStringField(fields.tone_style, valid),
        compliance_and_policies: this.normalizeSalesPoliciesField(
          complianceAndPolicies,
        ),
        forbidden_claims: this.normalizeStringArrayField(fields.forbidden_claims, valid),
        competitor_positioning: competitorPositioning,
        escalation_rules: escalationRules,
        knowledge_base_appendix: this.normalizeStringField(fields.knowledge_base_appendix, valid),
      },
    };
  }

  private async structureProducts(sources: SourceRef[]): Promise<ProductExtractionResult> {
    const raw = await this.runJsonCompletion({
      system:
        'You are a sales offering extraction analyst. Extract offerings/packages/services with citations and avoid hallucinations.',
      user:
        'Given these sources, return JSON with key "products" as an array. Each product item must contain:\n' +
        '{ "name": {"value": string, "confidence": number, "citations": string[], "suggested": boolean}, "elevator_pitch": {"value": string, "confidence": number, "citations": string[], "suggested": boolean}, "value_props": {"value": string[], "confidence": number, "citations": string[], "suggested": boolean}, "differentiators": {"value": string[], "confidence": number, "citations": string[], "suggested": boolean}, "pricing_rules": {"value": object, "confidence": number, "citations": string[], "suggested": boolean}, "dont_say": {"value": string[], "confidence": number, "citations": string[], "suggested": boolean}, "faqs": {"value": array, "confidence": number, "citations": string[], "suggested": boolean}, "objections": {"value": array, "confidence": number, "citations": string[], "suggested": boolean} }\n' +
        'Rules:\n' +
        '- For service businesses, detect multiple offerings/packages/services, not the company name as a product.\n' +
        '- Product names must be offering names such as package/service names found in sources.\n' +
        '- If a claim lacks evidence, keep it in value with suggested=true and citations=[].\n' +
        '- Never fabricate AI capabilities, pricing numbers, or unverified differentiators.\n' +
        '- Return up to 8 distinct offerings and citations must be IDs like S1.\n' +
        this.renderSources(sources),
    });

    const valid = new Set(sources.map((source) => source.id));
    const rawProducts = Array.isArray(raw.products) ? raw.products : [];
    const products = rawProducts
      .slice(0, 8)
      .map((item) => this.asRecord(item))
      .map((item) => ({
        id: randomUUID(),
        name: this.normalizeStringField(item.name, valid),
        elevator_pitch: this.normalizeStringField(item.elevator_pitch, valid),
        value_props: this.normalizeStringArrayField(item.value_props, valid),
        differentiators: this.normalizeStringArrayField(item.differentiators, valid),
        pricing_rules: this.normalizeObjectField(item.pricing_rules, valid),
        dont_say: this.normalizeStringArrayField(item.dont_say, valid),
        faqs: this.normalizeArrayField(item.faqs, valid),
        objections: this.normalizeArrayField(item.objections, valid),
      }))
      .map((item) => this.normalizeProductCandidate(item, sources))
      .filter((item) => item.name.value.trim().length > 0);

    return {
      kind: 'PRODUCT',
      sources: sources.map((source) => ({ id: source.id, title: source.title, uri: source.uri })),
      products:
        products.length > 0
          ? products
          : [
              {
                id: randomUUID(),
                name: { value: 'Service Offering', confidence: 0.2, citations: [], suggested: true },
                elevator_pitch: { value: '', confidence: 0.2, citations: [], suggested: true },
                value_props: { value: [], confidence: 0.2, citations: [], suggested: true },
                differentiators: { value: [], confidence: 0.2, citations: [], suggested: true },
                pricing_rules: { value: {}, confidence: 0.2, citations: [], suggested: true },
                dont_say: { value: [], confidence: 0.2, citations: [], suggested: true },
                faqs: { value: [], confidence: 0.2, citations: [], suggested: true },
                objections: { value: [], confidence: 0.2, citations: [], suggested: true },
              },
            ],
    };
  }

  private renderSources(sources: SourceRef[]) {
    return sources
      .map(
        (source) =>
          `${source.id}\nTitle: ${source.title}\nURI: ${source.uri}\nContent:\n${source.text}`,
      )
      .join('\n\n-----\n\n');
  }

  private normalizeStringField(input: unknown, validCitations: Set<string>): ExtractedField<string> {
    const record = this.asRecord(input);
    const value = this.readString(record.value, 2400);
    const citations = this.normalizeCitations(record.citations, validCitations);
    const confidence = this.normalizeConfidence(record.confidence);
    return {
      value,
      confidence,
      citations,
      suggested: this.normalizeSuggested(record.suggested, confidence, citations),
    };
  }

  private normalizeStringArrayField(
    input: unknown,
    validCitations: Set<string>,
  ): ExtractedField<string[]> {
    const record = this.asRecord(input);
    const array = this.toStringArray(record.value).slice(0, 12);
    const citations = this.normalizeCitations(record.citations, validCitations);
    const confidence = this.normalizeConfidence(record.confidence);
    return {
      value: array,
      confidence,
      citations,
      suggested: this.normalizeSuggested(record.suggested, confidence, citations),
    };
  }

  private normalizeObjectField(
    input: unknown,
    validCitations: Set<string>,
  ): ExtractedField<Record<string, unknown>> {
    const record = this.asRecord(input);
    const citations = this.normalizeCitations(record.citations, validCitations);
    const confidence = this.normalizeConfidence(record.confidence);
    return {
      value: this.toObject(record.value),
      confidence,
      citations,
      suggested: this.normalizeSuggested(record.suggested, confidence, citations),
    };
  }

  private normalizeArrayField(input: unknown, validCitations: Set<string>): ExtractedField<unknown[]> {
    const record = this.asRecord(input);
    const citations = this.normalizeCitations(record.citations, validCitations);
    const confidence = this.normalizeConfidence(record.confidence);
    return {
      value: Array.isArray(record.value) ? record.value.slice(0, 20) : [],
      confidence,
      citations,
      suggested: this.normalizeSuggested(record.suggested, confidence, citations),
    };
  }

  private normalizeSuggested(value: unknown, confidence: number, citations: string[]) {
    if (typeof value === 'boolean') return value;
    if (citations.length === 0 && confidence < 0.7) return true;
    return false;
  }

  private normalizeConfidence(value: unknown) {
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;
    if (Number.isFinite(numeric)) {
      if (numeric < 0) return 0;
      if (numeric > 1) return 1;
      return numeric;
    }
    return 0.35;
  }

  private normalizeCitations(value: unknown, validCitations: Set<string>) {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0 && validCitations.has(entry))
      .slice(0, 6);
  }

  private normalizeSalesPoliciesField(
    field: ExtractedField<string[]>,
  ): ExtractedField<string[]> {
    const filtered = field.value
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    const isWebsiteMetaOnly =
      filtered.length > 0 &&
      filtered.every((item) =>
        /(privacy|cookie|cookies|wcag|accessibility|gdpr|data protection|tracking)/i.test(item),
      );

    if (filtered.length === 0 || isWebsiteMetaOnly) {
      return {
        value: SALES_POLICY_SUGGESTED_DEFAULTS,
        confidence: 0.28,
        citations: [],
        suggested: true,
      };
    }

    return field;
  }

  private ensureSuggestedArrayField(
    field: ExtractedField<string[]>,
    defaults: string[],
  ): ExtractedField<string[]> {
    if (field.value.length > 0) return field;
    return {
      value: defaults,
      confidence: 0.26,
      citations: [],
      suggested: true,
    };
  }

  private normalizeProductCandidate(
    candidate: ProductExtractionResult['products'][number],
    sources: SourceRef[],
  ): ProductExtractionResult['products'][number] {
    const sourceNames = new Set<string>();
    for (const source of sources) {
      const host = this.extractHost(source.uri);
      if (host) {
        sourceNames.add(host.replace(/^www\./, '').toLowerCase());
      }
      sourceNames.add(source.title.trim().toLowerCase());
    }

    const nameNormalized = candidate.name.value.trim();
    const loweredName = nameNormalized.toLowerCase();
    if (loweredName) {
      for (const token of sourceNames) {
        if (!token) continue;
        if (loweredName === token || loweredName.includes(token)) {
          candidate.name = {
            value: '',
            confidence: 0.2,
            citations: [],
            suggested: true,
          };
          break;
        }
      }
    }

    if (candidate.value_props.citations.length === 0 && candidate.value_props.value.length > 0) {
      candidate.value_props = {
        ...candidate.value_props,
        value: candidate.value_props.value.map((line) => `Suggested (no citation): ${line}`),
        suggested: true,
      };
    }

    if (
      candidate.differentiators.citations.length === 0 &&
      candidate.differentiators.value.length > 0
    ) {
      candidate.differentiators = {
        ...candidate.differentiators,
        value: candidate.differentiators.value.map((line) => `Suggested (no citation): ${line}`),
        suggested: true,
      };
    }

    return candidate;
  }

  private extractHost(uri: string) {
    try {
      return new URL(uri).hostname;
    } catch {
      return '';
    }
  }

  private async runJsonCompletion(input: { system: string; user: string }) {
    const client = this.getOpenAiClient();
    const model =
      process.env['INGEST_LLM_MODEL'] ||
      process.env['LLM_MODEL'] ||
      process.env['OPENAI_MODEL'] ||
      'gpt-4o-mini';

    const response = await client.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: 2600,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
    });

    const text = response.choices[0]?.message?.content;
    if (!text || typeof text !== 'string') {
      throw new InternalServerErrorException('OpenAI returned an empty response.');
    }

    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      const code = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (code?.[1]) {
        try {
          return JSON.parse(code[1]) as Record<string, unknown>;
        } catch {
          throw new InternalServerErrorException('OpenAI response JSON could not be parsed.');
        }
      }
      throw new InternalServerErrorException('OpenAI response JSON could not be parsed.');
    }
  }

  private async applyCompanyResult(
    orgId: string,
    result: Record<string, unknown>,
    payload: Record<string, unknown>,
  ) {
    const company = this.asRecord(result.fields);
    const bodyCompany = this.asRecord(payload.company);
    const accepted = this.asRecord(bodyCompany.accepted);
    const values = this.asRecord(bodyCompany.values);
    const appendKnowledgeBase = this.readBoolean(bodyCompany.appendToKnowledgeBase, false);

    const readAccepted = (key: string) =>
      accepted[key] === undefined ? true : this.readBoolean(accepted[key], true);
    const readValue = (key: string) => {
      const raw = values[key];
      if (typeof raw === 'string') return raw.trim();
      return '';
    };
    const readExtractedText = (key: string) => {
      const field = this.asRecord(company[key]);
      return this.readString(field.value, 6000);
    };
    const readExtractedList = (key: string) => {
      const field = this.asRecord(company[key]);
      return this.toStringArray(field.value);
    };

    const patch: Partial<typeof schema.orgCompanyProfiles.$inferInsert> = {};
    if (readAccepted('company_overview')) {
      const value = readValue('company_overview') || readExtractedText('company_overview');
      if (value) patch.productSummary = value;
    }
    if (readAccepted('target_customers')) {
      const value = readValue('target_customers') || readExtractedText('target_customers');
      if (value) patch.idealCustomerProfile = value;
    }
    if (readAccepted('value_props')) {
      const value = readValue('value_props');
      const list = value
        ? this.splitLines(value)
        : readExtractedList('value_props');
      if (list.length > 0) patch.valueProposition = list.map((item) => `- ${item}`).join('\n');
    }
    if (readAccepted('tone_style')) {
      const value = readValue('tone_style') || readExtractedText('tone_style');
      if (value) patch.repTalkingPoints = value;
    }
    if (readAccepted('compliance_and_policies')) {
      const value = readValue('compliance_and_policies');
      const list = value
        ? this.splitLines(value)
        : readExtractedList('compliance_and_policies');
      if (list.length > 0) patch.pricingGuidance = list.map((item) => `- ${item}`).join('\n');
    }
    if (readAccepted('forbidden_claims')) {
      const value = readValue('forbidden_claims');
      const list = value
        ? this.splitLines(value)
        : readExtractedList('forbidden_claims');
      if (list.length > 0) patch.doNotSay = list.map((item) => `- ${item}`).join('\n');
    }
    if (readAccepted('competitor_positioning')) {
      const value = readValue('competitor_positioning');
      const list = value
        ? this.splitLines(value)
        : readExtractedList('competitor_positioning');
      if (list.length > 0) patch.competitorGuidance = list.map((item) => `- ${item}`).join('\n');
    }
    if (readAccepted('escalation_rules')) {
      const value = readValue('escalation_rules');
      const list = value
        ? this.splitLines(value)
        : readExtractedList('escalation_rules');
      if (list.length > 0) patch.objectionHandling = list.map((item) => `- ${item}`).join('\n');
    }

    const appendixFromReview =
      readValue('knowledge_base_appendix') || readExtractedText('knowledge_base_appendix');

    const [existing] = await this.db
      .select()
      .from(schema.orgCompanyProfiles)
      .where(eq(schema.orgCompanyProfiles.orgId, orgId))
      .limit(1);

    if (appendKnowledgeBase && appendixFromReview) {
      const currentFaq = existing?.faq || EMPTY_COMPANY_PROFILE_DEFAULTS.faq;
      patch.faq = `${currentFaq}\n\nImported Knowledge\n${appendixFromReview}`.slice(0, 12000);
    }

    const baseProfile = existing
      ? {
          companyName: existing.companyName,
          productName: existing.productName,
          productSummary: existing.productSummary,
          idealCustomerProfile: existing.idealCustomerProfile,
          valueProposition: existing.valueProposition,
          differentiators: existing.differentiators,
          proofPoints: existing.proofPoints,
          repTalkingPoints: existing.repTalkingPoints,
          discoveryGuidance: existing.discoveryGuidance,
          qualificationGuidance: existing.qualificationGuidance,
          objectionHandling: existing.objectionHandling,
          competitorGuidance: existing.competitorGuidance,
          pricingGuidance: existing.pricingGuidance,
          implementationGuidance: existing.implementationGuidance,
          faq: existing.faq,
          doNotSay: existing.doNotSay,
        }
      : EMPTY_COMPANY_PROFILE_DEFAULTS;

    const [saved] = await this.db
      .insert(schema.orgCompanyProfiles)
      .values({
        ...baseProfile,
        orgId,
        ...patch,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.orgCompanyProfiles.orgId,
        set: {
          ...patch,
          updatedAt: new Date(),
        },
      })
      .returning();

    return {
      profile: saved,
      changedFields: Object.keys(patch),
    };
  }

  private async applyProductResult(
    orgId: string,
    result: Record<string, unknown>,
    payload: Record<string, unknown>,
  ) {
    const resultProducts = Array.isArray(result.products) ? result.products : [];
    const reviewProducts = Array.isArray(payload.products) ? payload.products : resultProducts;

    const created: Array<{ id: string; name: string }> = [];
    for (const entry of reviewProducts.slice(0, 10)) {
      const product = this.asRecord(entry);
      const accepted =
        product.accepted === undefined ? true : this.readBoolean(product.accepted, true);
      if (!accepted) continue;

      const name = this.readString(product.name, 160);
      const elevatorPitch = this.readString(product.elevator_pitch, 1000);
      const valueProps = this.toStringArray(product.value_props).slice(0, 30);
      const differentiators = this.toStringArray(product.differentiators).slice(0, 30);
      const dontSay = this.toStringArray(product.dont_say).slice(0, 30);
      const pricingRules = this.toObject(product.pricing_rules);
      const faqs = Array.isArray(product.faqs) ? product.faqs.slice(0, 30) : [];
      const objections = Array.isArray(product.objections) ? product.objections.slice(0, 30) : [];

      if (!name) continue;
      if (valueProps.length < 3) continue;

      const [inserted] = await this.db
        .insert(schema.products)
        .values({
          orgId,
          name,
          elevatorPitch: elevatorPitch || null,
          valueProps,
          differentiators,
          pricingRules,
          dontSay,
          faqs,
          objections,
        })
        .returning({ id: schema.products.id, name: schema.products.name });

      created.push(inserted);
    }

    return { created };
  }

  private normalizeSuggestions(raw: Record<string, unknown>) {
    const list = Array.isArray(raw.suggestions) ? raw.suggestions : [];
    return list
      .slice(0, 6)
      .map((entry) => this.asRecord(entry))
      .map((entry, index) => ({
        id:
          this.readString(entry.id, 80) ||
          `suggestion_${index + 1}`,
        field: this.readString(entry.field, 120) || 'general',
        title: this.readString(entry.title, 160) || 'Improve clarity',
        message: this.readString(entry.message, 600),
        proposedValue: this.readString(entry.proposedValue, 4000),
      }))
      .filter((entry) => entry.message.length > 0);
  }

  private splitLines(value: string) {
    return value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private ensureOpenAiConfigured() {
    const key = this.readEnv('OPENAI_API_KEY') || this.readEnv('LLM_API_KEY');
    if (!key) {
      throw new BadRequestException(
        'OPENAI_API_KEY is missing. Add OPENAI_API_KEY to API environment variables.',
      );
    }
    return key;
  }

  private getOpenAiClient() {
    const apiKey = this.ensureOpenAiConfigured();
    if (!this.openaiClient) {
      this.openaiClient = new OpenAI({
        apiKey,
        ...(this.readEnv('LLM_BASE_URL') ? { baseURL: this.readEnv('LLM_BASE_URL')! } : {}),
      });
    }
    return this.openaiClient;
  }

  private ensureStorageConfigured() {
    const url = this.readEnv('SUPABASE_URL');
    const key = this.readEnv('SUPABASE_SERVICE_ROLE_KEY');
    const bucket =
      this.readEnv('SUPABASE_STORAGE_BUCKET_INGESTION') ||
      this.readEnv('SUPABASE_STORAGE_BUCKET') ||
      '';
    if (!url || !key || !bucket) {
      throw new BadRequestException(
        'Missing Supabase Storage configuration. Add SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET_INGESTION.',
      );
    }
    return {
      url: url.replace(/\/$/, ''),
      key,
      bucket,
    };
  }

  private readEnv(name: string) {
    const value = process.env[name]?.trim();
    return value && value.length > 0 ? value : '';
  }

  private readNumber(value: unknown, fallback: number) {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
    return fallback;
  }

  private readString(value: unknown, maxLength = 4000) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLength);
  }

  private readStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0);
  }

  private readBoolean(value: unknown, fallback: boolean) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
    return fallback;
  }

  private toStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0);
  }

  private toObject(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private asRecord(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private isPdfFile(file: UploadedPdfFile) {
    const byMime = (file.mimetype || '').toLowerCase().includes('pdf');
    const byName = (file.originalname || '').toLowerCase().endsWith('.pdf');
    return byMime || byName;
  }
}

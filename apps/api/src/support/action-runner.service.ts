import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../db/db.module';
import * as schema from '../db/schema';
import { SupportGateway } from './support.gateway';

@Injectable()
export class ActionRunnerService {
  private readonly logger = new Logger(ActionRunnerService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly gateway: SupportGateway,
  ) {}

  /**
   * Propose an action (called by support engine when it detects a trigger).
   */
  async proposeAction(
    sessionId: string,
    definitionId: string,
    inputJson: Record<string, unknown>,
  ) {
    const [execution] = await this.db
      .insert(schema.actionExecutions)
      .values({
        sessionId,
        definitionId,
        status: 'PROPOSED',
        inputJson,
      })
      .returning();

    // Load definition name for the UI
    const [definition] = await this.db
      .select({ name: schema.actionDefinitions.name, description: schema.actionDefinitions.description })
      .from(schema.actionDefinitions)
      .where(eq(schema.actionDefinitions.id, definitionId))
      .limit(1);

    this.gateway.emitToSession(sessionId, 'engine.action_proposed', {
      execution,
      definition: definition ?? { name: 'Unknown', description: '' },
    });

    // Auto-execute if no approval required
    const [def] = await this.db
      .select({ requiresApproval: schema.actionDefinitions.requiresApproval })
      .from(schema.actionDefinitions)
      .where(eq(schema.actionDefinitions.id, definitionId))
      .limit(1);

    if (def && !def.requiresApproval) {
      return this.executeAction(execution.id);
    }

    return execution;
  }

  /**
   * Agent approves → execute.
   */
  async approveAction(executionId: string, _userId: string) {
    const [execution] = await this.db
      .select()
      .from(schema.actionExecutions)
      .where(eq(schema.actionExecutions.id, executionId))
      .limit(1);
    if (!execution) throw new NotFoundException('Action execution not found');
    if (execution.status !== 'PROPOSED') return execution;

    await this.db
      .update(schema.actionExecutions)
      .set({ status: 'APPROVED', approvedAt: new Date() })
      .where(eq(schema.actionExecutions.id, executionId));

    this.gateway.emitToSession(execution.sessionId, 'engine.action_update', {
      executionId,
      status: 'RUNNING',
    });

    return this.executeAction(executionId);
  }

  /**
   * Agent rejects.
   */
  async rejectAction(executionId: string, _userId: string) {
    const [execution] = await this.db
      .select()
      .from(schema.actionExecutions)
      .where(eq(schema.actionExecutions.id, executionId))
      .limit(1);
    if (!execution) throw new NotFoundException('Action execution not found');

    const [updated] = await this.db
      .update(schema.actionExecutions)
      .set({ status: 'REJECTED' })
      .where(eq(schema.actionExecutions.id, executionId))
      .returning();

    this.gateway.emitToSession(execution.sessionId, 'engine.action_update', {
      executionId,
      status: 'REJECTED',
    });

    return updated;
  }

  /**
   * Execute action against the integration's API.
   */
  private async executeAction(executionId: string) {
    const [execution] = await this.db
      .select()
      .from(schema.actionExecutions)
      .where(eq(schema.actionExecutions.id, executionId))
      .limit(1);
    if (!execution) throw new NotFoundException('Action execution not found');

    // Load definition + integration
    const [definition] = await this.db
      .select()
      .from(schema.actionDefinitions)
      .where(eq(schema.actionDefinitions.id, execution.definitionId))
      .limit(1);
    if (!definition) {
      return this.failExecution(executionId, execution.sessionId, 'Action definition not found');
    }

    const [integration] = await this.db
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.id, definition.integrationId))
      .limit(1);
    if (!integration) {
      return this.failExecution(executionId, execution.sessionId, 'Integration not found');
    }

    await this.db
      .update(schema.actionExecutions)
      .set({ status: 'RUNNING' })
      .where(eq(schema.actionExecutions.id, executionId));

    try {
      const config = definition.executionConfig as {
        method?: string;
        endpoint?: string;
        bodyTemplate?: Record<string, unknown>;
        responseMapping?: Record<string, string>;
      };
      const integrationConfig = integration.configJson as {
        baseUrl?: string;
        apiKey?: string;
        headers?: Record<string, string>;
      };

      const baseUrl = (integrationConfig.baseUrl ?? '').replace(/\/$/, '');
      const endpoint = config.endpoint ?? '/';
      const url = `${baseUrl}${endpoint}`;
      const method = (config.method ?? 'GET').toUpperCase();

      // Build request body by interpolating input values into template
      let body: string | undefined;
      if (config.bodyTemplate && method !== 'GET') {
        const interpolated = this.interpolateTemplate(
          config.bodyTemplate,
          execution.inputJson as Record<string, unknown>,
        );
        body = JSON.stringify(interpolated);
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(integrationConfig.headers ?? {}),
      };
      if (integrationConfig.apiKey) {
        headers['Authorization'] = `Bearer ${integrationConfig.apiKey}`;
      }

      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(15_000),
      });

      const outputJson = await response.json().catch(async () => ({ raw: await response.text() }));

      const [completed] = await this.db
        .update(schema.actionExecutions)
        .set({
          status: 'COMPLETED',
          outputJson,
          completedAt: new Date(),
        })
        .where(eq(schema.actionExecutions.id, executionId))
        .returning();

      this.gateway.emitToSession(execution.sessionId, 'engine.action_update', {
        executionId,
        status: 'COMPLETED',
        output: outputJson,
      });

      return completed;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return this.failExecution(executionId, execution.sessionId, message);
    }
  }

  private async failExecution(executionId: string, sessionId: string, errorMessage: string) {
    this.logger.error(`Action execution ${executionId} failed: ${errorMessage}`);

    const [failed] = await this.db
      .update(schema.actionExecutions)
      .set({
        status: 'FAILED',
        errorMessage,
        completedAt: new Date(),
      })
      .where(eq(schema.actionExecutions.id, executionId))
      .returning();

    this.gateway.emitToSession(sessionId, 'engine.action_update', {
      executionId,
      status: 'FAILED',
      error: errorMessage,
    });

    return failed;
  }

  /**
   * Interpolate {{variable}} placeholders in a template object.
   */
  private interpolateTemplate(
    template: Record<string, unknown>,
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template)) {
      if (typeof value === 'string') {
        result[key] = value.replace(/\{\{(\w+)\}\}/g, (_, varName: string) => {
          const val = input[varName];
          return val !== undefined ? String(val) : '';
        });
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = this.interpolateTemplate(
          value as Record<string, unknown>,
          input,
        );
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Get all executions for a session (for the engine to check results).
   */
  async getSessionExecutions(sessionId: string) {
    return this.db
      .select()
      .from(schema.actionExecutions)
      .where(eq(schema.actionExecutions.sessionId, sessionId));
  }
}

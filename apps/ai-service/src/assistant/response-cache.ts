import { createHash } from "node:crypto";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { LlmCompletionRequest } from "./llm-provider.js";

export interface AssistantResponseCache {
  get(key: string): Promise<string | null>;
  set(key: string, content: string, ttlSeconds: number): Promise<void>;
}

export function responseCacheKey(input: {
  readonly tenantId: string;
  readonly userId: string;
  readonly role: string;
  readonly courseId?: string;
  readonly providerIdentity: string;
  readonly request: LlmCompletionRequest;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        tenantId: input.tenantId,
        userId: input.userId,
        role: input.role,
        courseId: input.courseId ?? null,
        providerIdentity: input.providerIdentity,
        systemPrompt: input.request.systemPrompt,
        messages: input.request.messages,
        availableTools: input.request.availableTools,
        integrationContext: input.request.integrationContext,
        temperature: input.request.temperature,
        maxTokens: input.request.maxTokens,
      }),
    )
    .digest("hex");
}

export class CassandraAssistantResponseCache implements AssistantResponseCache {
  public constructor(private readonly client: CassandraClient) {}

  public async get(key: string): Promise<string | null> {
    const rows = await this.client.execute(
      "SELECT content FROM ai_service.assistant_response_cache WHERE cache_key = ?",
      [key],
      "LOCAL_QUORUM",
    );
    const content: unknown = rows[0]?.get("content");
    return typeof content === "string" && content.trim() ? content : null;
  }

  public async set(key: string, content: string, ttlSeconds: number): Promise<void> {
    await this.client.execute(
      "INSERT INTO ai_service.assistant_response_cache (cache_key, content) VALUES (?, ?) USING TTL ?",
      [key, content, ttlSeconds],
      "LOCAL_QUORUM",
    );
  }
}

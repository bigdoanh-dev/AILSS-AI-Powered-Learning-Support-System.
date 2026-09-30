import { Router, type Request } from "express";
import { ZodError, z } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import type { AssistantOrchestrator } from "./orchestrator.js";
import type { AssistantRepository } from "./repository.js";
import { chatRequestSchema, type AssistantRole } from "./model.js";

export type ActorContextVerifier = (token: string) => Promise<{
  readonly userId: string;
  readonly role: AssistantRole;
}>;

export function assistantRouter(
  orchestrator: AssistantOrchestrator,
  repository: AssistantRepository,
  verifyActorContext: ActorContextVerifier,
  metrics: ReturnType<typeof createMetrics>,
): Router {
  const router = Router();

  async function getActor(req: Request): Promise<{ userId: string; role: AssistantRole }> {
    const rawHeader =
      (typeof req.headers["x-actor-context"] === "string" ? req.headers["x-actor-context"] : undefined) ??
      req.headers.authorization;
    if (!rawHeader) {
      throw new AppError("UNAUTHORIZED", 401, "Missing actor context or authorization header");
    }
    const token = rawHeader.startsWith("Bearer ") ? rawHeader.slice(7) : rawHeader;
    try {
      return await verifyActorContext(token);
    } catch {
      throw new AppError("UNAUTHORIZED", 401, "Invalid actor context token");
    }
  }

  // 1. Chat with Assistant
  router.post("/api/v1/assistant/chat", async (req, res, next): Promise<void> => {
    try {
      const context = currentRequestContext();
      const actor = await getActor(req);

      let body;
      try {
        body = chatRequestSchema.parse(req.body);
      } catch (error) {
        if (!(error instanceof ZodError)) throw error;
        throw new AppError(
          "VALIDATION_FAILED",
          422,
          "Invalid chat request body",
          false,
          error.issues.map((i) => ({ field: i.path.join(".") || "body", reason: i.message })),
        );
      }

      const result = await orchestrator.chat(actor, body);

      res.status(200).json({
        data: result,
        meta: {
          requestId: context?.requestId ?? "unknown",
          timestamp: new Date().toISOString(),
        },
      });
      void metrics;
    } catch (error) {
      next(error);
    }
  });

  // 2. List Conversations
  router.get("/api/v1/assistant/conversations", async (req, res, next): Promise<void> => {
    try {
      const context = currentRequestContext();
      const actor = await getActor(req);

      const conversations = (await repository.listUserConversations(actor.userId)).filter(
        (conversation) => conversation.role === actor.role,
      );

      res.status(200).json({
        data: conversations,
        meta: {
          requestId: context?.requestId ?? "unknown",
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  // 3. Get Conversation Detail & Messages
  router.get("/api/v1/assistant/conversations/:id", async (req, res, next): Promise<void> => {
    try {
      const context = currentRequestContext();
      const actor = await getActor(req);
      const conversationId = z.string().uuid().parse(req.params.id);

      const conversation = await repository.getConversation(conversationId);
      if (!conversation) {
        throw new AppError("NOT_FOUND", 404, "Conversation not found");
      }
      if (conversation.userId !== actor.userId || conversation.role !== actor.role) {
        throw new AppError("FORBIDDEN", 403, "Access to conversation denied");
      }

      const messages = await repository.getRecentMessages(conversationId, 500);

      res.status(200).json({
        data: {
          conversation,
          messages,
        },
        meta: {
          requestId: context?.requestId ?? "unknown",
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

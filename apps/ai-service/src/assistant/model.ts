import { z } from "zod";

export type AssistantRole = "PUBLIC" | "STUDENT" | "LECTURER" | "ADMIN";

export type AssistantMode = "STUDENT_ADVISOR" | "STUDY_BUDDY" | "LECTURER_COPILOT" | "ADMIN_SUPPORT";

export type ConversationSender = "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";

export interface Citation {
  readonly sourceId: string;
  readonly title: string;
  readonly lessonId?: string;
  readonly courseId?: string;
  readonly courseVersion?: number;
  readonly lessonVersion?: number;
  readonly sourceObjectId?: string;
  readonly retrievalScore?: number;
  readonly snippet?: string;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface ToolResult {
  readonly toolCallId: string;
  readonly name: string;
  readonly result: unknown;
  readonly error?: string;
}

export interface ConversationMessage {
  readonly messageId: string;
  readonly conversationId: string;
  readonly sender: ConversationSender;
  readonly content: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly toolResults?: readonly ToolResult[];
  readonly citations?: readonly Citation[];
  readonly createdAt: Date;
}

export interface ConversationSummary {
  readonly conversationId: string;
  readonly userId: string;
  readonly role: AssistantRole;
  readonly mode: AssistantMode;
  readonly courseId?: string;
  readonly title: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const chatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  mode: z
    .enum(["STUDENT_ADVISOR", "STUDY_BUDDY", "LECTURER_COPILOT", "ADMIN_SUPPORT"])
    .default("STUDENT_ADVISOR"),
  courseId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(4000),
  responseLanguage: z.enum(["vi", "en"]).optional(),
  historyLimit: z.number().int().min(1).max(50).optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface ChatResponse {
  readonly conversationId: string;
  readonly messageId: string;
  readonly content: string;
  readonly toolInvocations: readonly ToolCall[];
  readonly citations: readonly Citation[];
  readonly mode: AssistantMode;
  readonly safetyBlocked?: boolean;
  /** Bounded, authoritative catalog matches; not a personalized ranking. */
  readonly catalogCourses?: readonly {
    readonly courseId: string;
    readonly title: string;
    readonly priceAmount: number;
    readonly priceCurrency: string;
  }[];
}

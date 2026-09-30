import { ApiError, record, string } from "./api";
export type AdminMessage = { id: string; sender: "USER" | "ASSISTANT"; content: string };
export type RoleAssistantMode = "ADMIN_SUPPORT" | "LECTURER_COPILOT";
export function roleConversation(value: unknown, mode: RoleAssistantMode) {
  const r = record(value);
  const c = record(r.conversation);
  if (c.mode !== mode || !Array.isArray(r.messages)) throw new ApiError("invalid");
  return {
    conversationId: string(c.conversationId),
    messages: r.messages.flatMap((raw): AdminMessage[] => {
      const m = record(raw);
      return m.sender === "USER" || m.sender === "ASSISTANT"
        ? [{ id: string(m.messageId), sender: m.sender, content: string(m.content) }]
        : [];
    }),
  };
}
export function adminConversation(value: unknown) {
  return roleConversation(value, "ADMIN_SUPPORT");
}

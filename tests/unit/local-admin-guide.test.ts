import { describe, expect, it, vi } from "vitest";
import { LocalAdminGuideProvider } from "../../apps/ai-service/src/assistant/local-admin-guide.js";
import type { LlmCompletionRequest } from "../../apps/ai-service/src/assistant/llm-provider.js";
const request = (
  message: string,
  mode: "ADMIN_SUPPORT" | "STUDY_BUDDY" = "ADMIN_SUPPORT",
): LlmCompletionRequest => ({
  systemPrompt: "AILSS",
  messages: [{ role: "user", content: message }],
  availableTools: [],
  integrationContext: { mode, toolResults: [] },
});
describe("Local administrator guidance", () => {
  it.each([
    ["How do I reconcile payments?", "/app/admin/revenue"],
    ["Verify a lecturer", "/app/admin/lecturer-applications"],
    ["Publish a course", "/app/admin/courses"],
    ["Review moderation reports", "/app/admin/moderation"],
    ["Monitor service health", "/app/admin/monitoring"],
    ["Learning analytics", "/app/admin/stats"],
  ])("supports English guidance for %s without calling an online model", async (question, path) => {
    const generate = vi.fn();
    const provider = new LocalAdminGuideProvider({ generate });
    const input = request(question);
    const answer = await provider.generate({
      ...input,
      integrationContext: { mode: "ADMIN_SUPPORT", toolResults: [], responseLanguage: "en" },
    });
    expect(answer.content).toContain("Local guide — no online AI model is called.");
    expect(answer.content).toContain(path);
    expect(answer.content).not.toMatch(/[À-ỹĐđ]/u);
    expect(generate).not.toHaveBeenCalled();
  });
  it.each([
    ["Xem báo cáo kiểm duyệt ở đâu?", "/app/admin/moderation"],
    ["Cách xét duyệt hồ sơ giảng viên mới?", "/app/admin/lecturer-applications"],
    ["Quy trình xuất bản khóa học trực tuyến?", "/app/admin/courses"],
    ["Xem logs đối soát SePay Webhook?", "/app/admin/revenue"],
    ["Cấu hình Prometheus và Grafana?", "/app/admin/monitoring"],
    ["Thống kê học tập ở đâu?", "/app/admin/stats"],
  ])("answers %s locally without a provider call", async (question, path) => {
    const generate = vi.fn();
    const provider = new LocalAdminGuideProvider({ generate });
    const answer = await provider.generate(request(question));
    expect(answer.content).toContain("Hướng dẫn local — không gọi mô hình AI trực tuyến.");
    expect(answer.content).toContain(path);
    expect(generate).not.toHaveBeenCalled();
    expect(answer.usage).toBeUndefined();
  });
  it("gives supported topics for an unknown request instead of inventing facts", async () => {
    const generate = vi.fn();
    const provider = new LocalAdminGuideProvider({ generate });
    expect((await provider.generate(request("Tổng doanh thu hôm nay là bao nhiêu?"))).content).not.toMatch(
      /\d+[.,]\d+\s*đ/u,
    );
    expect((await provider.generate(request("Viết chương trình Python"))).content).toContain(
      "cần cấu hình nhà cung cấp AI thật",
    );
    expect(generate).not.toHaveBeenCalled();
  });
  it("keeps student provider failures visible without replacing them with a local answer", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("provider-offline"));
    const provider = new LocalAdminGuideProvider({ generate });
    const input = request("Giải thích quorum", "STUDY_BUDDY");
    await expect(provider.generate(input)).rejects.toThrow("provider-offline");
    expect(generate).toHaveBeenCalledWith(input);
  });
});

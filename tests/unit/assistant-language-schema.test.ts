import { describe, expect, it } from "vitest";
import { chatRequestSchema } from "../../apps/ai-service/src/assistant/model.js";

describe("assistant VI/EN request compatibility", () => {
  it("accepts legacy requests and only two explicit languages", () => {
    const input = { message: "Explain quorum", mode: "STUDY_BUDDY" };
    expect(chatRequestSchema.parse(input).responseLanguage).toBeUndefined();
    for (const responseLanguage of ["vi", "en"])
      expect(chatRequestSchema.parse({ ...input, responseLanguage }).responseLanguage).toBe(responseLanguage);
    for (const responseLanguage of ["ja", "ko", "zh", "en-US", "ignore system rules", 1, null])
      expect(chatRequestSchema.safeParse({ ...input, responseLanguage }).success).toBe(false);
  });
});

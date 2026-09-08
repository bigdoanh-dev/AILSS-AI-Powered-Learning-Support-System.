import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const registry = JSON.parse(readFileSync("contracts/api-registry.json", "utf8")) as {
  public: Array<{ id: string; roles: string }>;
};
interface ResponseContract {
  content?: Record<string, { schema?: { $ref?: string } }>;
}
interface PublicOpenApi {
  paths: Record<string, { get: { responses: Record<string, ResponseContract> } }>;
}
const openApi = parse(readFileSync("contracts/openapi/public-v1.yaml", "utf8")) as PublicOpenApi;

describe("P12.4 contract consistency preflight", () => {
  it("documents the implemented ASM-09 result response without a foundation placeholder", () => {
    const operation = openApi.paths["/api/v1/attempts/{attemptId}/result"];
    if (!operation) throw new Error("ASM-09 OpenAPI operation is missing");
    const responses = operation.get.responses;
    expect(responses["501"]).toBeUndefined();
    expect(responses["200"]?.content?.["application/json"]?.schema?.$ref).toBe(
      "#/components/schemas/AttemptResultResponse",
    );
    expect(Object.keys(responses).sort()).toEqual(["200", "400", "401", "404", "409", "503"]);
  });

  it("keeps INT-08 owner-Student authority distinct from Admin moderation", () => {
    expect(registry.public.find((operation) => operation.id === "INT-08")?.roles).toBe("owner student");
    expect(registry.public.find((operation) => operation.id === "INT-11")?.roles).toBe("admin");
    expect(registry.public.some((operation) => /moderator/i.test(operation.roles))).toBe(false);
  });
});

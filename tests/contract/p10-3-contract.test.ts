import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const namespace = "d2c62169-6dd9-5a04-b04d-39f739f7c51a";
type Validator = ((value: unknown) => boolean) & { errors?: unknown };
type RegistryEntry = { id: string } & Record<string, unknown>;
const JsonSchemaValidator = Ajv2020 as unknown as new (options: { strict: boolean }) => {
  compile: (schema: unknown) => Validator;
};

describe("P10.3 same-ID contract authority", () => {
  it("locks AI-05 reviewed approval, versioning, idempotency and response", async () => {
    const api = YAML.parse(await readFile("contracts/openapi/public-v1.yaml", "utf8"));
    const operation = api.paths["/api/v1/ai/drafts/{draftId}/approve"].post;
    const parameters = operation.parameters as Array<{
      name: string;
      schema: { const?: string };
    }>;
    expect(operation["x-contract-status"]).toBe("CONTRACT_DEFINED_RUNTIME_NOT_IMPLEMENTED");
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "draftId", in: "path", required: true }),
        expect.objectContaining({ name: "Idempotency-Key", in: "header", required: true }),
        expect.objectContaining({ name: "If-Match", in: "header", required: true }),
      ]),
    );
    expect(parameters.find(({ name }) => name === "If-Match")?.schema.const).toBe('"v1"');
    expect(operation["x-approval-operation"]).toMatchObject({
      generatedDraftVersion: 1,
      approvedDraftVersion: 2,
      approvedSnapshotImmutable: true,
      versionsAboveTwoAllowed: false,
      importOperationId: { algorithm: "UUIDv5", namespace, name: "{draftId}:2" },
    });
    expect(operation.responses["200"].content["application/json"].schema.$ref).toContain(
      "AiDraftApprovalResponse",
    );
    expect(operation.responses["501"]).toBeUndefined();
    for (const status of ["400", "401", "403", "404", "409", "422", "503"])
      expect(operation.responses[status]).toBeDefined();
    expect(api.components.schemas.AiJobState.enum).toContain("APPROVED");
    expect(api.components.schemas.AiDraftApprovalResponse.properties.data.properties).toMatchObject({
      state: { const: "APPROVED" },
      approvedDraftVersion: { const: 2 },
      assessment: { properties: { quizVersion: { const: 1 }, status: { const: "DRAFT" } } },
    });
  });

  it("locks INT-ASMT-01 auth, stable identity, exact DTO and DRAFT-only result", async () => {
    const api = YAML.parse(await readFile("contracts/openapi/internal-v1.yaml", "utf8"));
    const operation = api.paths["/internal/v1/ai-drafts/{id}/import"].post;
    expect(operation.security).toEqual([{ serviceAuth: [], actorContextAuth: [] }]);
    expect(operation["x-service-auth"]).toMatchObject({
      algorithm: "EdDSA",
      subject: "ai-service",
      audience: "assessment-service",
      purpose: "assessment.ai-draft.import",
      jtiRequired: true,
    });
    expect(operation["x-import-identity"]).toMatchObject({
      businessKey: ["path.draftId", "body.approvedDraftVersion"],
      algorithm: "UUIDv5",
      namespace,
      name: "{draftId}:2",
      headerEqualsBody: "Idempotency-Key == importOperationId",
    });
    expect(operation["x-deadline-ms"]).toBe(2000);
    expect(operation.responses["501"]).toBeUndefined();
    for (const status of ["200", "400", "401", "403", "404", "409", "422", "503"])
      expect(operation.responses[status]).toBeDefined();
    const request = api.components.schemas.AiDraftImportRequest;
    expect(request.additionalProperties).toBe(false);
    expect(request.required).toEqual([
      "importOperationId",
      "approvedDraftVersion",
      "approvedDraftChecksum",
      "jobId",
      "targetType",
      "targetId",
      "targetVersion",
      "ownerLecturerId",
      "quiz",
    ]);
    expect(api.components.schemas.AiDraftImportResponse.properties.data.properties).toMatchObject({
      approvedDraftVersion: { const: 2 },
      quizVersion: { const: 1 },
      status: { const: "DRAFT" },
    });
  });

  it("reuses one strict objective-v1 schema and preserves registry cardinalities", async () => {
    const schema = JSON.parse(await readFile("contracts/schemas/objective-v1.schema.json", "utf8"));
    const validate = new JsonSchemaValidator({ strict: false }).compile(schema);
    const quiz = {
      schemaVersion: "objective-v1",
      title: "Reviewed quiz",
      questions: [
        {
          id: "q1",
          order: 1,
          text: "One?",
          points: "1.00",
          type: "SINGLE_CHOICE",
          options: [
            { id: "a", text: "A" },
            { id: "b", text: "B" },
          ],
          correctAnswer: { optionId: "a" },
        },
        {
          id: "q2",
          order: 2,
          text: "Many?",
          points: "2",
          type: "MULTIPLE_CHOICE",
          options: [
            { id: "a", text: "A" },
            { id: "b", text: "B" },
          ],
          correctAnswer: { optionIds: ["a", "b"] },
        },
        {
          id: "q3",
          order: 3,
          text: "True?",
          points: "1",
          type: "TRUE_FALSE",
          correctAnswer: { value: true },
        },
        {
          id: "q4",
          order: 4,
          text: "Short?",
          points: "1",
          type: "SHORT_ANSWER",
          correctAnswer: { acceptedAnswer: "answer" },
        },
      ],
    };
    expect(validate(quiz), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...quiz, provider: "forbidden" })).toBe(false);
    expect(validate({ ...quiz, questions: [{ ...quiz.questions[2], points: "0" }] })).toBe(false);

    const registry = JSON.parse(await readFile("contracts/api-registry.json", "utf8"));
    const queries = JSON.parse(await readFile("contracts/query-registry.json", "utf8"));
    const events = JSON.parse(await readFile("contracts/event-registry.json", "utf8"));
    expect([
      registry.public.length,
      registry.internal.length,
      queries.queries.length,
      events.events.length,
    ]).toEqual([115, 15, 83, 22]);
    const publicApis = registry.public as RegistryEntry[];
    const internalApis = registry.internal as RegistryEntry[];
    expect(publicApis.find(({ id }) => id === "AI-05")).toMatchObject({
      queryIds: ["Q-AI-001", "Q-AI-003", "Q-AI-006"],
      event: null,
    });
    expect(internalApis.find(({ id }) => id === "INT-ASMT-01")).toMatchObject({
      purpose: "assessment.ai-draft.import",
      queryIds: ["Q-ASMT-001", "Q-ASMT-002", "Q-ASMT-007", "Q-ASMT-008"],
      event: null,
    });
  });
});

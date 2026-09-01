import { createHash } from "node:crypto";
import { z } from "zod";
import type { EventEnvelope } from "../../../packages/contracts/src/index.js";
import type { ObjectStorage } from "../../../packages/storage/src/index.js";
import type { ConsumerDisposition } from "../../../packages/rabbitmq/src/index.js";
import { extractDocument, ExtractionFailure } from "./extractor.js";
import type { DocumentWorkerRepository } from "./repository.js";

const dataSchema = z
  .object({
    jobId: z.string().uuid(),
    documentId: z.string().uuid(),
    objectKey: z.string().min(1).max(512),
    checksum: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
export class DocumentExtractionWorker {
  constructor(
    private readonly repo: DocumentWorkerRepository,
    private readonly storage: ObjectStorage,
    private readonly logger: { info(v: object, m: string): void; warn(v: object, m: string): void },
  ) {}
  async handle(event: EventEnvelope): Promise<ConsumerDisposition> {
    if (event.eventType !== "ai.document.extract.v1")
      return { kind: "dead-letter", reason: "UNEXPECTED_EVENT_TYPE" };
    const parsed = dataSchema.safeParse(event.data);
    if (!parsed.success) return { kind: "dead-letter", reason: "INVALID_EVENT_DATA" };
    const data = parsed.data,
      d = await this.repo.get(data.documentId);
    if (!d) return { kind: "dead-letter", reason: "DOCUMENT_NOT_FOUND" };
    if (d.status === "EXTRACTED" || d.status === "FAILED" || d.status === "QUARANTINED")
      return { kind: "ack" };
    if (d.jobId !== data.jobId || d.objectKey !== data.objectKey || d.checksum !== data.checksum)
      return { kind: "dead-letter", reason: "OPERATION_BINDING_MISMATCH" };
    if (!(await this.repo.claim(d, new Date()))) return { kind: "retry", reason: "CLAIM_CONFLICT" };
    if (d.attemptCount >= 3) {
      await this.repo.fail(d, "STORAGE_RETRY_EXHAUSTED", false, new Date());
      return { kind: "ack" };
    }
    let bytes: Buffer;
    try {
      bytes = await this.storage.read(d.objectKey, 25 * 1024 * 1024);
    } catch {
      return { kind: "retry", reason: "STORAGE_READ_TRANSIENT" };
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== d.size || actual !== d.checksum) {
      await this.repo.fail(d, "CONTENT_INTEGRITY_MISMATCH", true, new Date());
      return { kind: "ack" };
    }
    if (!magicMatches(bytes, d.mime)) {
      await this.repo.fail(d, "CONTENT_TYPE_MISMATCH", true, new Date());
      return { kind: "ack" };
    }
    try {
      const result = extractDocument(bytes, d.mime);
      await this.repo.validating(d, new Date());
      const key = `extracted/${d.ownerId}/${d.documentId}/${d.operationId}.txt`;
      await this.storage.writePrivate(key, result.text, "text/plain; charset=utf-8");
      await this.repo.success(
        d,
        {
          key,
          checksum: result.checksum,
          bytes: result.text.length,
          characters: result.characters,
          parserVersion: result.parserVersion,
        },
        new Date(),
      );
      this.logger.info(
        {
          operation: "ai.document.extract",
          documentId: d.documentId,
          jobId: d.jobId,
          state: "EXTRACTED",
          size: d.size,
        },
        "document extraction completed",
      );
      return { kind: "ack" };
    } catch (e) {
      if (e instanceof ExtractionFailure) {
        await this.repo.fail(d, e.code, e.quarantined, new Date());
        this.logger.warn(
          {
            operation: "ai.document.extract",
            documentId: d.documentId,
            jobId: d.jobId,
            state: e.quarantined ? "QUARANTINED" : "FAILED",
            errorCode: e.code,
          },
          "document extraction rejected",
        );
        return { kind: "ack" };
      }
      return { kind: "retry", reason: "EXTRACTION_TRANSIENT" };
    }
  }
}
function magicMatches(b: Buffer, mime: string) {
  if (mime === "application/pdf") return b.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mime.includes("wordprocessingml")) return b[0] === 0x50 && b[1] === 0x4b;
  if (mime === "text/plain")
    return (
      !(b[0] === 0x50 && b[1] === 0x4b) && b.subarray(0, 5).toString("ascii") !== "%PDF-" && !b.includes(0)
    );
  return false;
}

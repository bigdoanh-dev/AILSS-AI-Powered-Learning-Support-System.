import type { ActorContext } from "../../../../packages/security/src/index.js";
import type { EventEnvelope } from "../../../../packages/contracts/src/index.js";
import type { ObjectStorage } from "../../../../packages/storage/src/index.js";
import { AppError } from "../../../../packages/http/src/index.js";
import type { AiIdentityClient } from "../identity-client.js";
import {
  documentDto,
  fingerprint,
  ids,
  keyHash,
  objectKey,
  type CompleteRequest,
  type IntentRequest,
} from "./model.js";
import type { AiDocumentRepository } from "./repository.js";

export class AiDocumentService {
  constructor(
    private readonly repo: AiDocumentRepository,
    private readonly storage: ObjectStorage,
    private readonly identity: AiIdentityClient,
    private readonly secret: string,
  ) {}
  async intent(input: { actor: ActorContext; body: IntentRequest; key: string; correlationId: string }) {
    if (!input.actor.roles.includes("LECTURER"))
      throw new AppError("LECTURER_REQUIRED", 403, "Verified Lecturer required");
    try {
      await this.identity.eligible(input.actor.userId, input.correlationId);
    } catch (e) {
      throw new AppError(
        e instanceof Error && e.message === "REJECTED" ? "LECTURER_NOT_ELIGIBLE" : "IDENTITY_UNAVAILABLE",
        e instanceof Error && e.message === "REJECTED" ? 403 : 503,
        "Lecturer eligibility unavailable",
        true,
      );
    }
    const scope = `lecturer:${input.actor.userId}:AI-07`,
      hash = keyHash(this.secret, input.key),
      fp = fingerprint(this.secret, {
        method: "POST",
        route: "/api/v1/ai/documents/upload-intents",
        actor: input.actor.userId,
        body: input.body,
      }),
      generated = ids(),
      now = new Date();
    const won = await this.repo.reserve(scope, hash, input.key, generated, fp, now);
    const existing = await this.repo.idempotency(scope, hash, input.key);
    if (!existing || existing.fingerprint !== fp)
      throw new AppError("IDEMPOTENCY_CONFLICT", 409, "Idempotency key conflicts with another request");
    if (!won && existing.status === "COMPLETE") return { body: existing.responseBody, replayed: true };
    const documentId = existing.resourceId,
      key = objectKey(input.actor.userId, documentId, input.body.fileName),
      expires = new Date(now.getTime() + 900000);
    let document = await this.repo.get(documentId);
    if (!document) {
      await this.repo.createDocument(documentId, input.actor.userId, key, input.body, expires, now);
      document = await this.repo.get(documentId);
    }
    if (!document)
      throw new AppError("DOCUMENT_CREATE_UNCERTAIN", 503, "Document reservation unavailable", true);
    const upload = await this.storage.createUploadIntent(
      document.objectKey,
      document.declaredMime,
      document.declaredSizeBytes,
    );
    const body = {
      documentId,
      objectKey: document.objectKey,
      uploadUrl: upload.uploadUrl,
      expiresAt: document.uploadExpiresAt.toISOString(),
      status: document.status,
      version: document.version,
    };
    await this.repo.completeCommand(scope, hash, input.key, existing.operationId, 201, body);
    return { body, replayed: !won };
  }
  async complete(input: {
    actor: ActorContext;
    documentId: string;
    body: CompleteRequest;
    key: string;
    correlationId: string;
  }) {
    const scope = `owner:${input.actor.userId}:document:${input.documentId}:AI-08`,
      hash = keyHash(this.secret, input.key),
      fp = fingerprint(this.secret, {
        method: "POST",
        route: `/api/v1/ai/documents/${input.documentId}/complete`,
        actor: input.actor.userId,
        body: input.body,
      }),
      generated = { ...ids(), documentId: input.documentId },
      now = new Date();
    const won = await this.repo.reserve(scope, hash, input.key, generated, fp, now),
      existing = await this.repo.idempotency(scope, hash, input.key);
    if (!existing || existing.fingerprint !== fp)
      throw new AppError("IDEMPOTENCY_CONFLICT", 409, "Idempotency key conflicts with another request");
    if (!won && existing.status === "COMPLETE") return { body: existing.responseBody, replayed: true };
    let d = await this.owner(input.documentId, input.actor.userId);
    if (d.status === "UPLOAD_PENDING") {
      if (
        d.objectKey !== input.body.objectKey ||
        d.declaredChecksum !== input.body.sha256 ||
        d.declaredMime !== input.body.contentType ||
        d.declaredSizeBytes !== input.body.sizeBytes
      )
        throw new AppError("UPLOAD_RESERVATION_MISMATCH", 409, "Upload does not match the reservation");
      let stat;
      try {
        stat = await this.storage.stat(d.objectKey);
      } catch {
        throw new AppError("UPLOAD_OBJECT_NOT_FOUND", 409, "Uploaded object is unavailable");
      }
      if (stat.size !== input.body.sizeBytes || stat.size > 25 * 1024 * 1024)
        throw new AppError("UPLOAD_SIZE_MISMATCH", 409, "Uploaded object size mismatch");
      if (stat.contentType !== input.body.contentType)
        throw new AppError("UPLOAD_CONTENT_TYPE_MISMATCH", 409, "Uploaded object content type mismatch");
      const commandIds = {
        operationId: existing.operationId,
        jobId: generated.jobId,
        eventId: generated.eventId,
      };
      const applied = await this.repo.queueExtraction(d, input.body, commandIds, now);
      d = await this.owner(input.documentId, input.actor.userId);
      if (!applied) throw new AppError("DOCUMENT_VERSION_CONFLICT", 409, "Document completion conflict");
    } else if (d.operationId !== existing.operationId) {
      throw new AppError("DOCUMENT_ALREADY_COMPLETED", 409, "Document upload was already completed");
    }
    if (d.status === "EXTRACTION_QUEUED" && d.operationId && d.jobId && d.eventId) {
      const event: EventEnvelope = {
        specVersion: "1.0",
        eventId: d.eventId,
        eventType: "ai.document.extract.v1",
        occurredAt: now.toISOString(),
        producer: "ai-service",
        correlationId: input.correlationId,
        aggregate: { type: "DOCUMENT", id: d.documentId, version: 2 },
        data: {
          jobId: d.jobId,
          documentId: d.documentId,
          objectKey: d.objectKey,
          checksum: input.body.sha256,
        },
      };
      await this.repo.prepareEvent(event, now);
      await this.repo.createJob(d.jobId, d, d.operationId, now);
      await this.repo.readyEvent(d.eventId, now);
    }
    if (d.status === "FAILED" || d.status === "QUARANTINED")
      throw new AppError("DOCUMENT_NOT_COMPLETABLE", 409, "Document is terminal");
    const body = documentDto(d);
    await this.repo.completeCommand(scope, hash, input.key, existing.operationId, 202, body);
    return { body, replayed: !won };
  }
  async read(actor: ActorContext, documentId: string) {
    return documentDto(await this.owner(documentId, actor.userId));
  }
  private async owner(documentId: string, ownerId: string) {
    const d = await this.repo.get(documentId);
    if (!d || d.ownerId !== ownerId) throw new AppError("DOCUMENT_NOT_FOUND", 404, "Document not found");
    return d;
  }
}

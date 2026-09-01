import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { ALLOWED_CONTENT_TYPES, MAX_UPLOAD_BYTES } from "../../../../packages/storage/src/index.js";

const sha = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .transform((v) => v.toLowerCase());
const mime = z.string().refine((v) => ALLOWED_CONTENT_TYPES.has(v), "Unsupported contentType");
const safeName = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .refine(
    (v) =>
      !Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) &&
      !/[/\\]/u.test(v) &&
      !v.includes(".."),
    "Unsafe fileName",
  );
export const intentSchema = z
  .object({
    fileName: safeName,
    contentType: mime,
    sizeBytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
    sha256: sha,
  })
  .strict();
export const completeSchema = z
  .object({
    objectKey: z.string().min(1).max(512),
    sizeBytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
    sha256: sha,
    contentType: mime,
  })
  .strict();
export type IntentRequest = z.infer<typeof intentSchema>;
export type CompleteRequest = z.infer<typeof completeSchema>;
export type DocumentStatus =
  "UPLOAD_PENDING" | "EXTRACTION_QUEUED" | "EXTRACTING" | "EXTRACTED" | "FAILED" | "QUARANTINED";
export interface DocumentRecord {
  documentId: string;
  ownerId: string;
  objectKey: string;
  fileName: string;
  declaredChecksum: string;
  declaredMime: string;
  declaredSizeBytes: number;
  checksum?: string;
  mime?: string;
  sizeBytes?: number;
  status: DocumentStatus;
  version: number;
  uploadExpiresAt: Date;
  operationId?: string;
  jobId?: string;
  eventId?: string;
  extractionObjectKey?: string;
  extractionChecksum?: string;
  extractedBytes?: number;
  extractedCharacters?: number;
  parserVersion?: string;
  failureCode?: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface IdempotencyRecord {
  operationId: string;
  resourceId: string;
  fingerprint: string;
  status: string;
  responseStatus?: number;
  responseBody?: unknown;
}
export function documentDto(d: DocumentRecord) {
  return {
    documentId: d.documentId,
    fileName: d.fileName,
    contentType: d.declaredMime,
    sizeBytes: d.sizeBytes ?? d.declaredSizeBytes,
    sha256: d.checksum ?? d.declaredChecksum,
    status: d.status,
    version: d.version,
    ...(d.jobId ? { jobId: d.jobId } : {}),
    ...(d.extractionChecksum ? { extractionChecksum: d.extractionChecksum } : {}),
    ...(d.extractedBytes !== undefined ? { extractedBytes: d.extractedBytes } : {}),
    ...(d.extractedCharacters !== undefined ? { extractedCharacters: d.extractedCharacters } : {}),
    ...(d.failureCode ? { failureCode: d.failureCode } : {}),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}
export function validateIdempotencyKey(v: string | undefined): string {
  if (!v || v.length > 200 || !/^[\x21-\x7e]+$/u.test(v)) throw new Error("INVALID_IDEMPOTENCY_KEY");
  return v;
}
export function fingerprint(secret: string, value: unknown): string {
  return createHmac("sha256", secret).update(JSON.stringify(value)).digest("hex");
}
export function keyHash(secret: string, key: string): number {
  const b = createHmac("sha256", secret).update(key).digest()[0] ?? 0;
  return b > 127 ? b - 256 : b;
}
export function eventShard(id: string): number {
  return (createHash("sha256").update(id).digest()[0] ?? 0) % 16;
}
export function ids() {
  return { operationId: randomUUID(), documentId: randomUUID(), jobId: randomUUID(), eventId: randomUUID() };
}
export function objectKey(ownerId: string, documentId: string, fileName: string) {
  const normalized = fileName.normalize("NFKC").replace(/[^a-zA-Z0-9._-]/gu, "_");
  return `documents/${ownerId}/${documentId}/${randomBytes(12).toString("hex")}/${normalized}`;
}

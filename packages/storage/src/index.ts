import { createHash } from "node:crypto";
import { Client } from "minio";

export const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);
export const LESSON_CONTENT_TYPES = new Set([...ALLOWED_CONTENT_TYPES, "video/mp4", "video/webm"]);
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface UploadIntent {
  readonly objectKey: string;
  readonly uploadUrl: string;
  readonly expiresInSeconds: number;
}
export interface ObjectMetadata {
  readonly objectKey: string;
  readonly size: number;
  readonly contentType: string;
  readonly sha256: string;
}

export interface ObjectStorage {
  createUploadIntent(objectKey: string, contentType: string, size: number): Promise<UploadIntent>;
  verify(metadata: ObjectMetadata): Promise<boolean>;
  createReadUrl(objectKey: string): Promise<string>;
  stat(objectKey: string): Promise<{ readonly size: number; readonly contentType: string }>;
  read(objectKey: string, maximumBytes?: number): Promise<Buffer>;
  writePrivate(objectKey: string, content: Buffer, contentType: string): Promise<void>;
}

export function validateObjectKey(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,511}$/.test(value) || value.includes("..") || value.startsWith("/")) {
    throw new Error("INVALID_OBJECT_KEY");
  }
  return value;
}

export class MinioStorage implements ObjectStorage {
  readonly #client: Client;
  readonly #readSigner: Client;
  public constructor(
    private readonly bucket: string,
    options: ConstructorParameters<typeof Client>[0],
    publicOrigin?: string,
  ) {
    this.#client = new Client(options);
    if (publicOrigin) {
      const origin = new URL(publicOrigin);
      if (
        !["http:", "https:"].includes(origin.protocol) ||
        origin.username ||
        origin.password ||
        origin.pathname !== "/" ||
        origin.search ||
        origin.hash
      )
        throw new Error("INVALID_PUBLIC_STORAGE_ORIGIN");
      this.#readSigner = new Client({
        ...options,
        endPoint: origin.hostname,
        port: Number(origin.port || (origin.protocol === "https:" ? 443 : 80)),
        useSSL: origin.protocol === "https:",
        region: options.region || "us-east-1",
      });
    } else this.#readSigner = this.#client;
  }

  public async createUploadIntent(
    objectKey: string,
    contentType: string,
    size: number,
  ): Promise<UploadIntent> {
    validateObjectKey(objectKey);
    if (!ALLOWED_CONTENT_TYPES.has(contentType) || size < 1 || size > MAX_UPLOAD_BYTES)
      throw new Error("UPLOAD_POLICY_REJECTED");
    return {
      objectKey,
      uploadUrl: await this.#readSigner.presignedPutObject(this.bucket, objectKey, 15 * 60),
      expiresInSeconds: 15 * 60,
    };
  }

  public async verify(metadata: ObjectMetadata): Promise<boolean> {
    validateObjectKey(metadata.objectKey);
    const stat = await this.#client.statObject(this.bucket, metadata.objectKey);
    return (
      stat.size === metadata.size &&
      LESSON_CONTENT_TYPES.has(metadata.contentType) &&
      /^[a-f0-9]{64}$/i.test(metadata.sha256)
    );
  }

  public async createReadUrl(objectKey: string): Promise<string> {
    validateObjectKey(objectKey);
    return this.#readSigner.presignedGetObject(this.bucket, objectKey, 5 * 60);
  }

  public async stat(objectKey: string): Promise<{ readonly size: number; readonly contentType: string }> {
    validateObjectKey(objectKey);
    const value = await this.#client.statObject(this.bucket, objectKey);
    return { size: value.size, contentType: String(value.metaData["content-type"] ?? "") };
  }

  public async read(objectKey: string, maximumBytes = MAX_UPLOAD_BYTES): Promise<Buffer> {
    validateObjectKey(objectKey);
    const stream = await this.#client.getObject(this.bucket, objectKey);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const value = Buffer.from(chunk);
      size += value.length;
      if (size > maximumBytes) {
        stream.destroy(new Error("OBJECT_TOO_LARGE"));
        throw new Error("OBJECT_TOO_LARGE");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  }

  public async removePrivate(objectKey: string): Promise<void> {
    validateObjectKey(objectKey);
    await this.#client.removeObject(this.bucket, objectKey);
  }

  public async writePrivate(objectKey: string, content: Buffer, contentType: string): Promise<void> {
    validateObjectKey(objectKey);
    await this.#client.putObject(this.bucket, objectKey, content, content.length, {
      "Content-Type": contentType,
      "x-amz-meta-sha256": sha256(content),
    });
  }
}

export function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

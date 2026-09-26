import type { Readable } from "node:stream";
import { Client } from "minio";
import { validateObjectKey } from "./index.js";

export interface MultipartPart {
  part: number;
  etag: string;
  size: number;
}
export interface MediaObjectStorage {
  begin(key: string, mimeType: string): Promise<string>;
  partUrl(key: string, uploadId: string, part: number, ttlSeconds: number): Promise<string>;
  parts(key: string, uploadId: string): Promise<MultipartPart[]>;
  complete(key: string, uploadId: string, parts: MultipartPart[]): Promise<void>;
  abort(key: string, uploadId: string): Promise<void>;
  stat(key: string): Promise<{ size: number; etag: string }>;
  readStream(key: string): Promise<Readable>;
  writeFile(key: string, filename: string, mimeType: string): Promise<void>;
  writeBytes(key: string, bytes: Buffer, mimeType: string): Promise<void>;
  remove(key: string): Promise<void>;
}
// Keep the SDK's low-level multipart API inside this S3-compatible adapter only.
class MultipartClient extends Client {
  async uploadedParts(bucket: string, key: string, uploadId: string) {
    return this.listParts(bucket, key, uploadId);
  }
}
export class S3MediaStorage implements MediaObjectStorage {
  private readonly client: MultipartClient;
  private readonly signer: MultipartClient;
  constructor(
    private readonly bucket: string,
    options: ConstructorParameters<typeof Client>[0],
    publicOrigin: string,
  ) {
    this.client = new MultipartClient(options);
    const origin = new URL(publicOrigin);
    if (
      !/^https?:$/.test(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      throw Error("INVALID_MEDIA_STORAGE_ORIGIN");
    this.signer = new MultipartClient({
      ...options,
      endPoint: origin.hostname,
      port: Number(origin.port || (origin.protocol === "https:" ? 443 : 80)),
      useSSL: origin.protocol === "https:",
      region: options.region || "us-east-1",
    });
  }
  async begin(key: string, mimeType: string) {
    return this.client.initiateNewMultipartUpload(this.bucket, validateObjectKey(key), {
      "Content-Type": mimeType,
    });
  }
  async partUrl(key: string, uploadId: string, part: number, ttlSeconds: number) {
    if (!Number.isInteger(part) || part < 1 || part > 10_000) throw Error("INVALID_PART_NUMBER");
    return this.signer.presignedUrl("PUT", this.bucket, validateObjectKey(key), ttlSeconds, {
      uploadId,
      partNumber: String(part),
    });
  }
  async parts(key: string, uploadId: string): Promise<MultipartPart[]> {
    const rows = await this.client.uploadedParts(this.bucket, validateObjectKey(key), uploadId);
    return rows.map((p) => ({ part: p.part, etag: p.etag, size: p.size }));
  }
  async complete(key: string, uploadId: string, parts: MultipartPart[]) {
    await this.client.completeMultipartUpload(this.bucket, validateObjectKey(key), uploadId, parts);
  }
  async abort(key: string, uploadId: string) {
    await this.client.abortMultipartUpload(this.bucket, validateObjectKey(key), uploadId);
  }
  async stat(key: string) {
    const s = await this.client.statObject(this.bucket, validateObjectKey(key));
    return { size: s.size, etag: s.etag };
  }
  async readStream(key: string) {
    return this.client.getObject(this.bucket, validateObjectKey(key));
  }
  async writeFile(key: string, filename: string, mimeType: string) {
    await this.client.fPutObject(this.bucket, validateObjectKey(key), filename, { "Content-Type": mimeType });
  }
  async writeBytes(key: string, bytes: Buffer, mimeType: string) {
    await this.client.putObject(this.bucket, validateObjectKey(key), bytes, bytes.length, {
      "Content-Type": mimeType,
    });
  }
  async remove(key: string) {
    await this.client.removeObject(this.bucket, validateObjectKey(key));
  }
}

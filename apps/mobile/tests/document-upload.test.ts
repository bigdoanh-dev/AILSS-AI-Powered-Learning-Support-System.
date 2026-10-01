import type { Fetcher } from "../src/api";
import { describe, expect, it, vi } from "vitest";
import { uploadDocument, type DocumentUpload } from "../src/document-upload";
const file = {
  fileName: "notes.txt",
  contentType: "text/plain",
  bytes: new TextEncoder().encode("notes").buffer,
  sha256: "a".repeat(64),
};
describe("document upload recovery", () => {
  it("retries completion with the same key and does not upload an already received file twice", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        documentId: "document",
        objectKey: "object",
        uploadUrl: "https://storage.example.org/object",
      })
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ status: "EXTRACTION_QUEUED" });
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(new Response(null, { status: 200 }));
    const attempt: DocumentUpload = { intentKey: "intent-key", completeKey: "complete-key" };
    await expect(uploadDocument(request, file, attempt, undefined, fetcher)).rejects.toThrow("timeout");
    expect(attempt.uploaded).toBe(true);
    await expect(uploadDocument(request, file, attempt, undefined, fetcher)).resolves.toBe("document");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[1]).toEqual(request.mock.calls[2]);
    expect(request.mock.calls[1][1]).toMatchObject({
      idempotencyKey: "complete-key",
      body: { sizeBytes: 5, contentType: "text/plain", sha256: file.sha256, objectKey: "object" },
    });
  });
  it("does not call complete if the object upload fails", async () => {
    const request = vi.fn().mockResolvedValue({
      documentId: "document",
      objectKey: "object",
      uploadUrl: "https://storage.example.org/object",
    });
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(new Response(null, { status: 500 }));
    await expect(
      uploadDocument(request, file, { intentKey: "i", completeKey: "c" }, undefined, fetcher),
    ).rejects.toThrow("Không tải được");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects unsupported and oversized files before contacting the server", async () => {
    const request = vi.fn();
    for (const invalid of [
      { ...file, contentType: "text/html" },
      { ...file, bytes: new ArrayBuffer(25 * 1024 * 1024 + 1) },
      { ...file, bytes: new ArrayBuffer(0) },
    ])
      await expect(uploadDocument(request, invalid, { intentKey: "i", completeKey: "c" })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});

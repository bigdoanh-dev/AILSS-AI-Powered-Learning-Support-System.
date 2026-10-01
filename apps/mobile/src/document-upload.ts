import { ApiError, record, string, type RequestOptions, type Fetcher } from "./api";

export const DOCUMENT_TYPES = [
  "application/pdf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
export type DocumentFile = { fileName: string; contentType: string; bytes: ArrayBuffer; sha256: string };
export type DocumentUpload = {
  intentKey: string;
  completeKey: string;
  documentId?: string;
  objectKey?: string;
  uploadUrl?: string;
  uploaded?: boolean;
  completed?: boolean;
};
type Request = (path: string, options?: RequestOptions) => Promise<unknown>;

/** Retrying an interrupted upload preserves both command receipts and the uploaded object. */
export async function uploadDocument(
  request: Request,
  file: DocumentFile,
  attempt: DocumentUpload,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<string> {
  if (
    !DOCUMENT_TYPES.includes(file.contentType) ||
    !file.bytes.byteLength ||
    file.bytes.byteLength > 25 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/u.test(file.sha256)
  )
    throw new Error("Chọn tài liệu PDF, DOCX hoặc TXT không quá 25 MiB.");
  const metadata = { contentType: file.contentType, sizeBytes: file.bytes.byteLength, sha256: file.sha256 };
  if (!attempt.documentId) {
    const intent = record(
      await request("/api/v1/ai/documents/upload-intents", {
        method: "POST",
        body: { fileName: file.fileName, ...metadata },
        idempotencyKey: attempt.intentKey,
        signal,
      }),
    );
    attempt.documentId = string(intent.documentId);
    attempt.objectKey = string(intent.objectKey);
    attempt.uploadUrl = string(intent.uploadUrl);
  }
  if (!attempt.uploaded) {
    const url = new URL(string(attempt.uploadUrl));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
      throw new ApiError("invalid");
    const response = await fetcher(url.toString(), {
      method: "PUT",
      headers: { "Content-Type": file.contentType },
      body: file.bytes,
      signal: signal ?? AbortSignal.timeout(120000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("Không tải được tài liệu. Kiểm tra địa chỉ kho tài liệu và thử lại.");
    attempt.uploaded = true;
  }
  if (!attempt.completed) {
    await request(`/api/v1/ai/documents/${attempt.documentId}/complete`, {
      method: "POST",
      body: { objectKey: attempt.objectKey, ...metadata },
      idempotencyKey: attempt.completeKey,
      signal,
    });
    attempt.completed = true;
  }
  return attempt.documentId;
}

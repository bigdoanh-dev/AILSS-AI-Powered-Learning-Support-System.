import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { extractDocument, ExtractionFailure } from "../../apps/document-worker/src/extractor.js";
import { completeSchema, intentSchema, objectKey } from "../../apps/ai-service/src/documents/model.js";

describe("P10.1 secure document primitives", () => {
  it("locks strict upload DTOs and owner-scoped keys", () => {
    const body = { fileName: "notes.txt", contentType: "text/plain", sizeBytes: 5, sha256: "a".repeat(64) };
    expect(intentSchema.parse(body)).toEqual(body);
    expect(() => intentSchema.parse({ ...body, ownerId: "forged" })).toThrow();
    expect(() => completeSchema.parse({ ...body, objectKey: "x" })).toThrow();
    expect(objectKey("owner", "document", "notes.txt")).toMatch(
      /^documents\/owner\/document\/[a-f0-9]{24}\/notes\.txt$/u,
    );
  });
  it("extracts bounded UTF-8, PDF text and DOCX text", () => {
    expect(extractDocument(Buffer.from("hello\r\nworld"), "text/plain").text.toString()).toBe("hello\nworld");
    expect(
      extractDocument(Buffer.from("%PDF-1.4\n(hello) Tj\n%%EOF"), "application/pdf").text.toString(),
    ).toBe("hello");
    const docx = zipSync(
      {
        "[Content_Types].xml": strToU8("<Types/>"),
        "word/document.xml": strToU8("<w:document><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p></w:document>"),
      },
      { level: 0 },
    );
    expect(
      extractDocument(
        Buffer.from(docx),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ).text.toString(),
    ).toBe("Hello DOCX");
  });
  it("accepts a normal text-heavy DOCX even when XML compresses beyond eight times", () => {
    const paragraph = "Nguyên lý hệ điều hành và quản lý tiến trình. ".repeat(4000);
    const docx = zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "word/document.xml": strToU8(`<w:document><w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p></w:document>`),
    });
    expect(paragraph.length / docx.length).toBeGreaterThan(8);
    expect(
      extractDocument(
        Buffer.from(docx),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ).characters,
    ).toBe(paragraph.trim().length);
  });
  it("still quarantines a highly compressed DOCX beyond the absolute safety floor", () => {
    const docx = zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "word/document.xml": strToU8(`<w:document><w:t>${"A".repeat(9 * 1024 * 1024)}</w:t></w:document>`),
    });
    try {
      extractDocument(
        Buffer.from(docx),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "DOCX_DECOMPRESSION_LIMIT", quarantined: true });
    }
  });
  it("quarantines active PDF and rejects malformed UTF-8", () => {
    expect(() =>
      extractDocument(Buffer.from("%PDF-1.4 /JavaScript (x) Tj %%EOF"), "application/pdf"),
    ).toThrowError(ExtractionFailure);
    try {
      extractDocument(Buffer.from([0xff]), "text/plain");
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_UTF8", quarantined: false });
    }
  });
  it("rejects empty and oversized extracted text at the configured boundary", () => {
    expect(() => extractDocument(Buffer.from("   \r\n"), "text/plain", 16)).toThrowError(
      expect.objectContaining({ code: "EMPTY_DOCUMENT", quarantined: false }),
    );
    expect(() => extractDocument(Buffer.from("12345"), "text/plain", 4)).toThrowError(
      expect.objectContaining({ code: "EXTRACTED_OUTPUT_TOO_LARGE", quarantined: true }),
    );
    expect(extractDocument(Buffer.from("1234"), "text/plain", 4).text.toString()).toBe("1234");
  });
});

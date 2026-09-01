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
});

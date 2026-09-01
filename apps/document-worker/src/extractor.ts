import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";

export class ExtractionFailure extends Error {
  constructor(
    public readonly code: string,
    public readonly quarantined: boolean,
  ) {
    super(code);
  }
}
const OUTPUT_MAX = 5 * 1024 * 1024,
  DOCX_EXPANSION_MAX = 8,
  DOCX_ENTRY_MAX = 2000;
export function extractDocument(
  input: Buffer,
  mime: string,
): { text: Buffer; checksum: string; characters: number; parserVersion: string } {
  let text: string;
  if (mime === "text/plain") text = extractTxt(input);
  else if (mime === "application/pdf") text = extractPdf(input);
  else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    text = extractDocx(input);
  else throw new ExtractionFailure("UNSUPPORTED_CONTENT_TYPE", true);
  const normalized = text.normalize("NFKC").replace(/\r\n?/gu, "\n").trim(),
    output = Buffer.from(normalized, "utf8");
  if (output.length > OUTPUT_MAX) throw new ExtractionFailure("EXTRACTED_OUTPUT_TOO_LARGE", true);
  return {
    text: output,
    checksum: createHash("sha256").update(output).digest("hex"),
    characters: Array.from(normalized).length,
    parserVersion: "ailss-bounded-1",
  };
}
function extractTxt(input: Buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    throw new ExtractionFailure("INVALID_UTF8", false);
  }
}
function extractPdf(input: Buffer) {
  const source = input.toString("latin1");
  if (!source.startsWith("%PDF-") || !source.includes("%%EOF"))
    throw new ExtractionFailure("MALFORMED_PDF", false);
  if (/\/(?:JavaScript|JS|OpenAction|Launch|EmbeddedFile|XFA)\b/u.test(source))
    throw new ExtractionFailure("PDF_ACTIVE_CONTENT", true);
  const values: string[] = [];
  const pattern = /\(([^()]*)\)\s*(?:Tj|'|")/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    values.push((match[1] ?? "").replace(/\\([()\\])/gu, "$1"));
    if (values.join(" ").length > OUTPUT_MAX) throw new ExtractionFailure("EXTRACTED_OUTPUT_TOO_LARGE", true);
  }
  if (values.length === 0) throw new ExtractionFailure("PDF_TEXT_UNAVAILABLE", false);
  return values.join("\n");
}
function extractDocx(input: Buffer) {
  if (input[0] !== 0x50 || input[1] !== 0x4b) throw new ExtractionFailure("DOCX_MAGIC_MISMATCH", true);
  let total = 0,
    entries = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(input), {
      filter(file) {
        entries++;
        total += file.originalSize;
        if (entries > DOCX_ENTRY_MAX || total > OUTPUT_MAX || total > input.length * DOCX_EXPANSION_MAX)
          throw new ExtractionFailure("DOCX_DECOMPRESSION_LIMIT", true);
        if (file.name.includes("..") || file.name.startsWith("/") || file.name.includes("\\"))
          throw new ExtractionFailure("DOCX_PATH_TRAVERSAL", true);
        if (/vbaProject|embeddings|activeX/iu.test(file.name))
          throw new ExtractionFailure("DOCX_ACTIVE_CONTENT", true);
        return file.name === "word/document.xml" || file.name === "[Content_Types].xml";
      },
    });
  } catch (e) {
    if (e instanceof ExtractionFailure) throw e;
    throw new ExtractionFailure("MALFORMED_DOCX", false);
  }
  const document = files["word/document.xml"],
    types = files["[Content_Types].xml"];
  if (!document || !types) throw new ExtractionFailure("MALFORMED_DOCX", false);
  const xml = strFromU8(document);
  return xml
    .replace(/<w:tab\s*\/>/gu, "\t")
    .replace(/<\/w:p>/gu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

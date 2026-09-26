import { z } from "zod";

export const MAX_WEBVTT_BYTES = 256 * 1024;

export const captionUploadSchema = z.object({
  language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/).max(35),
  label: z.string().trim().min(1).max(80).refine((value) =>
    Array.from(value).every((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code > 31 && code !== 127;
    })),
  kind: z.enum(["SUBTITLES", "CAPTIONS"]),
  contentType: z.literal("text/vtt"),
  content: z.string().min(1).max(MAX_WEBVTT_BYTES),
}).strict();

const timestamp = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/;
function timestampMs(value: string): number | undefined {
  const match = timestamp.exec(value);
  if (!match) return undefined;
  return ((Number(match[1] ?? 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]);
}

// Accept a deliberately small, plain-text WebVTT subset. Reject unsupported
// constructs instead of silently storing a track browsers may parse differently.
export function validateWebVtt(raw: string): string {
  if (Buffer.byteLength(raw, "utf8") > MAX_WEBVTT_BYTES || Array.from(raw).some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
  }))
    throw Error("WEBVTT_INVALID");
  const normalized = raw.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  const blocks = normalized.trimEnd().split(/\n\n+/u);
  if (blocks.length < 2 || blocks[0] !== "WEBVTT") throw Error("WEBVTT_INVALID");
  const ids = new Set<string>();
  let cues = 0;
  for (const block of blocks.slice(1)) {
    const lines = block.split("\n");
    const timingIndex = lines[0]?.includes(" --> ") ? 0 : 1;
    if (timingIndex === 1) {
      const identifier = lines[0];
      if (!identifier || identifier.includes("-->") || ids.has(identifier)) throw Error("WEBVTT_INVALID");
      ids.add(identifier);
    }
    if (lines.length <= timingIndex + 1) throw Error("WEBVTT_INVALID");
    const match = /^(\S+) --> (\S+)$/u.exec(lines[timingIndex] ?? "");
    const start = match ? timestampMs(match[1] ?? "") : undefined;
    const end = match ? timestampMs(match[2] ?? "") : undefined;
    if (start === undefined || end === undefined || start >= end) throw Error("WEBVTT_INVALID");
    if (lines.slice(timingIndex + 1).some((line) => line.includes("-->") || /[<>]/u.test(line)))
      throw Error("WEBVTT_INVALID");
    cues++;
    if (cues > 5000) throw Error("WEBVTT_INVALID");
  }
  if (!cues) throw Error("WEBVTT_INVALID");
  return `${normalized.trimEnd()}\n`;
}

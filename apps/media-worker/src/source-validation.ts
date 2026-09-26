// ffprobe's "matroska,webm" identifies a demuxer family, not the actual
// document type. Parse only the bounded EBML header; ffprobe remains responsible
// for full stream/codec/duration validation of the same downloaded local file.
export const SOURCE_HEADER_BYTES = 64 * 1024;
function invalid(): never {
  throw Error("MEDIA_CONTAINER_SIGNATURE_REJECTED");
}
function vint(bytes: Buffer, offset: number, id = false) {
  const first = bytes[offset];
  if (!first) return invalid();
  let width = 1;
  let marker = 0x80;
  while (!(first & marker)) {
    width++;
    marker >>= 1;
  }
  if (width > (id ? 4 : 8) || offset + width > bytes.length) return invalid();
  let value = id ? first : first & (marker - 1);
  let data = first & (marker - 1);
  for (let index = 1; index < width; index++) {
    value = value * 256 + (bytes[offset + index] ?? 0);
    data = data * 256 + (bytes[offset + index] ?? 0);
    if (!Number.isSafeInteger(value)) return invalid();
  }
  if (id && (data === 0 || data === 2 ** (7 * width) - 1 || (width > 1 && data < 2 ** (7 * (width - 1)) - 1)))
    return invalid();
  if (!id && (value > SOURCE_HEADER_BYTES || value === 2 ** (7 * width) - 1)) return invalid();
  return { width, value };
}
export function sourceContainer(header: Buffer, mimeType: string, allowedContainers: readonly string[]) {
  let container: "mp4" | "webm";
  if (header.length >= 16 && header.subarray(4, 8).toString("ascii") === "ftyp") {
    // Preserve the existing ftyp/ISO-BMFF acceptance family; this patch does not
    // introduce a new MP4 brand policy or revisit already-READY legacy assets.
    container = "mp4";
  } else if (header.subarray(0, 4).toString("hex") === "1a45dfa3") {
    const length = vint(header, 4);
    const end = 4 + length.width + length.value;
    if (end > header.length || end > SOURCE_HEADER_BYTES) return invalid();
    let cursor = 4 + length.width;
    let documentType: string | undefined;
    while (cursor < end) {
      const element = vint(header, cursor, true);
      cursor += element.width;
      const size = vint(header, cursor);
      cursor += size.width;
      if (cursor + size.value > end) return invalid();
      if (element.value === 0x4282) {
        if (documentType !== undefined || size.value < 1) return invalid();
        const raw = header.subarray(cursor, cursor + size.value);
        const nul = raw.indexOf(0);
        const stringEnd = nul === -1 ? raw.length : nul;
        const text = raw.subarray(0, stringEnd);
        if (text.some((value) => value < 0x20 || value > 0x7e)) return invalid();
        documentType = text.toString("ascii");
      }
      // Skip bounded scalar/Void/CRC elements; strings inside their payloads
      // cannot substitute for a structural DocType element.
      cursor += size.value;
    }
    if (documentType !== "webm") throw Error("MEDIA_POLICY_REJECTED");
    container = "webm";
  } else return invalid();
  if (!allowedContainers.includes(container)) throw Error("MEDIA_POLICY_REJECTED");
  if (mimeType !== `video/${container}`) throw Error("MEDIA_MIME_REJECTED");
  return container;
}

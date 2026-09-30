import { describe, expect, it } from "vitest";
import { SOURCE_HEADER_BYTES, sourceContainer } from "../../apps/media-worker/src/source-validation.js";
import { probeMetadata } from "../../apps/media-worker/src/processor.js";
import {
  transition,
  type MediaAsset,
  type MediaPolicy,
} from "../../apps/learning-service/src/media/model.js";

const containers = ["mp4", "webm"];
const sized = (value: number, wide = false) =>
  wide ? Buffer.from([0x40 | (value >> 8), value & 0xff]) : Buffer.from([0x80 | value]);
const field = (id: number[], payload: Buffer, wide = false) =>
  Buffer.concat([Buffer.from(id), sized(payload.length, wide), payload]);
const doc = (value: string, wide = false) => field([0x42, 0x82], Buffer.from(value), wide);
const ebml = (fields: Buffer[], wide = false) => {
  const data = Buffer.concat(fields);
  return Buffer.concat([Buffer.from("1a45dfa3", "hex"), sized(data.length, wide), data]);
};
const mp4 = Buffer.from("000000186674797069736f6d0000020069736f6d6d703431", "hex");
describe("actual source container and MIME boundary", () => {
  it("keeps recognized MP4 source compatible", () =>
    expect(sourceContainer(mp4, "video/mp4", containers)).toBe("mp4"));
  it("accepts structural WebM DocType", () =>
    expect(sourceContainer(ebml([doc("webm")]), "video/webm", containers)).toBe("webm"));
  it("accepts longer size VINT encodings", () =>
    expect(sourceContainer(ebml([doc("webm", true)], true), "video/webm", containers)).toBe("webm"));
  it.each(["webm\0", "webm\0\0", "webm\0ignored"])("preserves null-terminated string semantics %j", (value) =>
    expect(sourceContainer(ebml([doc(value)]), "video/webm", containers)).toBe("webm"),
  );
  it("skips bounded Void/CRC fields without string searching", () =>
    expect(
      sourceContainer(
        ebml([field([0xec], Buffer.from("webm")), field([0xbf], Buffer.alloc(4)), doc("webm")]),
        "video/webm",
        containers,
      ),
    ).toBe("webm"));
  it("does not confuse Matroska with shared ffprobe demuxer", () =>
    expect(() => sourceContainer(ebml([doc("matroska")]), "video/webm", containers)).toThrow(
      "MEDIA_POLICY_REJECTED",
    ));
  it("does not use DocType bytes hidden in Void", () =>
    expect(() => sourceContainer(ebml([field([0xec], doc("webm"))]), "video/webm", containers)).toThrow(
      "MEDIA_POLICY_REJECTED",
    ));
  it.each([
    [doc("webm"), doc("matroska")],
    [doc("matroska"), doc("webm")],
  ])("rejects duplicate DocType regardless of ordering", (...fields) =>
    expect(() => sourceContainer(ebml(fields), "video/webm", containers)).toThrow(
      "MEDIA_CONTAINER_SIGNATURE_REJECTED",
    ),
  );
  it("rejects MP4 claimed as WebM", () =>
    expect(() => sourceContainer(mp4, "video/webm", containers)).toThrow("MEDIA_MIME_REJECTED"));
  it("rejects WebM claimed as MP4", () =>
    expect(() => sourceContainer(ebml([doc("webm")]), "video/mp4", containers)).toThrow(
      "MEDIA_MIME_REJECTED",
    ));
  it("honors configured container removal", () =>
    expect(() => sourceContainer(ebml([doc("webm")]), "video/webm", ["mp4"])).toThrow(
      "MEDIA_POLICY_REJECTED",
    ));
  it.each([
    Buffer.alloc(16),
    Buffer.from("1a45dfa300", "hex"),
    Buffer.from("1a45dfa3ff", "hex"),
    Buffer.from("1a45dfa388428284776562", "hex"),
  ])("rejects malformed/truncated/unknown-sized headers %j", (header) =>
    expect(() => sourceContainer(header, "video/webm", containers)).toThrow(
      "MEDIA_CONTAINER_SIGNATURE_REJECTED",
    ),
  );
  it("rejects a child extending beyond its parent even with trailing file bytes", () => {
    const header = Buffer.from("1a45dfa3834282847765626d", "hex");
    expect(() => sourceContainer(header, "video/webm", containers)).toThrow(
      "MEDIA_CONTAINER_SIGNATURE_REJECTED",
    );
  });
  it("rejects reserved/nonminimal element IDs", () =>
    expect(() =>
      sourceContainer(ebml([Buffer.from([0xff, 0x80]), doc("webm")]), "video/webm", containers),
    ).toThrow("MEDIA_CONTAINER_SIGNATURE_REJECTED"));
  it("bounds the EBML header, not the entire media source", () => {
    const body = Buffer.alloc(SOURCE_HEADER_BYTES + 1);
    const header = Buffer.concat([Buffer.from("1a45dfa3", "hex"), Buffer.from([0x21, 0x00, 0x01]), body]);
    expect(() => sourceContainer(header, "video/webm", containers)).toThrow(
      "MEDIA_CONTAINER_SIGNATURE_REJECTED",
    );
  });
  it("quarantines a recovered QUEUED asset on revalidation", () => {
    const asset = { status: "QUEUED", revision: 4, audit: [] } as unknown as MediaAsset;
    expect(transition(asset, "QUARANTINED", "media-worker").status).toBe("QUARANTINED");
  });
  const policy = {
    maxDurationSeconds: 600,
    allowedVideoCodecs: ["h264", "vp9", "av1"],
    allowedAudioCodecs: ["aac", "opus"],
    allowedContainers: containers,
  } as MediaPolicy;
  const probe = {
    format: { format_name: "matroska,webm", duration: "2" },
    streams: [{ codec_type: "video", codec_name: "vp9", width: 64, height: 64 }],
  };
  it("preserves WebM VP9 and Opus controls", () =>
    expect(
      probeMetadata(
        { ...probe, streams: [...probe.streams, { codec_type: "audio", codec_name: "opus" }] },
        policy,
        "webm",
      ),
    ).toMatchObject({ videoCodec: "vp9", audioCodec: "opus" }));
  it("rejects a Matroska H264 stream relabeled through DocType", () =>
    expect(() =>
      probeMetadata({ ...probe, streams: [{ ...probe.streams[0], codec_name: "h264" }] }, policy, "webm"),
    ).toThrow("MEDIA_POLICY_REJECTED"));
  it("rejects AAC relabeled as WebM despite global codec allowlist", () =>
    expect(() =>
      probeMetadata(
        { ...probe, streams: [...probe.streams, { codec_type: "audio", codec_name: "aac" }] },
        policy,
        "webm",
      ),
    ).toThrow("MEDIA_POLICY_REJECTED"));
  it("rejects a forbidden second WebM video stream", () =>
    expect(() =>
      probeMetadata(
        {
          ...probe,
          streams: [...probe.streams, { codec_type: "video", codec_name: "h264", width: 64, height: 64 }],
        },
        policy,
        "webm",
      ),
    ).toThrow("MEDIA_POLICY_REJECTED"));
  it("rejects a forbidden second WebM audio stream", () =>
    expect(() =>
      probeMetadata(
        {
          ...probe,
          streams: [
            ...probe.streams,
            { codec_type: "audio", codec_name: "opus" },
            { codec_type: "audio", codec_name: "aac" },
          ],
        },
        policy,
        "webm",
      ),
    ).toThrow("MEDIA_POLICY_REJECTED"));
  it("does not hide a globally forbidden codec behind the first MP4 stream", () =>
    expect(() =>
      probeMetadata(
        {
          format: { format_name: "mov,mp4", duration: "2" },
          streams: [
            { codec_type: "video", codec_name: "h264", width: 64, height: 64 },
            { codec_type: "video", codec_name: "mpeg4", width: 128, height: 128 },
          ],
        },
        policy,
        "mp4",
      ),
    ).toThrow("MEDIA_POLICY_REJECTED"));
});

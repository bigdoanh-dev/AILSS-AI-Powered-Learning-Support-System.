import { describe, expect, it } from "vitest";
import {
  localProfiles,
  parseRenditionProfiles,
  planRenditions,
} from "../../apps/learning-service/src/media/profiles.js";

describe("Phase 42B rendition configuration", () => {
  it.each([
    [480, [360, 480]],
    [720, [360, 480, 720]],
    [1080, [360, 480, 720, 1080]],
  ])("plans source %ip without upscaling", (height, expected) => {
    const ladder = planRenditions(Math.round((height * 16) / 9), height, localProfiles);
    expect(ladder.map((item) => item.height)).toEqual(expected);
    expect(ladder.every((item) => item.height <= height)).toBe(true);
  });
  it("keeps a sub-360p source at its actual size", () => {
    expect(
      planRenditions(320, 240, localProfiles).map((item) => ({ width: item.width, height: item.height })),
    ).toEqual([{ width: 320, height: 240 }]);
  });
  it("requires an explicit production ladder and rejects malformed/unsorted values", () => {
    expect(() => parseRenditionProfiles(undefined, true)).toThrow("MEDIA_TRANSCODE_PROFILES_REQUIRED");
    expect(() => parseRenditionProfiles("not-json", false)).toThrow("MEDIA_TRANSCODE_PROFILES_INVALID");
    expect(() => parseRenditionProfiles(JSON.stringify([...localProfiles].reverse()), true)).toThrow(
      "MEDIA_TRANSCODE_PROFILES_NOT_ASCENDING",
    );
    expect(() =>
      parseRenditionProfiles(JSON.stringify([{ ...localProfiles[0], codec: "copy" }]), true),
    ).toThrow();
  });
});

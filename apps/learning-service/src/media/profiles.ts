import { z } from "zod";

const profileSchema = z
  .object({
    height: z.number().int().min(2).max(2160),
    videoBitrate: z.number().int().min(64_000).max(20_000_000),
    maxBitrate: z.number().int().min(64_000).max(25_000_000),
    bufferSize: z.number().int().min(64_000).max(50_000_000),
    audioBitrate: z.number().int().min(32_000).max(512_000),
    codec: z.literal("libx264"),
    profile: z.enum(["baseline", "main", "high"]),
    segmentSeconds: z.number().int().min(2).max(10),
  })
  .strict()
  .refine((value) => value.maxBitrate >= value.videoBitrate && value.bufferSize >= value.maxBitrate);
export type RenditionProfile = z.infer<typeof profileSchema>;

export const localProfiles: RenditionProfile[] = [
  {
    height: 360,
    videoBitrate: 800_000,
    maxBitrate: 1_000_000,
    bufferSize: 2_000_000,
    audioBitrate: 96_000,
    codec: "libx264",
    profile: "main",
    segmentSeconds: 2,
  },
  {
    height: 480,
    videoBitrate: 1_400_000,
    maxBitrate: 1_750_000,
    bufferSize: 3_500_000,
    audioBitrate: 96_000,
    codec: "libx264",
    profile: "main",
    segmentSeconds: 2,
  },
  {
    height: 720,
    videoBitrate: 2_800_000,
    maxBitrate: 3_500_000,
    bufferSize: 7_000_000,
    audioBitrate: 128_000,
    codec: "libx264",
    profile: "high",
    segmentSeconds: 2,
  },
  {
    height: 1080,
    videoBitrate: 5_000_000,
    maxBitrate: 6_250_000,
    bufferSize: 12_500_000,
    audioBitrate: 128_000,
    codec: "libx264",
    profile: "high",
    segmentSeconds: 2,
  },
];

export function parseRenditionProfiles(raw: string | undefined, production: boolean): RenditionProfile[] {
  if (!raw && production) throw Error("MEDIA_TRANSCODE_PROFILES_REQUIRED");
  let value: unknown;
  try {
    value = raw ? JSON.parse(raw) : localProfiles;
  } catch {
    throw Error("MEDIA_TRANSCODE_PROFILES_INVALID");
  }
  const profiles = z.array(profileSchema).min(1).max(8).parse(value);
  for (let i = 1; i < profiles.length; i++) {
    const previous = profiles[i - 1];
    const current = profiles[i];
    if (previous && current && current.height <= previous.height)
      throw Error("MEDIA_TRANSCODE_PROFILES_NOT_ASCENDING");
  }
  return profiles;
}

export function planRenditions(width: number, height: number, profiles: readonly RenditionProfile[]) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2)
    throw Error("MEDIA_DIMENSIONS_INVALID");
  const applicable = profiles.filter((profile) => profile.height <= height);
  const selected = applicable.length ? applicable : profiles.slice(0, 1);
  return selected.map((profile) => {
    const outputHeight = Math.max(2, Math.floor(Math.min(profile.height, height) / 2) * 2);
    const outputWidth = Math.max(2, Math.floor((width * outputHeight) / height / 2) * 2);
    return { profile, width: outputWidth, height: outputHeight };
  });
}

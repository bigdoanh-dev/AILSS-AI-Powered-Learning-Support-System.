import { buildReleaseManifest } from "./rc-manifest-builder.mjs";

const sha = process.argv[2] || "HEAD";

buildReleaseManifest({
  rcVersion: "AILSS 6.2.0-rc4",
  releaseTag: "v6.2.0-rc.4",
  releaseGitSha: sha,
  outputFile: "release620rc4-test-manifest.json",
  isCompact: true,
}).catch((err) => {
  console.error("RC4 manifest generation failed:", err);
  process.exit(1);
});

import { buildReleaseManifest } from "./rc-manifest-builder.mjs";

const sha = process.argv[2] || "3b6325d330f006c1a0d520eb02d9bddd234ce6e7";

buildReleaseManifest({
  rcVersion: "AILSS 6.2.0-rc3",
  releaseTag: "v6.2.0-rc.3",
  releaseGitSha: sha,
  outputFile: "artifacts/release-evidence/release620rc3-test-manifest.json",
  isCompact: true,
}).catch((err) => {
  console.error("RC3 manifest generation failed:", err);
  process.exit(1);
});

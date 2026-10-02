import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("../", import.meta.url));
const mobile = join(root, "apps/mobile");
const require = createRequire(join(mobile, "package.json"));
const platform = process.argv[2];
if (!["android", "ios"].includes(platform)) throw Error("Specify android or ios");
const env = {};
for (const name of [".env", ".env.local"]) {
  const path = join(mobile, name);
  if (existsSync(path)) Object.assign(env, parseEnv(readFileSync(path, "utf8")));
}
Object.assign(env, process.env);
if (!env.EXPO_PUBLIC_AILSS_ENV || !env.EXPO_PUBLIC_AILSS_API_BASE_URL)
  throw Error(
    "Set EXPO_PUBLIC_AILSS_ENV and EXPO_PUBLIC_AILSS_API_BASE_URL in apps/mobile/.env.local or the environment",
  );
const expo = require.resolve("expo/bin/cli");
function run(command, args, cwd = mobile) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`Native build failed: ${command} (exit ${String(result.status)})`);
}
const output = join(root, "release-builds", platform);
mkdirSync(output, { recursive: true });
run(process.execPath, [expo, "config", "--type", "public"]);
if (platform === "android") {
  if (!env.JAVA_HOME && process.platform === "darwin") {
    const java = spawnSync("/usr/libexec/java_home", ["--failfast", "-v", "17"], { encoding: "utf8" });
    if (java.status === 0) env.JAVA_HOME = java.stdout.trim();
  }
  const javaCommand = env.JAVA_HOME ? join(env.JAVA_HOME, "bin/java") : "java";
  const javaVersion = spawnSync(javaCommand, ["-version"], { encoding: "utf8", env });
  if (javaVersion.status !== 0 || !/version "17[."]/u.test(javaVersion.stderr))
    throw Error("JDK 17 is required for the Android build. Set JAVA_HOME to a working JDK 17 installation");
  env.ANDROID_HOME ||=
    env.ANDROID_SDK_ROOT || (process.platform === "darwin" ? join(env.HOME, "Library/Android/sdk") : "");
  if (!env.ANDROID_HOME || !existsSync(env.ANDROID_HOME))
    throw Error("Android SDK is required to produce an APK");
  run(process.execPath, [expo, "prebuild", "--platform", "android", "--no-install"]);
  run(
    "bash",
    ["./gradlew", ":app:assembleRelease", "--no-daemon", "--max-workers=2"],
    join(mobile, "android"),
  );
  const built = join(mobile, "android/app/build/outputs/apk/release/app-release.apk");
  if (!existsSync(built) || statSync(built).size === 0) throw Error("Gradle did not produce an APK");
  const destination = join(output, "AILSS-preview.apk");
  copyFileSync(built, destination);
  console.log(`APK created: ${destination}`);
} else {
  // A signed Xcode export is required; a zip of an unsigned app is not installable.
  if (process.platform !== "darwin") throw Error("Signed IPA export requires macOS and Xcode");
  if (!env.AILSS_IOS_APPLE_TEAM_ID || !env.AILSS_IOS_EXPORT_OPTIONS_PLIST)
    throw Error(
      "Set AILSS_IOS_APPLE_TEAM_ID and AILSS_IOS_EXPORT_OPTIONS_PLIST (Xcode signing/export configuration)",
    );
  if (!existsSync(env.AILSS_IOS_EXPORT_OPTIONS_PLIST)) throw Error("ExportOptions.plist does not exist");
  run(process.execPath, [expo, "prebuild", "--platform", "ios", "--no-install"]);
  run("pod", ["install"], join(mobile, "ios"));
  const archive = join(output, "AILSS.xcarchive");
  run("xcodebuild", [
    "-workspace",
    "ios/AILSS.xcworkspace",
    "-scheme",
    "AILSS",
    "-configuration",
    "Release",
    "-destination",
    "generic/platform=iOS",
    "-archivePath",
    archive,
    `DEVELOPMENT_TEAM=${env.AILSS_IOS_APPLE_TEAM_ID}`,
    "archive",
  ]);
  run("xcodebuild", [
    "-exportArchive",
    "-archivePath",
    archive,
    "-exportOptionsPlist",
    env.AILSS_IOS_EXPORT_OPTIONS_PLIST,
    "-exportPath",
    output,
  ]);
  if (!readdirSync(output).some((name) => name.endsWith(".ipa") && statSync(join(output, name)).size > 0))
    throw Error("Xcode did not produce a signed IPA");
  console.log(`Signed IPA created in: ${output}`);
}

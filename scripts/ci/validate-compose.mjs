import { execFileSync } from "node:child_process";

const variants = [
  {
    name: "dev-media",
    files: ["docker-compose.yml", "docker-compose.async.yml", "docker-compose.media.yml"],
    profile: "dev-async",
  },
  { name: "dev-core", files: ["docker-compose.yml"], profile: "dev-core" },
  {
    name: "dev-async",
    files: ["docker-compose.yml", "docker-compose.async.yml"],
    profile: "dev-async",
  },
  {
    name: "demo-https",
    files: ["docker-compose.yml", "docker-compose.async.yml", "docker-compose.https.yml"],
    profile: "demo",
  },
  {
    name: "research-tls",
    files: ["docker-compose.yml", "docker-compose.async.yml", "docker-compose.research-tls.yml"],
    profile: "research",
  },
];

for (const variant of variants)
  execFileSync(
    "docker",
    [
      "compose",
      "--env-file",
      ".env.example",
      ...variant.files.flatMap((file) => ["-f", file]),
      "--profile",
      variant.profile,
      "config",
      "--quiet",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        MEDIA_MAX_SOURCE_BYTES: "1073741824",
        MEDIA_MAX_DURATION_SECONDS: "14400",
        MEDIA_DELIVERY_ORIGIN: "http://127.0.0.1:8211",
        ...Object.fromEntries(
          [
            "MEDIA_API_ACCESS_KEY",
            "MEDIA_API_SECRET_KEY",
            "MEDIA_WORKER_ACCESS_KEY",
            "MEDIA_WORKER_SECRET_KEY",
            "MEDIA_DELIVERY_ACCESS_KEY",
            "MEDIA_DELIVERY_SECRET_KEY",
            "MEDIA_PLAYBACK_SECRET",
            "CASSANDRA_SVC_MEDIA_WORKER_PASSWORD",
          ].map((key) => [key, "compose-validation-fixture-not-a-credential"]),
        ),
      },
    },
  );

console.log(
  JSON.stringify({
    stage: "compose-validation",
    status: "PASS",
    variants: variants.map((variant) => variant.name),
  }),
);

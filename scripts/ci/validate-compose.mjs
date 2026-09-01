import { execFileSync } from "node:child_process";

const variants = [
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
    { stdio: "inherit" },
  );

console.log(
  JSON.stringify({
    stage: "compose-validation",
    status: "PASS",
    variants: variants.map((variant) => variant.name),
  }),
);

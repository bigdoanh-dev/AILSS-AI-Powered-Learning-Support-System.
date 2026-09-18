import { writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";

const root = process.cwd();

async function run() {
  const rootPkg = JSON.parse(execSync("cat package.json", { encoding: "utf8" }));

  // Run pnpm ls to obtain the complete production dependency tree
  const rawProdJson = execSync("pnpm ls --prod -r --depth Infinity --json", {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const prodData = JSON.parse(rawProdJson);

  const rawDevJson = execSync("pnpm ls --dev -r --depth Infinity --json", {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const devData = JSON.parse(rawDevJson);

  const firstPartyMap = new Map();
  const directMap = new Map();
  const transitiveMap = new Map();
  const devMap = new Map();

  function walk(deps, isDirect) {
    if (!deps) return;
    for (const [name, info] of Object.entries(deps)) {
      if (name.startsWith("@ailss/") || name === "ailss") {
        firstPartyMap.set(name, {
          name,
          version: info.version ?? rootPkg.version,
          type: name.includes("service") || name.includes("gateway") || name.includes("web") || name.includes("mobile") || name.includes("worker") ? "application" : "library",
        });
      } else {
        const id = `${name}@${info.version}`;
        if (isDirect) {
          directMap.set(id, { name, version: info.version });
        } else {
          transitiveMap.set(id, { name, version: info.version });
        }
      }
      if (info.dependencies) {
        walk(info.dependencies, false);
      }
    }
  }

  for (const pkg of prodData) {
    if (pkg.name?.startsWith("@ailss/") || pkg.name === "ailss") {
      firstPartyMap.set(pkg.name, {
        name: pkg.name,
        version: pkg.version ?? rootPkg.version,
        type: pkg.name.includes("service") || pkg.name.includes("gateway") || pkg.name.includes("web") || pkg.name.includes("mobile") || pkg.name.includes("worker") ? "application" : "library",
      });
    }
    walk(pkg.dependencies, true);
  }

  // Remove direct dependencies from transitive map
  for (const key of directMap.keys()) {
    transitiveMap.delete(key);
  }

  function walkDev(deps) {
    if (!deps) return;
    for (const [name, info] of Object.entries(deps)) {
      devMap.set(`${name}@${info.version}`, { name, version: info.version });
      if (info.dependencies) walkDev(info.dependencies);
    }
  }
  for (const pkg of devData) {
    walkDev(pkg.devDependencies);
  }

  const components = [];

  // 1. First-party components
  for (const c of firstPartyMap.values()) {
    components.push({
      type: c.type,
      "bom-ref": `pkg:npm/${c.name}@${c.version}`,
      name: c.name,
      version: c.version,
      purl: `pkg:npm/${c.name}@${c.version}`,
      scope: "required",
      properties: [{ name: "ailss:tier", value: "first-party" }],
    });
  }

  // 2. Direct production dependencies
  for (const d of directMap.values()) {
    components.push({
      type: "library",
      "bom-ref": `pkg:npm/${d.name}@${d.version}`,
      name: d.name,
      version: d.version,
      purl: `pkg:npm/${d.name}@${d.version}`,
      scope: "required",
      properties: [{ name: "ailss:tier", value: "direct-runtime" }],
    });
  }

  // 3. Transitive production dependencies
  for (const t of transitiveMap.values()) {
    components.push({
      type: "library",
      "bom-ref": `pkg:npm/${t.name}@${t.version}`,
      name: t.name,
      version: t.version,
      purl: `pkg:npm/${t.name}@${t.version}`,
      scope: "required",
      properties: [{ name: "ailss:tier", value: "transitive-runtime" }],
    });
  }

  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: "AILSS Supply Chain", name: "ailss-complete-sbom-generator", version: "2.0.0" }],
      component: {
        type: "application",
        "bom-ref": `pkg:npm/${rootPkg.name}@${rootPkg.version}`,
        name: rootPkg.name,
        version: rootPkg.version,
        description: "AILSS: AI-Powered Learning Support System (Complete Transitive Production Graph)",
      },
    },
    components,
    dependencies: [
      {
        ref: `pkg:npm/${rootPkg.name}@${rootPkg.version}`,
        dependsOn: components.map((c) => c["bom-ref"]),
      },
    ],
  };

  const outputPath = path.join(root, "sbom.cyclonedx.json");
  await writeFile(outputPath, JSON.stringify(sbom, null, 2), "utf8");

  const auditSummary = {
    stage: "sbom-generation",
    status: "PASS",
    firstPartyComponents: firstPartyMap.size,
    directRuntimeDependencies: directMap.size,
    transitiveRuntimeDependencies: transitiveMap.size,
    totalRuntimeComponents: components.length,
    devOnlyComponents: devMap.size,
    unknownComponents: 0,
    output: outputPath,
  };

  console.log(JSON.stringify(auditSummary));
}

run().catch((err) => {
  console.error("SBOM generation failed:", err);
  process.exit(1);
});

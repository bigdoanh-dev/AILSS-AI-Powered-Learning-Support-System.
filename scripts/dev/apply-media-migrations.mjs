import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readEnv, required } from "./env.mjs";

const env = await readEnv();
const names = ["086_media_replacement_audit.cql", "087_media_quota.cql", "088_media_output_journal.cql"];
const sql = (
  await Promise.all(
    names.map((name) => readFile(new URL(`../../database/migrations/dev/${name}`, import.meta.url), "utf8")),
  )
)
  .join("\n")
  .replace(/^--.*$/gm, "")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);
const program = `import{readFileSync}from"node:fs";import{Client}from"cassandra-driver";
const i=JSON.parse(readFileSync(0,"utf8")),db=new Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,credentials:{username:"cassandra_admin",password:i.password}});
try{for(const sql of i.sql)await db.execute(sql);console.log("MEDIA_MIGRATIONS_LOCAL_PASS 086-088");}catch(e){console.error(e.name);process.exitCode=1;}finally{await db.shutdown();}`;
try {
  const output = execFileSync(
    "docker",
    ["exec", "-i", "ailss-learning-service", "node", "--input-type=module", "-e", program],
    {
      input: JSON.stringify({ password: required(env, "CASSANDRA_ADMIN_PASSWORD"), sql }),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  console.log(output.trim());
} catch {
  console.error("MEDIA_MIGRATIONS_LOCAL_FAIL (credential-bearing diagnostics suppressed)");
  process.exitCode = 1;
}

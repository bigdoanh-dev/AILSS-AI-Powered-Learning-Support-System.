import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createSessionAdapter } from "../../apps/web/server/session.mjs";
let handle;
const server = createServer(async (req, res) => {
  if (!(await handle(req, res))) {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
handle = createSessionAdapter({ gateway: "http://127.0.0.1:8080", origin });
let cookie;
async function request(route, method = "GET", body, key) {
  const response = await fetch(origin + "/web-session/" + route, {
    method,
    headers: {
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
  return { status: response.status, headers: response.headers, data: await response.json() };
}
try {
  const account = {
    email: `p122b-web-${randomUUID()}@example.test`,
    password: `Web-Fixture!${randomUUID()}`,
    displayName: "P12.2B Web Applicant",
  };
  assert.equal((await request("register", "POST", account, randomUUID())).status, 200);
  const login = await request("login", "POST", { email: account.email, password: account.password });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  assert.equal(login.data.data.role, "STUDENT");
  const submitted = await request(
    "lecturer-application",
    "POST",
    {
      professionalTitle: "Lecturer",
      institution: "Web Test University",
      teachingArea: "Databases",
      motivation: "I want to help students understand database design.",
    },
    randomUUID(),
  );
  assert.equal(submitted.status, 201);
  const current = await request("lecturer-application");
  assert.equal(current.data.data.status, "SUBMITTED");
  assert.equal(current.headers.get("cache-control"), "no-store");
  assert.equal((await request("bootstrap")).data.data.role, "STUDENT");
  assert.doesNotMatch(
    JSON.stringify([login.data, submitted.data, current.data]),
    /accessToken|refreshToken|currentPassword|step-up|Bearer/,
  );
  assert.equal((await request("logout", "POST", {})).status, 200);
  await mkdir("docs/evidence/p12.2b-web-real", { recursive: true });
  await writeFile(
    "docs/evidence/p12.2b-web-real/report.json",
    JSON.stringify(
      {
        status: "PASS",
        scope: "local Web session adapter to real Gateway/Identity/Cassandra; dedicated actor",
        checks: [
          "HttpOnly",
          "no-store",
          "API registration/login",
          "application submission",
          "canonical Student retained",
          "no credentials exposed",
          "logout",
        ],
      },
      null,
      2,
    ),
  );
  console.log('{"status":"PASS","scope":"local Web-to-real-Gateway"}');
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

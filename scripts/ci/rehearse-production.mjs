import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import https from "node:https";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createSessionAdapter } from "../../apps/web/server/session.mjs";

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch (error) {
      if (attempt === attempts - 1) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Isolated Web process did not become ready");
}

async function stopChild(child, name) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
  ]);
  if (!graceful) {
    child.kill("SIGKILL");
    await exited;
  }
  assert.ok(child.exitCode !== null || child.signalCode !== null, `${name} cleanup was not confirmed`);
}

function request(port, ca, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: "127.0.0.1",
        port,
        path: options.path ?? "/",
        method: options.method ?? "GET",
        ca,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        headers: options.headers,
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
      },
    );
    req.once("socket", (socket) =>
      socket.once("secureConnect", () => {
        const protocol = socket.getProtocol();
        if (!protocol || !["TLSv1.2", "TLSv1.3"].includes(protocol)) reject(new Error("TLS policy mismatch"));
      }),
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

const temp = await mkdtemp(path.join(os.tmpdir(), "ailss-p13-1-"));
const keyPath = path.join(temp, "rehearsal-key.pem");
const certPath = path.join(temp, "rehearsal-cert.pem");
let web;
let gateway;
let ingress;
let passed = false;
try {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      keyPath,
      "-out",
      certPath,
    ],
    { stdio: "ignore" },
  );
  const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)]);
  const signing = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const signingPrivatePath = path.join(temp, "signing-private.pem");
  const signingPublicPath = path.join(temp, "signing-public.pem");
  await Promise.all([
    writeFile(signingPrivatePath, signing.privateKey, { mode: 0o600 }),
    writeFile(signingPublicPath, signing.publicKey, { mode: 0o600 }),
  ]);
  const webPort = await freePort();
  const ingressPort = await freePort();
  const gatewayPort = await freePort();
  const externalOrigin = `https://127.0.0.1:${ingressPort}`;
  assert.throws(() =>
    createSessionAdapter({
      gateway: "http://127.0.0.1:1",
      origin: "http://unsafe.invalid",
      production: true,
    }),
  );
  gateway = spawn(process.execPath, ["dist/apps/api-gateway/src/server.js"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(gatewayPort),
      HTTPS_CERT_PATH: certPath,
      HTTPS_KEY_PATH: keyPath,
      JWT_PUBLIC_KEY_PATH: signingPublicPath,
      ACTOR_CONTEXT_PRIVATE_KEY_PATH: signingPrivatePath,
      CLASSROOM_SERVICE_TOKEN_PUBLIC_KEY_PATH: signingPublicPath,
      IDENTITY_SERVICE_URL: "http://127.0.0.1:1",
      LEARNING_SERVICE_URL: "http://127.0.0.1:1",
      CLASSROOM_SERVICE_URL: "http://127.0.0.1:1",
      ASSESSMENT_SERVICE_URL: "http://127.0.0.1:1",
      INTERACTION_SERVICE_URL: "http://127.0.0.1:1",
      AI_SERVICE_URL: "http://127.0.0.1:1",
      NOTIFICATION_SERVICE_URL: "http://127.0.0.1:1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let gatewayError = "";
  gateway.stderr.on("data", (chunk) => (gatewayError += String(chunk)));
  let gatewayLive;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      gatewayLive = await request(gatewayPort, cert, { path: "/health/live" });
      break;
    } catch (error) {
      if (gateway.exitCode !== null)
        throw new Error(`Isolated Gateway exited before readiness: ${gatewayError.slice(-1_000)}`);
      if (attempt === 79) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(gatewayLive.status, 200);
  assert.match(gatewayLive.body, /api-gateway/u);
  web = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: path.resolve("apps/web"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(webPort),
      AILSS_WEB_ORIGIN: externalOrigin,
      AILSS_GATEWAY_URL: "http://127.0.0.1:1",
      OBJECT_STORAGE_PUBLIC_URL: externalOrigin,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitFor(`http://127.0.0.1:${webPort}/`);
  ingress = https.createServer({ key, cert, minVersion: "TLSv1.2" }, (incoming, outgoing) => {
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: webPort,
        path: incoming.url,
        method: incoming.method,
        headers: { ...incoming.headers, host: `127.0.0.1:${ingressPort}` },
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on("error", () => outgoing.writeHead(502).end());
    incoming.pipe(upstream);
  });
  await new Promise((resolve, reject) =>
    ingress.once("error", reject).listen(ingressPort, "127.0.0.1", resolve),
  );

  const page = await request(ingressPort, cert);
  assert.equal(page.status, 200);
  assert.equal(page.headers["x-content-type-options"], "nosniff");
  assert.match(page.headers["content-security-policy"], /default-src 'self'/u);
  const hostile = await request(ingressPort, cert, {
    path: "/web-session/login",
    method: "POST",
    headers: { origin: "https://hostile.invalid", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(hostile.status, 403);
  assert.match(hostile.body, /ORIGIN_REJECTED/u);
  passed = true;
} finally {
  if (ingress) await new Promise((resolve) => ingress.close(resolve));
  await Promise.all([stopChild(web, "Web"), stopChild(gateway, "Gateway")]);
  await rm(temp, { recursive: true, force: true });
}
if (passed)
  console.log(
    JSON.stringify({
      stage: "p13.1-production-like-https-rehearsal",
      status: "PASS",
      scope: "isolated-loopback-gateway-and-web-ingress",
      tls: "TLSv1.2+ verified",
      externalCalls: 0,
      sharedDataMutations: 0,
      cleanup: "verified",
    }),
  );

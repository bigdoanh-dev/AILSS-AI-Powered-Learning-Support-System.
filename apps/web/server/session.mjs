import { localLibrary, courseMedia, enrichCourseLesson } from "./local-library.mjs";
import { studentOperation, studentEnvelope } from "./student.mjs";
import { lecturerOperation, lecturerEnvelope } from "./lecturer.mjs";
import { adminOperation, adminEnvelope } from "./admin.mjs";
import { randomBytes } from "node:crypto";
export class SessionError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
// One process owns all opaque sessions. No credentials are serialized or logged.
export function createSessionAdapter({
  gateway,
  origin,
  production = false,
  fetcher = fetch,
  maxSessions = 1000,
}) {
  const expected = new URL(origin);
  if (production && expected.protocol !== "https:")
    throw new Error("Production session origin requires HTTPS");
  const name = production ? "__Host-ailss" : "ailss";
  const sessions = new Map();
  const cookie = (id, age) =>
    `${name}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${production ? "; Secure" : ""}`;
  const drop = (id) => {
    const s = sessions.get(id);
    if (s) s.closed = true;
    sessions.delete(id);
  };
  async function upstream(route, method = "GET", body, token, key, scopedHeaders) {
    let response;
    try {
      response = await fetcher(new URL(`/api/v1${route}`, gateway), {
        method,
        headers: {
          Accept: "application/json",
          ...(scopedHeaders?.headers || scopedHeaders),
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new SessionError(503, "GATEWAY_UNAVAILABLE");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new SessionError(
        response.status,
        /^[A-Z_]{3,80}$/.test(data.error?.code) ? data.error.code : `HTTP_${response.status}`,
      );
    return scopedHeaders?.kind === "student"
      ? studentEnvelope(data)
      : scopedHeaders?.kind === "lecturer"
        ? lecturerEnvelope(data)
        : scopedHeaders?.kind === "admin"
          ? adminEnvelope(data)
          : data.data;
  }
  function valid(s) {
    if (s.closed) throw new SessionError(401, "SESSION_EXPIRED");
  }
  async function refresh(s) {
    valid(s);
    if (s.uncertain) throw new SessionError(503, "REFRESH_OUTCOME_UNKNOWN");
    if (!s.flight)
      s.flight = (async () => {
        try {
          const next = await upstream("/auth/refresh", "POST", {
            sessionId: s.tokens.sessionId,
            refreshToken: s.tokens.refreshToken,
          });
          valid(s);
          s.tokens = next;
        } catch (e) {
          if (e.status === 401 || e.status === 403) s.closed = true;
          // A lost rotation response cannot safely replay an old refresh credential.
          if (e.status >= 500) s.uncertain = true;
          throw e;
        } finally {
          s.flight = null;
        }
      })();
    await s.flight;
    valid(s);
  }
  async function protectedCall(s, route, method = "GET", body, key, studentHeaders) {
    valid(s);
    if (s.loggingOut && route !== "/auth/logout") throw new SessionError(409, "LOGOUT_PENDING");
    if (Date.parse(s.tokens.refreshExpiresAt) <= Date.now()) {
      s.closed = true;
      throw new SessionError(401, "SESSION_EXPIRED");
    }
    if (Date.parse(s.tokens.accessExpiresAt) <= Date.now() + 5000) await refresh(s);
    const used = s.tokens.accessToken;
    try {
      const result = await upstream(route, method, body, used, key, studentHeaders);
      valid(s);
      return result;
    } catch (e) {
      if (e.status !== 401 || ["INVALID_REAUTHENTICATION", "ADMIN_STEP_UP_FAILED"].includes(e.code)) throw e;
      if (s.tokens.accessToken === used) await refresh(s);
      const result = await upstream(route, method, body, s.tokens.accessToken, key, studentHeaders);
      valid(s);
      return result;
    }
  }
  async function bodyOf(req) {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (
        Buffer.byteLength(raw) >
        (req.url?.startsWith("/web-session/student/") ||
        req.url?.startsWith("/web-session/lecturer/") ||
        req.url?.startsWith("/web-session/admin/")
          ? 524288
          : req.url?.startsWith("/web-session/avatar")
            ? 350100
            : req.url?.startsWith("/web-session/lecturer-application")
              ? 32768
              : 8192)
      )
        throw new SessionError(413, "BODY_TOO_LARGE");
    }
    try {
      return raw ? JSON.parse(raw) : undefined;
    } catch {
      throw new SessionError(400, "INVALID_JSON");
    }
  }
  return async function handle(req, res) {
    if (!req.url?.startsWith("/web-session/")) return false;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Vary", "Cookie");
    const id = (req.headers.cookie || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${name}=`))
      ?.slice(name.length + 1);
    const send = (status, data) => {
      res.writeHead(status);
      res.end(JSON.stringify(data));
    };
    try {
      if (
        req.headers.host !== expected.host ||
        (req.headers.origin && req.headers.origin !== expected.origin) ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        throw new SessionError(403, "ORIGIN_REJECTED");
      const method = req.method;
      if (
        method !== "GET" &&
        (req.headers.origin !== expected.origin ||
          req.headers["content-type"]?.split(";")[0] !== "application/json")
      )
        throw new SessionError(403, "ORIGIN_REJECTED");
      const route = req.url.split("?")[0];
      const allowed = {
        "/web-session/bootstrap": "GET",
        "/web-session/login": "POST",
        "/web-session/register": "POST",
        "/web-session/logout": "POST",
        "/web-session/profile": "PATCH",
        "/web-session/avatar": method === "GET" ? "GET" : "POST",
        "/web-session/password": "POST",
        "/web-session/lecturer-application": method === "GET" ? "GET" : "POST",
        "/web-session/admin/lecturer-applications": "GET",
      };
      const applicationMatch = route.match(
        /^\/web-session\/admin\/lecturer-applications\/([0-9a-f-]{36})(\/decision)?$/i,
      );
      const verificationMatch = route.match(/^\/web-session\/admin\/lecturers\/([0-9a-f-]{36})\/verify$/i);
      if (applicationMatch) allowed[route] = applicationMatch[2] ? "POST" : "GET";
      if (verificationMatch) allowed[route] = "POST";
      const isLibrary = /^\/web-session\/library(?:\/[a-f0-9]{24})?$/.test(route);
      if (isLibrary && !production && ["GET", "HEAD"].includes(method)) allowed[route] = method;
      const isNotification =
        route === "/web-session/notifications" ||
        /^\/web-session\/notifications\/[a-f0-9-]{36}\/read$/i.test(route);
      if (isNotification) allowed[route] = route.endsWith("/read") ? "PATCH" : "GET";
      const isStudent = route.startsWith("/web-session/student/");
      const isLecturer = route.startsWith("/web-session/lecturer/");
      const isAdmin = route.startsWith("/web-session/admin/");
      if (!isStudent && !isLecturer && !isAdmin && allowed[route] !== method)
        throw new SessionError(405, "METHOD_NOT_ALLOWED");
      for (const [k, s] of sessions)
        if (s.closed || Date.parse(s.tokens.refreshExpiresAt) <= Date.now()) drop(k);
      const body = method === "GET" ? undefined : await bodyOf(req);
      const key = req.headers["idempotency-key"];
      if (route === "/web-session/register") {
        const data = await upstream("/auth/register", "POST", body, undefined, key);
        send(200, { data });
        return true;
      }
      if (route === "/web-session/login") {
        if (sessions.size >= maxSessions) throw new SessionError(503, "SESSION_CAPACITY_UNAVAILABLE");
        const tokens = await upstream("/auth/login", "POST", body);
        const s = { tokens, closed: false, flight: null, loggingOut: false, uncertain: false };
        const sid = randomBytes(32).toString("base64url");
        // Retain issued credentials even if profile bootstrap is temporarily unavailable.
        drop(id);
        sessions.set(sid, s);
        res.setHeader(
          "Set-Cookie",
          cookie(sid, Math.max(0, Math.floor((Date.parse(tokens.refreshExpiresAt) - Date.now()) / 1000))),
        );
        const profile = await protectedCall(s, "/me");
        if (profile.status !== "ACTIVE") {
          drop(sid);
          res.setHeader("Set-Cookie", cookie("", 0));
          throw new SessionError(403, "ACCOUNT_DISABLED");
        }
        send(200, { data: profile });
        return true;
      }
      const s = sessions.get(id);
      if (!s) {
        res.setHeader("Set-Cookie", cookie("", 0));
        throw new SessionError(401, "SESSION_EXPIRED");
      }
      if (isNotification) {
        const profile = await protectedCall(s, "/me");
        if (profile.status !== "ACTIVE" || !["STUDENT", "LECTURER", "ADMIN"].includes(profile.role))
          throw new SessionError(403, "ACCOUNT_DISABLED");
        const locator = body?.locator;
        if (method === "PATCH" && (!body || Object.keys(body).length !== 1 || typeof locator !== "string"))
          throw new SessionError(400, "INVALID_NOTIFICATION_REQUEST");
        let operation;
        try {
          operation = studentOperation(
            req.url.replace("/web-session/notifications", "/web-session/student/notifications"),
            method,
            method === "PATCH" ? {} : undefined,
            { "x-notification-locator": locator },
          );
        } catch {
          throw new SessionError(400, "INVALID_NOTIFICATION_REQUEST");
        }
        if (!operation) throw new SessionError(400, "INVALID_NOTIFICATION_REQUEST");
        const value = await protectedCall(
          s,
          operation.path,
          method,
          method === "PATCH" ? {} : undefined,
          undefined,
          { kind: "student", headers: operation.headers },
        );
        send(200, value);
        return true;
      }
      if (isLibrary && !production) {
        const profile = await protectedCall(s, "/me");
        if (profile.status !== "ACTIVE") throw new SessionError(403, "ACCOUNT_DISABLED");
        const fileId = route.split("/").pop();
        const lesson = Object.entries(await courseMedia()).find(([, item]) => item.fileId === fileId);
        if (!lesson) throw new SessionError(404, "LESSON_NOT_FOUND");
        await protectedCall(s, "/lessons/" + lesson[0], "GET", undefined, undefined, {
          kind: "student",
          headers: {},
        });
        await localLibrary(req, res);
        return true;
      }
      if (route === "/web-session/avatar") {
        send(200, { data: await protectedCall(s, "/me/avatar", method, body) });
        return true;
      }
      if (isStudent) {
        let operation;
        try {
          operation = studentOperation(req.url, method, body, req.headers);
        } catch {
          throw new SessionError(400, "INVALID_STUDENT_REQUEST");
        }
        const profile = await protectedCall(s, "/me");
        if (profile.status !== "ACTIVE") throw new SessionError(403, "ACCOUNT_DISABLED");
        if (profile.role !== "STUDENT") throw new SessionError(403, "STUDENT_REQUIRED");
        const result = await protectedCall(s, operation.path, method, body, key, {
          kind: "student",
          headers: operation.headers,
        });
        send(
          200,
          !production && method === "GET" && /^\/lessons\/[a-f0-9-]+$/.test(operation.path)
            ? await enrichCourseLesson(result)
            : result,
        );
        return true;
      }
      if (isLecturer) {
        let operation;
        try {
          operation = lecturerOperation(req.url, method, body, req.headers);
        } catch {
          throw new SessionError(400, "INVALID_LECTURER_REQUEST");
        }
        const profile = await protectedCall(s, "/me");
        if (profile.status !== "ACTIVE") throw new SessionError(403, "ACCOUNT_DISABLED");
        if (profile.role !== "LECTURER") throw new SessionError(403, "LECTURER_REQUIRED");
        if (!profile.lecturerVerified) throw new SessionError(403, "LECTURER_VERIFICATION_REQUIRED");
        const result = await protectedCall(s, operation.path, method, body, key, {
          kind: "lecturer",
          headers: operation.headers,
        });
        send(
          200,
          !production && method === "GET" && /^\/lessons\/[a-f0-9-]+$/.test(operation.path)
            ? await enrichCourseLesson(result)
            : result,
        );
        return true;
      }
      if (
        isAdmin &&
        !applicationMatch &&
        !verificationMatch &&
        route !== "/web-session/admin/lecturer-applications"
      ) {
        let operation;
        try {
          operation = adminOperation(req.url, method, body, req.headers);
        } catch {
          throw new SessionError(400, "INVALID_ADMIN_REQUEST");
        }
        const profile = await protectedCall(s, "/me");
        if (profile.status !== "ACTIVE") throw new SessionError(403, "ACCOUNT_DISABLED");
        if (profile.role !== "ADMIN") throw new SessionError(403, "ADMIN_REQUIRED");
        const result = await protectedCall(s, operation.path, method, body, operation.key || key, {
          kind: "admin",
          headers: operation.headers,
        });
        send(200, result);
        return true;
      }
      if (
        route === "/web-session/lecturer-application" ||
        route === "/web-session/admin/lecturer-applications" ||
        applicationMatch ||
        verificationMatch
      ) {
        const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
        const target =
          route === "/web-session/lecturer-application"
            ? method === "GET"
              ? "/me/lecturer-application"
              : "/lecturer-applications"
            : route.replace("/web-session", "");
        const data = await protectedCall(s, target + query, method, body, key);
        send(method === "POST" && route === "/web-session/lecturer-application" ? 201 : 200, { data });
        return true;
      }
      if (route === "/web-session/logout") {
        if (s.loggingOut) throw new SessionError(409, "LOGOUT_PENDING");
        s.loggingOut = true;
        try {
          await protectedCall(s, "/auth/logout", "POST");
          drop(id);
          res.setHeader("Set-Cookie", cookie("", 0));
          send(200, { data: { loggedOut: true } });
        } finally {
          s.loggingOut = false;
        }
      } else if (route === "/web-session/password") {
        await protectedCall(s, "/me/password", "POST", body, key);
        drop(id);
        res.setHeader("Set-Cookie", cookie("", 0));
        send(200, { data: { changed: true } });
      } else {
        if (route === "/web-session/profile") await protectedCall(s, "/me", "PATCH", body, key);
        const profile = await protectedCall(s, "/me");
        if (profile.status !== "ACTIVE") throw new SessionError(403, "ACCOUNT_DISABLED");
        send(200, { data: profile });
      }
    } catch (e) {
      if (
        (e.status === 401 && !["INVALID_REAUTHENTICATION", "ADMIN_STEP_UP_FAILED"].includes(e.code)) ||
        e.code === "ACCOUNT_DISABLED"
      ) {
        drop(id);
        res.setHeader("Set-Cookie", cookie("", 0));
      }
      send(e.status || 503, { error: { code: e.code || "SESSION_UNAVAILABLE" } });
    }
    return true;
  };
}

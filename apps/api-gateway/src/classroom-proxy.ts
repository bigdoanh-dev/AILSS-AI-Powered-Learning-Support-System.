import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Server, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import type { CryptoKey } from "jose";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import {
  loadPrivateKey,
  loadPublicKey,
  signActorContext,
  verifyAccessToken,
  verifyPresenceTicket,
} from "../../../packages/security/src/index.js";
import { parseBearerAuthorization } from "./protected-identity-proxy.js";
import { WebSocketServer, WebSocket } from "ws";

type ClassroomHandler =
  | "create"
  | "detail"
  | "update"
  | "join"
  | "studentList"
  | "ownedList"
  | "roster"
  | "warnStudent"
  | "removeStudent"
  | "reset"
  | "announce"
  | "announcements"
  | "sessionCreate"
  | "sessionUpdate"
  | "sessionList"
  | "sessionDetail"
  | "schedulePublish"
  | "schedule"
  | "attendance"
  | "attendanceHistory"
  | "presenceTicket"
  | "manualAttendance";

export type ClassroomProxy = Record<ClassroomHandler, RequestHandler> & {
  installWebSocket(server: Server): Promise<() => void>;
};

export async function classroomProxyFactory(config: AppConfig): Promise<ClassroomProxy> {
  if (!config.JWT_PUBLIC_KEY_PATH || !config.ACTOR_CONTEXT_PRIVATE_KEY_PATH)
    throw new Error("Classroom proxy requires signing keys");
  const [jwtKey, actorKey] = await Promise.all([
    loadPublicKey(config.JWT_PUBLIC_KEY_PATH),
    loadPrivateKey(config.ACTOR_CONTEXT_PRIVATE_KEY_PATH),
  ]);
  const handler =
    (
      method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
      purpose: string,
      path: (request: Request) => string,
      query = false,
      transform?: (body: string, request: Request) => string,
    ) =>
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const context = currentRequestContext();
        if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
        let actor;
        try {
          actor = await verifyAccessToken(parseBearerAuthorization(request), jwtKey, {
            issuer: config.JWT_ISSUER,
            audience: config.JWT_AUDIENCE,
            kid: config.JWT_KID,
            clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
          });
        } catch {
          throw new AppError("INVALID_ACCESS_TOKEN", 401, "Invalid access token");
        }
        const now = Math.floor(Date.now() / 1000);
        const signed = await signActorContext(
          actorKey,
          config.ACTOR_CONTEXT_KID,
          config.ACTOR_CONTEXT_ISSUER,
          "classroom-service",
          purpose,
          {
            userId: actor.userId,
            roles: [...actor.roles],
            sessionId: actor.sessionId,
            tokenVersion: actor.tokenVersion,
            correlationId: context.correlationId,
            issuedAt: now,
            expiresAt: now + config.ACTOR_CONTEXT_TTL_SECONDS,
          },
        );
        const url = new URL(path(request), config.CLASSROOM_SERVICE_URL);
        if (query)
          for (const [key, value] of Object.entries(request.query))
            if (typeof value === "string") url.searchParams.set(key, value);
        const idempotencyKey = request.header("idempotency-key");
        const upstream = await fetch(url, {
          method,
          headers: {
            ...(method !== "GET" ? { "content-type": "application/json" } : {}),
            "x-correlation-id": context.correlationId,
            "x-actor-context": signed,
            ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
          },
          ...(method !== "GET" ? { body: JSON.stringify(request.body) } : {}),
          signal: AbortSignal.timeout(config.INTERNAL_HTTP_TIMEOUT_MS),
        });
        const type = upstream.headers.get("content-type");
        if (type) response.type(type);
        const raw = await upstream.text();
        response.status(upstream.status).send(transform ? transform(raw, request) : raw);
      } catch (error) {
        next(
          error instanceof AppError
            ? error
            : new AppError(
                "CLASSROOM_SERVICE_UNAVAILABLE",
                503,
                "Classroom service is temporarily unavailable",
                true,
              ),
        );
      }
    };
  const id = (request: Request) => encodeURIComponent(String(request.params.classId));
  const sessionId = (request: Request) => encodeURIComponent(String(request.params.sessionId));
  return {
    create: handler("POST", "classroom.class.create", () => "/api/v1/classes"),
    detail: handler("GET", "classroom.class.detail", (request) => `/api/v1/classes/${id(request)}`),
    update: handler("PATCH", "classroom.class.update", (request) => `/api/v1/classes/${id(request)}`),
    join: handler("POST", "classroom.class.join", () => "/api/v1/classes/join"),
    studentList: handler("GET", "classroom.class.student-list", () => "/api/v1/me/classes", true),
    ownedList: handler("GET", "classroom.class.owned-list", () => "/api/v1/me/owned-classes", true),
    roster: handler(
      "GET",
      "classroom.class.roster",
      (request) => `/api/v1/classes/${id(request)}/members`,
      true,
    ),
    warnStudent: handler(
      "POST",
      "classroom.class.member.warn",
      (request) =>
        `/api/v1/classes/${id(request)}/members/${encodeURIComponent(String(request.params.studentId))}/warnings`,
    ),
    removeStudent: handler(
      "DELETE",
      "classroom.class.member.remove",
      (request) =>
        `/api/v1/classes/${id(request)}/members/${encodeURIComponent(String(request.params.studentId))}`,
    ),
    reset: handler(
      "POST",
      "classroom.class.join-code.reset",
      (request) => `/api/v1/classes/${id(request)}/join-code/reset`,
    ),
    announce: handler(
      "POST",
      "classroom.announcement.create",
      (request) => `/api/v1/classes/${id(request)}/announcements`,
    ),
    announcements: handler(
      "GET",
      "classroom.announcement.list",
      (request) => `/api/v1/classes/${id(request)}/announcements`,
      true,
    ),
    sessionCreate: handler(
      "POST",
      "classroom.session.create",
      (request) => `/api/v1/classes/${id(request)}/sessions`,
    ),
    sessionUpdate: handler(
      "PATCH",
      "classroom.session.update",
      (request) => `/api/v1/classes/${id(request)}/sessions/${sessionId(request)}`,
    ),
    sessionList: handler(
      "GET",
      "classroom.session.list",
      (request) => `/api/v1/classes/${id(request)}/sessions`,
      true,
    ),
    sessionDetail: handler(
      "GET",
      "classroom.session.detail",
      (request) => `/api/v1/class-sessions/${sessionId(request)}`,
    ),
    schedulePublish: handler(
      "POST",
      "classroom.schedule.publish",
      (request) => `/api/v1/classes/${id(request)}/schedule/publish`,
    ),
    schedule: handler("GET", "classroom.schedule.read", () => "/api/v1/me/schedule", true),
    attendance: handler(
      "GET",
      "classroom.attendance.read",
      (request) => `/api/v1/class-sessions/${sessionId(request)}/attendance`,
    ),
    attendanceHistory: handler("GET", "classroom.attendance.history", () => "/api/v1/me/attendance", true),
    presenceTicket: handler(
      "POST",
      "classroom.presence.ticket",
      (request) => `/api/v1/class-sessions/${sessionId(request)}/presence-tickets`,
      false,
      (raw, request) => rewriteWebsocketUrl(raw, request),
    ),
    manualAttendance: handler(
      "PUT",
      "classroom.attendance.manual",
      (request) =>
        `/api/v1/class-sessions/${sessionId(request)}/attendance/${encodeURIComponent(String(request.params.studentId))}`,
    ),
    installWebSocket: async (server: Server) => installGatewayWebSocket(server, config, actorKey),
  };
}

async function installGatewayWebSocket(
  server: Server,
  config: AppConfig,
  actorKey: CryptoKey,
): Promise<() => void> {
  if (!config.CLASSROOM_SERVICE_TOKEN_PUBLIC_KEY_PATH)
    throw new Error("Gateway requires Classroom presence public key");
  const classroomKey = await loadPublicKey(config.CLASSROOM_SERVICE_TOKEN_PUBLIC_KEY_PATH);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4_096 });
  const route = /^\/realtime\/v1\/class-sessions\/([0-9a-f-]{36})\/presence$/iu;
  const onUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const match = route.exec(url.pathname);
    if (!match) return;
    void (async () => {
      try {
        const ticket = url.searchParams.get("ticket");
        if (!ticket || url.searchParams.getAll("ticket").length !== 1) throw new Error("TICKET_REQUIRED");
        const claims = await verifyPresenceTicket(
          ticket,
          classroomKey,
          match[1]
            ? { kid: config.CLASSROOM_SERVICE_TOKEN_KID, sessionId: match[1] }
            : { kid: config.CLASSROOM_SERVICE_TOKEN_KID },
        );
        const correlationId = randomUUID(),
          now = Math.floor(Date.now() / 1000);
        const trusted = await signActorContext(
          actorKey,
          config.ACTOR_CONTEXT_KID,
          config.ACTOR_CONTEXT_ISSUER,
          "classroom-service",
          "classroom.presence.ws",
          {
            userId: claims.sub,
            roles: claims.roles,
            sessionId: claims.authSessionId,
            tokenVersion: claims.tokenVersion,
            correlationId,
            issuedAt: now,
            expiresAt: now + config.ACTOR_CONTEXT_TTL_SECONDS,
          },
        );
        const upstream = new URL(
          `/realtime/v1/class-sessions/${claims.sessionId}/presence`,
          config.CLASSROOM_SERVICE_URL,
        );
        upstream.protocol = upstream.protocol === "https:" ? "wss:" : "ws:";
        const upstreamSocket = new WebSocket(upstream, {
          headers: {
            "x-actor-context": trusted,
            "x-presence-ticket": ticket,
            "x-correlation-id": correlationId,
          },
        });
        let upgraded = false;
        const timer = setTimeout(() => {
          if (upgraded) return;
          rejectUpgrade(socket);
          upstreamSocket.close();
        }, config.INTERNAL_HTTP_TIMEOUT_MS);
        upstreamSocket.once("open", () => {
          upgraded = true;
          clearTimeout(timer);
          wss.handleUpgrade(request, socket, head, (client) => {
            client.on("message", (data, binary) => {
              if (upstreamSocket.readyState === WebSocket.OPEN) upstreamSocket.send(data, { binary });
            });
            upstreamSocket.on("message", (data, binary) => {
              if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
            });
            client.on("close", () => upstreamSocket.close());
            client.on("error", () => upstreamSocket.close());
            upstreamSocket.on("close", (code, reason) => {
              if (client.readyState === WebSocket.OPEN) client.close(code, reason);
            });
            upstreamSocket.on("error", () => {
              if (client.readyState === WebSocket.OPEN) client.close(1011, "presence unavailable");
            });
          });
        });
        upstreamSocket.once("error", () => {
          if (!upgraded) rejectUpgrade(socket);
        });
      } catch {
        rejectUpgrade(socket);
      }
    })();
  };
  server.on("upgrade", onUpgrade);
  return () => {
    server.off("upgrade", onUpgrade);
    wss.close();
  };
}

function rejectUpgrade(socket: Socket) {
  if (!socket.destroyed) socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
}

function rewriteWebsocketUrl(raw: string, request: Request) {
  try {
    const parsed = JSON.parse(raw) as { data?: { websocketUrl?: unknown } };
    if (parsed.data && typeof parsed.data.websocketUrl === "string") {
      const proto = request.header("x-forwarded-proto") === "https" || request.secure ? "wss" : "ws";
      const pathname = new URL(parsed.data.websocketUrl).pathname;
      parsed.data.websocketUrl = `${proto}://${request.get("host") ?? "127.0.0.1:8080"}${pathname}`;
    }
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}

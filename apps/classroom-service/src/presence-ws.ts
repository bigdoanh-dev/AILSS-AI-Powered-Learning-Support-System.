import type { Server, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import {
  loadPublicKey,
  verifyActorContext,
  verifyPresenceTicket,
} from "../../../packages/security/src/index.js";
import type { AppConfig } from "../../../packages/config/src/index.js";
import type { CryptoKey } from "jose";
import { WebSocketServer } from "ws";
import type { ClassroomPresence } from "./presence.js";

const route = /^\/realtime\/v1\/class-sessions\/([0-9a-f-]{36})\/presence$/iu;

export async function installClassroomPresenceWebSocket(
  server: Server,
  config: AppConfig,
  presence: ClassroomPresence,
  actorKey: CryptoKey,
): Promise<() => void> {
  if (!config.CLASSROOM_SERVICE_TOKEN_PUBLIC_KEY_PATH)
    throw new Error("Classroom presence requires its service public key");
  const ticketKey = await loadPublicKey(config.CLASSROOM_SERVICE_TOKEN_PUBLIC_KEY_PATH);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4_096 });
  const onUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const match = route.exec((request.url ?? "").split("?", 1)[0] ?? "");
    if (!match) return;
    void authorizeUpgrade(request, socket, head, match[1] ?? "", wss, ticketKey, actorKey, config, presence);
  };
  server.on("upgrade", onUpgrade);
  return () => {
    server.off("upgrade", onUpgrade);
    wss.close();
  };
}

async function authorizeUpgrade(
  request: IncomingMessage,
  socket: Socket,
  head: Buffer,
  sessionId: string,
  wss: WebSocketServer,
  ticketKey: CryptoKey,
  actorKey: CryptoKey,
  config: AppConfig,
  presence: ClassroomPresence,
) {
  try {
    const ticket = oneHeader(request, "x-presence-ticket");
    const actorContext = oneHeader(request, "x-actor-context");
    const correlationId = oneHeader(request, "x-correlation-id");
    const claims = await verifyPresenceTicket(ticket, ticketKey, {
      kid: config.CLASSROOM_SERVICE_TOKEN_KID,
      sessionId,
    });
    const actor = await verifyActorContext(actorContext, actorKey, {
      issuer: config.ACTOR_CONTEXT_ISSUER,
      audience: "classroom-service",
      purpose: "classroom.presence.ws",
      kid: config.ACTOR_CONTEXT_KID,
      clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
    });
    if (
      actor.correlationId !== correlationId ||
      actor.userId !== claims.sub ||
      actor.sessionId !== claims.authSessionId ||
      actor.tokenVersion !== claims.tokenVersion ||
      actor.roles.join("\u0000") !== claims.roles.join("\u0000")
    )
      throw new Error("PRESENCE_BINDING_REJECTED");
    wss.handleUpgrade(request, socket, head, (ws) => {
      void presence.accept(ws, claims, actor, correlationId).catch((error: unknown) => {
        presence.recordFailure(error);
        ws.close(1011, "presence unavailable");
      });
    });
  } catch {
    reject(socket);
  }
}

function oneHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  if (typeof value !== "string" || value.length === 0 || value.length > 16_384)
    throw new Error("HEADER_REJECTED");
  return value;
}

function reject(socket: Socket) {
  try {
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
  } finally {
    socket.destroy();
  }
}

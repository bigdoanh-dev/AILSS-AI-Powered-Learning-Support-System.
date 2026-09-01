import { randomUUID } from "node:crypto";
import type WebSocket from "ws";
import type { Logger } from "pino";
import type { ActorContext, PresenceTicketClaims } from "../../../packages/security/src/index.js";
import { attendanceDto, type AttendanceRow, type ClassSession, type PresenceCheckpoint } from "./model.js";
import type { ClassroomRepository } from "./repository.js";
import type { ClassroomService } from "./service.js";

const TIMEOUT_MS = 45_000;
const CHECKPOINT_MS = 60_000;

interface LocalStudentState {
  session: ClassSession;
  sessionId: string;
  studentId: string;
  activeConnectionCount: number;
  firstJoinedAt?: Date | undefined;
  lastJoinedAt?: Date | undefined;
  lastLeftAt?: Date | undefined;
  lastSeenAt?: Date | undefined;
  accumulatedDurationSeconds: number;
  checkpointVersion: number;
  intervalStartedAt?: Date | undefined;
  lastCheckpointAt: number;
}

interface Connection {
  id: string;
  ws: WebSocket;
  sessionId: string;
  actorKind: "STUDENT" | "LECTURER";
  studentId: string;
  state?: LocalStudentState;
  timer: NodeJS.Timeout;
}

export class ClassroomPresence {
  private readonly students = new Map<string, LocalStudentState>();
  private readonly connections = new Map<string, Connection>();
  private readonly lecturers = new Map<string, Set<Connection>>();

  public constructor(
    private readonly repo: ClassroomRepository,
    private readonly service: ClassroomService,
    private readonly logger: Logger,
  ) {}

  recordFailure(error: unknown) {
    this.logger.warn(
      {
        operation: "presence.connection.rejected",
        reason: error instanceof Error ? error.message : "unknown",
      },
      "presence connection rejected",
    );
  }

  async accept(
    ws: WebSocket,
    ticket: PresenceTicketClaims,
    actor: ActorContext,
    requestId: string,
  ): Promise<void> {
    const authorized = await this.service.authorizePresence(
      ticket.sessionId,
      actor,
      ticket.actorKind,
      requestId,
    );
    const connection: Connection = {
      id: randomUUID(),
      ws,
      sessionId: ticket.sessionId,
      actorKind: ticket.actorKind,
      studentId: ticket.sub,
      timer: setInterval(() => void this.expire(connection), 5_000),
    };
    connection.timer.unref();
    this.connections.set(connection.id, connection);
    ws.on("message", (data) => void this.message(connection, rawMessage(data)));
    ws.on("close", () => void this.disconnect(connection, "CLOSE"));
    ws.on("error", () => void this.disconnect(connection, "ERROR"));
    if (ticket.actorKind === "LECTURER") {
      let observers = this.lecturers.get(ticket.sessionId);
      if (!observers) this.lecturers.set(ticket.sessionId, (observers = new Set()));
      observers.add(connection);
      ws.send(
        JSON.stringify({
          type: "roster.snapshot",
          data: await this.service.attendanceRoster(ticket.sessionId, actor, requestId),
        }),
      );
      return;
    }
    connection.state = await this.openStudent(connection, authorized.session);
    ws.send(
      JSON.stringify({
        type: "presence.connected",
        data: { sessionId: ticket.sessionId, presenceState: "ONLINE", attendanceStatus: "PRESENT" },
      }),
    );
    this.broadcastDelta(connection.state);
  }

  private async openStudent(connection: Connection, session: ClassSession): Promise<LocalStudentState> {
    const key = this.key(connection.sessionId, connection.studentId),
      now = new Date();
    let state = this.students.get(key);
    if (!state) {
      const checkpoint = await this.repo.presenceCheckpoint(connection.sessionId, connection.studentId);
      state = this.fromCheckpoint(session, connection.studentId, checkpoint, now);
      this.students.set(key, state);
    }
    const wasOnline = state.activeConnectionCount > 0;
    state.activeConnectionCount += 1;
    state.firstJoinedAt ??= now;
    state.lastJoinedAt = now;
    state.lastSeenAt = now;
    if (!wasOnline) state.intervalStartedAt = now;
    if (!(await this.persist(state, false))) throw new Error("PRESENCE_CHECKPOINT_CONFLICT");
    return state;
  }

  private async message(connection: Connection, raw: string) {
    if (connection.ws.readyState !== 1) return;
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      connection.ws.send(JSON.stringify({ type: "error", code: "INVALID_MESSAGE" }));
      return;
    }
    if (!message || typeof message !== "object" || (message as { type?: unknown }).type !== "heartbeat") {
      connection.ws.send(JSON.stringify({ type: "error", code: "UNSUPPORTED_MESSAGE" }));
      return;
    }
    if (connection.actorKind === "LECTURER") return;
    const state = connection.state;
    if (!state) return;
    const now = new Date();
    state.lastSeenAt = now;
    if (now.getTime() - state.lastCheckpointAt >= CHECKPOINT_MS && !(await this.persist(state, false))) {
      connection.ws.close(1011, "presence superseded");
      return;
    }
    connection.ws.send(JSON.stringify({ type: "presence.ack", data: { at: now.toISOString() } }));
  }

  private async expire(connection: Connection) {
    if (connection.ws.readyState !== 1) return;
    if (connection.actorKind === "LECTURER") return;
    const state = connection.state;
    if (!state) return;
    const now = new Date();
    if (now.getTime() - (state.lastSeenAt?.getTime() ?? 0) > TIMEOUT_MS) {
      await this.disconnect(connection, "TIMEOUT");
      return;
    }
    if (now.getTime() > state.session.endAt.getTime() + 15 * 60_000) {
      this.sendSessionClosed(connection.sessionId);
      await this.disconnect(connection, "SESSION_END");
    }
  }

  private async disconnect(connection: Connection, reason: string) {
    if (!this.connections.delete(connection.id)) return;
    clearInterval(connection.timer);
    if (connection.actorKind === "LECTURER") {
      this.lecturers.get(connection.sessionId)?.delete(connection);
      if (this.lecturers.get(connection.sessionId)?.size === 0) this.lecturers.delete(connection.sessionId);
      return;
    }
    const state = connection.state;
    if (!state) return;
    state.activeConnectionCount = Math.max(0, state.activeConnectionCount - 1);
    const final = state.activeConnectionCount === 0;
    if (final) {
      const now = new Date();
      state.lastLeftAt = now;
      state.lastSeenAt = now;
      const persisted = await this.persist(state, true);
      this.students.delete(this.key(connection.sessionId, connection.studentId));
      if (!persisted) return;
    } else {
      state.lastSeenAt = new Date();
    }
    if (connection.ws.readyState === 1 && reason === "TIMEOUT")
      connection.ws.close(1000, "heartbeat timeout");
    this.broadcastDelta(state);
  }

  private async persist(state: LocalStudentState, final: boolean): Promise<boolean> {
    const now = new Date();
    const elapsed = state.intervalStartedAt
      ? Math.max(0, Math.floor((now.getTime() - state.intervalStartedAt.getTime()) / 1000))
      : 0;
    const accumulated = state.accumulatedDurationSeconds + elapsed;
    const next: PresenceCheckpoint = {
      sessionId: state.sessionId,
      studentId: state.studentId,
      presenceState: final ? "OFFLINE" : "ONLINE",
      activeConnectionCount: final ? 0 : state.activeConnectionCount,
      ...(state.firstJoinedAt ? { firstJoinedAt: state.firstJoinedAt } : {}),
      ...(state.lastJoinedAt ? { lastJoinedAt: state.lastJoinedAt } : {}),
      ...(state.lastLeftAt ? { lastLeftAt: state.lastLeftAt } : {}),
      ...(state.lastSeenAt ? { lastSeenAt: state.lastSeenAt } : {}),
      accumulatedDurationSeconds: accumulated,
      checkpointVersion: state.checkpointVersion + 1,
      updatedAt: now,
    };
    const localVersion = state.checkpointVersion;
    let expected = await this.repo.presenceCheckpoint(state.sessionId, state.studentId);
    if (!checkpointWriteAllowed(localVersion, expected)) {
      // A reconnect/checkpoint from a newer connection set owns the row. In
      // particular, an old disconnect must never rebase and mark it OFFLINE.
      return !!expected && checkpointMatches(expected, next);
    }
    let applied = false;
    for (let tryNumber = 0; tryNumber < 2; tryNumber += 1) {
      try {
        applied = await this.repo.writeCheckpoint(expected, next);
      } catch {
        applied = false;
      }
      const readBack = await this.repo.presenceCheckpoint(state.sessionId, state.studentId);
      if (readBack && checkpointMatches(readBack, next)) {
        applied = true;
        break;
      }
      if (
        tryNumber === 0 &&
        ((localVersion === 0 && !readBack) ||
          (readBack?.checkpointVersion === localVersion && expected?.checkpointVersion === localVersion))
      ) {
        expected = readBack;
        continue;
      }
      return false;
    }
    if (!applied) return false;
    state.accumulatedDurationSeconds = accumulated;
    state.checkpointVersion = next.checkpointVersion;
    state.lastCheckpointAt = now.getTime();
    state.intervalStartedAt = final ? undefined : now;
    const row: AttendanceRow = {
      sessionId: state.sessionId,
      studentId: state.studentId,
      attendanceStatus: "PRESENT",
      source: "ONLINE_PRESENCE",
      ...(state.firstJoinedAt ? { firstJoinedAt: state.firstJoinedAt } : {}),
      ...(state.lastJoinedAt ? { lastJoinedAt: state.lastJoinedAt } : {}),
      ...(state.lastLeftAt ? { lastLeftAt: state.lastLeftAt } : {}),
      ...(state.lastSeenAt ? { lastSeenAt: state.lastSeenAt } : {}),
      connectedDurationSeconds: accumulated,
      presenceState: final ? "OFFLINE" : "ONLINE",
      attendanceVersion: next.checkpointVersion,
      updatedAt: now,
    };
    const projected = await this.repo.writeAttendance(row);
    if (!projected) {
      const current = (await this.repo.attendanceBySession(state.sessionId)).find(
        (v) => v.studentId === state.studentId,
      );
      if (!current || current.attendanceVersion < row.attendanceVersion)
        throw new Error("ATTENDANCE_PROJECTION_CONFLICT");
    }
    await this.repo.writeAttendanceHistory({
      studentId: state.studentId,
      yearMonth: state.session.startAt.toISOString().slice(0, 7),
      startAt: state.session.startAt,
      sessionId: state.sessionId,
      classId: state.session.classId,
      title: state.session.title,
      mode: state.session.mode,
      attendanceStatus: "PRESENT",
      ...(state.firstJoinedAt ? { firstJoinedAt: state.firstJoinedAt } : {}),
      ...(state.lastJoinedAt ? { lastJoinedAt: state.lastJoinedAt } : {}),
      ...(state.lastLeftAt ? { lastLeftAt: state.lastLeftAt } : {}),
      connectedDurationSeconds: accumulated,
      attendanceVersion: next.checkpointVersion,
    });
    return true;
  }

  private fromCheckpoint(
    session: ClassSession,
    studentId: string,
    checkpoint: PresenceCheckpoint | undefined,
    now: Date,
  ): LocalStudentState {
    return {
      session,
      sessionId: session.sessionId,
      studentId,
      // If no local state exists, no connection in this process owns the
      // durable count (restart or lazy recovery). The reconnect begins at 0→1.
      activeConnectionCount: presenceHydration(checkpoint, now).activeConnectionCount,
      ...(checkpoint?.firstJoinedAt ? { firstJoinedAt: checkpoint.firstJoinedAt } : {}),
      ...(checkpoint?.lastJoinedAt ? { lastJoinedAt: checkpoint.lastJoinedAt } : {}),
      ...(checkpoint?.lastLeftAt ? { lastLeftAt: checkpoint.lastLeftAt } : {}),
      lastSeenAt: now,
      accumulatedDurationSeconds: checkpoint?.accumulatedDurationSeconds ?? 0,
      checkpointVersion: checkpoint?.checkpointVersion ?? 0,
      intervalStartedAt: now,
      lastCheckpointAt: 0,
    };
  }

  private broadcastDelta(state: LocalStudentState) {
    const row: AttendanceRow = {
      sessionId: state.sessionId,
      studentId: state.studentId,
      attendanceStatus: "PRESENT",
      source: "ONLINE_PRESENCE",
      ...(state.firstJoinedAt ? { firstJoinedAt: state.firstJoinedAt } : {}),
      ...(state.lastJoinedAt ? { lastJoinedAt: state.lastJoinedAt } : {}),
      ...(state.lastLeftAt ? { lastLeftAt: state.lastLeftAt } : {}),
      ...(state.lastSeenAt ? { lastSeenAt: state.lastSeenAt } : {}),
      connectedDurationSeconds: state.accumulatedDurationSeconds,
      presenceState: state.activeConnectionCount > 0 ? "ONLINE" : "OFFLINE",
      attendanceVersion: state.checkpointVersion,
      updatedAt: new Date(),
    };
    const observers = this.lecturers.get(state.sessionId);
    for (const observer of observers ?? [])
      if (observer.ws.readyState === 1)
        observer.ws.send(JSON.stringify({ type: "roster.delta", data: attendanceDto(row) }));
  }

  private sendSessionClosed(sessionId: string) {
    for (const observer of this.lecturers.get(sessionId) ?? [])
      if (observer.ws.readyState === 1)
        observer.ws.send(JSON.stringify({ type: "session.closed", data: { sessionId } }));
  }

  private key(sessionId: string, studentId: string) {
    return `${sessionId}:${studentId}`;
  }
}

export function checkpointMatches(current: PresenceCheckpoint, intended: PresenceCheckpoint) {
  return (
    current.sessionId === intended.sessionId &&
    current.studentId === intended.studentId &&
    current.presenceState === intended.presenceState &&
    current.activeConnectionCount === intended.activeConnectionCount &&
    current.accumulatedDurationSeconds === intended.accumulatedDurationSeconds &&
    current.checkpointVersion === intended.checkpointVersion &&
    current.updatedAt.getTime() === intended.updatedAt.getTime()
  );
}

export function checkpointWriteAllowed(
  localVersion: number,
  durable: PresenceCheckpoint | undefined,
): boolean {
  return localVersion === 0 ? durable === undefined : durable?.checkpointVersion === localVersion;
}

export function presenceHydration(checkpoint: PresenceCheckpoint | undefined, now: Date) {
  return {
    activeConnectionCount: 0,
    staleOnline:
      checkpoint?.presenceState === "ONLINE" && now.getTime() - checkpoint.updatedAt.getTime() > TIMEOUT_MS,
  };
}

function rawMessage(data: WebSocket.RawData): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString("utf8");
  return Buffer.from(data as Uint8Array).toString("utf8");
}

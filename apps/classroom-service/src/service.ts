import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../../../packages/http/src/index.js";
import { signPresenceTicket, type ActorContext } from "../../../packages/security/src/index.js";
import type { CryptoKey } from "jose";
import { ClassroomDependencyError, type ClassroomClients } from "./clients.js";
import {
  MAX_SCHEDULE_LIST_DAYS,
  MAX_SESSION_DURATION_MS,
  MAX_SESSIONS_PER_CLASS,
  MAX_SESSIONS_PER_CLASS_DATE,
  classDto,
  codeHash,
  deterministicJoinCode,
  deterministicSessionId,
  deterministicUuid,
  fingerprint,
  inMeetingWindow,
  isValidTimezone,
  keyHash,
  materializeRecurrence,
  membershipDto,
  sessionDto,
  sessionsOverlap,
  utcDatesTouched,
  type AnnouncementRequest,
  type AttendanceHistoryRow,
  type AttendanceRow,
  attendanceDto,
  attendanceHistoryDto,
  manualAttendanceDto,
  type ClassCreateRequest,
  type ClassJoinRequest,
  type ClassPatchRequest,
  type ClassSession,
  type ClassroomClass,
  type Membership,
  type ManualAttendanceRequest,
  type ScheduleReservation,
  type ScheduleSegment,
  type SessionPatchRequest,
  type SessionWriteRequest,
  type StudentWarningRequest,
} from "./model.js";
import type { ClassroomRepository } from "./repository.js";

export class ClassroomService {
  public constructor(
    private readonly repo: ClassroomRepository,
    private readonly clients: ClassroomClients,
    private readonly secret: string,
    private readonly presenceSigningKey?: CryptoKey,
    private readonly presenceKid = "dev-classroom-2026-01",
  ) {}

  async attendanceRoster(sessionId: string, actor: ActorContext, requestId: string) {
    const { session, klass } = await this.authorizeSession(sessionId, actor, requestId, "LECTURER", false);
    const members = (await this.repo.roster(klass.classId))
      .filter((member) => member.state === "ACTIVE")
      .sort((a, b) => a.studentId.localeCompare(b.studentId))
      .slice(0, 100);
    const rows = new Map<string, AttendanceRow>();
    for (const row of await this.repo.attendanceBySession(session.sessionId))
      rows.set(row.studentId, await this.repairStalePresence(session, row));
    return members.map((member) => {
      const row = rows.get(member.studentId);
      return attendanceDto(
        row ?? {
          sessionId: session.sessionId,
          studentId: member.studentId,
          attendanceStatus: "NOT_RECORDED",
          source: "NONE",
          connectedDurationSeconds: 0,
          presenceState: "OFFLINE",
          attendanceVersion: 0,
          updatedAt: new Date(0),
        },
      );
    });
  }

  async attendanceHistory(actor: ActorContext, month: string) {
    if (!actor.roles.includes("STUDENT"))
      throw new AppError("STUDENT_REQUIRED", 403, "Student authorization is required");
    return (await this.repo.attendanceByStudentMonth(actor.userId, month)).map(attendanceHistoryDto);
  }

  private async repairStalePresence(session: ClassSession, row: AttendanceRow): Promise<AttendanceRow> {
    if (row.source !== "ONLINE_PRESENCE" || row.presenceState !== "ONLINE") return row;
    const checkpoint = await this.repo.presenceCheckpoint(session.sessionId, row.studentId),
      staleAt = checkpoint?.updatedAt ?? row.lastSeenAt ?? row.updatedAt;
    if (Date.now() - staleAt.getTime() <= 45_000) return row;
    const now = new Date(),
      lastLeftAt = checkpoint?.lastSeenAt ?? row.lastSeenAt ?? staleAt;
    let nextVersion = row.attendanceVersion + 1;
    if (checkpoint) {
      const nextCheckpoint = {
        ...checkpoint,
        presenceState: "OFFLINE" as const,
        activeConnectionCount: 0,
        lastLeftAt,
        checkpointVersion: checkpoint.checkpointVersion + 1,
        updatedAt: now,
      };
      if (!(await this.repo.writeCheckpoint(checkpoint, nextCheckpoint))) return row;
      nextVersion = nextCheckpoint.checkpointVersion;
    }
    const repaired: AttendanceRow = {
      ...row,
      presenceState: "OFFLINE",
      lastLeftAt,
      attendanceVersion: nextVersion,
      updatedAt: now,
    };
    await this.repo.writeAttendance(repaired);
    const canonical = (await this.repo.attendance(session.sessionId, row.studentId)) ?? repaired;
    if (canonical.presenceState === "OFFLINE")
      await this.repo.writeAttendanceHistory({
        studentId: canonical.studentId,
        yearMonth: session.startAt.toISOString().slice(0, 7),
        startAt: session.startAt,
        sessionId: session.sessionId,
        classId: session.classId,
        title: session.title,
        mode: session.mode,
        attendanceStatus: canonical.attendanceStatus,
        ...(canonical.firstJoinedAt ? { firstJoinedAt: canonical.firstJoinedAt } : {}),
        ...(canonical.lastJoinedAt ? { lastJoinedAt: canonical.lastJoinedAt } : {}),
        ...(canonical.lastLeftAt ? { lastLeftAt: canonical.lastLeftAt } : {}),
        connectedDurationSeconds: canonical.connectedDurationSeconds,
        attendanceVersion: canonical.attendanceVersion,
      });
    return canonical;
  }

  async manualAttendance(input: {
    sessionId: string;
    studentId: string;
    actor: ActorContext;
    request: ManualAttendanceRequest;
    key: string;
    requestId: string;
  }) {
    await this.lecturer(input.actor, input.requestId);
    const session = await this.repo.getSession(input.sessionId);
    if (!session) throw notFound("SESSION_NOT_FOUND", "Session not found");
    const klass = await this.repo.getClass(session.classId);
    if (!klass) throw unavailable();
    if (klass.ownerLecturerId !== input.actor.userId)
      throw new AppError("CLASS_OWNER_REQUIRED", 403, "Class owner authorization is required");
    if (klass.state !== "ACTIVE" || klass.scheduleState !== "PUBLISHED")
      throw conflict("CLASS_SCHEDULE_NOT_AVAILABLE", "Published Class schedule is not available");
    if (session.mode !== "OFFLINE")
      throw conflict("MANUAL_ATTENDANCE_OFFLINE_ONLY", "Manual attendance requires an OFFLINE session");
    if (!["SCHEDULED", "COMPLETED"].includes(session.status))
      throw conflict("MANUAL_ATTENDANCE_SESSION_INELIGIBLE", "Session is not eligible for manual attendance");
    if (Date.now() < session.startAt.getTime())
      throw conflict("MANUAL_ATTENDANCE_TOO_EARLY", "Future sessions cannot be marked attended");
    const membership = await this.repo.membership(klass.classId, input.studentId);
    if (!membership || membership.state !== "ACTIVE")
      throw notFound("STUDENT_MEMBERSHIP_NOT_FOUND", "Student is not available for this Class");

    const now = new Date(),
      operationId = randomUUID(),
      eventId = randomUUID(),
      attendanceId = deterministicUuid(
        this.secret,
        "class-attendance",
        `${session.sessionId}:${input.studentId}`,
      ),
      scope = `CLS-19:${input.actor.userId}:${session.sessionId}:${input.studentId}`,
      hash = keyHash(this.secret, input.key),
      fp = fingerprint(this.secret, {
        method: "PUT",
        route: "/api/v1/class-sessions/{sessionId}/attendance/{studentId}",
        actor: input.actor.userId,
        sessionId: session.sessionId,
        studentId: input.studentId,
        body: input.request,
      });
    await this.repo.reserve(
      scope,
      hash,
      input.key,
      operationId,
      attendanceId,
      {
        fingerprint: fp,
        eventId,
        occurredAt: now.toISOString(),
        correlationId: input.actor.correlationId,
      },
      now,
    );
    let command = await this.requiredCommand(scope, hash, input.key, fp);
    if (command.status === "COMPLETE" && command.receipt.resource)
      return {
        data: command.receipt.resource,
        replayed: true,
        noOp: command.receipt.noOp ?? false,
      };

    let current = await this.repo.attendance(session.sessionId, input.studentId);
    if (current?.source === "ONLINE_PRESENCE")
      throw conflict(
        "ATTENDANCE_SOURCE_CONFLICT",
        "Trusted online presence evidence cannot be changed by manual attendance",
      );
    if (current && current.source !== "MANUAL_OFFLINE")
      throw conflict("ATTENDANCE_SOURCE_CONFLICT", "Attendance source is not manually correctable");
    if (
      !command.receipt.target &&
      current?.attendanceStatus === input.request.attendanceStatus &&
      current.manualNote === input.request.note
    ) {
      const data = manualAttendanceDto(current);
      await this.repo.complete(scope, hash, input.key, command.operationId, {
        ...command.receipt,
        resource: data,
        noOp: true,
      });
      return { data, replayed: false, noOp: true };
    }

    const occurredAt = new Date(command.receipt.occurredAt);
    let target = command.receipt.target as unknown as ManualAttendanceTarget | undefined;
    if (!target) {
      target = {
        sessionId: session.sessionId,
        studentId: input.studentId,
        attendanceStatus: input.request.attendanceStatus,
        ...(input.request.note ? { manualNote: input.request.note } : {}),
        expectedVersion: current?.attendanceVersion ?? 0,
        attendanceVersion: (current?.attendanceVersion ?? 0) + 1,
        connectedDurationSeconds: current?.connectedDurationSeconds ?? 0,
        updatedAt: occurredAt.toISOString(),
      };
      await this.repo.checkpoint(scope, hash, input.key, command.operationId, {
        ...command.receipt,
        target: target as unknown as Record<string, unknown>,
      });
      command = await this.requiredCommand(scope, hash, input.key, fp);
    }
    const next = manualTargetRow(target);
    current = await this.convergeManualAttendance(current, next, target.expectedVersion);
    if (!sameManualAttendance(current, next))
      throw conflict("ATTENDANCE_VERSION_CONFLICT", "Attendance changed concurrently");

    await this.repo.prepareEvent({
      eventId: command.receipt.eventId ?? eventId,
      eventType: "system.audit.requested.v1",
      aggregateId: command.resourceId,
      aggregateType: "CLASS_ATTENDANCE",
      version: current.attendanceVersion,
      occurredAt,
      correlationId: command.receipt.correlationId ?? command.operationId,
      actor: { type: "USER", id: input.actor.userId },
      data: {
        action: target.expectedVersion === 0 ? "OFFLINE_ATTENDANCE_RECORDED" : "OFFLINE_ATTENDANCE_CORRECTED",
        actorType: "USER",
        actorId: input.actor.userId,
        targetType: "CLASS_ATTENDANCE",
        targetId: command.resourceId,
        sessionId: session.sessionId,
        studentId: input.studentId,
        attendanceStatus: current.attendanceStatus,
        source: "MANUAL_OFFLINE",
        outcome: "SUCCESS",
        version: current.attendanceVersion,
        requestId: command.receipt.correlationId ?? command.operationId,
      },
    });
    const month = session.startAt.toISOString().slice(0, 7),
      history = {
        studentId: input.studentId,
        yearMonth: month,
        startAt: session.startAt,
        sessionId: session.sessionId,
        classId: session.classId,
        title: session.title,
        mode: "OFFLINE" as const,
        attendanceStatus: current.attendanceStatus,
        ...(current.manualNote ? { manualNote: current.manualNote } : {}),
        connectedDurationSeconds: current.connectedDurationSeconds,
        attendanceVersion: current.attendanceVersion,
      };
    await this.repo.writeAttendanceHistory(history);
    const projected = await this.repo.attendanceHistoryEntry(
      input.studentId,
      month,
      session.startAt,
      session.sessionId,
    );
    if (!projected || !sameManualHistory(projected, history))
      throw unavailable("ATTENDANCE_HISTORY_DIVERGED");
    await this.repo.readyEvent(command.receipt.eventId ?? eventId, occurredAt);
    const data = manualAttendanceDto(current);
    await this.repo.complete(scope, hash, input.key, command.operationId, {
      ...command.receipt,
      resource: data,
      noOp: false,
    });
    return { data, replayed: false, noOp: false };
  }

  private async convergeManualAttendance(
    current: Awaited<ReturnType<ClassroomRepository["attendance"]>>,
    intended: AttendanceRow,
    expectedVersion: number,
  ): Promise<AttendanceRow> {
    if (current && sameManualAttendance(current, intended)) return current;
    if (
      (expectedVersion === 0 && current) ||
      (expectedVersion > 0 &&
        (!current || current.attendanceVersion !== expectedVersion || current.source !== "MANUAL_OFFLINE"))
    )
      throw conflict("ATTENDANCE_VERSION_CONFLICT", "Attendance changed concurrently");
    for (let tryNumber = 0; tryNumber < 2; tryNumber += 1) {
      try {
        await this.repo.writeManualAttendance(current, intended);
      } catch {
        // Resolve an ambiguous LWT through the exact canonical read below.
      }
      const readBack = await this.repo.attendance(intended.sessionId, intended.studentId);
      if (readBack && sameManualAttendance(readBack, intended)) return readBack;
      if (
        tryNumber === 0 &&
        ((expectedVersion === 0 && !readBack) ||
          (readBack?.attendanceVersion === expectedVersion && readBack.source === "MANUAL_OFFLINE"))
      ) {
        current = readBack;
        continue;
      }
      break;
    }
    throw conflict("ATTENDANCE_VERSION_CONFLICT", "Attendance changed concurrently");
  }

  async issuePresenceTicket(input: { sessionId: string; actor: ActorContext; requestId: string }) {
    if (!this.presenceSigningKey) throw unavailable("PRESENCE_TICKET_SIGNER_UNAVAILABLE");
    const preferredKind = input.actor.roles.includes("LECTURER") ? "LECTURER" : "STUDENT";
    const { session } = await this.authorizeSession(
      input.sessionId,
      input.actor,
      input.requestId,
      preferredKind,
      true,
    );
    const now = Math.floor(Date.now() / 1000);
    const ticket = await signPresenceTicket(
      this.presenceSigningKey,
      this.presenceKid,
      {
        sub: input.actor.userId,
        sessionId: session.sessionId,
        actorKind: preferredKind,
        authSessionId: input.actor.sessionId,
        tokenVersion: input.actor.tokenVersion,
        roles: input.actor.roles,
        ttlSeconds: 30,
      },
      now,
    );
    return {
      ticket,
      websocketUrl: `ws://127.0.0.1:8080/realtime/v1/class-sessions/${session.sessionId}/presence`,
      expiresIn: 30,
    };
  }

  async authorizePresence(
    sessionId: string,
    actor: ActorContext,
    actorKind: "STUDENT" | "LECTURER",
    requestId: string,
  ) {
    return this.authorizeSession(sessionId, actor, requestId, actorKind, true);
  }

  private async authorizeSession(
    sessionId: string,
    actor: ActorContext,
    requestId: string,
    actorKind: "STUDENT" | "LECTURER",
    enforceWindow: boolean,
  ) {
    const session = await this.repo.getSession(sessionId);
    if (!session) throw notFound("SESSION_NOT_FOUND", "Session not found");
    const klass = await this.repo.getClass(session.classId);
    if (!klass) throw unavailable();
    if (klass.state !== "ACTIVE" || klass.scheduleState !== "PUBLISHED")
      throw notFound("CLASS_SCHEDULE_NOT_AVAILABLE", "Published Class schedule is not available");
    if (
      (enforceWindow && (session.mode !== "ONLINE" || session.status !== "SCHEDULED")) ||
      (!enforceWindow && ["DRAFT", "CANCELLED"].includes(session.status))
    )
      throw new AppError("PRESENCE_NOT_ELIGIBLE", 409, "Session is not eligible for online presence");
    if (enforceWindow && !inMeetingWindow(session.startAt, session.endAt, new Date()))
      throw new AppError("PRESENCE_WINDOW_CLOSED", 409, "Session presence window is closed");
    if (actorKind === "LECTURER") {
      await this.lecturer(actor, requestId);
      if (klass.ownerLecturerId !== actor.userId)
        throw new AppError("CLASS_OWNER_REQUIRED", 403, "Class owner authorization is required");
    } else {
      if (!actor.roles.includes("STUDENT"))
        throw new AppError("STUDENT_REQUIRED", 403, "Student authorization is required");
      const membership = await this.repo.membership(klass.classId, actor.userId);
      if (!membership || membership.state !== "ACTIVE")
        throw new AppError("CLASS_MEMBERSHIP_REQUIRED", 403, "Active Class membership is required");
    }
    return { session, klass };
  }

  async reserveSchedule(input: {
    operationId: string;
    studentId: string;
    offeringId: string;
    classId: string;
  }) {
    const reservationId = deterministicUuid(this.secret, "schedule-reservation", input.operationId),
      existing = await this.repo.getReservation(reservationId);
    if (existing) {
      this.assertReservationBinding(existing, input);
      if (existing.state === "HELD" && existing.expiresAt > new Date()) return reservationDto(existing);
      if (existing.state === "HELD" && existing.expiresAt <= new Date()) {
        const expiredAt = new Date();
        await this.cleanupSegments(await this.repo.reservationSegments(existing.reservationId));
        await this.repo.transitionReservation(existing, "EXPIRED", expiredAt, { reason: "EXPIRED" });
        throw conflict("RESERVATION_EXPIRED", "Schedule reservation expired");
      }
      if (existing.state === "CONFIRMED") return { ...reservationDto(existing), state: "HELD" as const };
      if (existing.state !== "PREPARED")
        throw conflict("RESERVATION_TERMINAL", "Schedule reservation is terminal");
    }
    const klass = await this.repo.getClass(input.classId);
    if (!klass || klass.state !== "ACTIVE" || klass.scheduleState !== "PUBLISHED")
      throw notFound("CLASS_SCHEDULE_NOT_AVAILABLE", "Published Class schedule is not available");
    const manifest = await this.repo.getManifest(klass.classId);
    if (!manifest || manifest.scheduleVersion !== klass.scheduleVersion) throw unavailable();
    const ids = await this.repo.listClassSessionIds(klass.classId, MAX_SESSIONS_PER_CLASS + 1),
      canonical: ClassSession[] = [];
    for (const id of ids) {
      const session = await this.repo.getSession(id);
      if (session?.status === "SCHEDULED" && session.scheduleVersion === klass.scheduleVersion)
        canonical.push(session);
    }
    canonical.sort(
      (a, b) => a.startAt.getTime() - b.startAt.getTime() || a.sessionId.localeCompare(b.sessionId),
    );
    const checksum = createHash("sha256")
      .update(canonical.map((s) => s.sessionId).join(","))
      .digest("hex");
    if (canonical.length !== manifest.sessionCount || checksum !== manifest.checksum) throw unavailable();
    const now = new Date(),
      expiresAt = new Date(now.getTime() + 15 * 60_000),
      segments: ScheduleSegment[] = [];
    for (const session of canonical.filter((s) => s.endAt > now))
      for (const day of utcDatesTouched(session.startAt, session.endAt))
        segments.push({
          entryId: deterministicUuid(
            this.secret,
            "schedule-entry",
            `${reservationId}:${day}:${session.sessionId}`,
          ),
          scheduleDay: day,
          startAt: session.startAt,
          endAt: session.endAt,
          sessionId: session.sessionId,
          classId: klass.classId,
          className: klass.name,
          studentId: input.studentId,
          offeringId: input.offeringId,
          reservationId,
          title: session.title,
          mode: session.mode,
          timezone: session.timezone,
          scheduleVersion: klass.scheduleVersion,
        });
    const prepared: ScheduleReservation = existing ?? {
      reservationId,
      operationId: input.operationId,
      studentId: input.studentId,
      classId: input.classId,
      offeringId: input.offeringId,
      state: "PREPARED",
      expiresAt,
      segmentCount: segments.length,
      scheduleVersion: klass.scheduleVersion,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    if (!existing) await this.repo.createReservation(prepared);
    await this.repo.writeReservationSegments(segments);
    const stableSegments = await this.repo.reservationSegments(reservationId);
    if (stableSegments.length !== prepared.segmentCount) throw unavailable();
    const guard = await this.repo.acquireScheduleGuard(
      input.studentId,
      input.operationId,
      reservationId,
      now,
    );
    if (!guard.acquired) throw conflict("SCHEDULE_GUARD_BUSY", "Student schedule is being updated");
    try {
      if (guard.predecessorReservationId && guard.predecessorReservationId !== reservationId)
        await this.expirePredecessorUnderGuard(guard.predecessorReservationId, now);
      const days = [...new Set(stableSegments.map((s) => s.scheduleDay))];
      for (const day of days) {
        const existingRows = await this.repo.daySchedule(input.studentId, day);
        for (const proposed of stableSegments.filter((s) => s.scheduleDay === day))
          if (
            existingRows.some(
              (row) =>
                row.reservationId !== reservationId &&
                (row.state === "CONFIRMED" || (!!row.expiresAt && row.expiresAt > now)) &&
                sessionsOverlap(proposed.startAt, proposed.endAt, row.startAt, row.endAt),
            )
          ) {
            await this.cleanupSegments(stableSegments);
            await this.repo.transitionReservation(prepared, "RELEASED", now, { reason: "SCHEDULE_CONFLICT" });
            throw conflict("SCHEDULE_CONFLICT", "Student schedule conflicts with an existing class");
          }
      }
      for (const segment of stableSegments) await this.repo.putHeldSegment(segment, prepared.expiresAt);
      await this.verifySegments(stableSegments, "HELD");
      const current = (await this.repo.getReservation(reservationId)) ?? prepared;
      if (current.state === "PREPARED") {
        await this.repo.transitionReservation(current, "HELD", now);
      }
      const held = await this.repo.getReservation(reservationId);
      if (!held || held.state !== "HELD") throw unavailable();
      await this.repo.enqueueReservationExpiry(held);
      return reservationDto(held);
    } finally {
      await this.repo.releaseScheduleGuard(input.studentId, input.operationId, guard.fence, new Date());
    }
  }

  async confirmSchedule(
    reservationId: string,
    request: { operationId: string; orderId: string; membershipId: string },
  ) {
    let reservation = await this.repo.getReservation(reservationId);
    if (!reservation) throw notFound("RESERVATION_NOT_FOUND", "Schedule reservation not found");
    if (reservation.state === "CONFIRMED") {
      if (reservation.orderId !== request.orderId || reservation.membershipId !== request.membershipId)
        throw conflict("RESERVATION_CONFIRM_CONFLICT", "Confirmation replay payload conflicts");
      return reservationDto(reservation);
    }
    if (reservation.state !== "HELD") throw conflict("RESERVATION_NOT_HELD", "Reservation is not HELD");
    const now = new Date(),
      guard = await this.repo.acquireScheduleGuard(
        reservation.studentId,
        request.operationId,
        reservation.reservationId,
        now,
      );
    if (!guard.acquired) throw conflict("SCHEDULE_GUARD_BUSY", "Student schedule is being updated");
    try {
      reservation = (await this.repo.getReservation(reservationId)) ?? reservation;
      if (reservation.state === "CONFIRMED") return reservationDto(reservation);
      const segments = await this.repo.reservationSegments(reservationId);
      if (reservation.expiresAt <= now) {
        await this.cleanupSegments(segments);
        await this.repo.transitionReservation(reservation, "EXPIRED", now, { reason: "EXPIRED" });
        throw conflict("RESERVATION_EXPIRED", "Schedule reservation expired");
      }
      if (segments.length !== reservation.segmentCount) throw unavailable();
      for (const segment of segments) await this.repo.putConfirmedSegment(segment);
      await this.verifySegments(segments, "CONFIRMED");
      await this.repo.transitionReservation(reservation, "CONFIRMED", now, request);
      const confirmed = await this.repo.getReservation(reservationId);
      if (!confirmed || confirmed.state !== "CONFIRMED") throw unavailable();
      return reservationDto(confirmed);
    } finally {
      await this.repo.releaseScheduleGuard(
        reservation.studentId,
        request.operationId,
        guard.fence,
        new Date(),
      );
    }
  }

  async releaseSchedule(
    reservationId: string,
    request: { operationId: string; reason: "PAYMENT_FAILED" | "CANCELLED" | "COMPENSATION" | "EXPIRED" },
  ) {
    let reservation = await this.repo.getReservation(reservationId);
    if (!reservation) throw notFound("RESERVATION_NOT_FOUND", "Schedule reservation not found");
    if (["RELEASED", "EXPIRED"].includes(reservation.state)) {
      const expected = request.reason === "EXPIRED" ? "EXPIRED" : "RELEASED";
      if (reservation.state !== expected || reservation.terminalReason !== request.reason)
        throw conflict("RESERVATION_RELEASE_CONFLICT", "Release replay payload conflicts");
      return reservationDto(reservation);
    }
    if (reservation.state === "CONFIRMED")
      throw conflict("CONFIRMED_RESERVATION_IMMUTABLE", "Confirmed schedule cannot be released here");
    const now = new Date(),
      guard = await this.repo.acquireScheduleGuard(
        reservation.studentId,
        request.operationId,
        reservationId,
        now,
      );
    if (!guard.acquired) throw conflict("SCHEDULE_GUARD_BUSY", "Student schedule is being updated");
    try {
      reservation = (await this.repo.getReservation(reservationId)) ?? reservation;
      const segments = await this.repo.reservationSegments(reservationId);
      await this.cleanupSegments(segments);
      const state = request.reason === "EXPIRED" ? "EXPIRED" : "RELEASED";
      if (reservation.state === "PREPARED" || reservation.state === "HELD")
        await this.repo.transitionReservation(reservation, state, now, { reason: request.reason });
      const terminal = await this.repo.getReservation(reservationId);
      if (!terminal || terminal.state !== state) throw unavailable();
      return reservationDto(terminal);
    } finally {
      await this.repo.releaseScheduleGuard(
        reservation.studentId,
        request.operationId,
        guard.fence,
        new Date(),
      );
    }
  }

  async activatePurchasedMembership(input: {
    classId: string;
    action: "PREPARE" | "ACTIVATE";
    operationId: string;
    studentId: string;
    offeringId: string;
    enrollmentId: string;
    reservationId: string;
    orderId: string;
    membershipId: string;
    requestId: string;
  }) {
    const now = new Date(),
      scope = `INT-CLS-07:${input.classId}:${input.studentId}`,
      hash = keyHash(this.secret, input.operationId),
      fp = fingerprint(this.secret, {
        api: "INT-CLS-07",
        classId: input.classId,
        operationId: input.operationId,
        studentId: input.studentId,
        offeringId: input.offeringId,
        enrollmentId: input.enrollmentId,
        reservationId: input.reservationId,
        orderId: input.orderId,
        membershipId: input.membershipId,
      }),
      eventId = deterministicUuid(this.secret, "purchase-membership-event", input.operationId);
    await this.repo.reserve(
      scope,
      hash,
      input.operationId,
      input.operationId,
      input.membershipId,
      { fingerprint: fp, eventId, occurredAt: now.toISOString() },
      now,
    );
    const command = await this.requiredCommand(scope, hash, input.operationId, fp);
    if (command.status === "COMPLETE" && command.receipt.resource) return command.receipt.resource;
    const klass = await this.repo.getClass(input.classId);
    if (
      !klass ||
      klass.state !== "ACTIVE" ||
      klass.classKind !== "LIVE_COHORT" ||
      klass.scheduleState !== "PUBLISHED"
    )
      throw notFound("LIVE_COHORT_NOT_AVAILABLE", "LIVE_COHORT Class is not available");
    const reservation = await this.repo.getReservation(input.reservationId);
    if (
      !reservation ||
      reservation.studentId !== input.studentId ||
      reservation.classId !== input.classId ||
      reservation.offeringId !== input.offeringId
    )
      throw conflict("MEMBERSHIP_RESERVATION_CONFLICT", "Membership reservation binding conflicts");
    if (!["HELD", "CONFIRMED"].includes(reservation.state))
      throw conflict("RESERVATION_NOT_USABLE", "Schedule reservation is not usable");
    const proposed: Membership = {
      membershipId: input.membershipId,
      classId: input.classId,
      studentId: input.studentId,
      state: "PENDING",
      source: "PURCHASE",
      offeringId: input.offeringId,
      enrollmentId: input.enrollmentId,
      scheduleReservationId: input.reservationId,
      joinedAt: new Date(command.receipt.occurredAt),
      version: 1,
    };
    await this.repo.createPurchaseMembership(proposed);
    let membership = await this.repo.membership(input.classId, input.studentId);
    if (!membership || !samePurchaseMembership(membership, proposed))
      throw conflict("MEMBERSHIP_IDENTITY_CONFLICT", "Membership identity conflicts");
    if (input.action === "PREPARE") {
      const resource = membershipDto(membership);
      await this.repo.checkpoint(scope, hash, input.operationId, command.operationId, {
        ...command.receipt,
        resource,
      });
      return resource;
    }
    const confirmed = await this.repo.getReservation(input.reservationId);
    if (
      !confirmed ||
      confirmed.state !== "CONFIRMED" ||
      confirmed.orderId !== input.orderId ||
      confirmed.membershipId !== input.membershipId
    )
      throw conflict("SCHEDULE_CONFIRMATION_REQUIRED", "Exact schedule confirmation is required");
    await this.repo.prepareEvent({
      eventId: command.receipt.eventId ?? eventId,
      eventType: "classroom.student.joined.v1",
      aggregateId: input.membershipId,
      aggregateType: "CLASS_MEMBERSHIP",
      version: 2,
      occurredAt: new Date(command.receipt.occurredAt),
      correlationId: input.requestId,
      data: {
        classId: input.classId,
        studentId: input.studentId,
        membershipId: input.membershipId,
        offeringId: input.offeringId,
        version: 2,
      },
    });
    if (membership.state === "PENDING") {
      await this.repo.activatePurchaseMembership(membership);
      membership = (await this.repo.membership(input.classId, input.studentId)) ?? membership;
    }
    if (membership.state !== "ACTIVE") throw unavailable();
    await this.repo.syncMembership(membership, klass.name);
    await this.repo.readyEvent(command.receipt.eventId ?? eventId, new Date(command.receipt.occurredAt));
    const resource = membershipDto(membership);
    await this.repo.complete(scope, hash, input.operationId, command.operationId, {
      ...command.receipt,
      resource,
    });
    return resource;
  }

  async studentSchedule(actor: ActorContext, from: string, to: string) {
    if (!actor.roles.includes("STUDENT"))
      throw new AppError("STUDENT_REQUIRED", 403, "Student authorization is required");
    const first = Date.parse(`${from}T00:00:00.000Z`),
      last = Date.parse(`${to}T00:00:00.000Z`);
    if (
      !Number.isFinite(first) ||
      !Number.isFinite(last) ||
      last < first ||
      (last - first) / 86400000 + 1 > 31
    )
      throw new AppError("INVALID_SCHEDULE_RANGE", 400, "Schedule range must be 1 to 31 UTC days");
    const unique = new Map<string, Awaited<ReturnType<ClassroomRepository["daySchedule"]>>[number]>();
    for (let t = first; t <= last; t += 86400000) {
      const day = new Date(t).toISOString().slice(0, 10);
      for (const row of await this.repo.daySchedule(actor.userId, day))
        if (row.state === "CONFIRMED") unique.set(`${row.reservationId}:${row.sessionId}`, row);
    }
    return [...unique.values()]
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.sessionId.localeCompare(b.sessionId))
      .map((v) => ({
        sessionId: v.sessionId,
        classId: v.classId,
        className: v.className,
        title: v.title,
        startAt: v.startAt.toISOString(),
        endAt: v.endAt.toISOString(),
        mode: v.mode,
        timezone: v.timezone,
        scheduleVersion: v.scheduleVersion,
      }));
  }

  async expireDueReservations(now = new Date()) {
    let expired = 0;
    for (const day of [new Date(now.getTime() - 86400000), now].map((v) => v.toISOString().slice(0, 10)))
      for (let shard = 0; shard < 16; shard++)
        for (const id of await this.repo.dueReservations(day, shard, now)) {
          const r = await this.repo.getReservation(id);
          if (r?.state === "HELD" && r.expiresAt <= now) {
            try {
              await this.releaseSchedule(id, {
                operationId: deterministicUuid(this.secret, "schedule-expiry", id),
                reason: "EXPIRED",
              });
              expired += 1;
            } catch (error) {
              if (!(error instanceof AppError && error.code === "SCHEDULE_GUARD_BUSY")) throw error;
            }
          }
        }
    return expired;
  }

  private async verifySegments(segments: readonly ScheduleSegment[], state: "HELD" | "CONFIRMED") {
    for (const segment of segments) {
      const row = (await this.repo.daySchedule(segment.studentId, segment.scheduleDay)).find(
        (v) => v.entryId === segment.entryId && v.reservationId === segment.reservationId,
      );
      if (!row || row.state !== state) throw unavailable();
    }
  }
  private async cleanupSegments(segments: readonly ScheduleSegment[]) {
    for (const segment of segments) await this.repo.deleteOwnHeldSegment(segment);
    for (const segment of segments) {
      const row = (await this.repo.daySchedule(segment.studentId, segment.scheduleDay)).find(
        (v) =>
          v.entryId === segment.entryId && v.reservationId === segment.reservationId && v.state === "HELD",
      );
      if (row) throw unavailable();
    }
  }
  private async expirePredecessorUnderGuard(id: string, now: Date) {
    const predecessor = await this.repo.getReservation(id);
    if (!predecessor || predecessor.state !== "HELD" || predecessor.expiresAt > now) return;
    await this.cleanupSegments(await this.repo.reservationSegments(id));
    await this.repo.transitionReservation(predecessor, "EXPIRED", now, { reason: "EXPIRED" });
  }
  private assertReservationBinding(
    value: ScheduleReservation,
    input: { operationId: string; studentId: string; offeringId: string; classId: string },
  ) {
    if (
      value.operationId !== input.operationId ||
      value.studentId !== input.studentId ||
      value.offeringId !== input.offeringId ||
      value.classId !== input.classId
    )
      throw conflict("RESERVATION_OPERATION_CONFLICT", "Reservation operation binding conflicts");
  }
  async create(input: { actor: ActorContext; request: ClassCreateRequest; key: string; requestId: string }) {
    await this.lecturer(input.actor, input.requestId);
    await this.link(input.request.linkedCourseId, input.actor.userId, input.requestId);
    const operationId = randomUUID(),
      classId = randomUUID(),
      eventId = randomUUID(),
      now = new Date(),
      scope = `CLS-01:${input.actor.userId}`,
      hash = keyHash(this.secret, input.key),
      fp = fingerprint(this.secret, {
        method: "POST",
        route: "/api/v1/classes",
        actor: input.actor.userId,
        body: input.request,
      });
    await this.repo.reserve(
      scope,
      hash,
      input.key,
      operationId,
      classId,
      { fingerprint: fp, eventId, occurredAt: now.toISOString() },
      now,
    );
    const cmd = await this.requiredCommand(scope, hash, input.key, fp);
    if (cmd.status === "COMPLETE" && cmd.receipt.resource)
      return { data: cmd.receipt.resource, replayed: true };
    const occurredAt = new Date(cmd.receipt.occurredAt),
      code = deterministicJoinCode(this.secret, cmd.operationId),
      hashCode = codeHash(this.secret, code);
    await this.repo.prepareEvent({
      eventId: cmd.receipt.eventId ?? eventId,
      eventType: "classroom.class.created.v1",
      aggregateId: cmd.resourceId,
      aggregateType: "CLASS",
      version: 1,
      occurredAt,
      correlationId: input.requestId,
      data: { classId: cmd.resourceId, lecturerId: input.actor.userId, version: 1 },
    });
    const existing = await this.repo.getClass(cmd.resourceId);
    if (!existing) {
      if (!(await this.repo.claimCode(hashCode, cmd.resourceId, 1, occurredAt)))
        throw conflict("JOIN_CODE_CONFLICT", "Join code claim conflicted");
      const value: ClassroomClass = {
        classId: cmd.resourceId,
        ownerLecturerId: input.actor.userId,
        name: input.request.name,
        ...(input.request.linkedCourseId ? { linkedCourseId: input.request.linkedCourseId } : {}),
        classKind: input.request.classKind,
        scheduleState: "DRAFT",
        scheduleVersion: 1,
        maxMembers: input.request.maxMembers,
        state: "ACTIVE",
        activeCodeHash: hashCode,
        version: 1,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      };
      await this.repo.createClass(value);
    }
    const value = await this.repo.getClass(cmd.resourceId);
    if (!value || value.ownerLecturerId !== input.actor.userId) throw unavailable();
    await this.repo.insertLecturer(value);
    await this.repo.readyEvent(cmd.receipt.eventId ?? eventId, occurredAt);
    const data = { ...classDto(value), joinCode: code };
    await this.repo.complete(
      scope,
      hash,
      input.key,
      cmd.operationId,
      { ...cmd.receipt, resource: data },
      201,
    );
    return { data, replayed: false };
  }
  async update(input: {
    classId: string;
    actor: ActorContext;
    request: ClassPatchRequest;
    key: string;
    requestId: string;
  }) {
    await this.lecturer(input.actor, input.requestId);
    await this.link(input.request.linkedCourseId ?? undefined, input.actor.userId, input.requestId);
    const now = new Date(),
      fp = fingerprint(this.secret, {
        method: "PATCH",
        route: "/api/v1/classes/{id}",
        actor: input.actor.userId,
        id: input.classId,
        body: input.request,
      }),
      scope = `CLS-03:${input.actor.userId}:${input.classId}`,
      hash = keyHash(this.secret, input.key),
      op = randomUUID();
    await this.repo.reserve(
      scope,
      hash,
      input.key,
      op,
      input.classId,
      { fingerprint: fp, occurredAt: now.toISOString() },
      now,
    );
    const cmd = await this.requiredCommand(scope, hash, input.key, fp);
    if (cmd.status === "COMPLETE" && cmd.receipt.resource)
      return { data: cmd.receipt.resource, replayed: true };
    const old = await this.owned(input.classId, input.actor.userId);
    if (
      input.request.linkedCourseId !== undefined &&
      old.classKind === "LIVE_COHORT" &&
      old.scheduleState === "PUBLISHED"
    ) {
      const nextLink = input.request.linkedCourseId === null ? undefined : input.request.linkedCourseId;
      if (nextLink !== old.linkedCourseId)
        throw conflict("LINKED_COURSE_FROZEN", "linkedCourseId is frozen once the schedule is published");
    }
    const linkedCourseId =
        input.request.linkedCourseId === null
          ? undefined
          : (input.request.linkedCourseId ?? old.linkedCourseId),
      computed: ClassroomClass = {
        ...old,
        name: input.request.name ?? old.name,
        ...(linkedCourseId ? { linkedCourseId } : {}),
        maxMembers: input.request.maxMembers ?? old.maxMembers,
        version: old.version + 1,
        updatedAt: new Date(cmd.receipt.occurredAt),
      };
    if (!linkedCourseId) delete computed.linkedCourseId;
    const next = restoreTarget(cmd.receipt.target, computed);
    if (!cmd.receipt.target && sameClass(old, next)) {
      const data = classDto(old);
      await this.repo.complete(scope, hash, input.key, cmd.operationId, { ...cmd.receipt, resource: data });
      return { data, replayed: false, noOp: true };
    }
    if (!cmd.receipt.target) {
      await this.repo.checkpoint(scope, hash, input.key, cmd.operationId, {
        ...cmd.receipt,
        oldUpdatedAt: old.updatedAt.toISOString(),
        target: serializeTarget(next),
      });
    }
    if (!sameTarget(old, next) && !(await this.repo.updateClass(old, next))) {
      const recovered = await this.repo.getClass(old.classId);
      if (!recovered || !sameTarget(recovered, next))
        throw conflict("CLASS_VERSION_CONFLICT", "Class changed concurrently");
    }
    const current = (await this.repo.getClass(old.classId)) ?? next;
    await this.repo.deleteLecturer({
      ...old,
      updatedAt: new Date(cmd.receipt.oldUpdatedAt ?? old.updatedAt),
    });
    await this.repo.insertLecturer(current);
    const data = classDto(current);
    await this.repo.complete(scope, hash, input.key, cmd.operationId, {
      ...cmd.receipt,
      oldUpdatedAt: old.updatedAt.toISOString(),
      resource: data,
    });
    return { data, replayed: false, noOp: false };
  }
  async resetCode(input: { classId: string; actor: ActorContext; key: string; requestId: string }) {
    await this.lecturer(input.actor, input.requestId);
    const now = new Date(),
      fp = fingerprint(this.secret, {
        method: "POST",
        route: "/api/v1/classes/{id}/join-code/reset",
        actor: input.actor.userId,
        id: input.classId,
      }),
      scope = `CLS-08:${input.actor.userId}:${input.classId}`,
      hash = keyHash(this.secret, input.key),
      op = randomUUID();
    await this.repo.reserve(
      scope,
      hash,
      input.key,
      op,
      input.classId,
      { fingerprint: fp, occurredAt: now.toISOString() },
      now,
    );
    const cmd = await this.requiredCommand(scope, hash, input.key, fp),
      code = deterministicJoinCode(this.secret, cmd.operationId);
    if (cmd.status === "COMPLETE" && cmd.receipt.resource)
      return { data: cmd.receipt.resource, replayed: true };
    const old = await this.owned(input.classId, input.actor.userId),
      computed = {
        ...old,
        activeCodeHash: codeHash(this.secret, code),
        version: old.version + 1,
        updatedAt: new Date(cmd.receipt.occurredAt),
      },
      next = restoreTarget(cmd.receipt.target, computed);
    if (!cmd.receipt.target)
      await this.repo.checkpoint(scope, hash, input.key, cmd.operationId, {
        ...cmd.receipt,
        oldUpdatedAt: old.updatedAt.toISOString(),
        oldCodeHash: old.activeCodeHash,
        target: serializeTarget(next),
      });
    if (!(await this.repo.claimCode(next.activeCodeHash, old.classId, next.version, next.updatedAt)))
      throw conflict("JOIN_CODE_CONFLICT", "Join code claim conflicted");
    if (!sameTarget(old, next) && !(await this.repo.updateClass(old, next))) {
      const recovered = await this.repo.getClass(old.classId);
      if (recovered?.activeCodeHash !== next.activeCodeHash)
        throw conflict("CLASS_VERSION_CONFLICT", "Class changed concurrently");
    }
    const oldCodeHash = cmd.receipt.oldCodeHash ?? old.activeCodeHash;
    if (oldCodeHash !== next.activeCodeHash) await this.repo.retireCode(oldCodeHash, old.classId);
    const current = (await this.repo.getClass(old.classId)) ?? next;
    await this.repo.deleteLecturer({
      ...old,
      updatedAt: new Date(cmd.receipt.oldUpdatedAt ?? old.updatedAt),
    });
    await this.repo.insertLecturer(current);
    const data = { classId: old.classId, joinCode: code, version: current.version };
    await this.repo.complete(scope, hash, input.key, cmd.operationId, { ...cmd.receipt, resource: data });
    return { data, replayed: false };
  }
  async join(input: { actor: ActorContext; request: ClassJoinRequest; key: string; requestId: string }) {
    if (!input.actor.roles.includes("STUDENT"))
      throw new AppError("STUDENT_REQUIRED", 403, "Student authorization is required");
    const lookup = await this.repo.code(codeHash(this.secret, input.request.code));
    if (!lookup || lookup.state !== "ACTIVE" || (lookup.expiresAt && lookup.expiresAt <= new Date()))
      throw notFound("CLASS_NOT_FOUND", "Class is not available");
    const klass = await this.repo.getClass(lookup.classId);
    if (!klass || klass.state !== "ACTIVE") throw notFound("CLASS_NOT_FOUND", "Class is not available");
    if (klass.classKind === "LIVE_COHORT")
      throw conflict("LIVE_COHORT_JOIN_CODE_DENIED", "LIVE_COHORT cannot be activated by join code");
    const now = new Date(),
      operationId = randomUUID(),
      membershipId = randomUUID(),
      eventId = randomUUID(),
      scope = `CLS-04:${input.actor.userId}:${klass.classId}`,
      hash = keyHash(this.secret, input.key),
      fp = fingerprint(this.secret, {
        method: "POST",
        route: "/api/v1/classes/join",
        actor: input.actor.userId,
        codeHash: codeHash(this.secret, input.request.code),
      });
    await this.repo.reserve(
      scope,
      hash,
      input.key,
      operationId,
      membershipId,
      { fingerprint: fp, eventId, occurredAt: now.toISOString() },
      now,
    );
    const cmd = await this.requiredCommand(scope, hash, input.key, fp);
    if (cmd.status === "COMPLETE" && cmd.receipt.resource)
      return { data: cmd.receipt.resource, replayed: true };
    const existingMembership = await this.repo.membership(klass.classId, input.actor.userId);
    if (
      (!existingMembership || existingMembership.state === "REMOVED") &&
      (await this.repo.roster(klass.classId)).length >= klass.maxMembers
    )
      throw conflict("CLASS_FULL", "Class has reached its member limit");
    if (!existingMembership && klass.linkedCourseId)
      await this.link(klass.linkedCourseId, klass.ownerLecturerId, input.requestId);
    const occurredAt = new Date(cmd.receipt.occurredAt),
      scheduled = klass.scheduleState === "PUBLISHED",
      offeringId = deterministicUuid(this.secret, "private-class-offering", klass.classId),
      reservationId = deterministicUuid(this.secret, "schedule-reservation", cmd.operationId),
      proposed: Membership = {
        membershipId: cmd.resourceId,
        classId: klass.classId,
        studentId: input.actor.userId,
        state: scheduled ? "PENDING" : "ACTIVE",
        source: "JOIN_CODE",
        joinedAt: occurredAt,
        version: 1,
      };
    if (scheduled)
      await this.reserveSchedule({
        operationId: cmd.operationId,
        studentId: input.actor.userId,
        offeringId,
        classId: klass.classId,
      });
    if (existingMembership?.state === "REMOVED") {
      if (existingMembership.source !== "JOIN_CODE")
        throw conflict("MEMBERSHIP_REMOVED", "Purchased membership cannot be restored by join code");
      await this.repo.restoreRemovedMembership(existingMembership, {
        ...proposed,
        version: existingMembership.version + 1,
      });
    } else {
      await this.repo.createMembership(proposed);
    }
    let membership = await this.repo.membership(klass.classId, input.actor.userId);
    if (!membership) throw unavailable();
    if (membership.state === "REMOVED") throw conflict("MEMBERSHIP_REMOVED", "Membership was removed");
    if (scheduled && membership.state === "PENDING") {
      await this.confirmSchedule(reservationId, {
        operationId: deterministicUuid(this.secret, "join-confirm", cmd.operationId),
        orderId: deterministicUuid(this.secret, "join-order", cmd.operationId),
        membershipId: membership.membershipId,
      });
      await this.repo.activateMembership(
        klass.classId,
        input.actor.userId,
        membership.membershipId,
        reservationId,
      );
      membership = (await this.repo.membership(klass.classId, input.actor.userId)) ?? membership;
      if (membership.state !== "ACTIVE") throw unavailable();
    }
    if (membership.membershipId === cmd.resourceId) {
      await this.repo.prepareEvent({
        eventId: cmd.receipt.eventId ?? eventId,
        eventType: "classroom.student.joined.v1",
        aggregateId: membership.membershipId,
        aggregateType: "CLASS_MEMBERSHIP",
        version: membership.version,
        occurredAt,
        correlationId: input.requestId,
        data: {
          classId: klass.classId,
          studentId: input.actor.userId,
          membershipId: membership.membershipId,
          version: membership.version,
        },
      });
      await this.repo.syncMembership(membership, klass.name);
      await this.repo.readyEvent(cmd.receipt.eventId ?? eventId, occurredAt);
    }
    const data = membershipDto(membership);
    await this.repo.complete(
      scope,
      hash,
      input.key,
      cmd.operationId,
      { ...cmd.receipt, resource: data },
      201,
    );
    return { data, replayed: false };
  }
  async announce(input: {
    classId: string;
    actor: ActorContext;
    request: AnnouncementRequest;
    key: string;
    requestId: string;
  }) {
    await this.lecturer(input.actor, input.requestId);
    const klass = await this.owned(input.classId, input.actor.userId),
      now = new Date(),
      op = randomUUID(),
      id = randomUUID(),
      eventId = randomUUID(),
      scope = `CLS-09:${input.actor.userId}:${input.classId}`,
      hash = keyHash(this.secret, input.key),
      fp = fingerprint(this.secret, {
        method: "POST",
        route: "/api/v1/classes/{id}/announcements",
        actor: input.actor.userId,
        id: input.classId,
        body: input.request,
      });
    await this.repo.reserve(
      scope,
      hash,
      input.key,
      op,
      id,
      { fingerprint: fp, eventId, occurredAt: now.toISOString() },
      now,
    );
    const cmd = await this.requiredCommand(scope, hash, input.key, fp);
    if (cmd.status === "COMPLETE" && cmd.receipt.resource)
      return { data: cmd.receipt.resource, replayed: true };
    const occurredAt = new Date(cmd.receipt.occurredAt);
    await this.repo.insertAnnouncement({
      classId: klass.classId,
      announcementId: cmd.resourceId,
      authorId: input.actor.userId,
      title: input.request.title,
      body: input.request.body.replaceAll("<", "").replaceAll(">", ""),
      now: occurredAt,
    });
    const title = input.request.title.normalize("NFC"),
      body = `Thông báo lớp mới: ${title}`.normalize("NFC"),
      recipients = (await this.repo.activeRecipientIds(klass.classId, klass.maxMembers)).filter(
        (recipientId) => recipientId !== input.actor.userId,
      );
    for (const recipientId of recipients) {
      const recipientEventId = deterministicUuid(
        this.secret,
        "class-announcement-recipient-event",
        `${cmd.resourceId}:${recipientId}`,
      );
      await this.repo.prepareEvent({
        eventId: recipientEventId,
        eventType: "system.notification.requested.v1",
        aggregateId: cmd.resourceId,
        aggregateType: "CLASS_ANNOUNCEMENT",
        version: 1,
        occurredAt,
        correlationId: input.requestId,
        data: {
          recipientId,
          notificationType: "CLASS_ANNOUNCEMENT",
          title,
          body,
          source: { announcementId: cmd.resourceId, classId: klass.classId },
        },
      });
      await this.repo.readyEvent(recipientEventId, occurredAt);
    }
    const data = {
      announcementId: cmd.resourceId,
      classId: klass.classId,
      title: input.request.title,
      body: input.request.body.replaceAll("<", "").replaceAll(">", ""),
      createdAt: occurredAt.toISOString(),
      version: 1,
    };
    await this.repo.complete(
      scope,
      hash,
      input.key,
      cmd.operationId,
      { ...cmd.receipt, resource: data },
      201,
    );
    return { data, replayed: false };
  }
  async detail(classId: string, actor: ActorContext, requestId: string) {
    const klass = await this.repo.getClass(classId);
    if (!klass) throw notFound();
    if (actor.userId === klass.ownerLecturerId) {
      await this.lecturer(actor, requestId);
      return classDto(klass);
    }
    if ((await this.repo.membership(classId, actor.userId))?.state !== "ACTIVE")
      throw new AppError("CLASS_ACCESS_REQUIRED", 403, "Class membership is required");
    return classDto(klass);
  }
  async studentClasses(actor: ActorContext) {
    if (!actor.roles.includes("STUDENT"))
      throw new AppError("STUDENT_REQUIRED", 403, "Student authorization is required");
    return (await this.repo.listStudent(actor.userId)).map(classDto);
  }
  async ownedClasses(actor: ActorContext, requestId: string) {
    await this.lecturer(actor, requestId);
    return (await this.repo.listLecturer(actor.userId)).map(classDto);
  }
  async roster(classId: string, actor: ActorContext, requestId: string) {
    if (actor.roles.includes("ADMIN"))
      throw new AppError(
        "ADMIN_ROSTER_DEFERRED",
        403,
        "Canonical Admin authorization is not available in P7.15A",
      );
    await this.lecturer(actor, requestId);
    await this.owned(classId, actor.userId);
    const members = await this.repo.roster(classId);
    const result = [];
    for (let offset = 0; offset < members.length; offset += 16) {
      result.push(
        ...(await Promise.all(
          members.slice(offset, offset + 16).map(async (member) => ({
            ...membershipDto(member),
            ...(await this.clients.student(member.studentId, requestId)),
          })),
        )),
      );
    }
    return result;
  }
  async warnStudent(input: {
    classId: string;
    studentId: string;
    actor: ActorContext;
    request: StudentWarningRequest;
    key: string;
    requestId: string;
  }) {
    await this.lecturer(input.actor, input.requestId);
    const klass = await this.owned(input.classId, input.actor.userId);
    const now = new Date();
    const scope = `CLS-WARN:${input.actor.userId}:${input.classId}:${input.studentId}`;
    const hash = keyHash(this.secret, input.key);
    const operationId = randomUUID();
    const eventId = randomUUID();
    const fp = fingerprint(this.secret, {
      method: "POST",
      route: "/api/v1/classes/{id}/members/{studentId}/warnings",
      actor: input.actor.userId,
      classId: input.classId,
      studentId: input.studentId,
      body: input.request,
    });
    const previous = await this.repo.command(scope, hash, input.key);
    if (previous) {
      const replay = await this.requiredCommand(scope, hash, input.key, fp);
      if (replay.status === "COMPLETE" && replay.receipt.resource)
        return { data: replay.receipt.resource, replayed: true };
    }
    const member = await this.repo.membership(input.classId, input.studentId);
    if (member?.state !== "ACTIVE") throw notFound("MEMBER_NOT_FOUND", "Member is not active");
    await this.repo.reserve(
      scope,
      hash,
      input.key,
      operationId,
      eventId,
      {
        fingerprint: fp,
        eventId,
        occurredAt: now.toISOString(),
      },
      now,
    );
    const cmd = await this.requiredCommand(scope, hash, input.key, fp);
    if (cmd.status === "COMPLETE" && cmd.receipt.resource)
      return { data: cmd.receipt.resource, replayed: true };
    const occurredAt = new Date(cmd.receipt.occurredAt);
    await this.repo.prepareEvent({
      eventId: cmd.receipt.eventId ?? cmd.resourceId,
      eventType: "system.notification.requested.v1",
      aggregateId: cmd.resourceId,
      aggregateType: "CLASS_WARNING",
      version: 1,
      occurredAt,
      correlationId: input.requestId,
      actor: { type: "USER", id: input.actor.userId },
      data: {
        recipientId: input.studentId,
        notificationType: "ACADEMIC",
        title: `Cảnh báo từ lớp ${klass.name}`.slice(0, 200),
        body: input.request.reason,
        source: { sourceType: "CLASS_WARNING", sourceId: cmd.resourceId, classId: input.classId },
      },
    });
    await this.repo.readyEvent(cmd.receipt.eventId ?? cmd.resourceId, occurredAt);
    const data = { warningId: cmd.resourceId, studentId: input.studentId, sentAt: occurredAt.toISOString() };
    await this.repo.complete(
      scope,
      hash,
      input.key,
      cmd.operationId,
      { ...cmd.receipt, resource: data },
      201,
    );
    return { data, replayed: false };
  }
  async removeStudent(input: {
    classId: string;
    studentId: string;
    actor: ActorContext;
    key: string;
    requestId: string;
  }) {
    await this.lecturer(input.actor, input.requestId);
    const klass = await this.owned(input.classId, input.actor.userId);
    const scope = `CLS-REMOVE:${input.actor.userId}:${input.classId}:${input.studentId}`;
    const hash = keyHash(this.secret, input.key);
    const previous = await this.repo.command(scope, hash, input.key);
    const current = await this.repo.membership(input.classId, input.studentId);
    const membershipId = previous?.resourceId ?? current?.membershipId;
    if (!membershipId) throw notFound("MEMBER_NOT_FOUND", "Member is not active");
    const fp = fingerprint(this.secret, {
      method: "DELETE",
      route: "/api/v1/classes/{id}/members/{studentId}",
      actor: input.actor.userId,
      classId: input.classId,
      studentId: input.studentId,
      membershipId,
    });
    if (previous) {
      const replay = await this.requiredCommand(scope, hash, input.key, fp);
      if (replay.status === "COMPLETE" && replay.receipt.resource)
        return { data: replay.receipt.resource, replayed: true };
    }
    if (
      !current ||
      current.membershipId !== membershipId ||
      (current.state !== "ACTIVE" && !(previous && current.state === "REMOVED"))
    )
      throw notFound("MEMBER_NOT_FOUND", "Member is not active");
    const member =
      current.state === "REMOVED"
        ? { ...current, state: "ACTIVE" as const, version: current.version - 1 }
        : current;
    if (member.source !== "JOIN_CODE")
      throw conflict(
        "PURCHASE_MEMBERSHIP_MANAGED_BY_ENROLLMENT",
        "Purchased membership requires enrollment management",
      );
    if (klass.scheduleState === "PUBLISHED")
      throw conflict(
        "PUBLISHED_SCHEDULE_MEMBERSHIP_LOCKED",
        "Published schedule membership cannot be removed",
      );
    const now = new Date();
    const op = randomUUID();
    const eventId = randomUUID();
    await this.repo.reserve(
      scope,
      hash,
      input.key,
      op,
      member.membershipId,
      {
        fingerprint: fp,
        eventId,
        occurredAt: now.toISOString(),
      },
      now,
    );
    const cmd = await this.requiredCommand(scope, hash, input.key, fp);
    if (cmd.status === "COMPLETE" && cmd.receipt.resource)
      return { data: cmd.receipt.resource, replayed: true };
    if (!(await this.repo.removeMembership(member))) {
      const current = await this.repo.membership(input.classId, input.studentId);
      if (current?.membershipId !== member.membershipId || current.state !== "REMOVED")
        throw conflict("MEMBERSHIP_VERSION_CONFLICT", "Membership changed concurrently");
    }
    await this.repo.removeMembershipProjections(member);
    const occurredAt = new Date(cmd.receipt.occurredAt);
    await this.repo.prepareEvent({
      eventId: cmd.receipt.eventId ?? eventId,
      eventType: "classroom.student.removed.v1",
      aggregateId: member.membershipId,
      aggregateType: "CLASS_MEMBERSHIP",
      version: member.version + 1,
      occurredAt,
      correlationId: input.requestId,
      actor: { type: "USER", id: input.actor.userId },
      data: { classId: klass.classId, studentId: member.studentId, membershipId: member.membershipId },
    });
    await this.repo.readyEvent(cmd.receipt.eventId ?? eventId, occurredAt);
    const data = { classId: klass.classId, studentId: member.studentId, removed: true };
    await this.repo.complete(scope, hash, input.key, cmd.operationId, { ...cmd.receipt, resource: data });
    return { data, replayed: false };
  }
  async announcements(classId: string, actor: ActorContext, requestId: string, month: string) {
    await this.detail(classId, actor, requestId);
    return this.repo.listAnnouncements(classId, month);
  }
  async createSessions(input: {
    classId: string;
    actor: ActorContext;
    request: SessionWriteRequest;
    key: string;
    requestId: string;
  }) {
    await this.lecturer(input.actor, input.requestId);
    const klass = await this.owned(input.classId, input.actor.userId);
    this.requireDraftSchedule(klass);
    const startAt = new Date(input.request.startAt),
      endAt = new Date(input.request.endAt);
    this.validateTimes(startAt, endAt, input.request.timezone);
    const now = new Date(),
      scope = `CLS-11:${input.actor.userId}:${input.classId}`,
      hash = keyHash(this.secret, input.key),
      op = randomUUID(),
      fp = fingerprint(this.secret, {
        method: "POST",
        route: "/api/v1/classes/{id}/sessions",
        actor: input.actor.userId,
        id: input.classId,
        body: input.request,
      });
    await this.repo.reserve(
      scope,
      hash,
      input.key,
      op,
      input.classId,
      { fingerprint: fp, occurredAt: now.toISOString() },
      now,
    );
    const cmd = await this.requiredCommand(scope, hash, input.key, fp);
    if (cmd.status === "COMPLETE" && cmd.receipt.resource)
      return { data: cmd.receipt.resource, replayed: true };
    const occurredAt = new Date(cmd.receipt.occurredAt);
    const instances = input.request.recurrence
      ? materializeRecurrence({ startAt, endAt, timezone: input.request.timezone }, input.request.recurrence)
      : [{ startAt, endAt }];
    let sessionIds: string[];
    if (cmd.receipt.target) {
      sessionIds = (cmd.receipt.target.sessionIds as string[] | undefined) ?? [];
    } else {
      if (instances === "RECURRENCE_OVERFLOW" || instances.length > MAX_SESSIONS_PER_CLASS)
        throw conflict("SESSION_LIMIT_EXCEEDED", "Recurrence materializes more than 200 sessions");
      const existing = await this.repo.countClassSessions(input.classId);
      if (existing + instances.length > MAX_SESSIONS_PER_CLASS)
        throw conflict("SESSION_LIMIT_EXCEEDED", "Class schedule exceeds 200 sessions");
      const batchByDate = new Map<string, number>();
      for (const i of instances)
        for (const day of utcDatesTouched(i.startAt, i.endAt))
          batchByDate.set(day, (batchByDate.get(day) ?? 0) + 1);
      for (const [day, added] of batchByDate) {
        const current = await this.repo.countDatePartition(input.classId, day);
        if (current + added > MAX_SESSIONS_PER_CLASS_DATE)
          throw conflict("SESSION_DATE_LIMIT_EXCEEDED", "A class date may hold at most 100 sessions");
      }
      for (const i of instances) await this.requireNoOverlap(input.classId, i.startAt, i.endAt);
      sessionIds = instances.map((_, index) => deterministicSessionId(this.secret, cmd.operationId, index));
      await this.repo.checkpoint(scope, hash, input.key, cmd.operationId, {
        ...cmd.receipt,
        target: { sessionIds },
      });
    }
    if (instances === "RECURRENCE_OVERFLOW" || instances.length !== sessionIds.length) throw unavailable();
    const written: ClassSession[] = [];
    for (let index = 0; index < sessionIds.length; index++) {
      const instance = instances[index];
      if (!instance) throw unavailable();
      const proposed: ClassSession = {
        sessionId: sessionIds[index] ?? "",
        classId: klass.classId,
        title: input.request.title,
        startAt: instance.startAt,
        endAt: instance.endAt,
        mode: input.request.mode,
        status: "DRAFT",
        timezone: input.request.timezone,
        ...(input.request.meetingProvider ? { meetingProvider: input.request.meetingProvider } : {}),
        ...(input.request.meetingUrl ? { meetingUrl: input.request.meetingUrl } : {}),
        ...(input.request.location ? { location: input.request.location } : {}),
        scheduleVersion: klass.scheduleVersion,
        recordVersion: 1,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      };
      await this.repo.createSession(proposed);
      const stored = await this.repo.getSession(proposed.sessionId);
      if (!stored || stored.classId !== klass.classId) throw unavailable();
      await this.repo.insertSessionProjections(stored);
      written.push(stored);
    }
    const data = { sessions: written.map(sessionDto), sessionCount: written.length };
    await this.repo.complete(
      scope,
      hash,
      input.key,
      cmd.operationId,
      { ...cmd.receipt, resource: data },
      201,
    );
    return { data, replayed: false };
  }
  async updateSession(input: {
    classId: string;
    sessionId: string;
    actor: ActorContext;
    request: SessionPatchRequest;
    key: string;
    requestId: string;
  }) {
    await this.lecturer(input.actor, input.requestId);
    const klass = await this.owned(input.classId, input.actor.userId);
    this.requireDraftSchedule(klass);
    const session = await this.repo.getSession(input.sessionId);
    if (!session || session.classId !== klass.classId)
      throw notFound("SESSION_NOT_FOUND", "Session not found");
    if (session.status !== "DRAFT") {
      if (input.request.status === "CANCELLED")
        throw conflict(
          "SCHEDULED_CANCEL_DEFERRED",
          "SCHEDULED cancellation requires P7.16 schedule reconciliation",
        );
      throw conflict("SESSION_NOT_EDITABLE", "Only DRAFT sessions may be changed");
    }
    const now = new Date(),
      scope = `CLS-12:${input.actor.userId}:${input.classId}:${input.sessionId}`,
      hash = keyHash(this.secret, input.key),
      op = randomUUID(),
      fp = fingerprint(this.secret, {
        method: "PATCH",
        route: "/api/v1/classes/{id}/sessions/{sessionId}",
        actor: input.actor.userId,
        id: input.classId,
        sessionId: input.sessionId,
        body: input.request,
      });
    await this.repo.reserve(
      scope,
      hash,
      input.key,
      op,
      input.sessionId,
      { fingerprint: fp, occurredAt: now.toISOString() },
      now,
    );
    const cmd = await this.requiredCommand(scope, hash, input.key, fp);
    if (cmd.status === "COMPLETE" && cmd.receipt.resource)
      return { data: cmd.receipt.resource, replayed: true };
    const occurredAt = new Date(cmd.receipt.occurredAt);
    if (input.request.status === "CANCELLED") {
      const next: ClassSession = {
        ...session,
        status: "CANCELLED",
        recordVersion: session.recordVersion + 1,
        updatedAt: occurredAt,
      };
      if (!(await this.repo.cancelSession(session, next))) {
        const recovered = await this.repo.getSession(session.sessionId);
        if (recovered?.status !== "CANCELLED" || recovered.recordVersion !== next.recordVersion)
          throw conflict("SESSION_VERSION_CONFLICT", "Session was changed concurrently");
      }
      const current = (await this.repo.getSession(session.sessionId)) ?? next;
      await this.repo.updateSessionProjectionStatus(current);
      const data = sessionDto(current);
      await this.repo.complete(scope, hash, input.key, cmd.operationId, { ...cmd.receipt, resource: data });
      return { data, replayed: false, noOp: false };
    }
    const computed: ClassSession = {
      ...session,
      title: input.request.title ?? session.title,
      startAt: input.request.startAt ? new Date(input.request.startAt) : session.startAt,
      endAt: input.request.endAt ? new Date(input.request.endAt) : session.endAt,
      timezone: input.request.timezone ?? session.timezone,
      ...(input.request.meetingProvider !== undefined
        ? { meetingProvider: input.request.meetingProvider }
        : {}),
      ...(input.request.meetingUrl !== undefined ? { meetingUrl: input.request.meetingUrl } : {}),
      ...(input.request.location !== undefined ? { location: input.request.location } : {}),
      recordVersion: session.recordVersion + 1,
      updatedAt: occurredAt,
    };
    this.validateTimes(computed.startAt, computed.endAt, computed.timezone);
    const next = cmd.receipt.target ? restoreSessionTarget(cmd.receipt.target, session) : computed;
    if (!cmd.receipt.target && sameSession(session, next)) {
      const data = sessionDto(session);
      await this.repo.complete(scope, hash, input.key, cmd.operationId, { ...cmd.receipt, resource: data });
      return { data, replayed: false, noOp: true };
    }
    if (!cmd.receipt.target) {
      await this.requireNoOverlap(klass.classId, next.startAt, next.endAt, session.sessionId);
      const oldDates = new Set(utcDatesTouched(session.startAt, session.endAt));
      for (const day of utcDatesTouched(next.startAt, next.endAt)) {
        if (oldDates.has(day)) continue;
        const current = await this.repo.countDatePartition(klass.classId, day);
        if (current + 1 > MAX_SESSIONS_PER_CLASS_DATE)
          throw conflict("SESSION_DATE_LIMIT_EXCEEDED", "A class date may hold at most 100 sessions");
      }
      await this.repo.checkpoint(scope, hash, input.key, cmd.operationId, {
        ...cmd.receipt,
        target: serializeSessionTarget(next),
      });
    }
    if (!(await this.repo.updateSession(session, next))) {
      const recovered = await this.repo.getSession(session.sessionId);
      if (!recovered || recovered.recordVersion !== next.recordVersion || !sameSession(recovered, next))
        throw conflict("SESSION_VERSION_CONFLICT", "Session was changed concurrently");
    }
    const current = (await this.repo.getSession(session.sessionId)) ?? next;
    await this.repo.deleteSessionProjections(session);
    await this.repo.insertSessionProjections(current);
    const data = sessionDto(current);
    await this.repo.complete(scope, hash, input.key, cmd.operationId, { ...cmd.receipt, resource: data });
    return { data, replayed: false, noOp: false };
  }
  async listSessions(classId: string, actor: ActorContext, requestId: string, from: string, to: string) {
    const klass = await this.repo.getClass(classId);
    if (!klass) throw notFound();
    if (actor.userId === klass.ownerLecturerId) await this.lecturer(actor, requestId);
    else if ((await this.repo.membership(classId, actor.userId))?.state !== "ACTIVE")
      throw new AppError("CLASS_ACCESS_REQUIRED", 403, "Class membership is required");
    if (from > to) throw new AppError("INVALID_DATE_RANGE", 400, "from must not be after to");
    const days = daysBetween(from, to);
    if (days.length > MAX_SCHEDULE_LIST_DAYS)
      throw new AppError("INVALID_DATE_RANGE", 400, "Schedule range is limited to 31 days");
    const seen = new Map<string, ClassSession>();
    for (const day of days)
      for (const row of await this.repo.listDatePartition(classId, day)) {
        if (seen.has(row.sessionId)) continue;
        const session = await this.repo.getSession(row.sessionId);
        if (session) seen.set(row.sessionId, session);
      }
    return [...seen.values()]
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.sessionId.localeCompare(b.sessionId))
      .map(sessionDto);
  }
  async sessionDetail(sessionId: string, actor: ActorContext, requestId: string) {
    const session = await this.repo.getSession(sessionId);
    if (!session) throw notFound("SESSION_NOT_FOUND", "Session not found");
    const klass = await this.repo.getClass(session.classId);
    if (!klass) throw unavailable();
    if (actor.userId === klass.ownerLecturerId) await this.lecturer(actor, requestId);
    else if ((await this.repo.membership(klass.classId, actor.userId))?.state !== "ACTIVE")
      throw new AppError("CLASS_ACCESS_REQUIRED", 403, "Class membership is required");
    const dto = sessionDto(session);
    if (session.meetingUrl && inMeetingWindow(session.startAt, session.endAt, new Date()))
      return { ...dto, meetingUrl: session.meetingUrl };
    return dto;
  }
  async publishSchedule(input: { classId: string; actor: ActorContext; key: string; requestId: string }) {
    await this.lecturer(input.actor, input.requestId);
    const klass = await this.owned(input.classId, input.actor.userId);
    if (klass.state !== "ACTIVE") throw conflict("CLASS_NOT_ACTIVE", "Class must be ACTIVE");
    const now = new Date(),
      scope = `CLS-20:${input.actor.userId}:${input.classId}`,
      hash = keyHash(this.secret, input.key),
      op = randomUUID(),
      fp = fingerprint(this.secret, {
        method: "POST",
        route: "/api/v1/classes/{id}/schedule/publish",
        actor: input.actor.userId,
        id: input.classId,
      });
    await this.repo.reserve(
      scope,
      hash,
      input.key,
      op,
      input.classId,
      { fingerprint: fp, occurredAt: now.toISOString() },
      now,
    );
    const cmd = await this.requiredCommand(scope, hash, input.key, fp);
    if (cmd.status === "COMPLETE" && cmd.receipt.resource)
      return { data: cmd.receipt.resource, replayed: true };
    const occurredAt = new Date(cmd.receipt.occurredAt);
    let target = cmd.receipt.target as unknown as ScheduleTarget | undefined;
    if (!target) {
      if (klass.scheduleState !== "DRAFT")
        throw conflict("SCHEDULE_ALREADY_PUBLISHED", "Published schedule is immutable");
      if (klass.classKind !== "LIVE_COHORT" && (await this.repo.hasActiveMembers(klass.classId)))
        throw conflict(
          "SCHEDULE_EXISTING_MEMBERS",
          "A Class with ACTIVE members cannot newly publish a schedule",
        );
      const ids = await this.repo.listClassSessionIds(klass.classId, MAX_SESSIONS_PER_CLASS + 1);
      const members: ClassSession[] = [];
      for (const id of ids) {
        const s = await this.repo.getSession(id);
        if (!s) throw unavailable();
        if (s.status === "DRAFT" || s.status === "SCHEDULED") members.push(s);
      }
      if (members.length === 0)
        throw new AppError("SCHEDULE_EMPTY", 422, "Schedule requires at least one DRAFT session");
      if (members.length > MAX_SESSIONS_PER_CLASS)
        throw conflict("SESSION_LIMIT_EXCEEDED", "Class schedule exceeds 200 sessions");
      members.sort(
        (a, b) => a.startAt.getTime() - b.startAt.getTime() || a.sessionId.localeCompare(b.sessionId),
      );
      for (let i = 1; i < members.length; i++) {
        const a = members[i - 1],
          b = members[i];
        if (a && b && sessionsOverlap(a.startAt, a.endAt, b.startAt, b.endAt))
          throw conflict("SESSION_OVERLAP_CONFLICT", "Scheduled sessions must not overlap");
      }
      const sessionIds = members.map((s) => s.sessionId);
      target = {
        scheduleVersion: klass.scheduleVersion + 1,
        sessionIds,
        checksum: createHash("sha256").update(sessionIds.join(",")).digest("hex"),
        sessionCount: members.length,
        firstStartAt: (members[0] as ClassSession).startAt.toISOString(),
        lastEndAt: members
          .reduce((m, s) => (s.endAt > m ? s.endAt : m), members[0]?.endAt ?? new Date())
          .toISOString(),
      };
      await this.repo.checkpoint(scope, hash, input.key, cmd.operationId, {
        ...cmd.receipt,
        target: { ...target },
      });
    }
    for (const id of target.sessionIds) {
      if (!(await this.repo.markSessionScheduled(id, target.scheduleVersion, occurredAt))) {
        const s = await this.repo.getSession(id);
        if (!s) throw unavailable();
        if (s.status !== "SCHEDULED" || s.scheduleVersion !== target.scheduleVersion)
          await this.repo.alignSessionScheduleVersion(id, target.scheduleVersion, occurredAt);
      }
    }
    for (const id of target.sessionIds) {
      const s = await this.repo.getSession(id);
      if (!s || s.status !== "SCHEDULED" || s.scheduleVersion !== target.scheduleVersion) throw unavailable();
      await this.repo.updateSessionProjectionStatus(s);
    }
    let won = false;
    try {
      won = await this.repo.publishSchedule(klass, target.scheduleVersion, occurredAt);
    } catch {
      // Resolve an ambiguous schedule LWT through the Q-CLS-001 read-back below.
    }
    if (!won) {
      const current = await this.repo.getClass(klass.classId);
      if (current?.scheduleState === "PUBLISHED" && current.scheduleVersion === target.scheduleVersion) {
        // An earlier attempt of this exact operation already applied the LWT.
      } else if (current?.scheduleState === "PUBLISHED") {
        for (const id of target.sessionIds)
          await this.repo.alignSessionScheduleVersion(id, current.scheduleVersion, occurredAt);
        throw conflict("SCHEDULE_ALREADY_PUBLISHED", "Schedule was published concurrently");
      } else {
        throw conflict("CLASS_VERSION_CONFLICT", "Class was changed concurrently");
      }
    }
    await this.repo.writeManifest({
      classId: klass.classId,
      scheduleVersion: target.scheduleVersion,
      sessionCount: target.sessionCount,
      checksum: target.checksum,
      firstStartAt: new Date(target.firstStartAt),
      lastEndAt: new Date(target.lastEndAt),
      publishedAt: occurredAt,
    });
    const data = {
      classId: klass.classId,
      scheduleState: "PUBLISHED",
      scheduleVersion: target.scheduleVersion,
      sessionCount: target.sessionCount,
      firstStartAt: target.firstStartAt,
      lastEndAt: target.lastEndAt,
      publishedAt: occurredAt.toISOString(),
    };
    await this.repo.complete(scope, hash, input.key, cmd.operationId, { ...cmd.receipt, resource: data });
    return { data, replayed: false };
  }
  async offeringContext(classId: string) {
    const klass = await this.repo.getClass(classId);
    if (!klass || klass.state !== "ACTIVE") return undefined;
    let sessionCount: number;
    const manifest = await this.repo.getManifest(classId);
    if (manifest) sessionCount = manifest.sessionCount;
    else {
      sessionCount = 0;
      for (const id of await this.repo.listClassSessionIds(classId, MAX_SESSIONS_PER_CLASS + 1)) {
        const s = await this.repo.getSession(id);
        if (s && s.status !== "CANCELLED") sessionCount += 1;
      }
    }
    return {
      classId: klass.classId,
      ...(klass.linkedCourseId ? { linkedCourseId: klass.linkedCourseId } : {}),
      ownerLecturerId: klass.ownerLecturerId,
      classKind: klass.classKind,
      classState: klass.state,
      scheduleState: klass.scheduleState,
      scheduleVersion: klass.scheduleVersion,
      sessionCount,
    };
  }
  private requireDraftSchedule(klass: ClassroomClass) {
    if (klass.state !== "ACTIVE") throw conflict("CLASS_NOT_ACTIVE", "Class must be ACTIVE");
    if (klass.scheduleState !== "DRAFT")
      throw conflict("SCHEDULE_PUBLISHED_FROZEN", "Published schedule is immutable until P7.16");
  }
  private validateTimes(startAt: Date, endAt: Date, timezone: string) {
    const issues: { field: string; reason: string }[] = [];
    if (!isValidTimezone(timezone))
      issues.push({ field: "timezone", reason: "timezone must be a valid IANA zone" });
    if (endAt.getTime() <= startAt.getTime())
      issues.push({ field: "endAt", reason: "endAt must be after startAt" });
    else if (endAt.getTime() - startAt.getTime() > MAX_SESSION_DURATION_MS)
      issues.push({ field: "endAt", reason: "Session duration must not exceed 12 hours" });
    if (issues.length)
      throw new AppError(
        "CLASSROOM_VALIDATION_FAILED",
        422,
        "Classroom request validation failed",
        false,
        issues,
      );
  }
  private async requireNoOverlap(classId: string, startAt: Date, endAt: Date, excludeSessionId?: string) {
    for (const day of utcDatesTouched(startAt, endAt))
      for (const row of await this.repo.listDatePartition(classId, day)) {
        if (row.sessionId === excludeSessionId || row.status === "CANCELLED") continue;
        if (sessionsOverlap(startAt, endAt, row.startAt, row.endAt))
          throw conflict("SESSION_OVERLAP_CONFLICT", "Session overlaps an existing session");
      }
  }
  private async requiredCommand(scope: string, hash: number, key: string, fp: string) {
    const cmd = await this.repo.command(scope, hash, key);
    if (!cmd) throw unavailable();
    if (cmd.receipt.fingerprint !== fp)
      throw conflict("IDEMPOTENCY_CONFLICT", "Idempotency key was used with another request");
    return cmd;
  }
  private async lecturer(actor: ActorContext, requestId: string) {
    if (!actor.roles.includes("LECTURER"))
      throw new AppError("LECTURER_REQUIRED", 403, "Eligible Lecturer authorization is required");
    try {
      await this.clients.lecturer(actor.userId, requestId);
    } catch (error) {
      if (error instanceof ClassroomDependencyError && error.code === "REJECTED")
        throw new AppError("LECTURER_NOT_ELIGIBLE", 403, "Eligible Lecturer authorization is required");
      throw unavailable("IDENTITY_SERVICE_UNAVAILABLE");
    }
  }
  private async link(courseId: string | undefined, owner: string, requestId: string) {
    if (!courseId) return;
    try {
      const course = await this.clients.course(courseId, requestId);
      if (course.ownerLecturerId !== owner)
        throw new AppError("COURSE_OWNER_REQUIRED", 403, "Linked Course owner authorization is required");
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof ClassroomDependencyError && error.code === "REJECTED")
        throw new AppError("COURSE_NOT_LINKABLE", 409, "Linked Course is not available");
      throw unavailable("LEARNING_SERVICE_UNAVAILABLE");
    }
  }
  private async owned(id: string, owner: string) {
    const value = await this.repo.getClass(id);
    if (!value) throw notFound();
    if (value.ownerLecturerId !== owner)
      throw new AppError("CLASS_OWNER_REQUIRED", 403, "Class owner authorization is required");
    return value;
  }
}

function samePurchaseMembership(current: Membership, expected: Membership) {
  return (
    current.membershipId === expected.membershipId &&
    current.classId === expected.classId &&
    current.studentId === expected.studentId &&
    current.source === "PURCHASE" &&
    current.offeringId === expected.offeringId &&
    current.enrollmentId === expected.enrollmentId &&
    current.scheduleReservationId === expected.scheduleReservationId
  );
}
function sameClass(a: ClassroomClass, b: ClassroomClass) {
  return a.name === b.name && a.linkedCourseId === b.linkedCourseId && a.maxMembers === b.maxMembers;
}
function serializeTarget(value: ClassroomClass): Record<string, unknown> {
  return {
    name: value.name,
    linkedCourseId: value.linkedCourseId ?? null,
    maxMembers: value.maxMembers,
    activeCodeHash: value.activeCodeHash,
    version: value.version,
    updatedAt: value.updatedAt.toISOString(),
  };
}
function restoreTarget(
  target: Record<string, unknown> | undefined,
  fallback: ClassroomClass,
): ClassroomClass {
  if (!target) return fallback;
  return {
    ...fallback,
    name: String(target.name),
    ...(typeof target.linkedCourseId === "string" ? { linkedCourseId: target.linkedCourseId } : {}),
    maxMembers: Number(target.maxMembers),
    activeCodeHash: String(target.activeCodeHash),
    version: Number(target.version),
    updatedAt: new Date(String(target.updatedAt)),
  };
}
function sameTarget(value: ClassroomClass, target: ClassroomClass) {
  return (
    value.name === target.name &&
    value.linkedCourseId === target.linkedCourseId &&
    value.maxMembers === target.maxMembers &&
    value.activeCodeHash === target.activeCodeHash &&
    value.version === target.version &&
    value.updatedAt.getTime() === target.updatedAt.getTime()
  );
}
function conflict(code: string, message: string) {
  return new AppError(code, 409, message);
}
function notFound(code = "CLASS_NOT_FOUND", message = "Class not found") {
  return new AppError(code, 404, message);
}
function unavailable(code = "CLASSROOM_SERVICE_UNAVAILABLE") {
  return new AppError(code, 503, "Classroom service is temporarily unavailable", true);
}
function reservationDto(v: ScheduleReservation) {
  return {
    reservationId: v.reservationId,
    state: v.state,
    expiresAt: v.expiresAt.toISOString(),
    scheduleVersion: v.scheduleVersion,
  };
}
interface ScheduleTarget {
  scheduleVersion: number;
  sessionIds: string[];
  checksum: string;
  sessionCount: number;
  firstStartAt: string;
  lastEndAt: string;
}
interface ManualAttendanceTarget {
  sessionId: string;
  studentId: string;
  attendanceStatus: "PRESENT" | "ABSENT" | "EXCUSED";
  manualNote?: string;
  expectedVersion: number;
  attendanceVersion: number;
  connectedDurationSeconds: number;
  updatedAt: string;
}
function manualTargetRow(target: ManualAttendanceTarget): AttendanceRow {
  return {
    sessionId: target.sessionId,
    studentId: target.studentId,
    attendanceStatus: target.attendanceStatus,
    source: "MANUAL_OFFLINE",
    ...(target.manualNote ? { manualNote: target.manualNote } : {}),
    connectedDurationSeconds: target.connectedDurationSeconds,
    presenceState: "OFFLINE",
    attendanceVersion: target.attendanceVersion,
    updatedAt: new Date(target.updatedAt),
  };
}
function sameManualAttendance(current: AttendanceRow, intended: AttendanceRow) {
  return (
    current.sessionId === intended.sessionId &&
    current.studentId === intended.studentId &&
    current.attendanceStatus === intended.attendanceStatus &&
    current.source === "MANUAL_OFFLINE" &&
    current.manualNote === intended.manualNote &&
    current.presenceState === "OFFLINE" &&
    current.connectedDurationSeconds === intended.connectedDurationSeconds &&
    current.attendanceVersion === intended.attendanceVersion &&
    current.updatedAt.getTime() === intended.updatedAt.getTime()
  );
}
function sameManualHistory(current: AttendanceHistoryRow, intended: AttendanceHistoryRow) {
  return (
    current.studentId === intended.studentId &&
    current.sessionId === intended.sessionId &&
    current.classId === intended.classId &&
    current.startAt.getTime() === intended.startAt.getTime() &&
    current.mode === "OFFLINE" &&
    current.attendanceStatus === intended.attendanceStatus &&
    current.manualNote === intended.manualNote &&
    current.connectedDurationSeconds === intended.connectedDurationSeconds &&
    current.attendanceVersion === intended.attendanceVersion
  );
}
function serializeSessionTarget(v: ClassSession): Record<string, unknown> {
  return {
    title: v.title,
    startAt: v.startAt.toISOString(),
    endAt: v.endAt.toISOString(),
    timezone: v.timezone,
    meetingProvider: v.meetingProvider ?? null,
    meetingUrl: v.meetingUrl ?? null,
    location: v.location ?? null,
    recordVersion: v.recordVersion,
    updatedAt: v.updatedAt.toISOString(),
  };
}
function restoreSessionTarget(target: Record<string, unknown>, base: ClassSession): ClassSession {
  const next: ClassSession = {
    ...base,
    title: String(target.title),
    startAt: new Date(String(target.startAt)),
    endAt: new Date(String(target.endAt)),
    timezone: String(target.timezone),
    recordVersion: Number(target.recordVersion),
    updatedAt: new Date(String(target.updatedAt)),
  };
  delete next.meetingProvider;
  delete next.meetingUrl;
  delete next.location;
  if (typeof target.meetingProvider === "string") next.meetingProvider = target.meetingProvider;
  if (typeof target.meetingUrl === "string") next.meetingUrl = target.meetingUrl;
  if (typeof target.location === "string") next.location = target.location;
  return next;
}
function sameSession(a: ClassSession, b: ClassSession) {
  return (
    a.title === b.title &&
    a.startAt.getTime() === b.startAt.getTime() &&
    a.endAt.getTime() === b.endAt.getTime() &&
    a.timezone === b.timezone &&
    a.mode === b.mode &&
    a.meetingProvider === b.meetingProvider &&
    a.meetingUrl === b.meetingUrl &&
    a.location === b.location
  );
}
function daysBetween(from: string, to: string) {
  const out: string[] = [];
  let t = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return out;
}

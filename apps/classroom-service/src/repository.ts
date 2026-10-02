import { createHash } from "node:crypto";
import { types } from "cassandra-driver";
import type { EventEnvelope } from "../../../packages/contracts/src/index.js";
import type { CassandraClient } from "../../../packages/cassandra/src/index.js";
import {
  eventShard,
  utcDatesTouched,
  type ClassSession,
  type ClassroomClass,
  type CommandReceipt,
  type AttendanceHistoryRow,
  type AttendanceRow,
  type PresenceCheckpoint,
  type Membership,
  type ScheduleReservation,
  type ScheduleSegment,
} from "./model.js";
const LQ = "LOCAL_QUORUM" as const,
  LS = "LOCAL_SERIAL" as const;
const uuid = (v: string) => types.Uuid.fromString(v),
  long = (v: number) => types.Long.fromNumber(v),
  date = (v: unknown) => {
    if (!(v instanceof Date)) throw new Error("INVALID_DATE");
    return v;
  },
  num = (v: unknown) =>
    v && typeof v === "object" && "toNumber" in v ? (v as { toNumber(): number }).toNumber() : Number(v);
export interface DueClassroomEvent {
  dueDay: string;
  shard: number;
  nextAttemptAt: Date;
  eventId: string;
  event: EventEnvelope;
  state: string;
  retryCount: number;
  leaseFence: number;
  leaseUntil?: Date;
}
export class ClassroomRepository {
  public constructor(private readonly db: CassandraClient) {}
  async reserve(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    resourceId: string,
    receipt: CommandReceipt,
    now: Date,
  ) {
    const r = await this.db.execute(
      `INSERT INTO idempotency_by_scope_key (scope,key_hash,idempotency_key,operation_id,resource_id,result_code,status,result_checksum,created_at,expires_at) VALUES (?,?,?,?,?,0,'IN_PROGRESS',?,?,?) IF NOT EXISTS`,
      [
        scope,
        hash,
        key,
        uuid(operationId),
        uuid(resourceId),
        JSON.stringify(receipt),
        now,
        new Date(now.getTime() + 86400000),
      ],
      LQ,
      LS,
    );
    return r[0]?.["[applied]"] === true;
  }
  async command(scope: string, hash: number, key: string) {
    const r = (
      await this.db.execute(
        `SELECT operation_id,resource_id,status,result_checksum FROM idempotency_by_scope_key WHERE scope=? AND key_hash=? AND idempotency_key=?`,
        [scope, hash, key],
        LQ,
      )
    )[0];
    return r
      ? {
          operationId: String(r.operation_id),
          resourceId: String(r.resource_id),
          status: String(r.status),
          receipt: JSON.parse(String(r.result_checksum)) as CommandReceipt,
        }
      : undefined;
  }
  async checkpoint(scope: string, hash: number, key: string, operationId: string, receipt: CommandReceipt) {
    const r = await this.db.execute(
      `UPDATE idempotency_by_scope_key SET result_checksum=? WHERE scope=? AND key_hash=? AND idempotency_key=? IF operation_id=? AND status='IN_PROGRESS'`,
      [JSON.stringify(receipt), scope, hash, key, uuid(operationId)],
      LQ,
      LS,
    );
    if (r[0]?.["[applied]"] !== true) throw new Error("COMMAND_CHECKPOINT_CONFLICT");
  }
  async complete(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    receipt: CommandReceipt,
    status = 200,
  ) {
    const r = await this.db.execute(
      `UPDATE idempotency_by_scope_key SET status='COMPLETE',result_code=?,result_checksum=? WHERE scope=? AND key_hash=? AND idempotency_key=? IF operation_id=?`,
      [status, JSON.stringify(receipt), scope, hash, key, uuid(operationId)],
      LQ,
      LS,
    );
    if (r[0]?.["[applied]"] !== true) throw new Error("COMMAND_COMPLETE_CONFLICT");
  }
  async getClass(id: string) {
    const r = (
      await this.db.execute(
        `SELECT class_id,owner_lecturer_id,name,linked_course_id,class_kind,schedule_state,schedule_version,max_members,photo_data_url,cover_data_url,state,active_code_hash,version,created_at,updated_at FROM class_by_id WHERE class_id=?`,
        [uuid(id)],
        LQ,
      )
    )[0];
    return r ? classRow(r) : undefined;
  }
  async createClass(v: ClassroomClass) {
    const r = await this.db.execute(
      `INSERT INTO class_by_id (class_id,owner_lecturer_id,name,linked_course_id,class_kind,schedule_state,schedule_version,max_members,state,active_code_hash,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
      [
        uuid(v.classId),
        uuid(v.ownerLecturerId),
        v.name,
        v.linkedCourseId ? uuid(v.linkedCourseId) : null,
        v.classKind,
        v.scheduleState,
        long(v.scheduleVersion),
        v.maxMembers,
        v.state,
        v.activeCodeHash,
        long(v.version),
        v.createdAt,
        v.updatedAt,
      ],
      LQ,
      LS,
    );
    return r[0]?.["[applied]"] === true;
  }
  async claimCode(code: string, classId: string, version: number, now: Date) {
    const r = await this.db.execute(
      `INSERT INTO class_by_active_code (normalized_code,class_id,state,code_version,claimed_at) VALUES (?,?,'ACTIVE',?,?) IF NOT EXISTS`,
      [code, uuid(classId), long(version), now],
      LQ,
      LS,
    );
    if (r[0]?.["[applied]"] === true) return true;
    const existing = await this.code(code);
    return existing?.classId === classId && existing.version === version && existing.state === "ACTIVE";
  }
  async code(code: string) {
    const r = (
      await this.db.execute(
        `SELECT class_id,state,code_version,expires_at FROM class_by_active_code WHERE normalized_code=?`,
        [code],
        LQ,
      )
    )[0];
    return r
      ? {
          classId: String(r.class_id),
          state: String(r.state),
          version: num(r.code_version),
          ...(r.expires_at ? { expiresAt: date(r.expires_at) } : {}),
        }
      : undefined;
  }
  async retireCode(code: string, classId: string) {
    await this.db.execute(
      `UPDATE class_by_active_code SET state='RETIRED' WHERE normalized_code=? IF class_id=? AND state='ACTIVE'`,
      [code, uuid(classId)],
      LQ,
      LS,
    );
  }
  async insertLecturer(v: ClassroomClass) {
    await this.db.execute(
      `INSERT INTO classes_by_lecturer (lecturer_id,updated_at,class_id,class_name,state,class_version) VALUES (?,?,?,?,?,?)`,
      [uuid(v.ownerLecturerId), v.updatedAt, uuid(v.classId), v.name, v.state, long(v.version)],
      LQ,
    );
  }
  async deleteLecturer(v: ClassroomClass) {
    await this.db.execute(
      `DELETE FROM classes_by_lecturer WHERE lecturer_id=? AND updated_at=? AND class_id=?`,
      [uuid(v.ownerLecturerId), v.updatedAt, uuid(v.classId)],
      LQ,
    );
  }
  async updateClass(old: ClassroomClass, next: ClassroomClass) {
    const r = await this.db.execute(
      `UPDATE class_by_id SET name=?,linked_course_id=?,max_members=?,photo_data_url=?,cover_data_url=?,active_code_hash=?,version=?,updated_at=? WHERE class_id=? IF owner_lecturer_id=? AND state='ACTIVE' AND version=?`,
      [
        next.name,
        next.linkedCourseId ? uuid(next.linkedCourseId) : null,
        next.maxMembers,
        next.photoDataUrl ?? null,
        next.coverDataUrl ?? null,
        next.activeCodeHash,
        long(next.version),
        next.updatedAt,
        uuid(next.classId),
        uuid(old.ownerLecturerId),
        long(old.version),
      ],
      LQ,
      LS,
    );
    return r[0]?.["[applied]"] === true;
  }
  async closeClass(old: ClassroomClass, now: Date) {
    const r = await this.db.execute(
      `UPDATE class_by_id SET state='CLOSED',version=?,updated_at=? WHERE class_id=? IF owner_lecturer_id=? AND state='ACTIVE' AND schedule_state='DRAFT' AND version=?`,
      [long(old.version + 1), now, uuid(old.classId), uuid(old.ownerLecturerId), long(old.version)],
      LQ,
      LS,
    );
    return r[0]?.["[applied]"] === true;
  }
  async membership(classId: string, studentId: string) {
    const r = (
      await this.db.execute(
        `SELECT membership_id,class_id,student_id,state,source,offering_id,enrollment_id,schedule_reservation_id,joined_at,version FROM membership_by_class_student WHERE class_id=? AND student_id=?`,
        [uuid(classId), uuid(studentId)],
        LQ,
      )
    )[0];
    return r ? membershipRow(r) : undefined;
  }
  async createMembership(v: Membership) {
    const r = await this.db.execute(
      `INSERT INTO membership_by_class_student (class_id,student_id,membership_id,state,source,joined_at,version) VALUES (?,?,?,?,'JOIN_CODE',?,?) IF NOT EXISTS`,
      [uuid(v.classId), uuid(v.studentId), uuid(v.membershipId), v.state, v.joinedAt, long(v.version)],
      LQ,
      LS,
    );
    return r[0]?.["[applied]"] === true;
  }
  async restoreRemovedMembership(previous: Membership, next: Membership) {
    const rows = await this.db.execute(
      `UPDATE membership_by_class_student SET membership_id=?,state=?,source='JOIN_CODE',joined_at=?,version=? WHERE class_id=? AND student_id=? IF membership_id=? AND state='REMOVED' AND version=?`,
      [
        uuid(next.membershipId),
        next.state,
        next.joinedAt,
        long(next.version),
        uuid(next.classId),
        uuid(next.studentId),
        uuid(previous.membershipId),
        long(previous.version),
      ],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  async removeMembership(current: Membership) {
    const rows = await this.db.execute(
      `UPDATE membership_by_class_student SET state='REMOVED',version=? WHERE class_id=? AND student_id=? IF membership_id=? AND state='ACTIVE' AND version=?`,
      [
        long(current.version + 1),
        uuid(current.classId),
        uuid(current.studentId),
        uuid(current.membershipId),
        long(current.version),
      ],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  async removeMembershipProjections(current: Membership) {
    const shard = (createHash("sha256").update(current.studentId).digest()[0] ?? 0) % 16;
    await this.db.execute(
      `DELETE FROM students_by_class WHERE class_id=? AND state='ACTIVE' AND shard=? AND joined_at=? AND student_id=?`,
      [uuid(current.classId), shard, current.joinedAt, uuid(current.studentId)],
      LQ,
    );
    await this.db.execute(
      `DELETE FROM classes_by_student WHERE student_id=? AND joined_at=? AND class_id=?`,
      [uuid(current.studentId), current.joinedAt, uuid(current.classId)],
      LQ,
    );
  }
  async createPurchaseMembership(v: Membership) {
    const r = await this.db.execute(
      `INSERT INTO membership_by_class_student (class_id,student_id,membership_id,state,source,offering_id,enrollment_id,schedule_reservation_id,joined_at,version) VALUES (?,?,?,'PENDING','PURCHASE',?,?,?,?,1) IF NOT EXISTS`,
      [
        uuid(v.classId),
        uuid(v.studentId),
        uuid(v.membershipId),
        v.offeringId ? uuid(v.offeringId) : null,
        v.enrollmentId ? uuid(v.enrollmentId) : null,
        v.scheduleReservationId ? uuid(v.scheduleReservationId) : null,
        v.joinedAt,
      ],
      LQ,
      LS,
    );
    return r[0]?.["[applied]"] === true;
  }
  async activateMembership(classId: string, studentId: string, membershipId: string, reservationId: string) {
    const r = await this.db.execute(
      `UPDATE membership_by_class_student SET state='ACTIVE',schedule_reservation_id=?,version=2 WHERE class_id=? AND student_id=? IF membership_id=? AND state='PENDING'`,
      [uuid(reservationId), uuid(classId), uuid(studentId), uuid(membershipId)],
      LQ,
      LS,
    );
    return r[0]?.["[applied]"] === true;
  }
  async activatePurchaseMembership(v: Membership) {
    if (!v.offeringId || !v.enrollmentId || !v.scheduleReservationId)
      throw new Error("PURCHASE_MEMBERSHIP_BINDING_REQUIRED");
    const r = await this.db.execute(
      `UPDATE membership_by_class_student SET state='ACTIVE',version=2 WHERE class_id=? AND student_id=? IF membership_id=? AND state='PENDING' AND source='PURCHASE' AND offering_id=? AND enrollment_id=? AND schedule_reservation_id=?`,
      [
        uuid(v.classId),
        uuid(v.studentId),
        uuid(v.membershipId),
        uuid(v.offeringId),
        uuid(v.enrollmentId),
        uuid(v.scheduleReservationId),
      ],
      LQ,
      LS,
    );
    return r[0]?.["[applied]"] === true;
  }
  async hasActiveMembers(classId: string) {
    for (let shard = 0; shard < 16; shard++) {
      const rows = await this.db.execute(
        `SELECT student_id FROM students_by_class WHERE class_id=? AND state='ACTIVE' AND shard=? LIMIT 1`,
        [uuid(classId), shard],
        LQ,
      );
      if (rows.length > 0) return true;
    }
    return false;
  }
  async syncMembership(v: Membership, className: string) {
    await this.db.execute(
      `INSERT INTO classes_by_student (student_id,joined_at,class_id,class_name,membership_state,membership_version) VALUES (?,?,?,?,?,?)`,
      [uuid(v.studentId), v.joinedAt, uuid(v.classId), className, v.state, long(v.version)],
      LQ,
    );
    const shard = (createHash("sha256").update(v.studentId).digest()[0] ?? 0) % 16;
    await this.db.execute(
      `INSERT INTO students_by_class (class_id,state,shard,joined_at,student_id,membership_version) VALUES (?,?,?,?,?,?)`,
      [uuid(v.classId), v.state, shard, v.joinedAt, uuid(v.studentId), long(v.version)],
      LQ,
    );
  }
  async listStudent(id: string) {
    const rows = await this.db.execute(
      `SELECT class_id FROM classes_by_student WHERE student_id=? LIMIT 50`,
      [uuid(id)],
      LQ,
    );
    const classes = await this.resolveClasses(rows);
    const active = await Promise.all(classes.map((klass) => this.membership(klass.classId, id)));
    return classes.filter((_klass, index) => active[index]?.state === "ACTIVE");
  }
  async listLecturer(id: string) {
    const rows = await this.db.execute(
      `SELECT class_id FROM classes_by_lecturer WHERE lecturer_id=? LIMIT 50`,
      [uuid(id)],
      LQ,
    );
    return (await this.resolveClasses(rows)).filter(
      (value) => value.state === "ACTIVE" && value.ownerLecturerId === id,
    );
  }
  private async resolveClasses(rows: readonly types.Row[]) {
    const out: ClassroomClass[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const classId = String(r.class_id);
      // Projections keyed by updated_at/joined_at can retain an older row after
      // a partial write. Resolve each canonical class once for both role lists.
      if (seen.has(classId)) continue;
      seen.add(classId);
      const v = await this.getClass(classId);
      if (v) out.push(v);
    }
    return out;
  }
  async roster(classId: string) {
    const out: Membership[] = [];
    for (let shard = 0; shard < 16; shard++) {
      let pageState: string | undefined;
      do {
        const page = await this.db.executePage(
          `SELECT student_id FROM students_by_class WHERE class_id=? AND state='ACTIVE' AND shard=?`,
          [uuid(classId), shard],
          LQ,
          500,
          pageState,
        );
        for (const row of page.rows) {
          const value = await this.membership(classId, String(row.student_id));
          if (value?.state === "ACTIVE") out.push(value);
        }
        pageState = page.pageState;
        if (out.length > 10000) throw new Error("CLASS_ROSTER_LIMIT_EXCEEDED");
      } while (pageState);
    }
    return out;
  }
  async activeRecipientIds(classId: string, maximum = 10_000) {
    const out: string[] = [];
    for (let shard = 0; shard < 16; shard++) {
      let pageState: string | undefined;
      do {
        const page = await this.db.executePage(
          `SELECT student_id FROM students_by_class WHERE class_id=? AND state='ACTIVE' AND shard=?`,
          [uuid(classId), shard],
          LQ,
          Math.min(500, maximum - out.length),
          pageState,
        );
        out.push(...page.rows.map((row) => String(row.student_id)));
        pageState = page.pageState;
        if (out.length >= maximum && pageState) throw new Error("CLASS_RECIPIENT_LIMIT_EXCEEDED");
      } while (pageState && out.length < maximum);
    }
    return out;
  }
  async attendanceBySession(sessionId: string, limit = 10_000): Promise<AttendanceRow[]> {
    const rows = await this.db.execute(
      `SELECT session_id,student_id,attendance_status,source,manual_note,first_joined_at,last_joined_at,last_left_at,last_seen_at,connected_duration_seconds,presence_state,attendance_version,updated_at FROM attendance_by_session WHERE session_id=? LIMIT ?`,
      [uuid(sessionId), Math.min(limit, 10_000)],
      LQ,
    );
    return rows.map(attendanceRow);
  }
  async attendance(sessionId: string, studentId: string): Promise<AttendanceRow | undefined> {
    const row = (
      await this.db.execute(
        `SELECT session_id,student_id,attendance_status,source,manual_note,first_joined_at,last_joined_at,last_left_at,last_seen_at,connected_duration_seconds,presence_state,attendance_version,updated_at FROM attendance_by_session WHERE session_id=? AND student_id=?`,
        [uuid(sessionId), uuid(studentId)],
        LQ,
      )
    )[0];
    return row ? attendanceRow(row) : undefined;
  }
  async attendanceByStudentMonth(
    studentId: string,
    month: string,
    limit = 100,
  ): Promise<AttendanceHistoryRow[]> {
    const rows = await this.db.execute(
      `SELECT student_id,year_month,start_at,session_id,class_id,title,mode,attendance_status,manual_note,first_joined_at,last_joined_at,last_left_at,connected_duration_seconds,attendance_version FROM attendance_by_student_bucket WHERE student_id=? AND year_month=? LIMIT ?`,
      [uuid(studentId), types.LocalDate.fromString(`${month}-01`), Math.min(limit, 100)],
      LQ,
    );
    return rows.map(attendanceHistoryRow);
  }
  async attendanceHistoryEntry(
    studentId: string,
    month: string,
    startAt: Date,
    sessionId: string,
  ): Promise<AttendanceHistoryRow | undefined> {
    const row = (
      await this.db.execute(
        `SELECT student_id,year_month,start_at,session_id,class_id,title,mode,attendance_status,manual_note,first_joined_at,last_joined_at,last_left_at,connected_duration_seconds,attendance_version FROM attendance_by_student_bucket WHERE student_id=? AND year_month=? AND start_at=? AND session_id=?`,
        [uuid(studentId), types.LocalDate.fromString(`${month}-01`), startAt, uuid(sessionId)],
        LQ,
      )
    )[0];
    return row ? attendanceHistoryRow(row) : undefined;
  }
  async presenceCheckpoint(sessionId: string, studentId: string): Promise<PresenceCheckpoint | undefined> {
    const row = (
      await this.db.execute(
        `SELECT session_id,student_id,presence_state,active_connection_count,first_joined_at,last_joined_at,last_left_at,last_seen_at,accumulated_duration_seconds,checkpoint_version,updated_at FROM presence_checkpoint_by_session_student WHERE session_id=? AND student_id=?`,
        [uuid(sessionId), uuid(studentId)],
        LQ,
      )
    )[0];
    return row ? checkpointRow(row) : undefined;
  }
  async writeCheckpoint(expected: PresenceCheckpoint | undefined, next: PresenceCheckpoint) {
    const values = [
      next.presenceState,
      next.activeConnectionCount,
      next.firstJoinedAt ?? null,
      next.lastJoinedAt ?? null,
      next.lastLeftAt ?? null,
      next.lastSeenAt ?? null,
      long(next.accumulatedDurationSeconds),
      long(next.checkpointVersion),
      next.updatedAt,
      uuid(next.sessionId),
      uuid(next.studentId),
    ];
    const r = expected
      ? await this.db.execute(
          // The table's default_time_to_live applies to conditional updates. Cassandra
          // does not accept a USING TTL clause on this conditional UPDATE form.
          `UPDATE presence_checkpoint_by_session_student SET presence_state=?,active_connection_count=?,first_joined_at=?,last_joined_at=?,last_left_at=?,last_seen_at=?,accumulated_duration_seconds=?,checkpoint_version=?,updated_at=? WHERE session_id=? AND student_id=? IF checkpoint_version=?`,
          [...values, long(expected.checkpointVersion)],
          LQ,
          LS,
        )
      : await this.db.execute(
          `INSERT INTO presence_checkpoint_by_session_student (session_id,student_id,presence_state,active_connection_count,first_joined_at,last_joined_at,last_left_at,last_seen_at,accumulated_duration_seconds,checkpoint_version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
          [
            uuid(next.sessionId),
            uuid(next.studentId),
            next.presenceState,
            next.activeConnectionCount,
            next.firstJoinedAt ?? null,
            next.lastJoinedAt ?? null,
            next.lastLeftAt ?? null,
            next.lastSeenAt ?? null,
            long(next.accumulatedDurationSeconds),
            long(next.checkpointVersion),
            next.updatedAt,
          ],
          LQ,
          LS,
        );
    return r[0]?.["[applied]"] === true;
  }
  async writeAttendance(row: AttendanceRow): Promise<boolean> {
    const common = [
      row.attendanceStatus,
      row.source,
      row.firstJoinedAt ?? null,
      row.lastJoinedAt ?? null,
      row.lastLeftAt ?? null,
      row.lastSeenAt ?? null,
      long(row.connectedDurationSeconds),
      row.presenceState,
      long(row.attendanceVersion),
      row.updatedAt,
    ];
    if (row.attendanceVersion === 1) {
      const r = await this.db.execute(
        `INSERT INTO attendance_by_session (session_id,student_id,attendance_status,source,first_joined_at,last_joined_at,last_left_at,last_seen_at,connected_duration_seconds,presence_state,attendance_version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
        [uuid(row.sessionId), uuid(row.studentId), ...common],
        LQ,
        LS,
      );
      return r[0]?.["[applied]"] === true;
    }
    const r = await this.db.execute(
      `UPDATE attendance_by_session SET attendance_status=?,source=?,first_joined_at=?,last_joined_at=?,last_left_at=?,last_seen_at=?,connected_duration_seconds=?,presence_state=?,attendance_version=?,updated_at=? WHERE session_id=? AND student_id=? IF attendance_version=?`,
      [...common, uuid(row.sessionId), uuid(row.studentId), long(row.attendanceVersion - 1)],
      LQ,
      LS,
    );
    if (r[0]?.["[applied]"] === true) return true;
    const current = (
      await this.db.execute(
        `SELECT attendance_version FROM attendance_by_session WHERE session_id=? AND student_id=?`,
        [uuid(row.sessionId), uuid(row.studentId)],
        LQ,
      )
    )[0];
    if (!current) {
      const inserted = await this.db.execute(
        `INSERT INTO attendance_by_session (session_id,student_id,attendance_status,source,first_joined_at,last_joined_at,last_left_at,last_seen_at,connected_duration_seconds,presence_state,attendance_version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
        [uuid(row.sessionId), uuid(row.studentId), ...common],
        LQ,
        LS,
      );
      return inserted[0]?.["[applied]"] === true;
    }
    const currentVersion = num(current.attendance_version);
    if (currentVersion === row.attendanceVersion) return true;
    if (currentVersion > row.attendanceVersion) return false;
    const recovered = await this.db.execute(
      `UPDATE attendance_by_session SET attendance_status=?,source=?,first_joined_at=?,last_joined_at=?,last_left_at=?,last_seen_at=?,connected_duration_seconds=?,presence_state=?,attendance_version=?,updated_at=? WHERE session_id=? AND student_id=? IF attendance_version=?`,
      [...common, uuid(row.sessionId), uuid(row.studentId), long(currentVersion)],
      LQ,
      LS,
    );
    return recovered[0]?.["[applied]"] === true;
  }
  async writeManualAttendance(expected: AttendanceRow | undefined, next: AttendanceRow): Promise<boolean> {
    if (!expected) {
      const rows = await this.db.execute(
        `INSERT INTO attendance_by_session (session_id,student_id,attendance_status,source,manual_note,connected_duration_seconds,presence_state,attendance_version,updated_at) VALUES (?,?,?,?,?,0,'OFFLINE',?,?) IF NOT EXISTS`,
        [
          uuid(next.sessionId),
          uuid(next.studentId),
          next.attendanceStatus,
          "MANUAL_OFFLINE",
          next.manualNote ?? null,
          long(next.attendanceVersion),
          next.updatedAt,
        ],
        LQ,
        LS,
      );
      return rows[0]?.["[applied]"] === true;
    }
    const rows = await this.db.execute(
      `UPDATE attendance_by_session SET attendance_status=?,source='MANUAL_OFFLINE',manual_note=?,attendance_version=?,updated_at=? WHERE session_id=? AND student_id=? IF attendance_version=? AND source='MANUAL_OFFLINE'`,
      [
        next.attendanceStatus,
        next.manualNote ?? null,
        long(next.attendanceVersion),
        next.updatedAt,
        uuid(next.sessionId),
        uuid(next.studentId),
        long(expected.attendanceVersion),
      ],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  async writeAttendanceHistory(row: AttendanceHistoryRow) {
    await this.db.execute(
      `INSERT INTO attendance_by_student_bucket (student_id,year_month,start_at,session_id,class_id,title,mode,attendance_status,manual_note,first_joined_at,last_joined_at,last_left_at,connected_duration_seconds,attendance_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uuid(row.studentId),
        types.LocalDate.fromString(`${row.yearMonth}-01`),
        row.startAt,
        uuid(row.sessionId),
        uuid(row.classId),
        row.title,
        row.mode,
        row.attendanceStatus,
        row.manualNote ?? null,
        row.firstJoinedAt ?? null,
        row.lastJoinedAt ?? null,
        row.lastLeftAt ?? null,
        long(row.connectedDurationSeconds),
        long(row.attendanceVersion),
      ],
      LQ,
    );
  }
  async insertAnnouncement(input: {
    classId: string;
    announcementId: string;
    authorId: string;
    title: string;
    body: string;
    now: Date;
  }) {
    await this.db.execute(
      `INSERT INTO announcements_by_class_bucket (class_id,year_month,created_at,announcement_id,author_id,title,body_sanitized,state,version) VALUES (?,?,?,?,?,?,?,'PUBLISHED',1)`,
      [
        uuid(input.classId),
        types.LocalDate.fromString(input.now.toISOString().slice(0, 7) + "-01"),
        input.now,
        uuid(input.announcementId),
        uuid(input.authorId),
        input.title,
        input.body,
      ],
      LQ,
    );
  }
  async listAnnouncements(classId: string, month: string) {
    const rows = await this.db.execute(
      `SELECT announcement_id,author_id,title,body_sanitized,created_at,version FROM announcements_by_class_bucket WHERE class_id=? AND year_month=? LIMIT 50`,
      [uuid(classId), types.LocalDate.fromString(month)],
      LQ,
    );
    return rows.map((r) => ({
      announcementId: String(r.announcement_id),
      authorId: String(r.author_id),
      title: String(r.title),
      body: String(r.body_sanitized),
      createdAt: date(r.created_at).toISOString(),
      version: num(r.version),
    }));
  }
  async createSession(v: ClassSession) {
    const r = await this.db.execute(
      `INSERT INTO session_by_id (session_id,class_id,title,start_at,end_at,mode,status,timezone,meeting_provider,meeting_url,location,schedule_version,record_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
      [
        uuid(v.sessionId),
        uuid(v.classId),
        v.title,
        v.startAt,
        v.endAt,
        v.mode,
        v.status,
        v.timezone,
        v.meetingProvider ?? null,
        v.meetingUrl ?? null,
        v.location ?? null,
        long(v.scheduleVersion),
        long(v.recordVersion),
        v.createdAt,
        v.updatedAt,
      ],
      LQ,
      LS,
    );
    return r[0]?.["[applied]"] === true;
  }
  async getSession(sessionId: string) {
    const r = (
      await this.db.execute(
        `SELECT session_id,class_id,title,start_at,end_at,mode,status,timezone,meeting_provider,meeting_url,location,schedule_version,record_version,created_at,updated_at FROM session_by_id WHERE session_id=?`,
        [uuid(sessionId)],
        LQ,
      )
    )[0];
    return r ? sessionRow(r) : undefined;
  }
  async updateSession(old: ClassSession, next: ClassSession) {
    const r = await this.db.execute(
      `UPDATE session_by_id SET title=?,start_at=?,end_at=?,timezone=?,mode=?,meeting_provider=?,meeting_url=?,location=?,record_version=?,updated_at=? WHERE session_id=? IF class_id=? AND status=? AND record_version=?`,
      [
        next.title,
        next.startAt,
        next.endAt,
        next.timezone,
        next.mode,
        next.meetingProvider ?? null,
        next.meetingUrl ?? null,
        next.location ?? null,
        long(next.recordVersion),
        next.updatedAt,
        uuid(next.sessionId),
        uuid(next.classId),
        old.status,
        long(old.recordVersion),
      ],
      LQ,
      LS,
    );
    return r[0]?.["[applied]"] === true;
  }
  async cancelSession(old: ClassSession, next: ClassSession) {
    const r = await this.db.execute(
      `UPDATE session_by_id SET status='CANCELLED',record_version=?,updated_at=? WHERE session_id=? IF class_id=? AND status=? AND record_version=?`,
      [
        long(next.recordVersion),
        next.updatedAt,
        uuid(old.sessionId),
        uuid(old.classId),
        old.status,
        long(old.recordVersion),
      ],
      LQ,
      LS,
    );
    return r[0]?.["[applied]"] === true;
  }
  async markSessionScheduled(sessionId: string, scheduleVersion: number, now: Date) {
    const r = await this.db.execute(
      `UPDATE session_by_id SET status='SCHEDULED',schedule_version=?,updated_at=? WHERE session_id=? IF status='DRAFT'`,
      [long(scheduleVersion), now, uuid(sessionId)],
      LQ,
      LS,
    );
    return r[0]?.["[applied]"] === true;
  }
  async alignSessionScheduleVersion(sessionId: string, scheduleVersion: number, now: Date) {
    await this.db.execute(
      `UPDATE session_by_id SET status='SCHEDULED',schedule_version=?,updated_at=? WHERE session_id=?`,
      [long(scheduleVersion), now, uuid(sessionId)],
      LQ,
    );
  }
  async insertSessionProjections(v: ClassSession) {
    await this.db.execute(
      `INSERT INTO sessions_by_class (class_id,start_at,session_id,end_at,status,session_version) VALUES (?,?,?,?,?,?)`,
      [uuid(v.classId), v.startAt, uuid(v.sessionId), v.endAt, v.status, long(v.recordVersion)],
      LQ,
    );
    for (const day of utcDatesTouched(v.startAt, v.endAt))
      await this.db.execute(
        `INSERT INTO sessions_by_class_date (class_id,session_date,start_at,session_id,end_at,title,mode,status,timezone,meeting_provider,location,session_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          uuid(v.classId),
          types.LocalDate.fromString(day),
          v.startAt,
          uuid(v.sessionId),
          v.endAt,
          v.title,
          v.mode,
          v.status,
          v.timezone,
          v.meetingProvider ?? null,
          v.location ?? null,
          long(v.recordVersion),
        ],
        LQ,
      );
  }
  async deleteSessionProjections(v: ClassSession) {
    await this.db.execute(
      `DELETE FROM sessions_by_class WHERE class_id=? AND start_at=? AND session_id=?`,
      [uuid(v.classId), v.startAt, uuid(v.sessionId)],
      LQ,
    );
    for (const day of utcDatesTouched(v.startAt, v.endAt))
      await this.db.execute(
        `DELETE FROM sessions_by_class_date WHERE class_id=? AND session_date=? AND start_at=? AND session_id=?`,
        [uuid(v.classId), types.LocalDate.fromString(day), v.startAt, uuid(v.sessionId)],
        LQ,
      );
  }
  async updateSessionProjectionStatus(v: ClassSession) {
    await this.db.execute(
      `UPDATE sessions_by_class SET status=?,session_version=? WHERE class_id=? AND start_at=? AND session_id=?`,
      [v.status, long(v.recordVersion), uuid(v.classId), v.startAt, uuid(v.sessionId)],
      LQ,
    );
    for (const day of utcDatesTouched(v.startAt, v.endAt))
      await this.db.execute(
        `UPDATE sessions_by_class_date SET status=?,session_version=? WHERE class_id=? AND session_date=? AND start_at=? AND session_id=?`,
        [
          v.status,
          long(v.recordVersion),
          uuid(v.classId),
          types.LocalDate.fromString(day),
          v.startAt,
          uuid(v.sessionId),
        ],
        LQ,
      );
  }
  async listDatePartition(classId: string, day: string) {
    const rows = await this.db.execute(
      `SELECT session_id,start_at,end_at,status FROM sessions_by_class_date WHERE class_id=? AND session_date=? LIMIT 100`,
      [uuid(classId), types.LocalDate.fromString(day)],
      LQ,
    );
    return rows.map((r) => ({
      sessionId: String(r.session_id),
      startAt: date(r.start_at),
      endAt: date(r.end_at),
      status: String(r.status),
    }));
  }
  async countDatePartition(classId: string, day: string) {
    const r = (
      await this.db.execute(
        `SELECT count(*) AS n FROM sessions_by_class_date WHERE class_id=? AND session_date=? LIMIT 101`,
        [uuid(classId), types.LocalDate.fromString(day)],
        LQ,
      )
    )[0];
    return num(r?.n ?? 0);
  }
  async listClassSessionIds(classId: string, limit = 201) {
    const rows = await this.db.execute(
      `SELECT session_id FROM sessions_by_class WHERE class_id=? LIMIT ?`,
      [uuid(classId), limit],
      LQ,
    );
    return rows.map((r) => String(r.session_id));
  }
  async countClassSessions(classId: string) {
    const r = (
      await this.db.execute(
        `SELECT count(*) AS n FROM sessions_by_class WHERE class_id=? LIMIT 201`,
        [uuid(classId)],
        LQ,
      )
    )[0];
    return num(r?.n ?? 0);
  }
  async writeManifest(m: {
    classId: string;
    scheduleVersion: number;
    sessionCount: number;
    checksum: string;
    firstStartAt: Date;
    lastEndAt: Date;
    publishedAt: Date;
  }) {
    await this.db.execute(
      `INSERT INTO schedule_manifest_by_class (class_id,schedule_version,session_count,manifest_checksum,first_start_at,last_end_at,published_at) VALUES (?,?,?,?,?,?,?)`,
      [
        uuid(m.classId),
        long(m.scheduleVersion),
        m.sessionCount,
        m.checksum,
        m.firstStartAt,
        m.lastEndAt,
        m.publishedAt,
      ],
      LQ,
    );
  }
  async getManifest(classId: string) {
    const r = (
      await this.db.execute(
        `SELECT schedule_version,session_count,manifest_checksum,first_start_at,last_end_at,published_at FROM schedule_manifest_by_class WHERE class_id=?`,
        [uuid(classId)],
        LQ,
      )
    )[0];
    return r
      ? {
          scheduleVersion: num(r.schedule_version),
          sessionCount: Number(r.session_count),
          checksum: String(r.manifest_checksum),
          firstStartAt: date(r.first_start_at),
          lastEndAt: date(r.last_end_at),
          publishedAt: date(r.published_at),
        }
      : undefined;
  }

  async getReservation(id: string): Promise<ScheduleReservation | undefined> {
    const r = (
      await this.db.execute(
        `SELECT reservation_id,operation_id,student_id,class_id,offering_id,state,expires_at,segment_count,schedule_version,version,terminal_reason,order_id,membership_id,created_at,updated_at FROM schedule_reservation_by_id WHERE reservation_id=?`,
        [uuid(id)],
        LQ,
      )
    )[0];
    return r ? reservationRow(r) : undefined;
  }
  async createReservation(v: ScheduleReservation) {
    const r = await this.db.execute(
      `INSERT INTO schedule_reservation_by_id (reservation_id,operation_id,student_id,class_id,offering_id,state,expires_at,segment_count,schedule_version,version,created_at,updated_at) VALUES (?,?,?,?,?,'PREPARED',?,?,?,?,?,?) IF NOT EXISTS`,
      [
        uuid(v.reservationId),
        uuid(v.operationId),
        uuid(v.studentId),
        uuid(v.classId),
        uuid(v.offeringId),
        v.expiresAt,
        v.segmentCount,
        long(v.scheduleVersion),
        long(v.version),
        v.createdAt,
        v.updatedAt,
      ],
      LQ,
      LS,
    );
    return r[0]?.["[applied]"] === true;
  }
  async writeReservationSegments(segments: readonly ScheduleSegment[]) {
    for (const s of segments)
      await this.db.execute(
        `INSERT INTO schedule_reservation_segments_by_id (reservation_id,schedule_day,start_at,session_id,entry_id,end_at,class_id,class_name,student_id,offering_id,title,mode,timezone,schedule_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          uuid(s.reservationId),
          types.LocalDate.fromString(s.scheduleDay),
          s.startAt,
          uuid(s.sessionId),
          uuid(s.entryId),
          s.endAt,
          uuid(s.classId),
          s.className,
          uuid(s.studentId),
          uuid(s.offeringId),
          s.title,
          s.mode,
          s.timezone,
          long(s.scheduleVersion),
        ],
        LQ,
      );
  }
  async reservationSegments(id: string): Promise<ScheduleSegment[]> {
    const rows = await this.db.execute(
      `SELECT reservation_id,schedule_day,start_at,session_id,entry_id,end_at,class_id,class_name,student_id,offering_id,title,mode,timezone,schedule_version FROM schedule_reservation_segments_by_id WHERE reservation_id=? LIMIT 400`,
      [uuid(id)],
      LQ,
    );
    return rows.map(scheduleSegmentRow);
  }
  async acquireScheduleGuard(studentId: string, operationId: string, reservationId: string, now: Date) {
    const current = (
      await this.db.execute(
        `SELECT holder_operation_id,holder_reservation_id,lease_until,lease_fence,version FROM student_schedule_guard WHERE student_id=?`,
        [uuid(studentId)],
        LQ,
      )
    )[0];
    const leaseUntil = new Date(now.getTime() + 10_000);
    if (!current) {
      const r = await this.db.execute(
        `INSERT INTO student_schedule_guard (student_id,holder_operation_id,holder_reservation_id,lease_until,lease_fence,version,updated_at) VALUES (?,?,?,?,1,1,?) IF NOT EXISTS`,
        [uuid(studentId), uuid(operationId), uuid(reservationId), leaseUntil, now],
        LQ,
        LS,
      );
      return r[0]?.["[applied]"] === true
        ? { acquired: true, fence: 1, predecessorReservationId: undefined }
        : { acquired: false, fence: 0, predecessorReservationId: undefined };
    }
    const same = String(current.holder_operation_id) === operationId;
    const expired = date(current.lease_until).getTime() <= now.getTime();
    if (!same && !expired)
      return { acquired: false, fence: num(current.lease_fence), predecessorReservationId: undefined };
    const nextVersion = num(current.version) + 1,
      nextFence = num(current.lease_fence) + 1,
      predecessorReservationId = expired ? String(current.holder_reservation_id) : undefined;
    const r = await this.db.execute(
      `UPDATE student_schedule_guard SET holder_operation_id=?,holder_reservation_id=?,lease_until=?,lease_fence=?,version=?,updated_at=? WHERE student_id=? IF version=?`,
      [
        uuid(operationId),
        uuid(reservationId),
        leaseUntil,
        long(nextFence),
        long(nextVersion),
        now,
        uuid(studentId),
        current.version,
      ],
      LQ,
      LS,
    );
    return {
      acquired: r[0]?.["[applied]"] === true,
      fence: nextFence,
      predecessorReservationId,
    };
  }
  async releaseScheduleGuard(studentId: string, operationId: string, fence: number, now: Date) {
    await this.db.execute(
      `UPDATE student_schedule_guard SET lease_until=?,updated_at=? WHERE student_id=? IF holder_operation_id=? AND lease_fence=?`,
      [now, now, uuid(studentId), uuid(operationId), long(fence)],
      LQ,
      LS,
    );
  }
  async daySchedule(studentId: string, day: string) {
    const rows = await this.db.execute(
      `SELECT schedule_day,start_at,entry_id,end_at,class_id,class_name,session_id,offering_id,reservation_id,entry_state,expires_at,schedule_version,title,mode,timezone FROM student_schedule_by_day WHERE student_id=? AND schedule_day=? LIMIT 200`,
      [uuid(studentId), types.LocalDate.fromString(day)],
      LQ,
    );
    return rows.map((r) => ({
      ...scheduleSegmentRow({ ...r, student_id: uuid(studentId) }),
      state: String(r.entry_state) as "HELD" | "CONFIRMED",
      ...(r.expires_at ? { expiresAt: date(r.expires_at) } : {}),
    }));
  }
  async putHeldSegment(s: ScheduleSegment, expiresAt: Date) {
    await this.db.execute(
      `INSERT INTO student_schedule_by_day (student_id,schedule_day,start_at,entry_id,end_at,class_id,class_name,session_id,offering_id,reservation_id,entry_state,expires_at,schedule_version,title,mode,timezone) VALUES (?,?,?,?,?,?,?,?,?,?,'HELD',?,?,?,?,?) USING TTL ?`,
      [
        uuid(s.studentId),
        types.LocalDate.fromString(s.scheduleDay),
        s.startAt,
        uuid(s.entryId),
        s.endAt,
        uuid(s.classId),
        s.className,
        uuid(s.sessionId),
        uuid(s.offeringId),
        uuid(s.reservationId),
        expiresAt,
        long(s.scheduleVersion),
        s.title,
        s.mode,
        s.timezone,
        1200,
      ],
      LQ,
    );
  }
  async putConfirmedSegment(s: ScheduleSegment) {
    await this.db.execute(
      `INSERT INTO student_schedule_by_day (student_id,schedule_day,start_at,entry_id,end_at,class_id,class_name,session_id,offering_id,reservation_id,entry_state,expires_at,schedule_version,title,mode,timezone) VALUES (?,?,?,?,?,?,?,?,?,?,'CONFIRMED',null,?,?,?,?)`,
      [
        uuid(s.studentId),
        types.LocalDate.fromString(s.scheduleDay),
        s.startAt,
        uuid(s.entryId),
        s.endAt,
        uuid(s.classId),
        s.className,
        uuid(s.sessionId),
        uuid(s.offeringId),
        uuid(s.reservationId),
        long(s.scheduleVersion),
        s.title,
        s.mode,
        s.timezone,
      ],
      LQ,
    );
  }
  async deleteOwnHeldSegment(s: ScheduleSegment) {
    const found = (await this.daySchedule(s.studentId, s.scheduleDay)).find(
      (v) => v.entryId === s.entryId && v.startAt.getTime() === s.startAt.getTime(),
    );
    if (found?.state === "HELD" && found.reservationId === s.reservationId)
      await this.db.execute(
        `DELETE FROM student_schedule_by_day WHERE student_id=? AND schedule_day=? AND start_at=? AND entry_id=?`,
        [uuid(s.studentId), types.LocalDate.fromString(s.scheduleDay), s.startAt, uuid(s.entryId)],
        LQ,
      );
  }
  async transitionReservation(
    old: ScheduleReservation,
    state: ScheduleReservation["state"],
    now: Date,
    extra: { reason?: string; orderId?: string; membershipId?: string } = {},
  ) {
    const r = await this.db.execute(
      `UPDATE schedule_reservation_by_id SET state=?,version=?,terminal_reason=?,order_id=?,membership_id=?,updated_at=? WHERE reservation_id=? IF state=? AND version=?`,
      [
        state,
        long(old.version + 1),
        extra.reason ?? old.terminalReason ?? null,
        extra.orderId ? uuid(extra.orderId) : old.orderId ? uuid(old.orderId) : null,
        extra.membershipId ? uuid(extra.membershipId) : old.membershipId ? uuid(old.membershipId) : null,
        now,
        uuid(old.reservationId),
        old.state,
        long(old.version),
      ],
      LQ,
      LS,
    );
    return r[0]?.["[applied]"] === true;
  }
  async enqueueReservationExpiry(v: ScheduleReservation) {
    const shard = (createHash("sha256").update(v.reservationId).digest()[0] ?? 0) % 16;
    await this.db.execute(
      `INSERT INTO schedule_reservations_by_expiry_bucket (expiry_day,shard,expires_at,reservation_id,student_id,state,reservation_version) VALUES (?,?,?,?,?,'HELD',?) USING TTL ?`,
      [
        types.LocalDate.fromString(v.expiresAt.toISOString().slice(0, 10)),
        shard,
        v.expiresAt,
        uuid(v.reservationId),
        uuid(v.studentId),
        long(v.version),
        7 * 86400 + 15 * 60,
      ],
      LQ,
    );
  }
  async dueReservations(day: string, shard: number, now: Date) {
    const rows = await this.db.execute(
      `SELECT reservation_id FROM schedule_reservations_by_expiry_bucket WHERE expiry_day=? AND shard=? AND expires_at<=? LIMIT 50`,
      [types.LocalDate.fromString(day), shard, now],
      LQ,
    );
    return rows.map((r) => String(r.reservation_id));
  }
  async publishSchedule(old: ClassroomClass, scheduleVersion: number, now: Date) {
    const r = await this.db.execute(
      `UPDATE class_by_id SET schedule_state='PUBLISHED',schedule_version=?,updated_at=? WHERE class_id=? IF owner_lecturer_id=? AND state='ACTIVE' AND schedule_state='DRAFT' AND schedule_version=?`,
      [long(scheduleVersion), now, uuid(old.classId), uuid(old.ownerLecturerId), long(old.scheduleVersion)],
      LQ,
      LS,
    );
    return r[0]?.["[applied]"] === true;
  }
  async prepareEvent(input: {
    eventId: string;
    eventType: string;
    aggregateId: string;
    aggregateType: string;
    version: number;
    occurredAt: Date;
    correlationId: string;
    data: object;
    actor?: object;
  }) {
    const envelope = {
      specVersion: "1.0",
      eventId: input.eventId,
      eventType: input.eventType,
      occurredAt: input.occurredAt.toISOString(),
      producer: "classroom-service",
      correlationId: input.correlationId,
      ...(input.actor ? { actor: input.actor } : {}),
      aggregate: { type: input.aggregateType, id: input.aggregateId, version: input.version },
      data: input.data,
    };
    const day = input.occurredAt.toISOString().slice(0, 10),
      shard = eventShard(input.eventId);
    await this.db.execute(
      `INSERT INTO pending_events_by_due_bucket (due_day,shard,next_attempt_at,event_id,event_type,aggregate_id,aggregate_version,payload_json,state,retry_count,lease_fence,created_at) VALUES (?,?,?,?,?,?,?,?, 'PREPARED',0,0,?) IF NOT EXISTS`,
      [
        types.LocalDate.fromString(day),
        shard,
        input.occurredAt,
        uuid(input.eventId),
        input.eventType,
        uuid(input.aggregateId),
        long(input.version),
        JSON.stringify(envelope),
        input.occurredAt,
      ],
      LQ,
      LS,
    );
    await this.db.execute(
      `INSERT INTO pending_event_by_id (event_id,event_type,aggregate_id,aggregate_version,state,next_attempt_at,retry_count,lease_fence,created_at) VALUES (?,?,?,?,'PREPARED',?,0,0,?) IF NOT EXISTS`,
      [
        uuid(input.eventId),
        input.eventType,
        uuid(input.aggregateId),
        long(input.version),
        input.occurredAt,
        input.occurredAt,
      ],
      LQ,
      LS,
    );
  }
  async readyEvent(eventId: string, occurredAt: Date) {
    const day = types.LocalDate.fromString(occurredAt.toISOString().slice(0, 10)),
      shard = eventShard(eventId);
    await this.db.execute(
      `UPDATE pending_events_by_due_bucket SET state='READY' WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=? IF state='PREPARED'`,
      [day, shard, occurredAt, uuid(eventId)],
      LQ,
      LS,
    );
    await this.db.execute(
      `UPDATE pending_event_by_id SET state='READY' WHERE event_id=? IF state='PREPARED'`,
      [uuid(eventId)],
      LQ,
      LS,
    );
  }
  async listDue(now: Date) {
    const out: DueClassroomEvent[] = [];
    for (let d = 0; d <= 1; d++) {
      const day = new Date(now);
      day.setUTCDate(day.getUTCDate() - d);
      for (let shard = 0; shard < 16; shard++) {
        const rows = await this.db.execute(
          `SELECT due_day,shard,next_attempt_at,event_id,payload_json,state,retry_count,lease_fence,lease_until FROM pending_events_by_due_bucket WHERE due_day=? AND shard=? AND next_attempt_at<=? LIMIT 25`,
          [types.LocalDate.fromString(day.toISOString().slice(0, 10)), shard, now],
          LQ,
        );
        for (const r of rows)
          out.push({
            dueDay: String(r.due_day),
            shard: Number(r.shard),
            nextAttemptAt: date(r.next_attempt_at),
            eventId: String(r.event_id),
            event: JSON.parse(String(r.payload_json)) as EventEnvelope,
            state: String(r.state),
            retryCount: Number(r.retry_count),
            leaseFence: num(r.lease_fence),
            ...(r.lease_until ? { leaseUntil: date(r.lease_until) } : {}),
          });
      }
    }
    return out.slice(0, 50);
  }
  async claim(i: DueClassroomEvent, owner: string, now: Date) {
    const fence = i.leaseFence + 1,
      r = await this.db.execute(
        `UPDATE pending_events_by_due_bucket SET state='PUBLISHING',lease_owner=?,lease_until=?,lease_fence=? WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=? IF state='READY'`,
        [
          owner,
          new Date(now.getTime() + 15000),
          long(fence),
          types.LocalDate.fromString(i.dueDay),
          i.shard,
          i.nextAttemptAt,
          uuid(i.eventId),
        ],
        LQ,
        LS,
      );
    if (r[0]?.["[applied]"] !== true) return false;
    await this.db.execute(
      `UPDATE pending_event_by_id SET state='PUBLISHING',lease_fence=? WHERE event_id=?`,
      [long(fence), uuid(i.eventId)],
      LQ,
    );
    return true;
  }
  async retry(i: DueClassroomEvent, next: Date) {
    const fence = i.leaseFence + 1;
    await this.db.execute(
      `UPDATE pending_events_by_due_bucket SET state='READY',retry_count=?,lease_owner=null,lease_until=? WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=? IF state='PUBLISHING' AND lease_fence=?`,
      [
        i.retryCount + 1,
        next,
        types.LocalDate.fromString(i.dueDay),
        i.shard,
        i.nextAttemptAt,
        uuid(i.eventId),
        long(fence),
      ],
      LQ,
      LS,
    );
    await this.db.execute(
      `UPDATE pending_event_by_id SET state='READY',retry_count=?,next_attempt_at=? WHERE event_id=? IF state='PUBLISHING' AND lease_fence=?`,
      [i.retryCount + 1, next, uuid(i.eventId), long(fence)],
      LQ,
      LS,
    );
  }
  async recover(i: DueClassroomEvent) {
    const r = await this.db.execute(
      `UPDATE pending_events_by_due_bucket SET state='READY',lease_owner=null,lease_until=null WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=? IF state='PUBLISHING' AND lease_fence=?`,
      [types.LocalDate.fromString(i.dueDay), i.shard, i.nextAttemptAt, uuid(i.eventId), long(i.leaseFence)],
      LQ,
      LS,
    );
    if (r[0]?.["[applied]"] === true)
      await this.db.execute(
        `UPDATE pending_event_by_id SET state='READY' WHERE event_id=? IF state='PUBLISHING' AND lease_fence=?`,
        [uuid(i.eventId), long(i.leaseFence)],
        LQ,
        LS,
      );
  }
  async published(i: DueClassroomEvent, now: Date) {
    const fence = i.leaseFence + 1,
      r = await this.db.execute(
        `UPDATE pending_event_by_id SET state='PUBLISHED',published_at=? WHERE event_id=? IF state='PUBLISHING' AND lease_fence=?`,
        [now, uuid(i.eventId), long(fence)],
        LQ,
        LS,
      );
    if (r[0]?.["[applied]"] !== true) throw new Error("OUTBOX_FENCE_LOST");
    await this.db.execute(
      `DELETE FROM pending_events_by_due_bucket WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=? IF state='PUBLISHING' AND lease_fence=?`,
      [types.LocalDate.fromString(i.dueDay), i.shard, i.nextAttemptAt, uuid(i.eventId), long(fence)],
      LQ,
      LS,
    );
  }
}
function classRow(r: types.Row): ClassroomClass {
  return {
    classId: String(r.class_id),
    ownerLecturerId: String(r.owner_lecturer_id),
    name: String(r.name),
    ...(r.linked_course_id ? { linkedCourseId: String(r.linked_course_id) } : {}),
    classKind: String(r.class_kind) as ClassroomClass["classKind"],
    scheduleState: String(r.schedule_state) as ClassroomClass["scheduleState"],
    scheduleVersion: num(r.schedule_version),
    maxMembers: Number(r.max_members),
    ...(r.photo_data_url ? { photoDataUrl: String(r.photo_data_url) } : {}),
    ...(r.cover_data_url ? { coverDataUrl: String(r.cover_data_url) } : {}),
    state: String(r.state) as ClassroomClass["state"],
    activeCodeHash: String(r.active_code_hash),
    version: num(r.version),
    createdAt: date(r.created_at),
    updatedAt: date(r.updated_at),
  };
}
function membershipRow(r: types.Row): Membership {
  return {
    membershipId: String(r.membership_id),
    classId: String(r.class_id),
    studentId: String(r.student_id),
    state: String(r.state) as Membership["state"],
    source: String(r.source) as Membership["source"],
    ...(r.offering_id ? { offeringId: String(r.offering_id) } : {}),
    ...(r.enrollment_id ? { enrollmentId: String(r.enrollment_id) } : {}),
    ...(r.schedule_reservation_id ? { scheduleReservationId: String(r.schedule_reservation_id) } : {}),
    joinedAt: date(r.joined_at),
    version: num(r.version),
  };
}
function reservationRow(r: types.Row): ScheduleReservation {
  return {
    reservationId: String(r.reservation_id),
    operationId: String(r.operation_id),
    studentId: String(r.student_id),
    classId: String(r.class_id),
    offeringId: String(r.offering_id),
    state: String(r.state) as ScheduleReservation["state"],
    expiresAt: date(r.expires_at),
    segmentCount: Number(r.segment_count),
    scheduleVersion: num(r.schedule_version),
    version: num(r.version),
    createdAt: date(r.created_at),
    updatedAt: date(r.updated_at),
    ...(r.terminal_reason ? { terminalReason: String(r.terminal_reason) } : {}),
    ...(r.order_id ? { orderId: String(r.order_id) } : {}),
    ...(r.membership_id ? { membershipId: String(r.membership_id) } : {}),
  };
}
function scheduleSegmentRow(r: types.Row): ScheduleSegment {
  return {
    entryId: String(r.entry_id),
    scheduleDay: String(r.schedule_day),
    startAt: date(r.start_at),
    endAt: date(r.end_at),
    sessionId: String(r.session_id),
    classId: String(r.class_id),
    className: String(r.class_name),
    studentId: String(r.student_id),
    offeringId: String(r.offering_id),
    reservationId: String(r.reservation_id),
    title: String(r.title),
    mode: String(r.mode) as ScheduleSegment["mode"],
    timezone: String(r.timezone),
    scheduleVersion: num(r.schedule_version),
  };
}
function sessionRow(r: types.Row): ClassSession {
  return {
    sessionId: String(r.session_id),
    classId: String(r.class_id),
    title: String(r.title),
    startAt: date(r.start_at),
    endAt: date(r.end_at),
    mode: String(r.mode) as ClassSession["mode"],
    status: String(r.status) as ClassSession["status"],
    timezone: String(r.timezone),
    ...(r.meeting_provider ? { meetingProvider: String(r.meeting_provider) } : {}),
    ...(r.meeting_url ? { meetingUrl: String(r.meeting_url) } : {}),
    ...(r.location ? { location: String(r.location) } : {}),
    scheduleVersion: num(r.schedule_version),
    recordVersion: num(r.record_version),
    createdAt: date(r.created_at),
    updatedAt: date(r.updated_at),
  };
}
function optionalDate(v: unknown): Date | undefined {
  return v ? date(v) : undefined;
}
function attendanceRow(r: types.Row): AttendanceRow {
  return {
    sessionId: String(r.session_id),
    studentId: String(r.student_id),
    attendanceStatus: String(r.attendance_status) as AttendanceRow["attendanceStatus"],
    source: attendanceSource(r.source),
    ...(r.manual_note ? { manualNote: String(r.manual_note) } : {}),
    ...(optionalDate(r.first_joined_at) ? { firstJoinedAt: optionalDate(r.first_joined_at) } : {}),
    ...(optionalDate(r.last_joined_at) ? { lastJoinedAt: optionalDate(r.last_joined_at) } : {}),
    ...(optionalDate(r.last_left_at) ? { lastLeftAt: optionalDate(r.last_left_at) } : {}),
    ...(optionalDate(r.last_seen_at) ? { lastSeenAt: optionalDate(r.last_seen_at) } : {}),
    connectedDurationSeconds: num(r.connected_duration_seconds ?? 0),
    presenceState: String(r.presence_state) as AttendanceRow["presenceState"],
    attendanceVersion: num(r.attendance_version),
    updatedAt: date(r.updated_at),
  };
}
function attendanceHistoryRow(r: types.Row): AttendanceHistoryRow {
  const yearMonth = String(r.year_month);
  return {
    studentId: String(r.student_id),
    yearMonth: yearMonth.slice(0, 7),
    startAt: date(r.start_at),
    sessionId: String(r.session_id),
    classId: String(r.class_id),
    title: String(r.title),
    mode: String(r.mode) as AttendanceHistoryRow["mode"],
    attendanceStatus: String(r.attendance_status) as AttendanceHistoryRow["attendanceStatus"],
    ...(r.manual_note ? { manualNote: String(r.manual_note) } : {}),
    ...(optionalDate(r.first_joined_at) ? { firstJoinedAt: optionalDate(r.first_joined_at) } : {}),
    ...(optionalDate(r.last_joined_at) ? { lastJoinedAt: optionalDate(r.last_joined_at) } : {}),
    ...(optionalDate(r.last_left_at) ? { lastLeftAt: optionalDate(r.last_left_at) } : {}),
    connectedDurationSeconds: num(r.connected_duration_seconds ?? 0),
    attendanceVersion: num(r.attendance_version),
  };
}
function attendanceSource(value: unknown): AttendanceRow["source"] {
  const source = String(value);
  if (source === "ONLINE" || source === "ONLINE_PRESENCE") return "ONLINE_PRESENCE";
  if (source === "MANUAL" || source === "MANUAL_OFFLINE") return "MANUAL_OFFLINE";
  return "NONE";
}
function checkpointRow(r: types.Row): PresenceCheckpoint {
  return {
    sessionId: String(r.session_id),
    studentId: String(r.student_id),
    presenceState: String(r.presence_state) as PresenceCheckpoint["presenceState"],
    activeConnectionCount: Number(r.active_connection_count ?? 0),
    ...(optionalDate(r.first_joined_at) ? { firstJoinedAt: optionalDate(r.first_joined_at) } : {}),
    ...(optionalDate(r.last_joined_at) ? { lastJoinedAt: optionalDate(r.last_joined_at) } : {}),
    ...(optionalDate(r.last_left_at) ? { lastLeftAt: optionalDate(r.last_left_at) } : {}),
    ...(optionalDate(r.last_seen_at) ? { lastSeenAt: optionalDate(r.last_seen_at) } : {}),
    accumulatedDurationSeconds: num(r.accumulated_duration_seconds ?? 0),
    checkpointVersion: num(r.checkpoint_version),
    updatedAt: date(r.updated_at),
  };
}

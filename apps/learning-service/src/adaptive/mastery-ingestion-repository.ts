import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { MasteryRecordV2, MultiFactorEvidence } from "../../../../packages/contracts/src/index.js";

const LQ = "LOCAL_QUORUM" as const, LS = "LOCAL_SERIAL" as const;
const uuid = (value: string) => types.Uuid.fromString(value);

export interface AuthoritativeMasteryEvidence {
  eventId: string; tenantId: string; studentId: string; courseId: string;
  learningOutcomeId: string; conceptId: string; sourceType: MultiFactorEvidence["evidenceSource"];
  sourceId: string; occurredAt: string; schemaVersion: string; rawScorePercent: number; correlationId: string;
}

export class MasteryIngestionRepository {
  constructor(private readonly db: CassandraClient) {}

  async reserve(event: AuthoritativeMasteryEvidence): Promise<"NEW" | "RECOVER" | "DONE"> {
    const now = new Date();
    const inserted = await this.db.execute(
      "INSERT INTO mastery_ingestion_by_event (event_id,state,student_id,course_id,source_type,retry_count,correlation_id,received_at,updated_at) VALUES (?,'RECEIVED',?,?,?,0,?,?,?) IF NOT EXISTS",
      [uuid(event.eventId), uuid(event.studentId), uuid(event.courseId), event.sourceType, uuid(event.correlationId), now, now], LQ, LS,
    );
    if (inserted[0]?.["[applied]"] === true) return "NEW";
    return String(inserted[0]?.state) === "PROCESSED" ? "DONE" : "RECOVER";
  }

  async persistEvidence(event: AuthoritativeMasteryEvidence): Promise<void> {
    await this.db.execute(
      "INSERT INTO mastery_evidence_by_student_course (student_id,course_id,learning_outcome_id,concept_id,occurred_at,event_id,tenant_id,source_type,source_id,raw_score_percent,schema_version,correlation_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS",
      [uuid(event.studentId), uuid(event.courseId), event.learningOutcomeId, event.conceptId, new Date(event.occurredAt), uuid(event.eventId), uuid(event.tenantId), event.sourceType, event.sourceId, event.rawScorePercent, event.schemaVersion, uuid(event.correlationId)], LQ, LS,
    );
  }

  async evidence(event: AuthoritativeMasteryEvidence): Promise<MultiFactorEvidence[]> {
    const rows = await this.db.execute(
      "SELECT event_id,source_type,raw_score_percent,occurred_at FROM mastery_evidence_by_student_course WHERE student_id=? AND course_id=? AND learning_outcome_id=? AND concept_id=? LIMIT 2000",
      [uuid(event.studentId), uuid(event.courseId), event.learningOutcomeId, event.conceptId], LQ,
    );
    if (rows.length >= 2000) throw new Error("MASTERY_EVIDENCE_PARTITION_LIMIT_EXCEEDED");
    return rows.map((row, index) => ({ evidenceId: String(row.event_id), evidenceSource: String(row.source_type) as MultiFactorEvidence["evidenceSource"], rawScorePercent: Number(row.raw_score_percent), attemptNumber: index + 1, timestamp: (row.occurred_at as Date).toISOString(), recencyWeight: 1 }));
  }

  async current(event: AuthoritativeMasteryEvidence): Promise<{ score: number; state: MasteryRecordV2["masteryState"] } | undefined> {
    const row = (await this.db.execute("SELECT mastery_score,mastery_state FROM mastery_v2_by_student_concept WHERE student_id=? AND course_id=? AND concept_id=?", [uuid(event.studentId), uuid(event.courseId), event.conceptId], LQ))[0];
    return row ? { score: Number(row.mastery_score), state: String(row.mastery_state) as MasteryRecordV2["masteryState"] } : undefined;
  }

  async saveProjection(record: MasteryRecordV2, event: AuthoritativeMasteryEvidence): Promise<void> {
    const explanation = JSON.stringify({ ...record.explanation, evidenceIds: record.evidenceIds, masteryPolicyId: record.masteryPolicyId, masteryPolicyVersion: record.masteryPolicyVersion });
    await this.db.execute(
      "INSERT INTO mastery_v2_by_student_concept (student_id,course_id,concept_id,tenant_id,learning_outcome_id,mastery_score,mastery_state,confidence_score,evidence_count,algorithm_version,policy_version,calculated_at,last_decay_at,updated_at,explanation_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [uuid(record.studentId), uuid(record.courseId), record.conceptId, uuid(record.tenantId), record.learningOutcomeId, record.masteryScore, record.masteryState, record.confidenceScore, record.evidenceCount, record.algorithmVersion, record.masteryPolicyVersion, new Date(record.calculatedAt), new Date(record.lastDecayEvaluationAt), new Date(), explanation], LQ,
    );
    await this.db.execute(
      "INSERT INTO mastery_v2_history (student_id,concept_id,calculated_at,previous_state,new_state,evidence_ids,reason) VALUES (?,?,?,?,?,?,?)",
      [uuid(record.studentId), record.conceptId, new Date(record.calculatedAt), record.previousMasteryState ?? "NOT_OBSERVED", record.masteryState, record.evidenceIds, `AUTHORITATIVE_EVENT:${event.sourceType}:${event.eventId}`], LQ,
    );
  }

  async complete(eventId: string): Promise<void> {
    await this.db.execute("UPDATE mastery_ingestion_by_event SET state='PROCESSED',processed_at=?,updated_at=?,last_error=null WHERE event_id=?", [new Date(), new Date(), uuid(eventId)], LQ);
  }

  async fail(eventId: string, reason: string): Promise<void> {
    const row = (await this.db.execute("SELECT retry_count FROM mastery_ingestion_by_event WHERE event_id=?", [uuid(eventId)], LQ))[0];
    await this.db.execute("UPDATE mastery_ingestion_by_event SET state='RETRY_PENDING',retry_count=?,last_error=?,updated_at=? WHERE event_id=?", [Number(row?.retry_count ?? 0) + 1, reason.slice(0, 500), new Date(), uuid(eventId)], LQ);
  }
}

import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type {
  MasteryRecordV2,
  StudyPlanItem,
  StudyPlanItemStatus,
  StudyPlanV2,
} from "../../../../packages/contracts/src/index.js";

const LQ = "LOCAL_QUORUM" as const;
const uuid = (value: string) => types.Uuid.fromString(value);

export class AdaptiveRuntimeRepository {
  constructor(private readonly db: CassandraClient) {}

  async mastery(studentId: string, courseId: string): Promise<MasteryRecordV2[]> {
    const rows = await this.db.execute(
      "SELECT tenant_id,concept_id,learning_outcome_id,mastery_score,mastery_state,confidence_score,evidence_count,algorithm_version,policy_version,calculated_at,last_decay_at,updated_at,explanation_json FROM mastery_v2_by_student_concept WHERE student_id=? AND course_id=? LIMIT 2000",
      [uuid(studentId), uuid(courseId)],
      LQ,
    );
    if (rows.length >= 2000) throw new Error("MASTERY_PARTITION_LIMIT_EXCEEDED");
    return rows.map((row) => {
      const explanation = parseObject(row.explanation_json);
      const calculatedAt = date(row.calculated_at).toISOString();
      return {
        studentId,
        tenantId: String(row.tenant_id),
        courseId,
        conceptId: String(row.concept_id),
        learningOutcomeId: String(row.learning_outcome_id),
        masteryScore: Number(row.mastery_score),
        masteryState: String(row.mastery_state) as MasteryRecordV2["masteryState"],
        confidenceScore: Number(row.confidence_score),
        evidenceCount: Number(row.evidence_count),
        evidenceIds: strings(explanation.evidenceIds),
        algorithmVersion: String(row.algorithm_version),
        ...(text(explanation.masteryPolicyId) ? { masteryPolicyId: text(explanation.masteryPolicyId) } : {}),
        ...(text(row.policy_version) || text(explanation.masteryPolicyVersion)
          ? { masteryPolicyVersion: text(row.policy_version) ?? text(explanation.masteryPolicyVersion) }
          : {}),
        calculatedAt,
        lastDecayEvaluationAt: date(row.last_decay_at ?? row.calculated_at).toISOString(),
        explanation: {
          whyState: text(explanation.whyState) ?? "Mastery was calculated from durable learning evidence.",
          nextSteps: text(explanation.nextSteps) ?? "Continue with the generated study plan.",
          contributingFactors: {
            assessmentPerformance: number(explanation.assessmentPerformance),
            attemptCount: number(explanation.attemptCount),
            recencyStatus: recency(explanation.recencyStatus),
            prerequisiteFoundationMet: explanation.prerequisiteFoundationMet !== false,
          },
        },
      };
    });
  }

  async savePlan(plan: StudyPlanV2): Promise<void> {
    await this.db.execute(
      "INSERT INTO study_plans_v2 (student_id,course_id,plan_id,tenant_id,week_start_date,generated_at,overall_mastery,plan_items_json) VALUES (?,?,?,?,?,?,?,?)",
      [
        uuid(plan.studentId),
        uuid(plan.courseId),
        uuid(plan.planId),
        uuid(plan.tenantId),
        plan.weekStartDate,
        new Date(plan.generatedAt),
        plan.overallMasteryPercent,
        JSON.stringify({
          items: plan.items,
          masteryGaps: plan.masteryGaps,
          upcomingAssessments: plan.upcomingAssessments,
        }),
      ],
      LQ,
    );
    await Promise.all(plan.items.map((item) => this.writeItemStatus(plan.studentId, item)));
  }

  async currentPlan(studentId: string, courseId: string): Promise<StudyPlanV2 | undefined> {
    const rows = await this.db.execute(
      "SELECT plan_id,tenant_id,week_start_date,generated_at,overall_mastery,plan_items_json FROM study_plans_v2 WHERE student_id=? AND course_id=? LIMIT 100",
      [uuid(studentId), uuid(courseId)],
      LQ,
    );
    const row = [...rows].sort((a, b) => date(b.generated_at).getTime() - date(a.generated_at).getTime())[0];
    if (!row) return undefined;
    const payload = parseObject(row.plan_items_json);
    const items = Array.isArray(payload.items) ? (payload.items as StudyPlanItem[]) : [];
    const statuses = await this.itemStatuses(studentId);
    return {
      planId: String(row.plan_id),
      studentId,
      tenantId: String(row.tenant_id),
      courseId,
      weekStartDate: String(row.week_start_date),
      generatedAt: date(row.generated_at).toISOString(),
      overallMasteryPercent: Number(row.overall_mastery),
      items: items.map((item) => ({ ...item, ...(statuses.get(item.itemId) ?? {}) })),
      masteryGaps: Array.isArray(payload.masteryGaps)
        ? (payload.masteryGaps as StudyPlanV2["masteryGaps"])
        : [],
      upcomingAssessments: Array.isArray(payload.upcomingAssessments)
        ? (payload.upcomingAssessments as StudyPlanV2["upcomingAssessments"])
        : [],
    };
  }

  async updateItem(
    studentId: string,
    courseId: string,
    itemId: string,
    status: StudyPlanItemStatus,
    scheduledDate?: string,
  ): Promise<StudyPlanItem | undefined> {
    const plan = await this.currentPlan(studentId, courseId);
    const item = plan?.items.find((candidate) => candidate.itemId === itemId);
    if (!item) return undefined;
    if (!validTransition(item.status, status)) throw new Error("INVALID_STUDY_PLAN_TRANSITION");
    const updated = { ...item, status, ...(scheduledDate ? { scheduledDate } : {}) };
    await this.writeItemStatus(studentId, updated);
    return updated;
  }

  private async writeItemStatus(studentId: string, item: StudyPlanItem) {
    await this.db.execute(
      "INSERT INTO study_plan_items_status (student_id,item_id,plan_id,course_id,status,action,scheduled_date,completed_at,reason_code,source_recommendation,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [
        uuid(studentId),
        uuid(item.itemId),
        uuid(item.planId),
        uuid(item.courseId),
        item.status,
        item.action,
        item.scheduledDate,
        item.status === "COMPLETED" ? new Date() : null,
        item.reasonCode,
        item.rationale,
        new Date(),
      ],
      LQ,
    );
  }

  private async itemStatuses(studentId: string) {
    const rows = await this.db.execute(
      "SELECT item_id,status,scheduled_date FROM study_plan_items_status WHERE student_id=? LIMIT 2000",
      [uuid(studentId)],
      LQ,
    );
    return new Map(
      rows.map((row) => [
        String(row.item_id),
        { status: String(row.status) as StudyPlanItemStatus, scheduledDate: String(row.scheduled_date) },
      ]),
    );
  }
}

const validTransition = (from: StudyPlanItemStatus, to: StudyPlanItemStatus) => {
  const transitions: Partial<Record<StudyPlanItemStatus, readonly StudyPlanItemStatus[]>> = {
    PENDING: ["ACCEPTED", "SKIPPED", "RESCHEDULED", "REPLACED"],
    PROPOSED: ["ACCEPTED", "SKIPPED", "RESCHEDULED", "REPLACED"],
    ACCEPTED: ["COMPLETED", "SKIPPED", "RESCHEDULED", "REPLACED"],
    RESCHEDULED: ["ACCEPTED", "COMPLETED", "SKIPPED", "REPLACED"],
  };
  return transitions[from]?.includes(to) === true;
};

const parseObject = (value: unknown): Record<string, unknown> => {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};
const date = (value: unknown) => (value instanceof Date ? value : new Date(String(value)));
const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
const recency = (value: unknown): "FRESH" | "STALE" | "DECAYING" =>
  value === "STALE" || value === "DECAYING" ? value : "FRESH";

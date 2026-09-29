import { execFileSync } from "node:child_process";
const uuid = (value) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value))
    throw new Error("INVALID_DURABLE_EVIDENCE_UUID");
  return value;
};
const text = (value) => {
  if (!/^[a-z0-9:-]+$/iu.test(value)) throw new Error("INVALID_DURABLE_EVIDENCE_KEY");
  return value;
};
const query = (cql) => {
  let output;
  try {
    output = execFileSync(
      "docker",
      [
        "exec",
        "-i",
        "ailss-cassandra-dev",
        "cqlsh",
        "-u",
        "cassandra",
        "-p",
        "cassandra",
        "--request-timeout=30",
        "-e",
        cql,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch {
    throw new Error("LOCAL_CASSANDRA_EVIDENCE_QUERY_FAILED");
  }
  try {
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));
  } catch {
    throw new Error("LOCAL_CASSANDRA_EVIDENCE_PARSE_FAILED");
  }
};

export async function captureDurable({ studentId, courseId, quizId }) {
  const student = uuid(studentId),
    course = uuid(courseId),
    conceptId = text(`quiz:${uuid(quizId)}`);
  const evidence = query(
    `SELECT JSON event_id,source_type,source_id,raw_score_percent,occurred_at FROM learning_keyspace.mastery_evidence_by_student_course WHERE student_id=${student} AND course_id=${course} AND learning_outcome_id='${conceptId}' AND concept_id='${conceptId}' LIMIT 2000;`,
  );
  const ingestion = evidence.flatMap((row) =>
    query(
      `SELECT JSON event_id,state,retry_count,processed_at FROM learning_keyspace.mastery_ingestion_by_event WHERE event_id=${uuid(row.event_id)};`,
    ),
  );
  const mastery =
    query(
      `SELECT JSON concept_id,mastery_score,mastery_state,evidence_count,calculated_at FROM learning_keyspace.mastery_v2_by_student_concept WHERE student_id=${student} AND course_id=${course} AND concept_id='${conceptId}';`,
    )[0] ?? null;
  const history = query(
    `SELECT JSON calculated_at,previous_state,new_state,evidence_ids,reason FROM learning_keyspace.mastery_v2_history WHERE student_id=${student} AND concept_id='${conceptId}' LIMIT 100;`,
  );
  const rawPlans = query(
    `SELECT JSON plan_id,generated_at,overall_mastery FROM learning_keyspace.study_plans_v2 WHERE student_id=${student} AND course_id=${course} LIMIT 100;`,
  );
  const itemRows = query(
    `SELECT JSON item_id,plan_id,course_id,status,reason_code,updated_at FROM learning_keyspace.study_plan_items_status WHERE student_id=${student} LIMIT 2000;`,
  );
  const plans = rawPlans
    .map((row) => {
      const items = itemRows.filter((item) => item.plan_id === row.plan_id);
      return {
        planId: row.plan_id,
        generatedAt: row.generated_at,
        overallMastery: row.overall_mastery,
        itemCount: items.length,
        itemIds: items.map((item) => item.item_id),
      };
    })
    .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
  return {
    studentId: student,
    courseId: course,
    quizId,
    conceptId,
    ingestion: ingestion.map((row) => ({
      eventId: row.event_id,
      state: row.state,
      retryCount: row.retry_count,
      processedAt: row.processed_at,
    })),
    evidence: evidence.map((row) => ({
      eventId: row.event_id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      score: row.raw_score_percent,
      occurredAt: row.occurred_at,
    })),
    mastery: mastery
      ? {
          conceptId: mastery.concept_id,
          score: mastery.mastery_score,
          state: mastery.mastery_state,
          evidenceCount: mastery.evidence_count,
          calculatedAt: mastery.calculated_at,
        }
      : null,
    history: history.map((row) => ({
      calculatedAt: row.calculated_at,
      previousState: row.previous_state,
      newState: row.new_state,
      evidenceIds: row.evidence_ids,
      reason: row.reason,
    })),
    plans,
    currentPlanItems: itemRows
      .filter((row) => row.plan_id === plans[0]?.planId)
      .map((row) => ({
        itemId: row.item_id,
        planId: row.plan_id,
        courseId: row.course_id,
        status: row.status,
        reasonCode: row.reason_code,
        updatedAt: row.updated_at,
      })),
  };
}

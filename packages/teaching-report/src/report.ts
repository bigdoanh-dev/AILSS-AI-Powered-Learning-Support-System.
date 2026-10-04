type Classroom = { classId: string; name: string; state: "ACTIVE" | "CLOSED"; linkedCourseId?: string };
type Member = { studentId: string; state: "ACTIVE" | "PENDING"; joinedAt?: string };
type Enrollment = { studentId: string; state: string; enrolledAt: string };
type Session = { sessionId: string; startAt: string; endAt: string; status: string };
type Attendance = { studentId: string; attendanceStatus: string };
type Quiz = {
  quizId: string;
  state: string;
  opensAt?: string;
  closesAt?: string;
  createdAt: string;
};
type Result = {
  attemptId: string;
  studentId: string;
  score: string;
  maxScore: string;
  submittedAt: string;
  gradingStatus: string;
};
type ResultPage = { items: Result[]; nextCursor?: string };

export type ReportClass = {
  classId: string;
  className: string;
  state: Classroom["state"];
  students: number;
  quizzes: number;
  submitted: number;
  expected: number;
  pending: number;
  scoreSum: number;
  scored: number;
  passed: number;
  present: number;
  recorded: number;
  distribution: number[];
};

export type TeachingReport = {
  classes: ReportClass[];
  from: string;
  to: string;
  fetchedAt: string;
};

export type Read = <T>(path: string, signal: AbortSignal, fallback?: T) => Promise<{ data: T }>;
export class ReportDataError extends Error {}
const day = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86400000);
const vietnamOffset = 7 * 60 * 60 * 1000;
const asArray = <T>(value: unknown, path: string): T[] => {
  if (!Array.isArray(value)) throw new ReportDataError(`Phản hồi dữ liệu không hợp lệ: ${path}`);
  return value as T[];
};
const percentScore = (item: Result) => {
  const score = Number(item.score);
  const max = Number(item.maxScore);
  return Number.isFinite(score) && Number.isFinite(max) && max > 0 && score >= 0 && score <= max
    ? (score / max) * 10
    : null;
};
const memberCanSubmit = (member: Member, quiz: Quiz, now: Date) =>
  !member.joinedAt || Date.parse(member.joinedAt) <= Date.parse(quiz.closesAt ?? now.toISOString());

function months(from: Date, to: Date) {
  const result: string[] = [];
  const current = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (current <= to) {
    result.push(current.toISOString().slice(0, 7));
    current.setUTCMonth(current.getUTCMonth() + 1);
  }
  return result;
}

function chunks(from: Date, to: Date) {
  const result: { from: string; to: string }[] = [];
  for (let current = new Date(from); current <= to; current = addDays(current, 31)) {
    const last = addDays(current, 30);
    result.push({ from: day(current), to: day(last < to ? last : to) });
  }
  return result;
}

async function mapLimit<T, U>(items: T[], limit: number, task: (item: T) => Promise<U>): Promise<U[]> {
  const results = Array<U>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        const item = items[index];
        if (item !== undefined) {
          results[index] = await task(item);
        }
      }
    }),
  );
  return results;
}

async function readResults(quizId: string, month: string, signal: AbortSignal, read: Read) {
  const items: Result[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const path = `/quizzes/${quizId}/results?month=${month}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const page = (await read<ResultPage | null | undefined>(path, signal)).data;
    if (!page || !Array.isArray(page.items))
      throw new ReportDataError(`Phản hồi kết quả không hợp lệ: ${path}`);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor) {
      if (seen.has(cursor) || seen.size >= 100)
        throw new ReportDataError("Kết quả quá lớn hoặc phân trang bị lặp; chưa thể tổng hợp chính xác.");
      seen.add(cursor);
    }
  } while (cursor);
  return items;
}

export async function loadTeachingReport(
  days: 30 | 90 | 365,
  signal: AbortSignal,
  read: Read,
  now = new Date(),
): Promise<TeachingReport> {
  // Calendar filters follow Vietnam's UTC+7 day; service partitions and result months use UTC.
  const localNow = new Date(now.getTime() + vietnamOffset);
  const localEnd = new Date(
    Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()),
  );
  const localStart = addDays(localEnd, -(days - 1));
  const start = new Date(localStart.getTime() - vietnamOffset);
  const from = day(localStart);
  const to = day(localEnd);
  const path = "/me/owned-classes";
  const classes = asArray<Classroom>((await read<Classroom[]>(path, signal)).data, path);
  const monthKeys = months(start, now);
  const windows = chunks(start, now);
  const summaries = await mapLimit(classes, 3, async (klass): Promise<ReportClass> => {
    const classId = encodeURIComponent(klass.classId);
    const membersPath = `/classes/${classId}/members`;
    const quizzesPath = `/targets/CLASS/${classId}/quizzes`;
    const courseId = klass.linkedCourseId ? encodeURIComponent(klass.linkedCourseId) : null;
    const courseQuizzesPath = courseId ? `/targets/COURSE/${courseId}/quizzes` : null;
    const courseRosterPath = courseId ? `/courses/${courseId}/roster` : null;
    const [membersResponse, quizzesResponse, sessionsByWindow, courseQuizzesResponse, courseRosterResponse] =
      await Promise.all([
        read<Member[]>(membersPath, signal),
        read<Quiz[]>(quizzesPath, signal),
        mapLimit(windows, 4, async (window) => {
          const sessionsPath = `/classes/${classId}/sessions?from=${window.from}&to=${window.to}`;
          return asArray<Session>((await read<Session[]>(sessionsPath, signal)).data, sessionsPath);
        }),
        courseQuizzesPath ? read<Quiz[]>(courseQuizzesPath, signal) : Promise.resolve(null),
        courseRosterPath ? read<Enrollment[]>(courseRosterPath, signal) : Promise.resolve(null),
      ]);
    const members = asArray<Member>(membersResponse.data, membersPath).filter(
      (member) => member.state === "ACTIVE",
    );
    const studentIds = new Set(members.map((member) => member.studentId));
    const classQuizzes = asArray<Quiz>(quizzesResponse.data, quizzesPath);
    const courseQuizzes =
      courseQuizzesPath && courseQuizzesResponse
        ? asArray<Quiz>(courseQuizzesResponse.data, courseQuizzesPath)
        : [];
    const enrollments =
      courseRosterPath && courseRosterResponse
        ? asArray<Enrollment>(courseRosterResponse.data, courseRosterPath)
        : [];
    const enrolled = new Map(
      enrollments.filter((row) => row.state === "ACTIVE").map((row) => [row.studentId, row]),
    );
    // The assessment list endpoint returns at most 50 quizzes and has no cursor.
    if (classQuizzes.length >= 50 || courseQuizzes.length >= 50)
      throw new ReportDataError(
        `Lớp ${klass.name} có từ 50 bài kiểm tra trong một nguồn; API chưa hỗ trợ phân trang báo cáo.`,
      );
    const eligibleQuizzes = [
      ...classQuizzes.map((quiz) => ({ quiz, target: "CLASS" as const })),
      ...courseQuizzes.map((quiz) => ({ quiz, target: "COURSE" as const })),
    ]
      .filter(
        ({ quiz }) =>
          quiz.state === "PUBLISHED" &&
          Date.parse(quiz.opensAt ?? quiz.createdAt) <= now.getTime() &&
          (!quiz.closesAt || Date.parse(quiz.closesAt) >= start.getTime()),
      )
      .map(({ quiz, target }) => ({
        quiz,
        eligibleStudents: new Set(
          members
            .filter((member) => {
              if (!memberCanSubmit(member, quiz, now)) return false;
              if (target === "CLASS") return true;
              const enrollment = enrolled.get(member.studentId);
              return (
                !!enrollment &&
                Date.parse(enrollment.enrolledAt) <= Date.parse(quiz.closesAt ?? now.toISOString())
              );
            })
            .map((member) => member.studentId),
        ),
      }));
    const uniqueSessions = new Map(sessionsByWindow.flat().map((session) => [session.sessionId, session]));
    const pastSessions = [...uniqueSessions.values()].filter(
      (session) =>
        session.status !== "CANCELLED" &&
        session.status !== "DRAFT" &&
        Date.parse(session.endAt) <= now.getTime() &&
        Date.parse(session.startAt) >= start.getTime(),
    );
    if (members.length > 100 && pastSessions.length)
      throw new ReportDataError(
        `Lớp ${klass.name} có trên 100 học viên; API điểm danh chưa trả đủ dữ liệu để báo cáo.`,
      );
    const [attendanceRows, resultsByQuiz] = await Promise.all([
      mapLimit(pastSessions, 4, async (session) => {
        const attendancePath = `/class-sessions/${encodeURIComponent(session.sessionId)}/attendance`;
        return asArray<Attendance>((await read<Attendance[]>(attendancePath, signal)).data, attendancePath);
      }),
      mapLimit(eligibleQuizzes, 4, async ({ quiz, eligibleStudents }) => ({
        quiz,
        eligibleStudents,
        pages: await mapLimit(monthKeys, 4, (month) => readResults(quiz.quizId, month, signal, read)),
      })),
    ]);
    let present = 0;
    let recorded = 0;
    for (const row of attendanceRows.flat()) {
      if (!studentIds.has(row.studentId)) continue;
      if (["PRESENT", "ABSENT", "EXCUSED"].includes(row.attendanceStatus)) {
        recorded++;
        if (row.attendanceStatus === "PRESENT") present++;
      }
    }
    const latest = new Map<string, Result>();
    for (const { quiz, eligibleStudents, pages } of resultsByQuiz) {
      for (const item of pages.flat()) {
        const submittedAt = Date.parse(item.submittedAt);
        if (
          !eligibleStudents.has(item.studentId) ||
          submittedAt < start.getTime() ||
          submittedAt > now.getTime()
        )
          continue;
        const key = `${quiz.quizId}:${item.studentId}`;
        const prior = latest.get(key);
        if (!prior || Date.parse(prior.submittedAt) < submittedAt) latest.set(key, item);
      }
    }
    let pending = 0;
    let scoreSum = 0;
    let scored = 0;
    let passed = 0;
    const distribution = [0, 0, 0, 0, 0];
    for (const item of latest.values()) {
      if (item.gradingStatus === "PENDING_MANUAL_GRADING") {
        pending++;
        continue;
      }
      const score = percentScore(item);
      if (score === null) continue;
      scored++;
      scoreSum += score;
      if (score >= 5) passed++;
      const bucket = score < 5 ? 0 : score < 6.5 ? 1 : score < 8 ? 2 : score < 9 ? 3 : 4;
      distribution[bucket] = (distribution[bucket] ?? 0) + 1;
    }
    return {
      classId: klass.classId,
      className: klass.name,
      state: klass.state,
      students: members.length,
      quizzes: eligibleQuizzes.length,
      submitted: latest.size,
      expected: eligibleQuizzes.reduce((count, item) => count + item.eligibleStudents.size, 0),
      pending,
      scoreSum,
      scored,
      passed,
      present,
      recorded,
      distribution,
    };
  });
  if (signal.aborted) throw new Error("Aborted");
  return { classes: summaries, from, to, fetchedAt: new Date().toISOString() };
}

export function aggregateReport(classes: ReportClass[]) {
  const total = classes.reduce(
    (value, row) => ({
      students: value.students + row.students,
      quizzes: value.quizzes + row.quizzes,
      submitted: value.submitted + row.submitted,
      expected: value.expected + row.expected,
      pending: value.pending + row.pending,
      scoreSum: value.scoreSum + row.scoreSum,
      scored: value.scored + row.scored,
      passed: value.passed + row.passed,
      present: value.present + row.present,
      recorded: value.recorded + row.recorded,
      distribution: value.distribution.map((count, index) => count + (row.distribution[index] ?? 0)),
    }),
    {
      students: 0,
      quizzes: 0,
      submitted: 0,
      expected: 0,
      pending: 0,
      scoreSum: 0,
      scored: 0,
      passed: 0,
      present: 0,
      recorded: 0,
      distribution: [0, 0, 0, 0, 0],
    },
  );
  return {
    ...total,
    submissionRate: total.expected ? (100 * total.submitted) / total.expected : null,
    averageScore: total.scored ? total.scoreSum / total.scored : null,
    attendanceRate: total.recorded ? (100 * total.present) / total.recorded : null,
    passRate: total.scored ? (100 * total.passed) / total.scored : null,
  };
}

function csvCell(value: string | number) {
  const safe = String(value).replace(/^[\s]*[=+@-]/, "'$&");
  return `"${safe.replaceAll('"', '""')}"`;
}

export function reportCsv(
  report: TeachingReport,
  classes: ReportClass[],
  translateHeader: (source: string) => string = (source) => source,
) {
  const header = [
    "Từ ngày",
    "Đến ngày",
    "Mã lớp",
    "Tên lớp",
    "Học viên đang học",
    "Bài kiểm tra",
    "Lượt nộp",
    "Lượt có thể nộp",
    "Tỷ lệ nộp (%)",
    "Chờ chấm",
    "Điểm TB / 10",
    "Lượt điểm danh có mặt",
    "Lượt điểm danh đã ghi",
    "Chuyên cần (%)",
    "Tỷ lệ đạt (%)",
  ];
  const rows = classes.map((row) => {
    const stat = aggregateReport([row]);
    return [
      report.from,
      report.to,
      row.classId,
      row.className,
      row.students,
      row.quizzes,
      row.submitted,
      row.expected,
      stat.submissionRate?.toFixed(1) ?? "",
      row.pending,
      stat.averageScore?.toFixed(1) ?? "",
      row.present,
      row.recorded,
      stat.attendanceRate?.toFixed(1) ?? "",
      stat.passRate?.toFixed(1) ?? "",
    ];
  });
  return [header.map((source) => translateHeader(source)), ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

/** Small, explicit fixtures. No payments, invented KPI values or production data. */
export function selectClass(classes, membershipIds, ownerId, courseId, name) {
  const candidates = classes.filter(
    (item) =>
      item.ownerLecturerId === ownerId &&
      item.linkedCourseId === courseId &&
      item.name === name &&
      item.state === "ACTIVE" &&
      item.scheduleState === "PUBLISHED" &&
      membershipIds.has(item.classId),
  );
  if (candidates.length !== 1) throw Error(`Expected one joined, published demo class: ${name}`);
  return candidates[0];
}

export function demoAnswers(questions, wrongFirst = false) {
  if (!questions.length) throw Error("Demo quiz must contain questions");
  return questions.map((question, index) => {
    const wrong = wrongFirst && index === 0;
    if (question.questionType === "TRUE_FALSE") {
      if (typeof question.correctAnswer !== "boolean") throw Error("Missing owner answer");
      return {
        questionId: question.questionId,
        value: wrong ? !question.correctAnswer : question.correctAnswer,
      };
    }
    if (question.questionType === "SINGLE_CHOICE") {
      if (!question.options?.includes(question.correctAnswer)) throw Error("Missing owner answer");
      return {
        questionId: question.questionId,
        selectedOptionId: wrong
          ? question.options.find((option) => option !== question.correctAnswer)
          : question.correctAnswer,
      };
    }
    throw Error(`Unsupported demo question: ${question.questionType}`);
  });
}

export function sessionPlan(createdAt, existing = []) {
  const base = new Date(createdAt);
  if (!Number.isFinite(base.getTime())) throw Error("Invalid fixture date");
  // Vietnam calendar day, 09:00–10:30 local. Skip overlapping student sessions.
  const day = new Date(base.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  const first = Date.parse(`${day}T02:00:00Z`);
  const sessions = [];
  for (let offset = 3; offset <= 24 && sessions.length < 3; offset++) {
    const start = first + offset * 86400000;
    const end = start + 90 * 60000;
    if (existing.some((entry) => start < Date.parse(entry.endAt) && end > Date.parse(entry.startAt)))
      continue;
    sessions.push({
      title: `[Demo] Python thực hành - Buổi ${sessions.length + 1}`,
      startAt: new Date(start).toISOString(),
      endAt: new Date(end).toISOString(),
      timezone: "Asia/Ho_Chi_Minh",
      mode: "OFFLINE",
      location: "Phòng thực hành Python (dữ liệu demo)",
    });
    offset++; // Space sessions out by at least two days.
  }
  if (sessions.length !== 3) throw Error("No three non-overlapping demo sessions available");
  return sessions;
}

export const pythonQuiz = {
  title: "[Demo] Python: biến, danh sách và vòng lặp",
  durationSeconds: 900,
  attemptLimit: 3,
  questions: [
    {
      prompt: "Hàm nào trả về số phần tử của một danh sách?",
      questionType: "SINGLE_CHOICE",
      options: ["len", "sum", "print"],
      correctAnswer: "len",
      points: "2.5",
    },
    {
      prompt: "Chỉ số đầu tiên của một danh sách Python là 0.",
      questionType: "TRUE_FALSE",
      correctAnswer: true,
      points: "2.5",
    },
    {
      prompt: "range(3) sinh ra những giá trị nào?",
      questionType: "SINGLE_CHOICE",
      options: ["0, 1, 2", "1, 2, 3", "0, 1, 2, 3"],
      correctAnswer: "0, 1, 2",
      points: "2.5",
    },
    {
      prompt: "Danh sách Python có thể thay đổi sau khi tạo.",
      questionType: "TRUE_FALSE",
      correctAnswer: true,
      points: "2.5",
    },
  ],
};

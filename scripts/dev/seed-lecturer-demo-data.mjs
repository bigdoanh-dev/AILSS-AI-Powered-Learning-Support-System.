/**
 * Seed script for Lecturer Demo Account (lecturer.demo@ailss.local)
 * Populates realistic demo data for:
 * 1. Lịch dạy (Teaching Schedule with multiple sessions in current month Oct 2026)
 * 2. Điểm danh (Attendance records with PRESENT, EXCUSED, ABSENT)
 * 3. Bài kiểm tra (Quizzes with comprehensive questions published for both Classes & Courses)
 * 4. Bảng điểm (Gradebook with student submissions, auto scores, manual grades and teacher feedback)
 */
import { randomUUID } from "node:crypto";

const origin = new URL(process.env.AILSS_GATEWAY_URL || "http://127.0.0.1:8080");

async function main() {
  console.log("🚀 Bắt đầu nạp dữ liệu demo cho giảng viên (lecturer.demo@ailss.local)...");

  // Helper for API calls
  async function api(token, path, method = "GET", body, key) {
    const headers = {
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    };
    const response = await fetch(new URL("/api/v1" + path, origin), {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok) {
      const err = new Error(
        `${method} ${path}: ${response.status} ${result.error?.code || "UNKNOWN"} - ${result.error?.message || ""}`,
      );
      err.response = result;
      err.status = response.status;
      throw err;
    }
    return result.data;
  }

  // 1. Log in lecturer
  console.log("🔑 Đang đăng nhập tài khoản Giảng viên...");
  const lecturerLogin = await api(null, "/auth/login", "POST", {
    email: "lecturer.demo@ailss.local",
    password: process.env.AILSS_DEMO_LECTURER_PASSWORD || "AilssLecturer!2026",
  });
  const lecturerToken = lecturerLogin.accessToken;
  const me = await api(lecturerToken, "/me");
  console.log(`✅ Giảng viên: ${me.displayName} (${me.userId})`);

  // 2. Ensure demo students exist and get their tokens
  console.log("👥 Đang chuẩn bị danh sách học viên mẫu...");
  const studentAccounts = [
    { email: "student.demo@ailss.local", password: "AilssDemo!2026", name: "Học viên Demo AILSS" },
    { email: "nam.hoang.student@ailss.local", password: "StudentPass!2026", name: "Hoàng Văn Nam" },
    { email: "mai.anh.student@ailss.local", password: "StudentPass!2026", name: "Trần Thị Mai Anh" },
    { email: "quoc.bao.student@ailss.local", password: "StudentPass!2026", name: "Lê Quốc Bảo" },
    { email: "thu.ha.student@ailss.local", password: "StudentPass!2026", name: "Phạm Thu Hà" },
  ];

  const students = [];
  for (const acc of studentAccounts) {
    let token = null;
    let userId = null;
    try {
      const login = await api(null, "/auth/login", "POST", { email: acc.email, password: acc.password });
      token = login.accessToken;
      const sMe = await api(token, "/me");
      userId = sMe.userId;
    } catch {
      // Register if not exist
      try {
        const reg = await api(
          null,
          "/auth/register",
          "POST",
          {
            email: acc.email,
            password: acc.password,
            displayName: acc.name,
          },
          `reg-${acc.email}`,
        );
        userId = reg.userId;
        const login = await api(null, "/auth/login", "POST", { email: acc.email, password: acc.password });
        token = login.accessToken;
      } catch (err) {
        console.warn(`Không thể đăng ký ${acc.email}:`, err.message);
      }
    }
    if (token && userId) {
      students.push({ ...acc, token, userId });
      console.log(`   + Học viên: ${acc.name} (${acc.email})`);
    }
  }

  // 3. Find published courses for linking
  const ownedCoursesRes = await api(lecturerToken, "/me/owned-courses");
  const ownedCourses = ownedCoursesRes.items || ownedCoursesRes || [];
  const webCourse = ownedCourses.find((c) => c.title.includes("Lập trình web")) || ownedCourses[0];
  const cassandraCourse =
    ownedCourses.find((c) => c.title.includes("Cassandra")) || ownedCourses[1] || webCourse;

  // 4. Create or reuse Class 1: Lớp K26 - Lập trình Web Fullstack & AI
  console.log("\n🏫 1. Tạo lớp học & thời khóa biểu (Lịch dạy)...");
  const ownedClassesRes = await api(lecturerToken, "/me/owned-classes");
  const ownedClasses = ownedClassesRes.classes || ownedClassesRes || [];

  let classA = null;
  const candidatesA = ownedClasses.filter(
    (c) =>
      c.name.includes("Lớp K26: Lập trình Web Fullstack & Ứng dụng AI") && c.scheduleState === "PUBLISHED",
  );
  for (const c of candidatesA) {
    try {
      const m = await api(lecturerToken, `/classes/${c.classId}/members`);
      if ((m.members || m || []).length > 0) {
        classA = c;
        break;
      }
    } catch {}
  }
  if (!classA && candidatesA.length > 0) classA = candidatesA[0];
  if (!classA) {
    classA = ownedClasses.find(
      (c) => c.name.includes("Lớp K26: Lập trình Web Fullstack & Ứng dụng AI") && c.state === "ACTIVE",
    );
  }

  if (!classA) {
    classA = await api(
      lecturerToken,
      "/classes",
      "POST",
      {
        name: "Lớp K26: Lập trình Web Fullstack & Ứng dụng AI",
        classKind: "PRIVATE",
        linkedCourseId: webCourse?.courseId,
        maxMembers: 50,
      },
      `cls-web-k26-${randomUUID()}`,
    );
    console.log(`   + Đã tạo Lớp mới: "${classA.name}" (Mã tham gia: ${classA.joinCode})`);
  } else {
    console.log(`   + Sử dụng Lớp sẵn có: "${classA.name}" (ID: ${classA.classId})`);
  }

  // Add 6 sessions for Class A in October 2026 if none exist
  let sessionsClassAData = [];
  try {
    const sRes = await api(
      lecturerToken,
      `/classes/${classA.classId}/sessions?from=2026-10-01&to=2026-10-31`,
    );
    sessionsClassAData = sRes.data || sRes || [];
  } catch {}

  const createdSessionsA = [...sessionsClassAData];
  if (!sessionsClassAData.length) {
    const sessionsClassA = [
      {
        title: "Buổi 1: Kiến trúc Web hiện đại & Thiết lập môi trường phát triển",
        startAt: "2026-10-01T08:00:00.000Z",
        endAt: "2026-10-01T10:00:00.000Z",
        timezone: "Asia/Ho_Chi_Minh",
        mode: "OFFLINE",
        location: "Phòng thực hành Lab 302 - Nhà A (Tầng 3)",
      },
      {
        title: "Buổi 2: Thiết kế giao diện chuyên sâu với CSS Flexbox & CSS Grid",
        startAt: "2026-10-02T08:00:00.000Z",
        endAt: "2026-10-02T10:00:00.000Z",
        timezone: "Asia/Ho_Chi_Minh",
        mode: "OFFLINE",
        location: "Phòng thực hành Lab 302 - Nhà A (Tầng 3)",
      },
      {
        title: "Buổi 3: Lập trình tương tác DOM & Xử lý sự kiện JavaScript ES6+",
        startAt: "2026-10-05T13:30:00.000Z",
        endAt: "2026-10-05T15:30:00.000Z",
        timezone: "Asia/Ho_Chi_Minh",
        mode: "ONLINE",
        meetingProvider: "Google Meet",
        meetingUrl: "https://meet.google.com/ail-webk-fst",
      },
      {
        title: "Buổi 4: Làm việc với Web API, Fetch & Xử lý bất đồng bộ (Promise/Async)",
        startAt: "2026-10-07T08:00:00.000Z",
        endAt: "2026-10-07T10:00:00.000Z",
        timezone: "Asia/Ho_Chi_Minh",
        mode: "OFFLINE",
        location: "Phòng thực hành Lab 302 - Nhà A (Tầng 3)",
      },
      {
        title: "Buổi 5: Tích hợp Microservices & Xây dựng RESTful API Gateway",
        startAt: "2026-10-09T13:30:00.000Z",
        endAt: "2026-10-09T15:30:00.000Z",
        timezone: "Asia/Ho_Chi_Minh",
        mode: "ONLINE",
        meetingProvider: "Google Meet",
        meetingUrl: "https://meet.google.com/ail-webk-fst",
      },
      {
        title: "Buổi 6: Báo cáo đồ án Mini-Project & Hỏi đáp chuyên sâu",
        startAt: "2026-10-12T08:00:00.000Z",
        endAt: "2026-10-12T11:00:00.000Z",
        timezone: "Asia/Ho_Chi_Minh",
        mode: "OFFLINE",
        location: "Hội trường H2 - Giảng đường trung tâm",
      },
    ];

    for (const s of sessionsClassA) {
      const sRes = await api(
        lecturerToken,
        `/classes/${classA.classId}/sessions`,
        "POST",
        s,
        `sess-${randomUUID()}`,
      );
      createdSessionsA.push(sRes.sessions?.[0] || sRes);
    }
    console.log(`   + Đã tạo ${createdSessionsA.length} buổi học trong tháng 10/2026.`);
  } else {
    console.log(`   + Đã có sẵn ${createdSessionsA.length} buổi học trong tháng 10/2026.`);
  }

  // Publish schedule for Class A if draft
  if (classA.scheduleState !== "PUBLISHED") {
    try {
      await api(
        lecturerToken,
        `/classes/${classA.classId}/schedule/publish`,
        "POST",
        {},
        `pub-sched-${randomUUID()}`,
      );
      console.log("   + Đã xuất bản thời khóa biểu cho lớp.");
    } catch {
      /* ignore */
    }
  }

  // Have all students join Class A if not already joined
  let membersA = [];
  try {
    const mRes = await api(lecturerToken, `/classes/${classA.classId}/members`);
    membersA = mRes.members || mRes || [];
  } catch {}
  const joinedStudentIdsA = new Set(membersA.map((m) => m.studentId));

  for (const st of students) {
    if (!joinedStudentIdsA.has(st.userId) && classA.joinCode) {
      try {
        await api(
          st.token,
          "/classes/join",
          "POST",
          { code: classA.joinCode },
          `join-${st.userId}-${classA.classId}`,
        );
      } catch (err) {
        /* ignore if conflict */
      }
    }
  }

  // 5. Create or reuse Class 2: Lớp Chuyên đề: Cơ sở dữ liệu phân tán Cassandra
  let classB = null;
  const candidatesB = ownedClasses.filter(
    (c) =>
      c.name.includes("Lớp Chuyên đề: Cơ sở dữ liệu phân tán Cassandra & Big Data") &&
      c.scheduleState === "PUBLISHED",
  );
  for (const c of candidatesB) {
    try {
      const m = await api(lecturerToken, `/classes/${c.classId}/members`);
      if ((m.members || m || []).length > 0) {
        classB = c;
        break;
      }
    } catch {}
  }
  if (!classB && candidatesB.length > 0) classB = candidatesB[0];
  if (!classB) {
    classB = ownedClasses.find(
      (c) =>
        c.name.includes("Lớp Chuyên đề: Cơ sở dữ liệu phân tán Cassandra & Big Data") && c.state === "ACTIVE",
    );
  }

  if (!classB) {
    classB = await api(
      lecturerToken,
      "/classes",
      "POST",
      {
        name: "Lớp Chuyên đề: Cơ sở dữ liệu phân tán Cassandra & Big Data",
        classKind: "PRIVATE",
        linkedCourseId: cassandraCourse?.courseId,
        maxMembers: 40,
      },
      `cls-cas-${randomUUID()}`,
    );
    console.log(`\n🏫 2. Tạo lớp học thứ hai: "${classB.name}" (Mã: ${classB.joinCode})`);
  } else {
    console.log(`\n🏫 2. Sử dụng lớp học thứ hai sẵn có: "${classB.name}" (ID: ${classB.classId})`);
  }

  let sessionsClassBData = [];
  try {
    const sRes = await api(
      lecturerToken,
      `/classes/${classB.classId}/sessions?from=2026-10-01&to=2026-10-31`,
    );
    sessionsClassBData = sRes.data || sRes || [];
  } catch {}

  const createdSessionsB = [...sessionsClassBData];
  if (!sessionsClassBData.length) {
    const sessionsClassB = [
      {
        title: "Buổi 1: Tổng quan NoSQL & Kiến trúc phân tán Peer-to-Peer của Cassandra",
        startAt: "2026-10-01T14:00:00.000Z",
        endAt: "2026-10-01T16:00:00.000Z",
        timezone: "Asia/Ho_Chi_Minh",
        mode: "OFFLINE",
        location: "Phòng Lab Dữ liệu 405 - Tòa CNTT",
      },
      {
        title: "Buổi 2: Thiết kế mô hình dữ liệu CQL dựa trên Access Pattern",
        startAt: "2026-10-06T08:00:00.000Z",
        endAt: "2026-10-06T10:00:00.000Z",
        timezone: "Asia/Ho_Chi_Minh",
        mode: "OFFLINE",
        location: "Phòng Lab Dữ liệu 405 - Tòa CNTT",
      },
      {
        title: "Buổi 3: Tối ưu Partition Key, Clustering Key và phân tán dữ liệu",
        startAt: "2026-10-08T14:00:00.000Z",
        endAt: "2026-10-08T16:00:00.000Z",
        timezone: "Asia/Ho_Chi_Minh",
        mode: "ONLINE",
        meetingProvider: "Google Meet",
        meetingUrl: "https://meet.google.com/cas-data-k26",
      },
      {
        title: "Buổi 4: Reconcile dữ liệu, Anti-Entropy Repair và Replication Strategy",
        startAt: "2026-10-13T08:00:00.000Z",
        endAt: "2026-10-13T10:00:00.000Z",
        timezone: "Asia/Ho_Chi_Minh",
        mode: "OFFLINE",
        location: "Phòng Lab Dữ liệu 405 - Tòa CNTT",
      },
    ];

    for (const s of sessionsClassB) {
      const sRes = await api(
        lecturerToken,
        `/classes/${classB.classId}/sessions`,
        "POST",
        s,
        `sess-b-${randomUUID()}`,
      );
      createdSessionsB.push(sRes.sessions?.[0] || sRes);
    }
  }

  if (classB.scheduleState !== "PUBLISHED") {
    await api(
      lecturerToken,
      `/classes/${classB.classId}/schedule/publish`,
      "POST",
      {},
      `pub-sched-b-${randomUUID()}`,
    );
  }

  let membersB = [];
  try {
    const mRes = await api(lecturerToken, `/classes/${classB.classId}/members`);
    membersB = mRes.members || mRes || [];
  } catch {}
  const joinedStudentIdsB = new Set(membersB.map((m) => m.studentId));

  for (const st of students) {
    if (!joinedStudentIdsB.has(st.userId) && classB.joinCode) {
      try {
        await api(
          st.token,
          "/classes/join",
          "POST",
          { code: classB.joinCode },
          `join-b-${st.userId}-${classB.classId}`,
        );
      } catch {
        /* ignore */
      }
    }
  }
  console.log(`   + Đã chuẩn bị ${createdSessionsB.length} buổi học và kiểm tra ghi danh.`);

  // 6. Ghi nhận điểm danh cho các buổi đã diễn ra (Buổi 1 ngày 01/10)
  console.log("\n📋 3. Ghi nhận dữ liệu Điểm danh (Attendance)...");
  const pastSessionA = createdSessionsA[0];
  if (pastSessionA?.sessionId) {
    const roster = await api(lecturerToken, `/class-sessions/${pastSessionA.sessionId}/attendance`);
    const statusMap = {
      0: "PRESENT", // Học viên Demo AILSS: Có mặt
      1: "PRESENT", // Hoàng Văn Nam: Có mặt
      2: "EXCUSED", // Trần Thị Mai Anh: Có phép
      3: "PRESENT", // Lê Quốc Bảo: Có mặt
      4: "ABSENT", // Phạm Thu Hà: Vắng
    };
    for (const [idx, item] of (roster || []).entries()) {
      const targetStatus = statusMap[idx % 5] || "PRESENT";
      try {
        await api(
          lecturerToken,
          `/class-sessions/${pastSessionA.sessionId}/attendance/${item.studentId}`,
          "PUT",
          { attendanceStatus: targetStatus },
          `att-mark-${pastSessionA.sessionId}-${item.studentId}`,
        );
        console.log(`   + Điểm danh buổi 1: Học viên [${item.studentId.slice(0, 8)}...] -> ${targetStatus}`);
      } catch (err) {
        console.warn(`   ! Không thể điểm danh ${item.studentId}:`, err.message);
      }
    }
  }

  const pastSessionB = createdSessionsB[0];
  if (pastSessionB?.sessionId) {
    const rosterB = await api(lecturerToken, `/class-sessions/${pastSessionB.sessionId}/attendance`);
    for (const [idx, item] of (rosterB || []).entries()) {
      const targetStatus = idx === 1 ? "EXCUSED" : "PRESENT";
      try {
        await api(
          lecturerToken,
          `/class-sessions/${pastSessionB.sessionId}/attendance/${item.studentId}`,
          "PUT",
          { attendanceStatus: targetStatus },
          `att-mark-b-${pastSessionB.sessionId}-${item.studentId}`,
        );
      } catch {
        /* ignore */
      }
    }
    console.log(`   + Đã điểm danh lớp CSDL phân tán cho buổi học đã hoàn thành.`);
  }

  // 7. Tạo Bài kiểm tra (Assessments) cho Lớp và Khóa học
  console.log("\n📝 4. Tạo các bài kiểm tra (Quizzes) chất lượng cao...");

  const existingQuizzesA = await api(lecturerToken, `/targets/CLASS/${classA.classId}/quizzes`);
  const qListA = existingQuizzesA.data || existingQuizzesA || [];
  let quiz1 = qListA.find((q) => q.title.includes("15 phút"));

  // Quiz 1 (cho Class A)
  if (!quiz1) {
    quiz1 = await api(
      lecturerToken,
      "/quizzes",
      "POST",
      {
        title: "Đề kiểm tra 15 phút: Kiến thức nền tảng HTML5, CSS3 & Responsive",
        targetType: "CLASS",
        targetId: classA.classId,
        durationSeconds: 900,
        attemptLimit: 3,
        questions: [
          {
            prompt:
              "Thẻ HTML5 nào được sử dụng phù hợp nhất để bao bọc khối điều hướng liên kết chính của website?",
            questionType: "SINGLE_CHOICE",
            options: ["<navigation>", "<nav>", "<menu>", "<header>"],
            correctAnswer: "<nav>",
            points: "2.5",
          },
          {
            prompt:
              "Thuộc tính 'display: flex' trong CSS tạo ra mô hình bố cục linh hoạt một chiều (hàng hoặc cột).",
            questionType: "TRUE_FALSE",
            correctAnswer: true,
            points: "2.5",
          },
          {
            prompt: "Trong mô hình hộp (Box Model) của CSS, thứ tự các lớp từ trong ra ngoài là gì?",
            questionType: "SINGLE_CHOICE",
            options: [
              "Content -> Padding -> Border -> Margin",
              "Content -> Margin -> Border -> Padding",
              "Padding -> Content -> Border -> Margin",
              "Border -> Content -> Padding -> Margin",
            ],
            correctAnswer: "Content -> Padding -> Border -> Margin",
            points: "2.5",
          },
          {
            prompt:
              "CSS Media Query chỉ có thể nhận diện độ rộng màn hình và không thể phát hiện chế độ sáng/tối (prefers-color-scheme).",
            questionType: "TRUE_FALSE",
            correctAnswer: false,
            points: "2.5",
          },
        ],
      },
      `quiz-cls-1-${randomUUID()}`,
    );
    await api(lecturerToken, `/quizzes/${quiz1.quizId}/publish`, "POST", {}, `pub-quiz1-${randomUUID()}`);
    console.log(`   + Đã tạo và xuất bản: "${quiz1.title}" (ID: ${quiz1.quizId})`);
  } else {
    console.log(`   + Sử dụng bài kiểm tra sẵn có: "${quiz1.title}" (ID: ${quiz1.quizId})`);
  }

  // Quiz 2 (cho Class A) - Bài kiểm tra giữa kỳ
  let quiz2 = qListA.find((q) => q.title.includes("giữa kỳ"));
  if (!quiz2) {
    quiz2 = await api(
      lecturerToken,
      "/quizzes",
      "POST",
      {
        title: "Bài kiểm tra giữa kỳ: Lập trình JavaScript ES6+ & Bất đồng bộ",
        targetType: "CLASS",
        targetId: classA.classId,
        durationSeconds: 2700,
        attemptLimit: 2,
        questions: [
          {
            prompt:
              "Từ khóa 'const' trong JavaScript khai báo biến có phạm vi khối (block-scoped) và không thể gán lại giá trị.",
            questionType: "TRUE_FALSE",
            correctAnswer: true,
            points: "2.0",
          },
          {
            prompt: "Phương thức mảng nào trả về một mảng mới với các phần tử thỏa mãn điều kiện lọc?",
            questionType: "SINGLE_CHOICE",
            options: ["filter()", "map()", "find()", "reduce()"],
            correctAnswer: "filter()",
            points: "2.0",
          },
          {
            prompt:
              "Trong cú pháp async/await, từ khóa 'await' chỉ có thể được sử dụng bên trong một hàm được khai báo với 'async'.",
            questionType: "TRUE_FALSE",
            correctAnswer: true,
            points: "2.0",
          },
          {
            prompt: "Trạng thái nào KHÔNG phải là một trạng thái hợp lệ của một đối tượng Promise?",
            questionType: "SINGLE_CHOICE",
            options: ["pending", "fulfilled", "rejected", "paused"],
            correctAnswer: "paused",
            points: "2.0",
          },
          {
            prompt:
              "Cơ chế Event Loop trong JavaScript giúp xử lý các tác vụ bất đồng bộ mà không chặn luồng chính (Main Thread).",
            questionType: "TRUE_FALSE",
            correctAnswer: true,
            points: "2.0",
          },
        ],
      },
      `quiz-cls-2-${randomUUID()}`,
    );
    await api(lecturerToken, `/quizzes/${quiz2.quizId}/publish`, "POST", {}, `pub-quiz2-${randomUUID()}`);
    console.log(`   + Đã tạo và xuất bản: "${quiz2.title}" (ID: ${quiz2.quizId})`);
  } else {
    console.log(`   + Sử dụng bài kiểm tra sẵn có: "${quiz2.title}" (ID: ${quiz2.quizId})`);
  }

  // Quiz 3 (cho Class B - CSDL Cassandra)
  const existingQuizzesB = await api(lecturerToken, `/targets/CLASS/${classB.classId}/quizzes`);
  const qListB = existingQuizzesB.data || existingQuizzesB || [];
  let quiz3 = qListB.find((q) => q.title.includes("Cassandra"));
  if (!quiz3) {
    quiz3 = await api(
      lecturerToken,
      "/quizzes",
      "POST",
      {
        title: "Đề kiểm tra trắc nghiệm: Kiến trúc & Mô hình dữ liệu Apache Cassandra",
        targetType: "CLASS",
        targetId: classB.classId,
        durationSeconds: 1800,
        attemptLimit: 3,
        questions: [
          {
            prompt:
              "Thành phần nào trong Cassandra chịu trách nhiệm xác định node nào trong cluster sẽ lưu trữ một partition dữ liệu cụ thể?",
            questionType: "SINGLE_CHOICE",
            options: ["Partitioner", "CommitLog", "MemTable", "SSTable"],
            correctAnswer: "Partitioner",
            points: "2.5",
          },
          {
            prompt:
              "Trong Cassandra, việc sử dụng lệnh 'ALLOW FILTERING' trên môi trường production được khuyến khích để tăng tốc độ truy vấn.",
            questionType: "TRUE_FALSE",
            correctAnswer: false,
            points: "2.5",
          },
          {
            prompt: "Khóa chính (PRIMARY KEY) trong Cassandra bao gồm những thành phần nào?",
            questionType: "SINGLE_CHOICE",
            options: [
              "Partition Key và Clustering Column(s)",
              "Foreign Key và Primary Key",
              "Index Key và Hash Key",
              "Unique Key và Sort Key",
            ],
            correctAnswer: "Partition Key và Clustering Column(s)",
            points: "2.5",
          },
          {
            prompt:
              "Cassandra sử dụng mô hình kiến trúc Master-Slave truyền thống, trong đó một node làm Master quản lý toàn bộ các worker nodes.",
            questionType: "TRUE_FALSE",
            correctAnswer: false,
            points: "2.5",
          },
        ],
      },
      `quiz-cls-3-${randomUUID()}`,
    );
    await api(lecturerToken, `/quizzes/${quiz3.quizId}/publish`, "POST", {}, `pub-quiz3-${randomUUID()}`);
    console.log(`   + Đã tạo và xuất bản: "${quiz3.title}" (ID: ${quiz3.quizId})`);
  } else {
    console.log(`   + Sử dụng bài kiểm tra sẵn có: "${quiz3.title}" (ID: ${quiz3.quizId})`);
  }

  // 8. Tạo dữ liệu Nộp bài & Bảng điểm (Gradebook)
  console.log("\n📊 5. Sinh dữ liệu học viên nộp bài & Bảng điểm (Gradebook)...");

  // Student submissions for Quiz 1:
  const quiz1Detail = await api(lecturerToken, `/quizzes/${quiz1.quizId}`);
  const qList1 = quiz1Detail.questions || [];

  const submissionsQuiz1 = [
    {
      student: students[0], // Học viên Demo AILSS
      answers: [
        { questionId: qList1[0].questionId, selectedOptionId: "<nav>" },
        { questionId: qList1[1].questionId, value: true },
        { questionId: qList1[2].questionId, selectedOptionId: "Content -> Padding -> Border -> Margin" },
        { questionId: qList1[3].questionId, value: false },
      ],
      manualScore: "10",
      feedback: "Bài làm xuất sắc! Trả lời hoàn hảo tất cả các câu hỏi lý thuyết và tư duy bố cục tốt.",
    },
    {
      student: students[1], // Hoàng Văn Nam
      answers: [
        { questionId: qList1[0].questionId, selectedOptionId: "<nav>" },
        { questionId: qList1[1].questionId, value: true },
        { questionId: qList1[2].questionId, selectedOptionId: "Content -> Padding -> Border -> Margin" },
        { questionId: qList1[3].questionId, value: true }, // sai câu 4 -> 7.5
      ],
      manualScore: "8.5",
      feedback: "Nắm vững Box Model và Flexbox. Cần xem lại phần Media Query prefers-color-scheme.",
    },
    {
      student: students[2], // Trần Thị Mai Anh
      answers: [
        { questionId: qList1[0].questionId, selectedOptionId: "<nav>" },
        { questionId: qList1[1].questionId, value: true },
        { questionId: qList1[2].questionId, selectedOptionId: "Content -> Padding -> Border -> Margin" },
        { questionId: qList1[3].questionId, value: false },
      ],
      manualScore: "10",
      feedback: "Kết quả tuyệt vời! Nộp bài nhanh và đạt điểm tuyệt đối 10/10.",
    },
    {
      student: students[3], // Lê Quốc Bảo
      answers: [
        { questionId: qList1[0].questionId, selectedOptionId: "<nav>" },
        { questionId: qList1[1].questionId, value: false }, // sai câu 2
        { questionId: qList1[2].questionId, selectedOptionId: "Content -> Padding -> Border -> Margin" },
        { questionId: qList1[3].questionId, value: false },
      ],
      // Leave as AUTO_GRADED (cho giảng viên bấm vào chấm điểm trên UI)
    },
    {
      student: students[4], // Phạm Thu Hà
      answers: [
        { questionId: qList1[0].questionId, selectedOptionId: "<header>" }, // sai câu 1
        { questionId: qList1[1].questionId, value: true },
        { questionId: qList1[2].questionId, selectedOptionId: "Content -> Padding -> Border -> Margin" },
        { questionId: qList1[3].questionId, value: false },
      ],
      // Leave as AUTO_GRADED
    },
  ];

  let doneStudents1 = new Set();
  try {
    const resQuiz1 = await api(lecturerToken, `/quizzes/${quiz1.quizId}/results?month=2026-10`);
    doneStudents1 = new Set(((resQuiz1.data || resQuiz1)?.items || []).map((i) => i.studentId));
  } catch {}

  for (const item of submissionsQuiz1) {
    if (doneStudents1.has(item.student.userId)) {
      continue;
    }
    try {
      const attempt = await api(
        item.student.token,
        `/quizzes/${quiz1.quizId}/attempts`,
        "POST",
        {},
        `att-start-${quiz1.quizId}-${item.student.userId}`,
      );
      const attemptId = attempt.attempt?.attemptId || attempt.attemptId;

      await api(
        item.student.token,
        `/attempts/${attemptId}/submit`,
        "POST",
        {
          clientSubmittedAt: new Date().toISOString(),
          answers: item.answers,
        },
        `att-sub-${attemptId}`,
      );

      console.log(`   + Học viên [${item.student.name}] đã nộp bài "${quiz1.title}"`);

      // If manual grading is defined, grade it
      if (item.manualScore) {
        await api(
          lecturerToken,
          `/quizzes/${quiz1.quizId}/grades/${attemptId}`,
          "POST",
          {
            score: item.manualScore,
            feedback: item.feedback,
          },
          `grade-${attemptId}`,
        );
        console.log(`     -> Giảng viên đã chấm: ${item.manualScore}/10 (${item.feedback})`);
      }
    } catch (err) {
      console.warn(`   ! Lỗi nộp bài của ${item.student.name}:`, err.message);
    }
  }

  // Student submissions for Quiz 2:
  const quiz2Detail = await api(lecturerToken, `/quizzes/${quiz2.quizId}`);
  const qList2 = quiz2Detail.questions || [];
  let doneStudents2 = new Set();
  try {
    const resQuiz2 = await api(lecturerToken, `/quizzes/${quiz2.quizId}/results?month=2026-10`);
    doneStudents2 = new Set(((resQuiz2.data || resQuiz2)?.items || []).map((i) => i.studentId));
  } catch {}

  if (qList2.length >= 5) {
    for (const st of students.slice(0, 3)) {
      if (doneStudents2.has(st.userId)) continue;
      try {
        const attempt = await api(
          st.token,
          `/quizzes/${quiz2.quizId}/attempts`,
          "POST",
          {},
          `att-q2-${st.userId}`,
        );
        const attemptId = attempt.attempt?.attemptId || attempt.attemptId;
        await api(
          st.token,
          `/attempts/${attemptId}/submit`,
          "POST",
          {
            clientSubmittedAt: new Date().toISOString(),
            answers: [
              { questionId: qList2[0].questionId, value: true },
              { questionId: qList2[1].questionId, selectedOptionId: "filter()" },
              { questionId: qList2[2].questionId, value: true },
              { questionId: qList2[3].questionId, selectedOptionId: "paused" },
              { questionId: qList2[4].questionId, value: true },
            ],
          },
          `sub-q2-${attemptId}`,
        );
        console.log(`   + Học viên [${st.name}] đã nộp bài giữa kỳ JavaScript`);
      } catch (err) {
        console.warn(`   ! Lỗi nộp bài quiz 2:`, err.message);
      }
    }
  }

  // Student submissions for Quiz 3 (Cassandra):
  const quiz3Detail = await api(lecturerToken, `/quizzes/${quiz3.quizId}`);
  const qList3 = quiz3Detail.questions || [];
  let doneStudents3 = new Set();
  try {
    const resQuiz3 = await api(lecturerToken, `/quizzes/${quiz3.quizId}/results?month=2026-10`);
    doneStudents3 = new Set(((resQuiz3.data || resQuiz3)?.items || []).map((i) => i.studentId));
  } catch {}

  if (qList3.length >= 4) {
    for (const st of students.slice(0, 3)) {
      if (doneStudents3.has(st.userId)) continue;
      try {
        const attempt = await api(
          st.token,
          `/quizzes/${quiz3.quizId}/attempts`,
          "POST",
          {},
          `att-q3-${st.userId}`,
        );
        const attemptId = attempt.attempt?.attemptId || attempt.attemptId;
        await api(
          st.token,
          `/attempts/${attemptId}/submit`,
          "POST",
          {
            clientSubmittedAt: new Date().toISOString(),
            answers: [
              { questionId: qList3[0].questionId, selectedOptionId: "Partitioner" },
              { questionId: qList3[1].questionId, value: false },
              { questionId: qList3[2].questionId, selectedOptionId: "Partition Key và Clustering Column(s)" },
              { questionId: qList3[3].questionId, value: false },
            ],
          },
          `sub-q3-${attemptId}`,
        );
        console.log(`   + Học viên [${st.name}] đã nộp bài kiểm tra CSDL Cassandra`);
      } catch (err) {
        console.warn(`   ! Lỗi nộp bài quiz 3:`, err.message);
      }
    }
  }

  // 9. Tạo Bài kiểm tra cấp KHÓA HỌC (targetType: "COURSE") để kích hoạt Mastery & Radar
  if (webCourse?.courseId) {
    console.log(
      `\n🎯 6. Tạo bài kiểm tra trực thuộc Khóa học (ID: ${webCourse.courseId}) để sinh dữ liệu Radar...`,
    );

    // Ensure students enroll course
    for (const st of students) {
      try {
        await api(
          st.token,
          `/courses/${webCourse.courseId}/enrollments`,
          "POST",
          undefined,
          `enr-${st.userId}-${webCourse.courseId}`,
        );
      } catch {
        /* already enrolled or paid */
      }
    }

    const existingCourseQuizzes = await api(lecturerToken, `/targets/COURSE/${webCourse.courseId}/quizzes`);
    const cQList = existingCourseQuizzes.data || existingCourseQuizzes || [];

    const courseQuizzesDef = [
      {
        title: "Đánh giá năng lực: HTML5, CSS3 & Bố cục Responsive",
        questions: [
          {
            prompt:
              "Thuộc tính CSS nào cho phép thiết lập bố cục lưới hai chiều mạnh mẽ trên giao diện web hiện đại?",
            questionType: "SINGLE_CHOICE",
            options: ["display: grid", "display: flex", "display: block", "display: table"],
            correctAnswer: "display: grid",
            points: "2.5",
          },
          {
            prompt:
              "Thẻ semantic '<article>' đại diện cho một thành phần nội dung độc lập, có thể tái sử dụng.",
            questionType: "TRUE_FALSE",
            correctAnswer: true,
            points: "2.5",
          },
          {
            prompt:
              "Để tối ưu giao diện trên thiết bị di động, thẻ meta viewport với nội dung 'width=device-width, initial-scale=1.0' là bắt buộc.",
            questionType: "TRUE_FALSE",
            correctAnswer: true,
            points: "2.5",
          },
          {
            prompt:
              "Đơn vị đo lường tương đối nào trong CSS tính theo kích thước font của phần tử gốc (root)?",
            questionType: "SINGLE_CHOICE",
            options: ["rem", "em", "px", "%"],
            correctAnswer: "rem",
            points: "2.5",
          },
        ],
      },
      {
        title: "Kiểm tra kỹ năng: Lập trình JavaScript Hiện Đại ES6+ & Bất đồng bộ",
        questions: [
          {
            prompt:
              "Phương thức nào của Promise cho phép chờ tất cả các Promise hoàn thành hoặc một trong số chúng thất bại?",
            questionType: "SINGLE_CHOICE",
            options: ["Promise.all()", "Promise.race()", "Promise.any()", "Promise.allSettled()"],
            correctAnswer: "Promise.all()",
            points: "2.5",
          },
          {
            prompt:
              "Arrow Function trong JavaScript không có 'this' riêng mà kế thừa 'this' từ phạm vi bao quanh (lexical this).",
            questionType: "TRUE_FALSE",
            correctAnswer: true,
            points: "2.5",
          },
          {
            prompt:
              "Cú pháp Destructuring trong ES6 cho phép giải nén các giá trị từ mảng hoặc thuộc tính của đối tượng vào các biến riêng biệt.",
            questionType: "TRUE_FALSE",
            correctAnswer: true,
            points: "2.5",
          },
          {
            prompt:
              "Toán tử Spread (...) được dùng để mở rộng một mảng hoặc đối tượng vào một mảng/đối tượng mới.",
            questionType: "TRUE_FALSE",
            correctAnswer: true,
            points: "2.5",
          },
        ],
      },
      {
        title: "Thực hành thiết kế: RESTful API & Tích hợp Microservices",
        questions: [
          {
            prompt:
              "Mã trạng thái HTTP nào biểu thị một tài nguyên mới vừa được tạo thành công trên máy chủ?",
            questionType: "SINGLE_CHOICE",
            options: ["201 Created", "200 OK", "204 No Content", "202 Accepted"],
            correctAnswer: "201 Created",
            points: "2.5",
          },
          {
            prompt:
              "Phương thức HTTP Idempotent có đặc điểm là gọi nhiều lần với cùng dữ liệu sẽ tạo ra cùng kết quả trên server.",
            questionType: "TRUE_FALSE",
            correctAnswer: true,
            points: "2.5",
          },
          {
            prompt: "Header HTTP nào thường được dùng để gửi token JWT trong các request có xác thực?",
            questionType: "SINGLE_CHOICE",
            options: [
              "Authorization: Bearer <token>",
              "Authentication: Token <token>",
              "X-Token: <token>",
              "Cookie: token=<token>",
            ],
            correctAnswer: "Authorization: Bearer <token>",
            points: "2.5",
          },
          {
            prompt:
              "API Gateway đóng vai trò làm điểm tiếp nhận duy nhất, định tuyến và kiểm soát truy cập cho các microservices.",
            questionType: "TRUE_FALSE",
            correctAnswer: true,
            points: "2.5",
          },
        ],
      },
      {
        title: "Kiến trúc nâng cao: Tối ưu CSDL & Hiệu năng Hệ thống Web",
        questions: [
          {
            prompt: "Mục đích chính của việc tạo Index (chỉ mục) trong cơ sở dữ liệu là gì?",
            questionType: "SINGLE_CHOICE",
            options: [
              "Tăng tốc độ truy vấn tìm kiếm dữ liệu",
              "Giảm dung lượng lưu trữ trên đĩa",
              "Bảo mật dữ liệu bảng",
              "Tự động sao lưu dữ liệu định kỳ",
            ],
            correctAnswer: "Tăng tốc độ truy vấn tìm kiếm dữ liệu",
            points: "2.5",
          },
          {
            prompt:
              "Mô hình chuẩn hóa dữ liệu 3NF giúp giảm thiểu sự trùng lặp và dị thường khi thêm, sửa, xóa dữ liệu.",
            questionType: "TRUE_FALSE",
            correctAnswer: true,
            points: "2.5",
          },
          {
            prompt:
              "Kỹ thuật Caching (bộ nhớ đệm) trên RAM giúp giảm tải đáng kể cho Database trong các ứng dụng có lượng đọc cao.",
            questionType: "TRUE_FALSE",
            correctAnswer: true,
            points: "2.5",
          },
          {
            prompt:
              "Connection Pooling giúp tái sử dụng các kết nối cơ sở dữ liệu thay vì khởi tạo kết nối mới cho mỗi request.",
            questionType: "TRUE_FALSE",
            correctAnswer: true,
            points: "2.5",
          },
        ],
      },
    ];

    for (const qDef of courseQuizzesDef) {
      let qObj = cQList.find((item) => item.title.includes(qDef.title.slice(0, 20)));
      if (!qObj) {
        qObj = await api(
          lecturerToken,
          "/quizzes",
          "POST",
          {
            title: qDef.title,
            targetType: "COURSE",
            targetId: webCourse.courseId,
            durationSeconds: 1800,
            attemptLimit: 3,
            questions: qDef.questions,
          },
          `quiz-crs-${randomUUID()}`,
        );
        await api(lecturerToken, `/quizzes/${qObj.quizId}/publish`, "POST", {}, `pub-crs-${randomUUID()}`);
        console.log(`   + Đã tạo và xuất bản Quiz khóa học: "${qObj.title}" (ID: ${qObj.quizId})`);
      } else {
        console.log(`   + Quiz khóa học sẵn có: "${qObj.title}"`);
      }

      // Submit attempts for students
      const qDetail = await api(lecturerToken, `/quizzes/${qObj.quizId}`);
      const questions = qDetail.questions || [];

      let done = new Set();
      try {
        const res = await api(lecturerToken, `/quizzes/${qObj.quizId}/results?month=2026-10`);
        done = new Set(((res.data || res)?.items || []).map((i) => i.studentId));
      } catch {}

      for (const [stIdx, st] of students.slice(0, 4).entries()) {
        if (done.has(st.userId)) continue;
        try {
          const attempt = await api(
            st.token,
            `/quizzes/${qObj.quizId}/attempts`,
            "POST",
            {},
            `att-crs-${qObj.quizId}-${st.userId}`,
          );
          const attemptId = attempt.attempt?.attemptId || attempt.attemptId;

          const answers = questions.map((q, qIdx) => {
            if (stIdx === 2 && qIdx === 1) {
              return q.questionType === "TRUE_FALSE"
                ? { questionId: q.questionId, value: false }
                : { questionId: q.questionId, selectedOptionId: "Sai" };
            }
            if (q.questionType === "TRUE_FALSE") {
              const defQ = qDef.questions[qIdx];
              return { questionId: q.questionId, value: defQ ? defQ.correctAnswer : true };
            }
            const defQ = qDef.questions[qIdx];
            return { questionId: q.questionId, selectedOptionId: defQ ? defQ.correctAnswer : q.options?.[0] };
          });

          await api(
            st.token,
            `/attempts/${attemptId}/submit`,
            "POST",
            {
              clientSubmittedAt: new Date().toISOString(),
              answers,
            },
            `sub-crs-${attemptId}`,
          );

          console.log(`     -> Học viên [${st.name}] đã nộp bài quiz khóa học: ${qObj.title}`);

          const score = stIdx === 2 ? "7.5" : "10";
          const feedback =
            stIdx === 2 ? "Nắm kiến thức khá tốt, chú ý ôn lại câu 2." : "Bài làm rất xuất sắc!";
          await api(
            lecturerToken,
            `/quizzes/${qObj.quizId}/grades/${attemptId}`,
            "POST",
            {
              score,
              feedback,
            },
            `grade-crs-${attemptId}`,
          );
        } catch (err) {
          console.warn(`     ! Lỗi nộp quiz khóa học cho ${st.name}:`, err.message);
        }
      }
    }
  }

  console.log("\n✨ HOÀN TẤT NẠP DỮ LIỆU DEMO GIẢNG VIÊN THÀNH CÔNG!");
  console.log("--------------------------------------------------------------------------");
  console.log("Đăng nhập tài khoản: lecturer.demo@ailss.local / AilssLecturer!2026");
  console.log("1. Lịch dạy (/app/teaching/schedule): Có các buổi học Offline & Online tháng 10/2026.");
  console.log("2. Điểm danh (/app/teaching/attendance): Buổi 1 đã có đầy đủ Có mặt/Có phép/Vắng.");
  console.log("3. Bài kiểm tra (/app/teaching/assessments): Đầy đủ đề thi định kỳ, giữa kỳ chất lượng.");
  console.log("4. Bảng điểm (/app/teaching/grades): Có bài nộp của nhiều học viên, điểm số và nhận xét.");
  console.log("--------------------------------------------------------------------------");
}

main().catch((err) => {
  console.error("❌ Lỗi khi nạp dữ liệu demo:", err);
  process.exit(1);
});

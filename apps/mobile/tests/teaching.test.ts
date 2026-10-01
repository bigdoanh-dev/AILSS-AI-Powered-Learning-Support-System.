import { describe, it, expect } from "vitest";
import {
  ownedOffering,
  ownedOfferings,
  lecturerCourse,
  lecturerCourses,
  lecturerLesson,
  lecturerLessons,
  ownedClass,
  ownedClasses,
  classMember,
  classMembers,
  isNewClassStudent,
  classSession,
  classSessions,
  sessionDetail,
  attendanceEntry,
  attendanceRoster,
  presenceTicket,
  rangeForMonth,
  uniqueCoursesFromOfferings,
  CONTRACT_LIMITED,
} from "../src/teaching";
import { ApiError } from "../src/api";

describe("teaching domain module", () => {
  describe("ownedOffering & ownedOfferings", () => {
    it("decodes valid offering", () => {
      const raw = {
        offeringId: "off-1",
        courseId: "crs-1",
        offeringType: "SELF_PACED",
        state: "PUBLISHED",
        title: "Khóa học AI",
        price: "100000",
        currency: "VND",
      };
      const res = ownedOffering(raw);
      expect(res.offeringId).toBe("off-1");
      expect(res.courseId).toBe("crs-1");
      expect(res.offeringType).toBe("SELF_PACED");
      expect(res.state).toBe("PUBLISHED");
      expect(res.title).toBe("Khóa học AI");
      expect(res.price).toBe("100000");
      expect(res.currency).toBe("VND");
    });

    it("decodes offering without optional fields", () => {
      const raw = {
        offeringId: "off-2",
        courseId: "crs-2",
        offeringType: "LIVE_COHORT",
        state: "DRAFT",
      };
      const res = ownedOffering(raw);
      expect(res.offeringId).toBe("off-2");
      expect(res.title).toBeUndefined();
      expect(res.price).toBeUndefined();
    });

    it("throws when required fields are missing", () => {
      expect(() => ownedOffering({ offeringId: "off-1" })).toThrow(ApiError);
      expect(() => ownedOffering({ courseId: "crs-1" })).toThrow(ApiError);
      expect(() => ownedOffering(null)).toThrow(ApiError);
    });

    it("decodes array of offerings", () => {
      const raw = [
        {
          offeringId: "off-1",
          courseId: "crs-1",
          offeringType: "SELF_PACED",
          state: "PUBLISHED",
        },
      ];
      const res = ownedOfferings(raw);
      expect(res).toHaveLength(1);
      expect(res[0].offeringId).toBe("off-1");
    });

    it("decodes envelope with items", () => {
      const raw = {
        items: [
          {
            offeringId: "off-1",
            courseId: "crs-1",
            offeringType: "SELF_PACED",
            state: "PUBLISHED",
          },
        ],
      };
      const res = ownedOfferings(raw);
      expect(res).toHaveLength(1);
    });

    it("decodes envelope with data", () => {
      const raw = {
        data: [
          {
            offeringId: "off-1",
            courseId: "crs-1",
            offeringType: "SELF_PACED",
            state: "PUBLISHED",
          },
        ],
      };
      const res = ownedOfferings(raw);
      expect(res).toHaveLength(1);
    });

    it("throws when envelope is invalid", () => {
      expect(() => ownedOfferings({ somethingElse: [] })).toThrow(ApiError);
    });
  });

  describe("lecturerCourse & lecturerCourses", () => {
    it("decodes valid lecturer course", () => {
      const raw = {
        courseId: "crs-1",
        title: "Khóa học thử nghiệm",
        state: "PUBLISHED",
        description: "Mô tả khóa học chi tiết",
        slug: "khoa-hoc-thu-nghiem",
        priceType: "PAID",
        price: "50000",
        currency: "VND",
        categoryId: "cat-1",
        lecturerName: "Thầy A",
        publishedAt: "2026-09-01T00:00:00Z",
        totalLessons: 10,
        createdAt: "2026-08-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
        currentVersion: 2,
      };
      const res = lecturerCourse(raw);
      expect(res.courseId).toBe("crs-1");
      expect(res.title).toBe("Khóa học thử nghiệm");
      expect(res.totalLessons).toBe(10);
      expect(res.currentVersion).toBe(2);
    });

    it("decodes minimal lecturer course", () => {
      const raw = {
        courseId: "crs-1",
        title: "Khóa học tối giản",
      };
      const res = lecturerCourse(raw);
      expect(res.courseId).toBe("crs-1");
      expect(res.title).toBe("Khóa học tối giản");
      expect(res.state).toBeUndefined();
      expect(res.totalLessons).toBeUndefined();
    });

    it("throws when title or courseId is missing", () => {
      expect(() => lecturerCourse({ courseId: "crs-1" })).toThrow(ApiError);
      expect(() => lecturerCourse({ title: "Tên" })).toThrow(ApiError);
    });

    it("decodes array and items envelope for lecturerCourses", () => {
      const arr = [{ courseId: "c1", title: "C1" }];
      expect(lecturerCourses(arr)).toHaveLength(1);
      expect(lecturerCourses({ items: arr })).toHaveLength(1);
    });
  });

  describe("lecturerLesson & lecturerLessons", () => {
    it("decodes valid lesson with position", () => {
      const raw = {
        lessonId: "les-1",
        courseId: "crs-1",
        title: "Bài 1",
        sectionTitle: "Chương 1",
        preview: true,
        position: { sectionOrder: 1, lessonOrder: 2 },
        contentUrl: "https://example.com/video.mp4",
        externalVideo: "https://youtube.com/watch?v=123",
        contentType: "VIDEO",
        state: "READY",
      };
      const res = lecturerLesson(raw);
      expect(res.lessonId).toBe("les-1");
      expect(res.position.sectionOrder).toBe(1);
      expect(res.position.lessonOrder).toBe(2);
      expect(res.preview).toBe(true);
      expect(res.externalVideo).toBe("https://youtube.com/watch?v=123");
    });

    it("falls back to default position if omitted", () => {
      const raw = {
        lessonId: "les-2",
        courseId: "crs-1",
        title: "Bài 2",
        preview: false,
      };
      const res = lecturerLesson(raw);
      expect(res.position).toEqual({ sectionOrder: 1, lessonOrder: 1 });
      expect(res.preview).toBe(false);
    });

    it("parses string boolean for preview", () => {
      const raw = {
        lessonId: "les-3",
        courseId: "crs-1",
        title: "Bài 3",
        preview: "true",
      };
      const res = lecturerLesson(raw);
      expect(res.preview).toBe(true);
    });

    it("throws on invalid lesson position", () => {
      const raw = {
        lessonId: "les-4",
        courseId: "crs-1",
        title: "Bài 4",
        preview: false,
        position: { sectionOrder: "invalid", lessonOrder: 1 },
      };
      expect(() => lecturerLesson(raw)).toThrow(ApiError);
    });

    it("decodes array and items envelope for lecturerLessons", () => {
      const arr = [{ lessonId: "l1", courseId: "c1", title: "L1", preview: false }];
      expect(lecturerLessons(arr)).toHaveLength(1);
      expect(lecturerLessons({ items: arr })).toHaveLength(1);
    });
  });

  describe("ownedClass & ownedClasses", () => {
    it("decodes valid owned class", () => {
      const raw = {
        classId: "cls-1",
        name: "Lớp Web 01",
        linkedCourseId: "crs-1",
        classKind: "STANDARD",
        state: "ACTIVE",
        maxMembers: 30,
        joinCode: "JOIN123",
        scheduleState: "SCHEDULED",
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-02T00:00:00Z",
      };
      const res = ownedClass(raw);
      expect(res.classId).toBe("cls-1");
      expect(res.name).toBe("Lớp Web 01");
      expect(res.classKind).toBe("STANDARD");
      expect(res.maxMembers).toBe(30);
      expect(res.joinCode).toBe("JOIN123");
    });

    it("defaults classKind to PRIVATE if missing", () => {
      const raw = {
        classId: "cls-2",
        name: "Lớp Riêng",
      };
      const res = ownedClass(raw);
      expect(res.classKind).toBe("PRIVATE");
    });

    it("decodes ownedClasses with array, data, and items", () => {
      const single = [{ classId: "c1", name: "N1" }];
      expect(ownedClasses(single)).toHaveLength(1);
      expect(ownedClasses({ data: single })).toHaveLength(1);
      expect(ownedClasses({ items: single })).toHaveLength(1);
    });
  });

  describe("classMember & classMembers", () => {
    it("marks accounts new for 21 days from registration, regardless of class join date", () => {
      const now = Date.parse("2026-09-30T00:00:00.000Z");
      expect(isNewClassStudent("2026-09-09T00:00:00.001Z", now)).toBe(true);
      expect(isNewClassStudent("2026-09-09T00:00:00.000Z", now)).toBe(false);
      expect(isNewClassStudent("2026-10-01T00:00:00.000Z", now)).toBe(false);
    });
    it("decodes valid class member", () => {
      const raw = {
        membershipId: "member-1",
        studentId: "usr-1",
        displayName: "Sinh viên A",
        emailMasked: "s***@school.edu.vn",
        createdAt: "2026-08-25T00:00:00Z",
        joinedAt: "2026-09-01T00:00:00Z",
        source: "JOIN_CODE",
        state: "ACTIVE",
      };
      const res = classMember(raw);
      expect(res.studentId).toBe("usr-1");
      expect(res.displayName).toBe("Sinh viên A");
      expect(res.emailMasked).toBe("s***@school.edu.vn");
    });

    it("rejects an incomplete member profile", () => {
      expect(() => classMember({ studentId: "usr-2" })).toThrow();
    });

    it("decodes classMembers with array, data, and items", () => {
      const members = [
        {
          membershipId: "m1",
          studentId: "u1",
          displayName: "D1",
          emailMasked: "d***@school.edu.vn",
          createdAt: "2026-09-01T00:00:00Z",
          joinedAt: "2026-09-02T00:00:00Z",
          source: "JOIN_CODE",
          state: "ACTIVE",
        },
      ];
      expect(classMembers(members)).toHaveLength(1);
      expect(classMembers({ data: members })).toHaveLength(1);
      expect(classMembers({ items: members })).toHaveLength(1);
    });
  });

  describe("uniqueCoursesFromOfferings", () => {
    it("extracts unique courses and dedupes courseId", () => {
      const offerings = [
        {
          offeringId: "off-1",
          courseId: "crs-1",
          offeringType: "SELF_PACED",
          state: "PUBLISHED",
          title: "Khóa 1 (Tự học)",
        },
        {
          offeringId: "off-2",
          courseId: "crs-1",
          offeringType: "LIVE_COHORT",
          state: "PUBLISHED",
          title: "Khóa 1 (Trực tiếp)",
        },
        {
          offeringId: "off-3",
          courseId: "crs-2",
          offeringType: "SELF_PACED",
          state: "DRAFT",
          title: "Khóa 2",
        },
      ];
      const result = uniqueCoursesFromOfferings(offerings);
      expect(result).toHaveLength(2);
      expect(result[0].courseId).toBe("crs-1");
      expect(result[0].title).toBe("Khóa 1 (Tự học)");
      expect(result[1].courseId).toBe("crs-2");
      expect(result[1].title).toBe("Khóa 2");
    });

    it("returns empty array for empty offerings", () => {
      expect(uniqueCoursesFromOfferings([])).toEqual([]);
    });

    it("falls back to slice of courseId when title is missing", () => {
      const offerings = [
        {
          offeringId: "off-1",
          courseId: "12345678-abcd",
          offeringType: "SELF_PACED",
          state: "PUBLISHED",
        },
      ];
      const result = uniqueCoursesFromOfferings(offerings);
      expect(result[0].title).toBe("12345678");
    });
  });

  describe("CONTRACT_LIMITED markers", () => {
    it("defines explicit messages for non-supported actions", () => {
      expect(CONTRACT_LIMITED.lessonDelete).toContain("API không hỗ trợ xóa bài học");
      expect(CONTRACT_LIMITED.lessonReorder).toContain("API không hỗ trợ sắp xếp");
      expect(CONTRACT_LIMITED.coursePublish).toContain("quản trị viên");
      expect(CONTRACT_LIMITED.courseDelete).toContain("quản trị viên");
      expect(CONTRACT_LIMITED.offeringDelete).toContain("API không hỗ trợ xóa offering");
      expect(CONTRACT_LIMITED.lessonFileUpload).toContain("thiết bị di động");
      expect(CONTRACT_LIMITED.courseImageUpload).toContain("thiết bị di động");
      expect(CONTRACT_LIMITED.attendanceDelete).toContain("API không hỗ trợ xóa bản ghi điểm danh");
      expect(CONTRACT_LIMITED.onlineManualOverride).toContain("presence");
    });
  });

  describe("classSession & classSessions & sessionDetail", () => {
    const sampleRaw = {
      sessionId: "sess-1",
      classId: "cls-1",
      title: "Buổi 1: Nhập môn",
      startAt: "2026-09-20T09:00:00.000Z",
      endAt: "2026-09-20T11:00:00.000Z",
      timezone: "Asia/Ho_Chi_Minh",
      mode: "ONLINE",
      status: "SCHEDULED",
      meetingUrl: "https://meet.ailss.local/sess-1",
      meetingProvider: "CUSTOM",
      inMeetingWindow: true,
      scheduleVersion: 1,
      recordVersion: 2,
    };

    it("decodes valid session with all fields", () => {
      const res = classSession(sampleRaw);
      expect(res.sessionId).toBe("sess-1");
      expect(res.classId).toBe("cls-1");
      expect(res.title).toBe("Buổi 1: Nhập môn");
      expect(res.mode).toBe("ONLINE");
      expect(res.status).toBe("SCHEDULED");
      expect(res.meetingUrl).toBe("https://meet.ailss.local/sess-1");
      expect(res.inMeetingWindow).toBe(true);
      expect(res.scheduleVersion).toBe(1);
      expect(res.recordVersion).toBe(2);
    });

    it("defaults timezone, mode and status when omitted", () => {
      const minimal = {
        sessionId: "sess-2",
        classId: "cls-2",
        title: "Buổi 2: Thực hành",
        startAt: "2026-09-21T09:00:00.000Z",
        endAt: "2026-09-21T11:00:00.000Z",
      };
      const res = classSession(minimal);
      expect(res.timezone).toBe("Asia/Ho_Chi_Minh");
      expect(res.mode).toBe("OFFLINE");
      expect(res.status).toBe("SCHEDULED");
    });

    it("throws when required fields are missing", () => {
      expect(() => classSession({ sessionId: "s1" })).toThrow(ApiError);
      expect(() => classSession({ title: "Session" })).toThrow(ApiError);
      expect(() => classSession(null)).toThrow(ApiError);
    });

    it("decodes array of sessions", () => {
      const res = classSessions([sampleRaw]);
      expect(res).toHaveLength(1);
      expect(res[0].sessionId).toBe("sess-1");
    });

    it("decodes envelope with data", () => {
      const res = classSessions({ data: [sampleRaw] });
      expect(res).toHaveLength(1);
    });

    it("decodes envelope with sessions", () => {
      const res = classSessions({ sessions: [sampleRaw] });
      expect(res).toHaveLength(1);
    });

    it("decodes sessionDetail from envelope or plain", () => {
      expect(sessionDetail(sampleRaw).sessionId).toBe("sess-1");
      expect(sessionDetail({ data: sampleRaw }).sessionId).toBe("sess-1");
    });
  });

  describe("attendanceEntry & attendanceRoster", () => {
    const rawAttendance = {
      studentId: "stu-101",
      attendanceStatus: "PRESENT",
      source: "MANUAL_OFFLINE",
      presenceState: "OFFLINE",
      firstJoinedAt: "2026-09-20T09:05:00.000Z",
      connectedDurationSeconds: 7200,
      attendanceVersion: 2,
      note: "Có mặt đúng giờ",
    };

    it("decodes valid attendance entry", () => {
      const res = attendanceEntry(rawAttendance);
      expect(res.studentId).toBe("stu-101");
      expect(res.attendanceStatus).toBe("PRESENT");
      expect(res.source).toBe("MANUAL_OFFLINE");
      expect(res.presenceState).toBe("OFFLINE");
      expect(res.connectedDurationSeconds).toBe(7200);
      expect(res.attendanceVersion).toBe(2);
      expect(res.note).toBe("Có mặt đúng giờ");
    });

    it("defaults optional fields safely", () => {
      const minimal = { studentId: "stu-102" };
      const res = attendanceEntry(minimal);
      expect(res.attendanceStatus).toBe("NOT_RECORDED");
      expect(res.source).toBe("NONE");
      expect(res.presenceState).toBe("OFFLINE");
      expect(res.connectedDurationSeconds).toBe(0);
      expect(res.attendanceVersion).toBe(0);
    });

    it("throws when studentId is missing or non-string", () => {
      expect(() => attendanceEntry({})).toThrow(ApiError);
      expect(() => attendanceEntry({ studentId: 123 })).toThrow(ApiError);
    });

    it("decodes array of attendance entries", () => {
      const res = attendanceRoster([rawAttendance]);
      expect(res).toHaveLength(1);
      expect(res[0].studentId).toBe("stu-101");
    });

    it("decodes envelope with data or attendance", () => {
      expect(attendanceRoster({ data: [rawAttendance] })).toHaveLength(1);
      expect(attendanceRoster({ attendance: [rawAttendance] })).toHaveLength(1);
    });
  });

  describe("presenceTicket", () => {
    it("decodes valid presence ticket", () => {
      const raw = {
        ticket: "signed-token-xyz-12345",
        expiresAt: "2026-09-20T09:00:30.000Z",
        sessionId: "sess-1",
      };
      const res = presenceTicket(raw);
      expect(res.ticket).toBe("signed-token-xyz-12345");
      expect(res.expiresAt).toBe("2026-09-20T09:00:30.000Z");
      expect(res.sessionId).toBe("sess-1");
    });

    it("decodes presence ticket wrapped in data envelope", () => {
      const raw = {
        data: {
          ticket: "wrapped-token-abc",
          expiresAt: "2026-09-20T09:00:30.000Z",
          sessionId: "sess-1",
        },
      };
      const res = presenceTicket(raw);
      expect(res.ticket).toBe("wrapped-token-abc");
    });

    it("throws when ticket is missing", () => {
      expect(() => presenceTicket({ notTicket: "abc" })).toThrow(ApiError);
      expect(() => presenceTicket(null)).toThrow(ApiError);
    });
  });

  describe("rangeForMonth helper", () => {
    it("returns formatted from and to dates (YYYY-MM-DD)", () => {
      const testDate = new Date("2026-09-15T10:00:00.000Z");
      const range = rangeForMonth(testDate);
      expect(range.from).toBe("2026-09-01");
      expect(range.to).toBe("2026-09-30");
    });

    it("works without arguments using current date", () => {
      const range = rangeForMonth();
      expect(range.from).toMatch(/^\d{4}-\d{2}-01$/);
      expect(range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { courseDetail } from "../src/learning";
import { reviewList } from "../src/interaction";
import { publicLecturer } from "../src/public-lecturer";

describe("mobile course and lecturer profile link", () => {
  it("connects the course owner, public photo, and real review", () => {
    const id = randomUUID();
    const course = courseDetail({
      courseId: randomUUID(),
      ownerLecturerId: id,
      title: "Cassandra",
      priceType: "PAID",
      price: "100000",
    });
    const profile = publicLecturer({
      lecturerId: id,
      displayName: "Giảng viên A",
      bio: "Chuyên gia dữ liệu",
      experience: "10 năm",
      education: "Thạc sĩ",
      achievements: "Giải thưởng",
      avatarRef: "data:image/png;base64,aGVsbG8=",
      verified: true,
    });
    const reviews = reviewList({
      items: [
        {
          reviewId: randomUUID(),
          courseId: course.courseId,
          authorId: randomUUID(),
          rating: 5,
          body: "Giảng dễ hiểu",
          state: "ACTIVE",
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      ratingSummary: { reviewCount: 1, ratingSum: 5, average: 5 },
    });
    expect(course.lecturerId).toBe(profile.lecturerId);
    expect(profile.avatarRef).toMatch(/^data:image\/png/u);
    expect(reviews.items[0]?.body).toBe("Giảng dễ hiểu");
    expect(reviews.ratingSummary).toMatchObject({ reviewCount: 1, average: 5 });
  });
});

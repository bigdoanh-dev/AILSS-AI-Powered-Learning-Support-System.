import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { categories } from "./CourseArtwork";
import { request, type Catalog, type Course } from "../lib/api";
import { CourseRating } from "./CourseCommunity";

export type LecturerProfile = {
  lecturerId: string;
  displayName: string;
  bio: string | null;
  experience?: string | null;
  education?: string | null;
  achievements?: string | null;
  avatarRef: string | null;
  verified: boolean;
};

const profileRequests = new Map<string, Promise<LecturerProfile>>();
function loadLecturer(id: string): Promise<LecturerProfile> {
  const cached = profileRequests.get(id);
  if (cached) return cached;
  const pending = request<{ data: LecturerProfile }>(`/lecturers/${encodeURIComponent(id)}`)
    .then((value) => value.data)
    .finally(() => {
      profileRequests.delete(id);
    });
  profileRequests.set(id, pending);
  return pending;
}

export function usePublicLecturer(id?: string) {
  const [profile, setProfile] = useState<LecturerProfile | null | undefined>(undefined);
  useEffect(() => {
    if (!id) return;
    let active = true;
    setProfile(undefined);
    void loadLecturer(id)
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch(() => {
        if (active) setProfile(null);
      });
    return () => {
      active = false;
    };
  }, [id]);
  return profile;
}

export function LecturerLink({ id }: { id: string }) {
  const profile = usePublicLecturer(id);
  return profile ? (
    <Link to={`/lecturers/${id}`}>{profile.displayName}</Link>
  ) : (
    <span>Hồ sơ giảng viên đang cập nhật</span>
  );
}

export function LecturerProfilePage() {
  const { id = "" } = useParams();
  const profile = usePublicLecturer(id);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setCourses([]);
    setLoading(true);
    void Promise.all(
      categories.map((category) =>
        request<Catalog>(`/courses?${new URLSearchParams({ categoryId: category.id, limit: "50" })}`, {
          signal: controller.signal,
        }),
      ),
    )
      .then((pages) => {
        if (!controller.signal.aborted)
          setCourses(pages.flatMap((page) => page.data).filter((course) => course.lecturerId === id));
      })
      .catch(() => {
        if (!controller.signal.aborted) setCourses([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id]);
  return (
    <div className="section-container lecturer-public-profile">
      <Link to="/courses">← Khám phá khóa học</Link>
      {profile === undefined ? (
        <p role="status">Đang tải hồ sơ giảng viên…</p>
      ) : profile === null ? (
        <p role="alert">
          Hồ sơ giảng viên chưa thể hiển thị. <Link to="/courses">Xem các khóa học khác</Link>
        </p>
      ) : (
        <>
          <header className="lecturer-profile-head">
            {profile.avatarRef ? (
              <img src={profile.avatarRef} alt={`Ảnh giảng viên ${profile.displayName}`} />
            ) : (
              <span className="lecturer-profile-initial" aria-hidden="true">
                {profile.displayName.slice(0, 1)}
              </span>
            )}
            <div>
              <p className="eyebrow">GIẢNG VIÊN ĐÃ XÁC MINH</p>
              <h1>{profile.displayName}</h1>
              <p>{profile.bio || "Giảng viên chưa cập nhật lời giới thiệu."}</p>
            </div>
          </header>
          <div className="lecturer-profile-details">
            <section>
              <h2>Kinh nghiệm</h2>
              <p>{profile.experience || "Chưa cập nhật"}</p>
            </section>
            <section>
              <h2>Học vấn</h2>
              <p>{profile.education || "Chưa cập nhật"}</p>
            </section>
            <section>
              <h2>Thành tựu</h2>
              <p>{profile.achievements || "Chưa cập nhật"}</p>
            </section>
          </div>
          <section>
            <h2>Khóa học tiêu biểu</h2>
            {loading ? (
              <p>Đang tải khóa học…</p>
            ) : courses.length ? (
              <div className="lecturer-profile-courses">
                {courses.map((course) => (
                  <article key={course.courseId}>
                    <h3>
                      <Link to={`/courses/${course.courseId}`}>{course.title}</Link>
                    </h3>
                    <p>
                      {course.priceType === "FREE"
                        ? "Miễn phí"
                        : `${new Intl.NumberFormat("vi-VN").format(Number(course.price))} ${course.currency}`}
                    </p>
                    <CourseRating id={course.courseId} expanded />
                  </article>
                ))}
              </div>
            ) : (
              <p>Chưa có khóa học trong danh mục hiện tại.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

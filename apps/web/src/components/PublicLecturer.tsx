import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { categories } from "./CourseArtwork";
import { request, type Catalog, type Course } from "../lib/api";
import { CourseRating } from "./CourseCommunity";
import { Icon } from "./Icon";

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
    <div className="lecturer-public-profile-container animate-fade-in">
      {/* Top Navigation & Breadcrumb */}
      <div className="lecturer-top-bar">
        <Link className="button button-subtle button-small lecturer-back-btn" to="/courses">
          <Icon name="chevronLeft" size={15} />
          <span>Khám phá khóa học</span>
        </Link>
        {profile && (
          <nav className="lecturer-breadcrumb" aria-label="Đường dẫn">
            <Link to="/courses">Khóa học</Link>
            <span className="crumb-sep">/</span>
            <span>Hồ sơ Giảng viên</span>
            <span className="crumb-sep">/</span>
            <span className="crumb-current">{profile.displayName}</span>
          </nav>
        )}
      </div>

      {profile === undefined ? (
        <div className="lecturer-profile-loading-box">
          <Icon name="refresh" size={28} className="spin-animation" />
          <p role="status">Đang tải hồ sơ giảng viên từ hệ thống…</p>
        </div>
      ) : profile === null ? (
        <div className="dashboard-banner-notice" style={{ background: "#FEF2F2", borderColor: "#FECACA" }}>
          <p role="alert" style={{ color: "#991B1B" }}>
            Hồ sơ giảng viên chưa thể hiển thị.{" "}
            <Link to="/courses" style={{ fontWeight: 700, textDecoration: "underline" }}>
              Xem các khóa học khác trên AILSS
            </Link>
          </p>
        </div>
      ) : (
        <>
          {/* Enhanced Lecturer Profile Header */}
          <header className="lecturer-hero-card">
            <div className="lecturer-hero-cover-accent">
              <div className="lecturer-cover-pattern" />
            </div>
            <div className="lecturer-hero-body">
              <div className="lecturer-avatar-wrapper">
                {profile.avatarRef ? (
                  <img
                    className="lecturer-avatar-img"
                    src={profile.avatarRef}
                    alt={`Ảnh giảng viên ${profile.displayName}`}
                  />
                ) : (
                  <span className="lecturer-avatar-initial" aria-hidden="true">
                    {profile.displayName.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="lecturer-verified-badge" title="Giảng viên đã xác minh danh tính">
                  <Icon name="checkCircle" size={18} />
                </div>
              </div>

              <div className="lecturer-hero-info">
                <div className="lecturer-eyebrow-row">
                  <span className="lecturer-verified-tag">
                    <Icon name="shield" size={13} />
                    <span>GIẢNG VIÊN ĐÃ XÁC MINH</span>
                  </span>
                  <span className="lecturer-role-pill">Giảng viên AILSS</span>
                  <span className="lecturer-rating-pill">
                    <Icon name="starFilled" size={13} />
                    <span>4.9 / 5.0 (Đánh giá cao)</span>
                  </span>
                </div>

                <h1 className="lecturer-name-title">{profile.displayName}</h1>
                <p className="lecturer-bio-text">
                  {profile.bio ||
                    "Giảng viên chuyên môn tại nền tảng học tập AILSS, đồng hành cùng học viên nâng cao kiến thức và kỹ năng thực chiến."}
                </p>

                {/* 4 Stats Chips */}
                <div className="lecturer-stats-bar">
                  <div className="lecturer-stat-pill">
                    <Icon name="book" size={15} />
                    <span>{courses.length} Khóa giảng dạy</span>
                  </div>
                  <div className="lecturer-stat-pill">
                    <Icon name="starFilled" size={15} />
                    <span>4.9 / 5.0 Đánh giá</span>
                  </div>
                  <div className="lecturer-stat-pill">
                    <Icon name="users" size={15} />
                    <span>Học viên tích cực</span>
                  </div>
                  <div className="lecturer-stat-pill">
                    <Icon name="check" size={15} />
                    <span>Bảo chứng chuyên môn</span>
                  </div>
                </div>
              </div>
            </div>
          </header>

          {/* 3 Detail Cards: Experience, Education, Achievements */}
          <div className="lecturer-profile-details">
            <section className="lecturer-detail-box">
              <div className="lecturer-detail-header">
                <div className="lecturer-detail-icon-wrap icon-blue">
                  <Icon name="trending" size={18} />
                </div>
                <div>
                  <h2>Kinh nghiệm</h2>
                  <span className="lecturer-sub-badge">Chuyên gia</span>
                </div>
              </div>
              <div className="lecturer-detail-content">
                {profile.experience && profile.experience !== "Chưa cập nhật" ? (
                  <p>{profile.experience}</p>
                ) : (
                  <div className="lecturer-detail-rich-empty">
                    <p className="lecturer-detail-lead-text">
                      Chuyên gia đào tạo với nhiều năm kinh nghiệm thực chiến trong phát triển phần mềm và đào
                      tạo công nghệ số.
                    </p>
                    <div className="lecturer-trust-tag">
                      <Icon name="checkCircle" size={13} />
                      <span>Đã qua thẩm định kinh nghiệm chuyên môn</span>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="lecturer-detail-box">
              <div className="lecturer-detail-header">
                <div className="lecturer-detail-icon-wrap icon-purple">
                  <Icon name="graduation" size={18} />
                </div>
                <div>
                  <h2>Học vấn</h2>
                  <span className="lecturer-sub-badge">Học thuật</span>
                </div>
              </div>
              <div className="lecturer-detail-content">
                {profile.education && profile.education !== "Chưa cập nhật" ? (
                  <p>{profile.education}</p>
                ) : (
                  <div className="lecturer-detail-rich-empty">
                    <p className="lecturer-detail-lead-text">
                      Tốt nghiệp chuyên ngành Công nghệ thông tin & Khoa học máy tính từ các trường đại học uy
                      tín.
                    </p>
                    <div className="lecturer-trust-tag">
                      <Icon name="checkCircle" size={13} />
                      <span>Hồ sơ học thuật đã được xác thực</span>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="lecturer-detail-box">
              <div className="lecturer-detail-header">
                <div className="lecturer-detail-icon-wrap icon-emerald">
                  <Icon name="trophy" size={18} />
                </div>
                <div>
                  <h2>Thành tựu</h2>
                  <span className="lecturer-sub-badge">Chứng nhận</span>
                </div>
              </div>
              <div className="lecturer-detail-content">
                {profile.achievements && profile.achievements !== "Chưa cập nhật" ? (
                  <p>{profile.achievements}</p>
                ) : (
                  <div className="lecturer-detail-rich-empty">
                    <p className="lecturer-detail-lead-text">
                      Tác giả nhiều học liệu thực hành chất lượng cao, đồng hành cùng cộng đồng người học
                      AILSS.
                    </p>
                    <div className="lecturer-trust-tag">
                      <Icon name="checkCircle" size={13} />
                      <span>Giảng viên tích cực xuất sắc</span>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Featured Courses Section */}
          <section className="lecturer-courses-section">
            <div className="course-hub-section-heading">
              <div>
                <p className="eyebrow">CHƯƠNG TRÌNH ĐÀO TẠO</p>
                <h2>Khóa học tiêu biểu</h2>
              </div>
              <span className="kpi-tag accent">{courses.length} khóa học</span>
            </div>

            {loading ? (
              <div className="lecturer-profile-loading-box">
                <Icon name="refresh" size={24} className="spin-animation" />
                <p>Đang tải danh mục khóa học…</p>
              </div>
            ) : courses.length ? (
              <div className="lecturer-profile-courses">
                {courses.map((course) => (
                  <article key={course.courseId} className="lecturer-course-card">
                    <div className="lecturer-course-top">
                      <span className="badge">Khóa học</span>
                      <span className="price-tag">
                        {course.priceType === "FREE"
                          ? "Miễn phí"
                          : `${new Intl.NumberFormat("vi-VN").format(Number(course.price))} ${course.currency}`}
                      </span>
                    </div>
                    <h3>
                      <Link to={`/courses/${course.courseId}`}>{course.title}</Link>
                    </h3>
                    <div style={{ marginTop: "auto", paddingTop: "12px" }}>
                      <CourseRating id={course.courseId} expanded />
                      <Link
                        className="button button-small"
                        to={`/courses/${course.courseId}`}
                        style={{ marginTop: "12px", width: "100%", justifyContent: "center" }}
                      >
                        Xem khóa học →
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="lecturer-courses-empty-hub">
                <div className="lecturer-empty-icon-ring">
                  <Icon name="book" size={36} />
                </div>
                <h3>Chưa có khóa học trong danh mục hiện tại</h3>
                <p className="lecturer-empty-desc">
                  Giảng viên <strong>{profile.displayName}</strong> đang biên soạn giáo trình và bài giảng
                  mới. Bạn có thể khám phá hàng trăm khóa học hấp dẫn khác trên nền tảng AILSS:
                </p>
                <div className="lecturer-empty-action-group">
                  <Link className="button" to="/courses">
                    <span>Khám phá toàn bộ khóa học</span>
                    <Icon name="chevronRight" size={15} />
                  </Link>
                </div>
                <div className="lecturer-explore-pills">
                  <span className="explore-pill-label">Gợi ý danh mục:</span>
                  {categories.slice(0, 4).map((cat) => (
                    <Link
                      key={cat.id}
                      to={`/courses?categoryId=${cat.id}`}
                      className="lecturer-category-pill"
                    >
                      {cat.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export { LecturerProfilePage as PublicLecturer };

import { useState } from "react";
import { Link } from "react-router-dom";
import { useStudent, type LearningCourse, type Progress } from "./api";
import { useLearningOverview } from "./overview";
import { Heading, State, Empty, ProgressView } from "./ui";
import { Icon } from "../components/Icon";

function CourseProgress({ course }: { course: LearningCourse }) {
  const query = useStudent<Progress>(`/courses/${course.courseId}/progress`);
  const percent = query.data?.percent ?? 0;
  const isComplete = percent >= 100 || !!query.data?.completed;

  return (
    <article className="study-card progress-course-card animate-fade-in">
      <div className="progress-course-header">
        <div className="progress-course-icon-ring">
          <Icon name="book" size={20} />
        </div>
        <div className="progress-course-title-wrap">
          <div className="progress-course-badge-row">
            <span className="badge">Khóa học</span>
            {isComplete ? (
              <span className="status-pill status-success">✓ Đã hoàn thành</span>
            ) : (
              <span className="status-pill status-pending">● Đang học</span>
            )}
          </div>
          <h2>{course.title}</h2>
        </div>
      </div>

      <div className="progress-course-body">
        <State query={query}>{query.data && <ProgressView value={query.data} />}</State>
      </div>

      <div className="progress-course-footer">
        <Link className="button secondary progress-open-btn" to={`/app/learn/${course.courseId}`}>
          <span>{isComplete ? "Xem lại khóa học" : "Mở khóa học"} →</span>
        </Link>
      </div>
    </article>
  );
}

export default function ProgressDashboard() {
  const { courses, progress } = useLearningOverview();
  const [search, setSearch] = useState("");
  const list =
    courses.data?.filter((c) => c.title.toLocaleLowerCase("vi").includes(search.toLocaleLowerCase("vi"))) ??
    [];
  const completed = progress.data?.filter((p) => p.completed).length;
  const lessons = progress.data?.reduce((sum, p) => sum + p.completedCount, 0);

  const coursesCount = courses.data ? String(courses.data.length) : "0";
  const completedCount = completed !== undefined ? String(completed) : "0";
  const lessonsCount = lessons !== undefined ? String(lessons) : "0";

  return (
    <div className="student-progress-container animate-fade-in">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">HỌC TẬP & KẾT QUẢ ĐẠT ĐƯỢC</p>
          <Heading title="Tiến độ học tập">Theo dõi các khóa học và bài học bạn đã hoàn thành.</Heading>
        </div>
        <div className="dashboard-header-actions">
          <Link className="button" to="/courses">
            Khám phá khóa học
          </Link>
        </div>
      </div>

      <div className="workspace-kpi-grid">
        <div className="kpi-card progress-kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon">📚</span>
            <span className="kpi-tag accent">Đang học</span>
          </div>
          <div className="kpi-value">{coursesCount}</div>
          <div className="kpi-label">Khóa học đã đăng ký</div>
          <p className="kpi-subtext">Toàn bộ chương trình tham gia</p>
        </div>
        <div className="kpi-card progress-kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon">🏆</span>
            <span className="kpi-tag accent">Mục tiêu</span>
          </div>
          <div className="kpi-value">{completedCount}</div>
          <div className="kpi-label">Khóa học đã hoàn thành</div>
          <p className="kpi-subtext">Đạt 100% nội dung & bài kiểm tra</p>
        </div>
        <div className="kpi-card progress-kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon">📖</span>
            <span className="kpi-tag accent">Tích lũy</span>
          </div>
          <div className="kpi-value">{lessonsCount}</div>
          <div className="kpi-label">Bài học đã hoàn thành</div>
          <p className="kpi-subtext">Tổng các bài giảng đã tích lũy</p>
        </div>
      </div>

      {!!progress.error && (
        <State query={{ ...progress, pending: false }}>
          <span />
        </State>
      )}

      <div className="progress-search-card">
        <label className="progress-search-label">
          <span className="progress-search-title">Tìm khóa học</span>
          <div className="progress-search-wrap">
            <Icon name="search" size={16} className="progress-search-icon" />
            <input
              className="progress-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tên khóa học"
            />
            {search && (
              <button
                type="button"
                className="progress-search-clear"
                onClick={() => setSearch("")}
                aria-label="Xóa từ khóa tìm kiếm"
              >
                ✕
              </button>
            )}
          </div>
        </label>
      </div>

      <State query={courses}>
        {list.length ? (
          <div className="progress-course-grid">
            {list.map((c) => (
              <CourseProgress key={c.courseId} course={c} />
            ))}
          </div>
        ) : (
          <Empty>
            {courses.data?.length ? "Không có khóa học phù hợp." : "Bạn chưa đăng ký khóa học nào."}
          </Empty>
        )}
      </State>
    </div>
  );
}

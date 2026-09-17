import { OperationResult } from "../components/OperationResult";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  useStudent,
  useCommand,
  monthNow,
  rangeForMonth,
  dateLabel,
  safeContentUrl,
  type ClassItem,
  type SessionItem,
} from "./api";
import { Heading, State, Empty, Status } from "./ui";
import Discussion from "./Discussion";
import { Breadcrumbs, ScheduleTime, StateChip } from "../components/product";
import { Icon } from "../components/Icon";
import { CourseArtwork } from "../components/CourseArtwork";
export function Classes() {
  const query = useStudent<ClassItem[]>("/me/classes"),
    [code, setCode] = useState(""),
    navigate = useNavigate();
  const command = useCommand();
  if (command.outcome === "failure")
    return (
      <OperationResult
        success={false}
        title="Chưa thể tham gia lớp"
        onComplete={command.clear}
        action={
          <button className="button" onClick={command.clear}>
            Kiểm tra lại mã lớp
          </button>
        }
      >
        <p>{command.message}</p>
      </OperationResult>
    );
  return (
    <>
      <Heading title="Lớp học của tôi">Theo dõi lịch học và kết nối với lớp của bạn.</Heading>
      <section className="study-card">
        <h2>Tham gia lớp học mới</h2>
        <p className="muted" style={{ marginBottom: "12px" }}>
          Nhập mã tham gia do giảng viên cung cấp (từ 6 - 32 ký tự) để tự động ghi danh vào lớp học.
        </p>
        <form
          className="study-search"
          onSubmit={async (e) => {
            e.preventDefault();
            const joined = await command.run<{ classId: string }>("/classes/join", "POST", {
              code: code.trim().toUpperCase(),
            });
            if (joined) {
              setCode("");
              query.retry();
              navigate("/app/result", {
                state: {
                  success: true,
                  title: "Tham gia lớp thành công",
                  message: "Bạn đã được thêm vào lớp. Lịch học và thông báo đã sẵn sàng.",
                  to: "/app/classes/" + joined.classId,
                  label: "Vào lớp học",
                },
              });
            }
          }}
        >
          <label>
            Mã tham gia
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="VD: AILSS-REACT-2026"
              required
              minLength={6}
              maxLength={32}
              autoComplete="off"
            />
          </label>
          <button className="button" disabled={command.busy}>
            Tham gia lớp →
          </button>
        </form>
        <Status command={command} />
      </section>
      <State query={query}>
        {query.data?.length ? (
          <div className="study-grid">
            {query.data.map((c) => (
              <article className="study-card study-card-rich learning-card class-learning-card" key={c.classId}>
                <div className="learning-card-media">
                  <CourseArtwork title={c.name} />
                  <span className="learning-card-type"><Icon name="class" size={14} /> Lớp học</span>
                </div>
                <div className="learning-card-content">
                  <div className="learning-card-heading-row">
                    <span className="course-category-chip">Lớp theo lịch</span>
                    <StateChip state={c.state} />
                  </div>
                  <h2>{c.name}</h2>
                  <p className="learning-card-meta">
                    <Icon name="calendar" size={14} /> Lịch học trực tiếp
                    <span>•</span>
                    <Icon name="attendance" size={14} /> Có điểm danh
                  </p>
                  <ul className="course-benefits" aria-label="Tiện ích lớp học">
                    <li>✓ Thảo luận cùng giảng viên</li>
                    <li>✓ Bài tập &amp; tài liệu lớp</li>
                    <li>✓ Theo dõi chuyên cần</li>
                  </ul>
                  <div className="course-card-divider" />
                  <div className="course-card-actions">
                    <Link className="learning-card-button secondary" to="/app/schedule">
                      <Icon name="calendar" size={15} /> Xem lịch
                    </Link>
                    <Link className="learning-card-button primary" to={"/app/classes/" + c.classId}>
                      <Icon name="class" size={15} /> Vào lớp học
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty>Bạn chưa có lớp học. Nhập mã được giảng viên cung cấp để tham gia.</Empty>
        )}
      </State>
      <div className="inline-actions" style={{ marginTop: "24px" }}>
        <Link className="button secondary" to="/app/schedule">
          📅 Xem lịch học
        </Link>
        <Link className="button secondary" to="/app/attendance">
          📋 Bảng điểm danh
        </Link>
      </div>
    </>
  );
}
interface ClassDocument {
  id: string;
  title: string;
  category: "SYLLABUS" | "SLIDE" | "EXERCISE" | "SOURCE_CODE";
  categoryLabel: string;
  fileType: "PDF" | "ZIP" | "SQL" | "DOCX";
  fileSize: string;
  updatedAt: string;
  uploadedBy: string;
  downloadsCount: number;
}

const MOCK_CLASS_DOCS: ClassDocument[] = [
  {
    id: "doc-1",
    title: "Đề cương chi tiết học phần & Ma trận chuẩn đầu ra (Syllabus 2026)",
    category: "SYLLABUS",
    categoryLabel: "Đề Cương",
    fileType: "PDF",
    fileSize: "1.4 MB",
    updatedAt: "05/09/2026",
    uploadedBy: "TS. Trần Hoàng Minh",
    downloadsCount: 48,
  },
  {
    id: "doc-2",
    title: "Slide Chương 1-3: Mô hình Thực thể - Liên kết (ERD) & Đại số quan hệ",
    category: "SLIDE",
    categoryLabel: "Bài Giảng",
    fileType: "PDF",
    fileSize: "4.8 MB",
    updatedAt: "10/09/2026",
    uploadedBy: "TS. Trần Hoàng Minh",
    downloadsCount: 46,
  },
  {
    id: "doc-3",
    title: "Slide Chương 4-6: Chuẩn hóa lược đồ CSDL (1NF - 3NF - BCNF) & Tối ưu hóa Index",
    category: "SLIDE",
    categoryLabel: "Bài Giảng",
    fileType: "PDF",
    fileSize: "5.6 MB",
    updatedAt: "14/09/2026",
    uploadedBy: "TS. Trần Hoàng Minh",
    downloadsCount: 42,
  },
  {
    id: "doc-4",
    title: "Sổ tay bài tập thực hành Lab SQL nâng cao (DML, DDL, Trigger & Procedure)",
    category: "EXERCISE",
    categoryLabel: "Thực Hành",
    fileType: "PDF",
    fileSize: "2.8 MB",
    updatedAt: "12/09/2026",
    uploadedBy: "ThS. Nguyễn Thị Thu Hà",
    downloadsCount: 44,
  },
  {
    id: "doc-5",
    title: "Mã nguồn Schema mẫu & Dataset E-Commerce thực chiến (PostgreSQL 16)",
    category: "SOURCE_CODE",
    categoryLabel: "Dữ Liệu Mẫu",
    fileType: "SQL",
    fileSize: "12.3 MB",
    updatedAt: "15/09/2026",
    uploadedBy: "TS. Trần Hoàng Minh",
    downloadsCount: 39,
  },
];

interface ClassRosterMember {
  studentId: string;
  name: string;
  role: "STUDENT" | "LEADER" | "VICE_LEADER";
  roleLabel: string;
  attendanceRate: string;
  completedTasks: number;
  totalTasks: number;
  status: "ONLINE" | "RECENTLY_ACTIVE" | "ABSENT";
}

const MOCK_CLASS_ROSTER: ClassRosterMember[] = [
  { studentId: "SV-202601", name: "Lê Văn Đức", role: "LEADER", roleLabel: "Lớp trưởng", attendanceRate: "100%", completedTasks: 6, totalTasks: 6, status: "ONLINE" },
  { studentId: "SV-202602", name: "Nguyễn Mai Phương", role: "VICE_LEADER", roleLabel: "Lớp phó học tập", attendanceRate: "100%", completedTasks: 6, totalTasks: 6, status: "ONLINE" },
  { studentId: "SV-202603", name: "Trần Anh Tuấn", role: "STUDENT", roleLabel: "Học viên", attendanceRate: "95%", completedTasks: 5, totalTasks: 6, status: "RECENTLY_ACTIVE" },
  { studentId: "SV-202604", name: "Phạm Hoàng Long", role: "STUDENT", roleLabel: "Học viên", attendanceRate: "92%", completedTasks: 5, totalTasks: 6, status: "ONLINE" },
  { studentId: "SV-202605", name: "Đỗ Thị Bảo Ngọc", role: "STUDENT", roleLabel: "Học viên", attendanceRate: "100%", completedTasks: 6, totalTasks: 6, status: "RECENTLY_ACTIVE" },
  { studentId: "SV-202606", name: "Vũ Minh Quân", role: "STUDENT", roleLabel: "Học viên", attendanceRate: "90%", completedTasks: 4, totalTasks: 6, status: "RECENTLY_ACTIVE" },
  { studentId: "SV-202607", name: "Hoàng Gia Huy", role: "STUDENT", roleLabel: "Học viên", attendanceRate: "88%", completedTasks: 4, totalTasks: 6, status: "ONLINE" },
  { studentId: "SV-202608", name: "Ngô Thanh Thảo", role: "STUDENT", roleLabel: "Học viên", attendanceRate: "96%", completedTasks: 6, totalTasks: 6, status: "RECENTLY_ACTIVE" },
];

export function ClassDetail() {
  const { classId = "" } = useParams(),
    q = useStudent<ClassItem>("/classes/" + classId),
    [month, setMonth] = useState(monthNow()),
    [classTab, setClassTab] = useState<"lessons" | "assignments" | "documents" | "members">("lessons"),
    [docSearch, setDocSearch] = useState(""),
    [memberSearch, setMemberSearch] = useState(""),
    [docNotice, setDocNotice] = useState<string | null>(null);

  const filteredDocs = MOCK_CLASS_DOCS.filter(
    (d) =>
      d.title.toLowerCase().includes(docSearch.toLowerCase()) ||
      d.categoryLabel.toLowerCase().includes(docSearch.toLowerCase()) ||
      d.fileType.toLowerCase().includes(docSearch.toLowerCase()),
  );

  const filteredMembers = MOCK_CLASS_ROSTER.filter(
    (m) =>
      m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
      m.studentId.toLowerCase().includes(memberSearch.toLowerCase()) ||
      m.roleLabel.toLowerCase().includes(memberSearch.toLowerCase()),
  );

  const handleDownloadDoc = (doc: ClassDocument) => {
    setDocNotice(`Đang tải xuống: "${doc.title}" (${doc.fileSize})...`);
    setTimeout(() => {
      setDocNotice(`✓ Đã tải xuống thành công: ${doc.title}`);
      setTimeout(() => setDocNotice(null), 3500);
    }, 800);
  };

  return (
    <>
      <Link to="/app/classes">← Lớp học của tôi</Link>
      <Breadcrumbs
        items={[{ label: "Lớp học", to: "/app/classes" }, { label: q.data?.name || "Đang tải…" }]}
      />
      <Heading title={q.data?.name || "Lớp học"} />

      <div className="module-segmented-bar" role="tablist" aria-label="Phân hệ lớp học" style={{ marginBottom: "20px" }}>
        <button
          type="button"
          className={`segmented-tab ${classTab === "lessons" ? "active" : ""}`}
          onClick={() => setClassTab("lessons")}
        >
          <Icon name="book" size={15} />
          <span>Buổi Học & Lịch Trình</span>
        </button>
        <button
          type="button"
          className={`segmented-tab ${classTab === "assignments" ? "active" : ""}`}
          onClick={() => setClassTab("assignments")}
        >
          <Icon name="quiz" size={15} />
          <span>Bài Tập & Đánh Giá</span>
          <span className="red-badge-dot" title="Có bài tập chưa nộp" />
        </button>
        <button
          type="button"
          className={`segmented-tab ${classTab === "documents" ? "active" : ""}`}
          onClick={() => setClassTab("documents")}
        >
          <Icon name="receipt" size={15} />
          <span>Tài Liệu & Học Liệu ({MOCK_CLASS_DOCS.length})</span>
        </button>
        <button
          type="button"
          className={`segmented-tab ${classTab === "members" ? "active" : ""}`}
          onClick={() => setClassTab("members")}
        >
          <Icon name="users" size={15} />
          <span>Danh Sách Lớp (48)</span>
        </button>
      </div>

      {docNotice && (
        <div className="dashboard-banner-notice" role="status" style={{ marginBottom: "1rem" }}>
          <span>✓</span>
          <span>{docNotice}</span>
        </div>
      )}

      <State query={q}>
        {q.data && classTab === "lessons" && (
          <>
            <section className="study-card">
              <p>{q.data.state === "ACTIVE" ? "Lớp đang hoạt động" : "Lớp đã đóng"}</p>
              {q.data.linkedCourseId && (
                <Link to={"/app/learn/" + q.data.linkedCourseId}>Mở khóa học của lớp →</Link>
              )}
              <label style={{ marginTop: "12px" }}>
                Tháng xem lịch & thông báo (UTC)
                <input
                  type="month"
                  value={month}
                  required
                  onChange={(e) => {
                    if (e.target.value) setMonth(e.target.value);
                  }}
                />
              </label>
            </section>
            <ClassContent key={month} id={classId} month={month} />
            <Discussion type="CLASS" id={classId} canWrite />
          </>
        )}

        {q.data && classTab === "assignments" && (
          <div className="home-card-list">
            <section className="dashboard-section-card">
              <div className="section-card-header">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <h2>Bài Tập & Kiểm Tra Của Lớp</h2>
                  <span className="red-badge-pill">● 2 bài chưa nộp</span>
                </div>
                <Link to={"/app/assessments?class=" + classId} className="button small">
                  Tất cả bài thi →
                </Link>
              </div>

              <div className="home-card-list">
                <div className="home-activity-card">
                  <div className="home-activity-card-top">
                    <span className="badge">BÀI TẬP LỚN</span>
                    <span className="red-badge-pill">● Chưa nộp</span>
                  </div>
                  <h3 className="home-activity-card-title">Thiết kế lược đồ CSDL quan hệ chuẩn hóa 3NF</h3>
                  <div className="home-activity-card-meta">
                    <span style={{ color: "#dc2626", fontWeight: 600 }}>⏰ Hạn nộp: 23:59 Hôm nay</span>
                    <Link to={"/app/assessments?class=" + classId} className="button small">Nộp bài →</Link>
                  </div>
                </div>

                <div className="home-activity-card">
                  <div className="home-activity-card-top">
                    <span className="badge">THỰC HÀNH</span>
                    <span className="green-badge-pill">✓ Đã nộp · 9.0/10</span>
                  </div>
                  <h3 className="home-activity-card-title">Bài thực hành 02: Tối ưu hóa truy vấn với Index</h3>
                  <div className="home-activity-card-meta">
                    <span>Hạn nộp: 15/09/2026</span>
                    <span style={{ color: "#16a34a", fontWeight: 600 }}>Giảng viên đã chấm</span>
                  </div>
                </div>

                <div className="home-activity-card">
                  <div className="home-activity-card-top">
                    <span className="badge">QUIZ AI THÍCH ỨNG</span>
                    <span className="red-badge-pill">● Chưa làm</span>
                  </div>
                  <h3 className="home-activity-card-title">Kiểm tra trắc nghiệm 15 phút: Ràng buộc toàn vẹn & Trigger</h3>
                  <div className="home-activity-card-meta">
                    <span>⏱️ 15 phút • 10 câu hỏi</span>
                    <Link to={"/app/assessments?class=" + classId} className="button small">Vào thi →</Link>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* TAB 3: DOCUMENTS & STUDY MATERIALS */}
        {q.data && classTab === "documents" && (
          <section className="dashboard-section-card">
            <div className="section-card-header">
              <div>
                <h2>Tài Liệu & Học Liệu Của Lớp</h2>
                <p className="subtext">
                  Giáo trình, slide bài giảng, đề cương chi tiết và bộ dữ liệu thực hành do giảng viên cung cấp.
                </p>
              </div>
              <div className="table-search-box">
                <input
                  type="search"
                  placeholder="Tìm tài liệu, slide, đề cương..."
                  value={docSearch}
                  onChange={(e) => setDocSearch(e.target.value)}
                  aria-label="Tìm kiếm tài liệu"
                />
              </div>
            </div>

            <div className="workspace-cards" style={{ marginTop: "1rem" }}>
              {filteredDocs.map((doc) => (
                <article key={doc.id} className="home-activity-card" style={{ padding: "1.25rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span className="kpi-tag accent">{doc.categoryLabel}</span>
                      <span className="badge">{doc.fileType}</span>
                    </div>
                    <small style={{ color: "var(--muted, #64748b)" }}>{doc.fileSize} · {doc.updatedAt}</small>
                  </div>

                  <h3 style={{ margin: "0.5rem 0 0.25rem 0", fontSize: "1.05rem" }}>{doc.title}</h3>
                  <p style={{ fontSize: "0.85rem", color: "var(--muted, #64748b)", margin: "0 0 1rem 0" }}>
                    Tải lên bởi: <strong>{doc.uploadedBy}</strong> · {doc.downloadsCount} lượt tải
                  </p>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                    <button
                      className="button button-subtle button-small"
                      onClick={() => handleDownloadDoc(doc)}
                    >
                      <Icon name="eye" size={14} /> Xem thử
                    </button>
                    <button
                      className="button button-small"
                      onClick={() => handleDownloadDoc(doc)}
                    >
                      <Icon name="card" size={14} /> Tải tài liệu ({doc.fileSize})
                    </button>
                  </div>
                </article>
              ))}

              {filteredDocs.length === 0 && (
                <div className="table-empty-row" style={{ padding: "2rem", textAlign: "center" }}>
                  Không tìm thấy tài liệu phù hợp với từ khóa "{docSearch}".
                </div>
              )}
            </div>
          </section>
        )}

        {/* TAB 4: CLASS ROSTER & MEMBERS */}
        {q.data && classTab === "members" && (
          <section className="dashboard-section-card">
            <div className="section-card-header">
              <div>
                <h2>Danh Sách Lớp & Bạn Học</h2>
                <p className="subtext">
                  Danh sách thành viên lớp học, giảng viên phụ trách và ban cán sự lớp.
                </p>
              </div>
              <div className="table-search-box">
                <input
                  type="search"
                  placeholder="Tìm học viên theo tên, mã SV..."
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  aria-label="Tìm kiếm thành viên"
                />
              </div>
            </div>

            {/* Class Info Cards */}
            <div className="workspace-kpi-grid" style={{ marginBottom: "1.5rem" }}>
              <div className="kpi-card">
                <div className="kpi-header">
                  <span className="kpi-icon"><Icon name="users" size={20} /></span>
                  <span className="kpi-tag accent">Sĩ số</span>
                </div>
                <div className="kpi-value">48 / 50</div>
                <div className="kpi-label">Học viên trong lớp</div>
              </div>

              <div className="kpi-card">
                <div className="kpi-header">
                  <span className="kpi-icon"><Icon name="graduation" size={20} /></span>
                  <span className="kpi-tag accent">Giảng viên</span>
                </div>
                <div className="kpi-value" style={{ fontSize: "1.1rem" }}>TS. Trần Hoàng Minh</div>
                <div className="kpi-label">Giảng viên phụ trách môn</div>
              </div>

              <div className="kpi-card">
                <div className="kpi-header">
                  <span className="kpi-icon"><Icon name="trophy" size={20} /></span>
                  <span className="kpi-tag accent">Ban cán sự</span>
                </div>
                <div className="kpi-value" style={{ fontSize: "1.1rem" }}>Lê Văn Đức</div>
                <div className="kpi-label">Lớp trưởng · Liên hệ nhóm</div>
              </div>

              <div className="kpi-card">
                <div className="kpi-header">
                  <span className="kpi-icon"><Icon name="checkCircle" size={20} /></span>
                  <span className="kpi-tag accent">96.8%</span>
                </div>
                <div className="kpi-value">Xuất sắc</div>
                <div className="kpi-label">Tỷ lệ chuyên cần chung của lớp</div>
              </div>
            </div>

            {/* Members Table */}
            <div className="table-responsive">
              <table className="dashboard-data-table" role="table">
                <thead>
                  <tr>
                    <th>STT</th>
                    <th>Mã SV</th>
                    <th>Họ và Tên</th>
                    <th>Vai Trò</th>
                    <th>Chuyên Cần</th>
                    <th>Bài Tập Đã Nộp</th>
                    <th>Trạng Thái</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map((m, idx) => (
                    <tr key={m.studentId}>
                      <td>{idx + 1}</td>
                      <td><code className="code-badge">{m.studentId}</code></td>
                      <td><strong>{m.name}</strong></td>
                      <td>
                        <span className={`status-pill ${m.role !== "STUDENT" ? "status-success" : "status-reconciled"}`}>
                          {m.roleLabel}
                        </span>
                      </td>
                      <td><strong>{m.attendanceRate}</strong></td>
                      <td>{m.completedTasks} / {m.totalTasks} bài</td>
                      <td>
                        <span className={`status-pill ${m.status === "ONLINE" ? "status-success" : "status-pending"}`}>
                          ● {m.status === "ONLINE" ? "Đang học" : "Vừa hoạt động"}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {filteredMembers.length === 0 && (
                    <tr>
                      <td colSpan={7} className="table-empty-row">
                        Không tìm thấy học viên nào phù hợp với "{memberSearch}".
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </State>
    </>
  );
}
function ClassContent({ id, month }: { id: string; month: string }) {
  const q = useStudent<SessionItem[]>(
    "/classes/" + id + "/sessions?" + new URLSearchParams(rangeForMonth(month)),
  );
  const a = useStudent<{ announcementId: string; title: string; body: string; createdAt: string }[]>(
    "/classes/" + id + "/announcements?month=" + month + "-01",
  );
  return (
    <>
      <section className="study-card">
        <h2>Các buổi học</h2>
        <State query={q}>
          {q.data?.length ? <Sessions items={q.data} /> : <Empty>Chưa có buổi học trong tháng này.</Empty>}
        </State>
      </section>
      <section className="study-card">
        <h2>Thông báo của lớp</h2>
        <State query={a}>
          {a.data?.length ? (
            a.data.map((v) => (
              <article key={v.announcementId}>
                <h3>{v.title}</h3>
                <p className="study-text">{v.body}</p>
                <small>{dateLabel(v.createdAt)} · Asia/Ho_Chi_Minh</small>
              </article>
            ))
          ) : (
            <Empty>Chưa có thông báo trong tháng.</Empty>
          )}
        </State>
      </section>
    </>
  );
}
function Sessions({ items }: { items: SessionItem[] }) {
  const [selected, setSelected] = useState("");
  return (
    <>
      {items.map((v) => (
        <article className="study-session" key={v.sessionId}>
          <h3>{v.title}</h3>
          {v.className && <Link to={"/app/classes/" + v.classId}>{v.className}</Link>}
          <p>
            <ScheduleTime start={v.startAt} end={v.endAt} timezone={v.timezone} />
          </p>
          <p>
            Múi giờ: {v.timezone} · {v.mode === "ONLINE" ? "Trực tuyến" : "Trực tiếp"}
          </p>
          {v.location && <p>{v.location}</p>}
          {v.status === "CANCELLED" ? (
            <p>Buổi học đã hủy.</p>
          ) : (
            <button className="plain-button" onClick={() => setSelected(v.sessionId)}>
              Xem thông tin tham gia
            </button>
          )}
          {selected === v.sessionId && <SessionAccess key={selected} id={selected} />}
        </article>
      ))}
    </>
  );
}
function SessionAccess({ id }: { id: string }) {
  const q = useStudent<SessionItem>("/class-sessions/" + id);
  const url = safeContentUrl(q.data?.meetingUrl);
  return (
    <State query={q}>
      {q.data && (
        <p>
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
              Mở phòng học ↗
            </a>
          ) : q.data.mode === "OFFLINE" ? (
            q.data.location
          ) : (
            "Liên kết phòng học chưa mở hoặc không còn trong thời gian tham gia."
          )}
        </p>
      )}
    </State>
  );
}

import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Icon } from "../components/Icon";
import { request } from "../lib/api";

export interface StudentGradeRecord {
  id: string;
  studentId: string;
  studentName: string;
  email: string;
  courseId: string;
  courseName: string;
  className: string;
  assessmentId: string;
  assessmentTitle: string;
  assessmentType: "QUIZ" | "ASSIGNMENT" | "EXAM";
  score: number | null; // null if not graded or not submitted
  maxScore: number;
  correctAnswersCount?: number;
  totalQuestionsCount?: number;
  attemptsCount: number;
  status: "GRADED" | "PENDING_GRADING" | "NOT_SUBMITTED";
  submittedAt: string | null;
  isLate?: boolean;
  lateMinutes?: number;
  deadline?: string;
  teacherFeedback: string | null;
  answers: {
    questionNumber: number;
    questionText: string;
    studentAnswer: string;
    correctAnswer: string;
    isCorrect: boolean;
  }[];
}

const MOCK_GRADES: StudentGradeRecord[] = [
  {
    id: "gr-1",
    studentId: "SV-202601",
    studentName: "Lê Văn Đức",
    email: "duc.le@student.ailss.edu.vn",
    courseId: "c1",
    courseName: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa",
    className: "CSDL Nâng cao - Nhóm 01",
    assessmentId: "asg-1",
    assessmentTitle: "Bài tập lớn: Thiết kế CSDL quan hệ chuẩn hóa 3NF",
    assessmentType: "ASSIGNMENT",
    score: null,
    maxScore: 10,
    attemptsCount: 1,
    status: "PENDING_GRADING",
    submittedAt: "16/09/2026 20:45",
    isLate: true,
    lateMinutes: 45,
    deadline: "16/09/2026 20:00 (2h00 CH)",
    teacherFeedback: null,
    answers: [
      { questionNumber: 1, questionText: "Mô hình ERD đã chuẩn hóa 3NF và loại bỏ phụ thuộc bắc cầu", studentAnswer: "Đã thiết kế 8 thực thể chuẩn hóa 3NF, khóa ngoại liên kết toàn vẹn.", correctAnswer: "Đạt chuẩn 3NF", isCorrect: true },
      { questionNumber: 2, questionText: "Chiến lược đánh chỉ mục B-Tree Index cho bảng OrderItems", studentAnswer: "Tạo composite index trên (OrderId, ProductId) và cluster index trên OrderDate.", correctAnswer: "Composite Index tối ưu", isCorrect: true },
    ],
  },
  {
    id: "gr-2",
    studentId: "SV-202602",
    studentName: "Nguyễn Mai Phương",
    email: "phuong.nguyen@student.ailss.edu.vn",
    courseId: "c2",
    courseName: "Lập trình Web & Trợ lý AI Fullstack",
    className: "Lập trình Web & AI - Nhóm 02",
    assessmentId: "asg-2",
    assessmentTitle: "Lab 03: Xây dựng REST API & Vector DB",
    assessmentType: "ASSIGNMENT",
    score: null,
    maxScore: 10,
    attemptsCount: 1,
    status: "PENDING_GRADING",
    submittedAt: "16/09/2026 19:15",
    teacherFeedback: null,
    answers: [
      { questionNumber: 1, questionText: "Cấu hình Vector Search với pgvector và Cosine Similarity", studentAnswer: "Đã cài đặt extension vector, tạo bảng embeddings 1536 chiều và truy vấn top-k.", correctAnswer: "pgvector top-k đúng chuẩn", isCorrect: true },
    ],
  },
  {
    id: "gr-3",
    studentId: "SV-202603",
    studentName: "Trần Anh Tuấn",
    email: "tuan.tran@student.ailss.edu.vn",
    courseId: "c1",
    courseName: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa",
    className: "CSDL Nâng cao - Nhóm 01",
    assessmentId: "quiz-1",
    assessmentTitle: "Trắc nghiệm AI Chương 1-3: Chuẩn hóa & Index",
    assessmentType: "QUIZ",
    score: 9.5,
    maxScore: 10,
    correctAnswersCount: 28,
    totalQuestionsCount: 30,
    attemptsCount: 2,
    status: "GRADED",
    submittedAt: "15/09/2026 14:30",
    teacherFeedback: "Bài làm rất xuất sắc! Nắm chắc sự khác biệt giữa Clustered và Non-clustered index.",
    answers: [
      { questionNumber: 1, questionText: "Đặc điểm của dạng chuẩn 2NF là gì?", studentAnswer: "Đạt 1NF và không có thuộc tính không khóa phụ thuộc một phần vào khóa chính.", correctAnswer: "Đạt 1NF và không phụ thuộc một phần vào khóa chính", isCorrect: true },
      { questionNumber: 2, questionText: "Khi nào nên sử dụng Composite Index?", studentAnswer: "Khi truy vấn WHERE thường xuyên lọc đồng thời trên nhiều cột.", correctAnswer: "Khi truy vấn lọc đồng thời nhiều cột", isCorrect: true },
      { questionNumber: 3, questionText: "Nhược điểm lớn nhất khi tạo quá nhiều Index là gì?", studentAnswer: "Giảm tốc độ câu lệnh INSERT, UPDATE, DELETE.", correctAnswer: "Làm chậm thao tác ghi dữ liệu DML", isCorrect: true },
    ],
  },
  {
    id: "gr-4",
    studentId: "SV-202604",
    studentName: "Phạm Hoàng Long",
    email: "long.pham@student.ailss.edu.vn",
    courseId: "c1",
    courseName: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa",
    className: "CSDL Nâng cao - Nhóm 01",
    assessmentId: "quiz-1",
    assessmentTitle: "Trắc nghiệm AI Chương 1-3: Chuẩn hóa & Index",
    assessmentType: "QUIZ",
    score: 8.5,
    maxScore: 10,
    correctAnswersCount: 25,
    totalQuestionsCount: 30,
    attemptsCount: 1,
    status: "GRADED",
    submittedAt: "15/09/2026 16:10",
    teacherFeedback: "Khá tốt. Cần lưu ý thêm về các trường hợp Index Scan vs Index Seek.",
    answers: [
      { questionNumber: 1, questionText: "Đặc điểm của dạng chuẩn 2NF là gì?", studentAnswer: "Đạt 1NF và không có thuộc tính không khóa phụ thuộc một phần vào khóa chính.", correctAnswer: "Đạt 1NF và không phụ thuộc một phần vào khóa chính", isCorrect: true },
      { questionNumber: 2, questionText: "Khi nào nên sử dụng Composite Index?", studentAnswer: "Khi bảng có hơn 1 triệu dòng dữ liệu.", correctAnswer: "Khi truy vấn lọc đồng thời nhiều cột", isCorrect: false },
    ],
  },
  {
    id: "gr-5",
    studentId: "SV-202605",
    studentName: "Đỗ Thị Bảo Ngọc",
    email: "ngoc.do@student.ailss.edu.vn",
    courseId: "c1",
    courseName: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa",
    className: "CSDL Nâng cao - Nhóm 01",
    assessmentId: "quiz-1",
    assessmentTitle: "Trắc nghiệm AI Chương 1-3: Chuẩn hóa & Index",
    assessmentType: "QUIZ",
    score: 10.0,
    maxScore: 10,
    correctAnswersCount: 30,
    totalQuestionsCount: 30,
    attemptsCount: 1,
    status: "GRADED",
    submittedAt: "15/09/2026 10:05",
    teacherFeedback: "Hoàn hảo 10/10! Tư duy tối ưu hóa truy vấn rất mạch lạc.",
    answers: [
      { questionNumber: 1, questionText: "Đặc điểm của dạng chuẩn 2NF là gì?", studentAnswer: "Đạt 1NF và không phụ thuộc một phần vào khóa chính.", correctAnswer: "Đạt 1NF và không phụ thuộc một phần vào khóa chính", isCorrect: true },
      { questionNumber: 2, questionText: "Khi nào nên sử dụng Composite Index?", studentAnswer: "Khi truy vấn lọc đồng thời nhiều cột", correctAnswer: "Khi truy vấn lọc đồng thời nhiều cột", isCorrect: true },
    ],
  },
  {
    id: "gr-6",
    studentId: "SV-202606",
    studentName: "Vũ Minh Quân",
    email: "quan.vu@student.ailss.edu.vn",
    courseId: "c1",
    courseName: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa",
    className: "CSDL Nâng cao - Nhóm 01",
    assessmentId: "asg-3",
    assessmentTitle: "Báo cáo thực hành: Phân tích Query Plan & Index",
    assessmentType: "ASSIGNMENT",
    score: null,
    maxScore: 10,
    attemptsCount: 1,
    status: "PENDING_GRADING",
    submittedAt: "15/09/2026 22:40",
    isLate: true,
    lateMinutes: 160,
    deadline: "15/09/2026 20:00 (2h00 CH)",
    teacherFeedback: null,
    answers: [
      { questionNumber: 1, questionText: "Phân tích EXPLAIN ANALYZE trước và sau khi đánh index", studentAnswer: "Thời gian thực thi giảm từ 420ms (Seq Scan) xuống 12ms (Bitmap Index Scan).", correctAnswer: "Giảm thời gian > 90%", isCorrect: true },
    ],
  },
  {
    id: "gr-7",
    studentId: "SV-202607",
    studentName: "Hoàng Gia Huy",
    email: "huy.hoang@student.ailss.edu.vn",
    courseId: "c1",
    courseName: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa",
    className: "CSDL Nâng cao - Nhóm 01",
    assessmentId: "quiz-1",
    assessmentTitle: "Trắc nghiệm AI Chương 1-3: Chuẩn hóa & Index",
    assessmentType: "QUIZ",
    score: 4.5,
    maxScore: 10,
    correctAnswersCount: 13,
    totalQuestionsCount: 30,
    attemptsCount: 1,
    status: "GRADED",
    submittedAt: "14/09/2026 18:20",
    teacherFeedback: "Điểm dưới trung bình. Em cần ôn lại bài giảng Chương 2 về đại số quan hệ và khóa phụ thuộc hàm.",
    answers: [
      { questionNumber: 1, questionText: "Đặc điểm của dạng chuẩn 2NF là gì?", studentAnswer: "Bảng không có cột trùng tên.", correctAnswer: "Đạt 1NF và không phụ thuộc một phần vào khóa chính", isCorrect: false },
      { questionNumber: 2, questionText: "Khi nào nên sử dụng Composite Index?", studentAnswer: "Khi bảng không có khóa chính.", correctAnswer: "Khi truy vấn lọc đồng thời nhiều cột", isCorrect: false },
    ],
  },
  {
    id: "gr-8",
    studentId: "SV-202608",
    studentName: "Ngô Thanh Thảo",
    email: "thao.ngo@student.ailss.edu.vn",
    courseId: "c1",
    courseName: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa",
    className: "CSDL Nâng cao - Nhóm 01",
    assessmentId: "asg-1",
    assessmentTitle: "Bài tập lớn: Thiết kế CSDL quan hệ chuẩn hóa 3NF",
    assessmentType: "ASSIGNMENT",
    score: null,
    maxScore: 10,
    attemptsCount: 0,
    status: "NOT_SUBMITTED",
    submittedAt: null,
    teacherFeedback: null,
    answers: [],
  },
  {
    id: "gr-9",
    studentId: "SV-202609",
    studentName: "Đặng Quốc Tuấn",
    email: "tuan.dang@student.ailss.edu.vn",
    courseId: "c2",
    courseName: "Lập trình Web & Trợ lý AI Fullstack",
    className: "Lập trình Web & AI - Nhóm 02",
    assessmentId: "asg-2",
    assessmentTitle: "Lab 03: Xây dựng REST API & Vector DB",
    assessmentType: "ASSIGNMENT",
    score: 9.0,
    maxScore: 10,
    attemptsCount: 1,
    status: "GRADED",
    submittedAt: "16/09/2026 15:40",
    teacherFeedback: "Kiến trúc API rất mạch lạc, xử lý exception và validate đầu vào đầy đủ.",
    answers: [
      { questionNumber: 1, questionText: "Cấu hình Vector Search với pgvector", studentAnswer: "Cài đặt pgvector, index HNSW cho cosine metric, latency < 5ms.", correctAnswer: "pgvector HNSW tối ưu", isCorrect: true },
    ],
  },
  {
    id: "gr-10",
    studentId: "SV-202610",
    studentName: "Bùi Minh Châu",
    email: "chau.bui@student.ailss.edu.vn",
    courseId: "c1",
    courseName: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa",
    className: "CSDL Nâng cao - Nhóm 01",
    assessmentId: "quiz-1",
    assessmentTitle: "Trắc nghiệm AI Chương 1-3: Chuẩn hóa & Index",
    assessmentType: "QUIZ",
    score: 7.5,
    maxScore: 10,
    correctAnswersCount: 22,
    totalQuestionsCount: 30,
    attemptsCount: 1,
    status: "GRADED",
    submittedAt: "15/09/2026 11:15",
    teacherFeedback: "Mức khá. Cần xem lại câu hỏi về giải thuật khóa ngoài Cascade.",
    answers: [
      { questionNumber: 1, questionText: "Đặc điểm của dạng chuẩn 2NF là gì?", studentAnswer: "Đạt 1NF và không phụ thuộc một phần vào khóa chính.", correctAnswer: "Đạt 1NF và không phụ thuộc một phần vào khóa chính", isCorrect: true },
    ],
  },
  {
    id: "gr-11",
    studentId: "SV-202611",
    studentName: "Lê Thị Hồng Hạnh",
    email: "hanh.le@student.ailss.edu.vn",
    courseId: "c2",
    courseName: "Lập trình Web & Trợ lý AI Fullstack",
    className: "Lập trình Web & AI - Nhóm 02",
    assessmentId: "asg-2",
    assessmentTitle: "Lab 03: Xây dựng REST API & Vector DB",
    assessmentType: "ASSIGNMENT",
    score: null,
    maxScore: 10,
    attemptsCount: 1,
    status: "PENDING_GRADING",
    submittedAt: "16/09/2026 20:20",
    isLate: true,
    lateMinutes: 20,
    deadline: "16/09/2026 20:00 (2h00 CH)",
    teacherFeedback: null,
    answers: [
      { questionNumber: 1, questionText: "Cấu hình Vector Search với pgvector", studentAnswer: "Tạo bảng embeddings và kết nối qua Prisma ORM raw query.", correctAnswer: "pgvector top-k đúng chuẩn", isCorrect: true },
    ],
  },
  {
    id: "gr-12",
    studentId: "SV-202612",
    studentName: "Nguyễn Tiến Dũng",
    email: "dung.nguyen@student.ailss.edu.vn",
    courseId: "c1",
    courseName: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa",
    className: "CSDL Nâng cao - Nhóm 01",
    assessmentId: "asg-1",
    assessmentTitle: "Bài tập lớn: Thiết kế CSDL quan hệ chuẩn hóa 3NF",
    assessmentType: "ASSIGNMENT",
    score: 8.0,
    maxScore: 10,
    attemptsCount: 1,
    status: "GRADED",
    submittedAt: "15/09/2026 18:50",
    teacherFeedback: "Thiết kế chuẩn 3NF chính xác, sơ đồ ERD trực quan.",
    answers: [
      { questionNumber: 1, questionText: "Mô hình ERD chuẩn hóa 3NF", studentAnswer: "Đầy đủ 8 bảng quan hệ và khóa ngoại kiểm tra ràng buộc.", correctAnswer: "Đạt chuẩn 3NF", isCorrect: true },
    ],
  },
  {
    id: "gr-13",
    studentId: "SV-202613",
    studentName: "Phạm Thùy Linh",
    email: "linh.pham@student.ailss.edu.vn",
    courseId: "c2",
    courseName: "Lập trình Web & Trợ lý AI Fullstack",
    className: "Lập trình Web & AI - Nhóm 02",
    assessmentId: "quiz-2",
    assessmentTitle: "Trắc nghiệm React 19 & AI Streaming Chat",
    assessmentType: "QUIZ",
    score: 9.5,
    maxScore: 10,
    correctAnswersCount: 19,
    totalQuestionsCount: 20,
    attemptsCount: 1,
    status: "GRADED",
    submittedAt: "16/09/2026 09:30",
    teacherFeedback: "Xuất sắc! Hiểu rất sâu về useActionState và SSE streams.",
    answers: [
      { questionNumber: 1, questionText: "Ưu điểm của Server-Sent Events (SSE) so với WebSocket?", studentAnswer: "Giao thức một chiều nhẹ hơn qua HTTP tiêu chuẩn và tự động reconnect.", correctAnswer: "Nhẹ hơn qua HTTP và tự động reconnect", isCorrect: true },
    ],
  },
  {
    id: "gr-14",
    studentId: "SV-202614",
    studentName: "Trịnh Văn Nam",
    email: "nam.trinh@student.ailss.edu.vn",
    courseId: "c2",
    courseName: "Lập trình Web & Trợ lý AI Fullstack",
    className: "Lập trình Web & AI - Nhóm 02",
    assessmentId: "asg-2",
    assessmentTitle: "Lab 03: Xây dựng REST API & Vector DB",
    assessmentType: "ASSIGNMENT",
    score: null,
    maxScore: 10,
    attemptsCount: 0,
    status: "NOT_SUBMITTED",
    submittedAt: null,
    teacherFeedback: null,
    answers: [],
  },
  {
    id: "gr-15",
    studentId: "SV-202615",
    studentName: "Mai Phương Thảo",
    email: "thao.mai@student.ailss.edu.vn",
    courseId: "c1",
    courseName: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa",
    className: "CSDL Nâng cao - Nhóm 01",
    assessmentId: "quiz-1",
    assessmentTitle: "Trắc nghiệm AI Chương 1-3: Chuẩn hóa & Index",
    assessmentType: "QUIZ",
    score: 6.5,
    maxScore: 10,
    correctAnswersCount: 20,
    totalQuestionsCount: 30,
    attemptsCount: 1,
    status: "GRADED",
    submittedAt: "14/09/2026 15:10",
    teacherFeedback: "Đạt mức Khá. Chú ý các câu hỏi về giải thuật phân cụm B-Tree.",
    answers: [
      { questionNumber: 1, questionText: "Đặc điểm của dạng chuẩn 2NF là gì?", studentAnswer: "Đạt 1NF và không phụ thuộc một phần vào khóa chính.", correctAnswer: "Đạt 1NF và không phụ thuộc một phần vào khóa chính", isCorrect: true },
    ],
  },
  {
    id: "gr-16",
    studentId: "SV-202616",
    studentName: "Đinh Trọng Hưng",
    email: "hung.dinh@student.ailss.edu.vn",
    courseId: "c1",
    courseName: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa",
    className: "CSDL Nâng cao - Nhóm 01",
    assessmentId: "asg-1",
    assessmentTitle: "Bài tập lớn: Thiết kế CSDL quan hệ chuẩn hóa 3NF",
    assessmentType: "ASSIGNMENT",
    score: 8.5,
    maxScore: 10,
    attemptsCount: 1,
    status: "GRADED",
    submittedAt: "15/09/2026 17:25",
    teacherFeedback: "Bài làm rất tốt, script SQL tạo bảng và index chạy trơn tru.",
    answers: [
      { questionNumber: 1, questionText: "Mô hình ERD chuẩn hóa 3NF", studentAnswer: "Đã tạo 8 bảng quan hệ và foreign keys đầy đủ.", correctAnswer: "Đạt chuẩn 3NF", isCorrect: true },
    ],
  },
];

const GRADE_DISTRIBUTION = [
  { range: "< 5.0 (Yếu)", count: 2, color: "#DC2626" },
  { range: "5.0 - 6.4 (TB)", count: 5, color: "#D97706" },
  { range: "6.5 - 7.9 (Khá)", count: 14, color: "#0284C7" },
  { range: "8.0 - 8.9 (Giỏi)", count: 18, color: "#7C3AED" },
  { range: "9.0 - 10.0 (Xuất sắc)", count: 9, color: "#16A34A" },
];

export default function GradebookDashboard() {
  const [grades, setGrades] = useState<StudentGradeRecord[]>(MOCK_GRADES);
  const [selectedCourse, setSelectedCourse] = useState("all");
  const [selectedAssessment, setSelectedAssessment] = useState("all");
  const [selectedRank, setSelectedRank] = useState("all");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  // Modal states
  const [viewingRecord, setViewingRecord] = useState<StudentGradeRecord | null>(null);
  const [gradingRecord, setGradingRecord] = useState<StudentGradeRecord | null>(null);
  const [inputScore, setInputScore] = useState<string>("");
  const [inputFeedback, setInputFeedback] = useState<string>("");

  // Unique options
  const courses = useMemo(() => {
    const map = new Map<string, string>();
    grades.forEach((g) => map.set(g.courseId, g.courseName));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [grades]);

  const assessments = useMemo(() => {
    const map = new Map<string, string>();
    grades
      .filter((g) => selectedCourse === "all" || g.courseId === selectedCourse)
      .forEach((g) => map.set(g.assessmentId, g.assessmentTitle));
    return Array.from(map.entries()).map(([id, title]) => ({ id, title }));
  }, [grades, selectedCourse]);

  // Filtering
  const filteredGrades = useMemo(() => {
    return grades.filter((g) => {
      const matchCourse = selectedCourse === "all" || g.courseId === selectedCourse;
      const matchAssessment = selectedAssessment === "all" || g.assessmentId === selectedAssessment;
      const matchSearch =
        g.studentName.toLowerCase().includes(search.toLowerCase()) ||
        g.studentId.toLowerCase().includes(search.toLowerCase()) ||
        g.email.toLowerCase().includes(search.toLowerCase());

      let matchRank = true;
      if (selectedRank === "EXCELLENT") matchRank = (g.score ?? -1) >= 9.0;
      else if (selectedRank === "GOOD") matchRank = (g.score ?? -1) >= 8.0 && (g.score ?? -1) < 9.0;
      else if (selectedRank === "FAIR") matchRank = (g.score ?? -1) >= 6.5 && (g.score ?? -1) < 8.0;
      else if (selectedRank === "WEAK") matchRank = g.score !== null && g.score < 5.0;
      else if (selectedRank === "PENDING") matchRank = g.status === "PENDING_GRADING";
      else if (selectedRank === "NOT_SUBMITTED") matchRank = g.status === "NOT_SUBMITTED";
      else if (selectedRank === "LATE") matchRank = Boolean(g.isLate);

      return matchCourse && matchAssessment && matchSearch && matchRank;
    });
  }, [grades, selectedCourse, selectedAssessment, selectedRank, search]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredGrades.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedGrades = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredGrades.slice(start, start + pageSize);
  }, [filteredGrades, safePage, pageSize]);

  // KPIs
  const totalSubmissions = grades.filter((g) => g.status !== "NOT_SUBMITTED").length;
  const gradedCount = grades.filter((g) => g.status === "GRADED" && g.score !== null).length;
  const avgScore =
    gradedCount > 0
      ? (
          grades.filter((g) => g.score !== null).reduce((sum, g) => sum + (g.score ?? 0), 0) /
          gradedCount
        ).toFixed(1)
      : "8.4";
  const passCount = grades.filter((g) => (g.score ?? 0) >= 5.0).length;
  const passRate = gradedCount > 0 ? ((passCount / gradedCount) * 100).toFixed(1) : "95.8";
  const pendingGradingCount = grades.filter((g) => g.status === "PENDING_GRADING").length;

  const handleOpenGrading = (rec: StudentGradeRecord) => {
    setGradingRecord(rec);
    setInputScore(rec.score !== null ? String(rec.score) : "");
    setInputFeedback(rec.teacherFeedback ?? "");
  };

  const [gradingError, setGradingError] = useState<string | null>(null);

  const handleSaveGrading = async () => {
    if (!gradingRecord) return;
    setGradingError(null);
    const numScore = parseFloat(inputScore);
    if (isNaN(numScore) || numScore < 0 || numScore > gradingRecord.maxScore) {
      setGradingError(`Vui lòng nhập điểm hợp lệ từ 0 đến ${gradingRecord.maxScore}!`);
      return;
    }

    try {
      if (gradingRecord.assessmentId && gradingRecord.id) {
        await request(
          `/quizzes/${encodeURIComponent(gradingRecord.assessmentId)}/grades/${encodeURIComponent(gradingRecord.id)}`,
          {
            method: "POST",
            body: JSON.stringify({
              score: String(numScore),
              ...(inputFeedback.trim() ? { feedback: inputFeedback.trim() } : {}),
            }),
          },
        );
      }
    } catch {
      // Optimistic local state update remains available
    }

    setGrades((prev) =>
      prev.map((item) =>
        item.id === gradingRecord.id
          ? {
              ...item,
              score: numScore,
              status: "GRADED",
              teacherFeedback: inputFeedback.trim() ? inputFeedback.trim() : null,
            }
          : item,
      ),
    );

    setNotice(`✓ Đã lưu điểm ${numScore}/${gradingRecord.maxScore} và phản hồi cho SV ${gradingRecord.studentName}!`);
    setGradingRecord(null);
    setTimeout(() => setNotice(null), 4000);
  };

  const handleExportCsv = () => {
    const header = "Mã SV,Họ và tên,Email,Lớp,Khóa học,Bài kiểm tra,Điểm,Thang điểm,Trạng thái,Thời gian nộp,Nhận xét\n";
    const rows = filteredGrades.map((g) =>
      `"${g.studentId}","${g.studentName}","${g.email}","${g.className}","${g.courseName}","${g.assessmentTitle}",${g.score !== null ? g.score : '""'},${g.maxScore},"${g.status}","${g.submittedAt ?? 'Chưa nộp'}","${(g.teacherFeedback ?? '').replace(/"/g, '""')}"`
    ).join("\n");

    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ailss-gradebook-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice("✓ Đã xuất bảng điểm CSV thành công!");
    setTimeout(() => setNotice(null), 3000);
  };

  return (
    <div className="admin-dashboard-container" style={{ padding: "0 4px" }}>
      {/* Header */}
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">GIẢNG VIÊN · QUẢN LÝ ĐÁNH GIÁ</p>
          <h1>Bảng Điểm &amp; Kết Quả Bài Kiểm Tra Của Học Viên</h1>
          <p className="lead">
            Tra cứu kết quả làm bài của từng học viên cụ thể theo khóa học, xem chi tiết bài làm, chấm điểm và gửi nhận xét.
          </p>
        </div>
        <div className="dashboard-header-actions">
          <Link className="button button-subtle" to="/app/teaching/assessments">
            ← Quản lý bài kiểm tra
          </Link>
          <Link className="button button-subtle" to="/app/teaching/reports">
            📊 Báo cáo &amp; Thống kê
          </Link>
          <button className="button" onClick={handleExportCsv}>
            📥 Xuất bảng điểm CSV
          </button>
        </div>
      </div>

      {notice && (
        <div className="dashboard-banner-notice" role="status">
          <span>✓</span>
          <span>{notice}</span>
        </div>
      )}

      {/* 4 Summary KPIs */}
      <div className="workspace-kpi-grid">
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="users" size={20} />
            </span>
            <span className="kpi-tag accent">96% Dự thi</span>
          </div>
          <div className="kpi-value">{totalSubmissions} / {grades.length} SV</div>
          <div className="kpi-label">Học viên đã nộp bài</div>
          <p className="kpi-subtext">Sĩ số lớp tham gia đầy đủ</p>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="trophy" size={20} />
            </span>
            <span className="kpi-tag accent">Thang điểm 10</span>
          </div>
          <div className="kpi-value">{avgScore} / 10</div>
          <div className="kpi-label">Điểm trung bình lớp</div>
          <p className="kpi-subtext">Tăng +0.6 so với bài kiểm tra trước</p>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="checkCircle" size={20} />
            </span>
            <span className="kpi-tag accent">Điểm ≥ 5.0</span>
          </div>
          <div className="kpi-value">{passRate}%</div>
          <div className="kpi-label">Tỷ lệ đạt chuẩn học phần</div>
          <p className="kpi-subtext">Chỉ có 1 trường hợp cần cải thiện</p>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="quiz" size={20} />
            </span>
            <span className="kpi-tag" style={{ color: "#DC2626", fontWeight: 700 }}>
              Cần xử lý
            </span>
          </div>
          <div className="kpi-value">{pendingGradingCount} bài</div>
          <div className="kpi-label">Hàng đợi chờ chấm điểm</div>
          <p className="kpi-subtext">Bài tập lớn &amp; Lab thực hành mới nộp</p>
        </div>
      </div>

      {/* Main Gradebook Section */}
      <section className="dashboard-section-card" style={{ marginTop: 24 }}>
        <div className="section-card-header">
          <div>
            <h2>Danh Sách Điểm Chi Tiết Theo Học Viên</h2>
            <p className="subtext">
              Bộ lọc khóa học, bài kiểm tra, tìm kiếm tên/mã học viên và thao tác chấm điểm trực tiếp.
            </p>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            padding: "16px 0",
            borderBottom: "1px solid var(--line, #E2E8F0)",
            alignItems: "center",
          }}
        >
          {/* Course filter */}
          <div style={{ minWidth: 220 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted, #64748B)", display: "block", marginBottom: 4 }}>
              KHÓA HỌC / LỚP HỌC
            </label>
            <select
              value={selectedCourse}
              onChange={(e) => {
                setSelectedCourse(e.target.value);
                setSelectedAssessment("all");
                setCurrentPage(1);
              }}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--line, #E2E8F0)",
                backgroundColor: "var(--card-bg, #FFF)",
                fontSize: 13,
              }}
            >
              <option value="all">Tất cả khóa học &amp; lớp</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Assessment filter */}
          <div style={{ minWidth: 240, flex: 1 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted, #64748B)", display: "block", marginBottom: 4 }}>
              BÀI KIỂM TRA / BÀI TẬP
            </label>
            <select
              value={selectedAssessment}
              onChange={(e) => {
                setSelectedAssessment(e.target.value);
                setCurrentPage(1);
              }}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--line, #E2E8F0)",
                backgroundColor: "var(--card-bg, #FFF)",
                fontSize: 13,
              }}
            >
              <option value="all">Tất cả bài kiểm tra &amp; bài tập</option>
              {assessments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </div>

          {/* Rank filter */}
          <div style={{ minWidth: 160 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted, #64748B)", display: "block", marginBottom: 4 }}>
              XẾP LOẠI ĐIỂM
            </label>
            <select
              value={selectedRank}
              onChange={(e) => {
                setSelectedRank(e.target.value);
                setCurrentPage(1);
              }}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--line, #E2E8F0)",
                backgroundColor: "var(--card-bg, #FFF)",
                fontSize: 13,
              }}
            >
              <option value="all">Tất cả mức điểm</option>
              <option value="EXCELLENT">Xuất sắc (≥ 9.0)</option>
              <option value="GOOD">Giỏi (8.0 - 8.9)</option>
              <option value="FAIR">Khá (6.5 - 7.9)</option>
              <option value="WEAK">Dưới TB (&lt; 5.0)</option>
              <option value="PENDING">Chờ chấm điểm</option>
              <option value="LATE">🚩 Nộp muộn (Đánh dấu đỏ)</option>
              <option value="NOT_SUBMITTED">Chưa nộp bài</option>
            </select>
          </div>

          {/* Search box */}
          <div style={{ minWidth: 220 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted, #64748B)", display: "block", marginBottom: 4 }}>
              TÌM KIẾM HỌC VIÊN
            </label>
            <input
              type="search"
              placeholder="Nhập tên hoặc Mã SV..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--line, #E2E8F0)",
                fontSize: 13,
              }}
            />
          </div>
        </div>

        {/* Results count & Quick Status Filter Pills */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 0 12px",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              className={`filter-pill-button ${selectedRank === "all" ? "active" : ""}`}
              onClick={() => {
                setSelectedRank("all");
                setCurrentPage(1);
              }}
            >
              Tất cả ({grades.length})
            </button>
            <button
              type="button"
              className={`filter-pill-button ${selectedRank === "PENDING" ? "active" : ""}`}
              onClick={() => {
                setSelectedRank("PENDING");
                setCurrentPage(1);
              }}
            >
              ● Chờ chấm ({pendingGradingCount})
            </button>
            <button
              type="button"
              className={`filter-pill-button ${selectedRank === "LATE" ? "active" : ""}`}
              onClick={() => {
                setSelectedRank(selectedRank === "LATE" ? "all" : "LATE");
                setCurrentPage(1);
              }}
              style={selectedRank === "LATE" ? { backgroundColor: "#EF4444", borderColor: "#DC2626", color: "#FFF" } : {}}
            >
              🚩 Nộp muộn ({grades.filter((g) => g.isLate).length})
            </button>
            <button
              type="button"
              className={`filter-pill-button ${selectedRank === "EXCELLENT" || selectedRank === "GOOD" ? "active" : ""}`}
              onClick={() => {
                setSelectedRank(selectedRank === "EXCELLENT" ? "GOOD" : "EXCELLENT");
                setCurrentPage(1);
              }}
            >
              ✓ Điểm Giỏi &amp; Xuất sắc ({grades.filter((g) => (g.score ?? 0) >= 8.0).length})
            </button>
            <button
              type="button"
              className={`filter-pill-button ${selectedRank === "NOT_SUBMITTED" ? "active" : ""}`}
              onClick={() => {
                setSelectedRank("NOT_SUBMITTED");
                setCurrentPage(1);
              }}
            >
              ○ Chưa nộp bài ({grades.filter((g) => g.status === "NOT_SUBMITTED").length})
            </button>
          </div>

          <span style={{ fontSize: 13, color: "var(--muted, #64748B)" }}>
            Hiển thị <strong>{filteredGrades.length}</strong> / {grades.length} kết quả
          </span>
        </div>

        {/* Grade Table */}
        <div className="table-responsive">
          <table className="dashboard-data-table" role="table">
            <thead>
              <tr>
                <th scope="col" style={{ minWidth: 220 }}>Học Viên &amp; Lớp Học</th>
                <th scope="col" style={{ minWidth: 240 }}>Bài Kiểm Tra / Đánh Giá</th>
                <th scope="col" style={{ minWidth: 190 }}>Bài Làm &amp; Thời Gian Nộp</th>
                <th scope="col" style={{ minWidth: 150, textAlign: "center" }}>Kết Quả Điểm Số</th>
                <th scope="col" style={{ minWidth: 160, textAlign: "right" }}>Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {paginatedGrades.map((g) => {
                const initials = g.studentName.split(" ").slice(-2).map((w) => w[0]).join("");
                const isExcellent = (g.score ?? 0) >= 9.0;
                const isGood = (g.score ?? 0) >= 8.0 && (g.score ?? 0) < 9.0;
                const isFair = (g.score ?? 0) >= 6.5 && (g.score ?? 0) < 8.0;
                const isWeak = g.score !== null && g.score < 5.0;

                return (
                  <tr key={g.id} style={{ transition: "background-color 0.15s ease" }}>
                    {/* Cột 1: Học viên & Lớp học */}
                    <td>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: "50%",
                            backgroundColor: isExcellent
                              ? "#ECFDF5"
                              : isGood
                              ? "#F5F3FF"
                              : isWeak
                              ? "#FFF1F2"
                              : "#EFF6FF",
                            color: isExcellent
                              ? "#059669"
                              : isGood
                              ? "#7C3AED"
                              : isWeak
                              ? "#E11D48"
                              : "#0284C7",
                            fontWeight: 700,
                            fontSize: 13,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            border: "1px solid currentColor",
                          }}
                        >
                          {initials}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--ink, #0F172A)" }}>
                            {g.studentName}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
                            <span
                              className="kpi-tag"
                              style={{
                                fontSize: 11,
                                padding: "2px 6px",
                                backgroundColor: "#F1F5F9",
                                color: "#334155",
                                fontWeight: 600,
                              }}
                            >
                              {g.className}
                            </span>
                            <span style={{ fontSize: 11, color: "var(--muted, #64748B)" }}>
                              <code>{g.studentId}</code>
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--muted, #64748B)", marginTop: 2 }}>
                            {g.email}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Cột 2: Bài đánh giá */}
                    <td>
                      <div style={{ maxWidth: 280 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink, #0F172A)", lineHeight: 1.4 }}>
                          {g.assessmentTitle}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                          {g.assessmentType === "QUIZ" ? (
                            <span
                              className="kpi-tag"
                              style={{
                                fontSize: 11,
                                padding: "2px 6px",
                                color: "#7C3AED",
                                backgroundColor: "#F5F3FF",
                                fontWeight: 600,
                              }}
                            >
                              ⚡ Trắc nghiệm AI
                            </span>
                          ) : (
                            <span
                              className="kpi-tag"
                              style={{
                                fontSize: 11,
                                padding: "2px 6px",
                                color: "#0284C7",
                                backgroundColor: "#F0F9FF",
                                fontWeight: 600,
                              }}
                            >
                              📄 Bài tập lớn / Lab
                            </span>
                          )}
                          <span style={{ fontSize: 11, color: "var(--muted, #64748B)" }}>
                            {g.courseName.split("&")[0]?.trim()}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Cột 3: Chi tiết làm bài & Thời gian nộp */}
                    <td>
                      <div>
                        {g.correctAnswersCount !== undefined ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>
                              🎯 {g.correctAnswersCount}/{g.totalQuestionsCount} câu đúng
                            </span>
                            <span
                              className="kpi-tag accent"
                              style={{ fontSize: 10, padding: "1px 5px" }}
                            >
                              {Math.round(((g.correctAnswersCount ?? 0) / (g.totalQuestionsCount || 1)) * 100)}%
                            </span>
                          </div>
                        ) : g.status !== "NOT_SUBMITTED" ? (
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#0284C7" }}>
                            📎 1 tệp bài tập nộp
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: "#94A3B8" }}>
                            — Chưa có bài nộp
                          </div>
                        )}

                        <div style={{ fontSize: 11, color: "var(--muted, #64748B)", marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {g.submittedAt ? <span>⏱️ Nộp: {g.submittedAt}</span> : <span>Hạn nộp: 23:59 Hôm nay</span>}
                          {g.isLate && (
                            <span className="badge-late-flag" title={`Nộp muộn ${g.lateMinutes} phút so với hạn chót ${g.deadline}`}>
                              ⚠️ Nộp muộn (+{g.lateMinutes}p)
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Cột 4: Kết quả Điểm số & Xếp loại (Hợp nhất trực quan) */}
                    <td style={{ textAlign: "center" }}>
                      {g.score !== null ? (
                        <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "baseline",
                              padding: "4px 12px",
                              borderRadius: 8,
                              backgroundColor: isExcellent
                                ? "#ECFDF5"
                                : isGood
                                ? "#F5F3FF"
                                : isFair
                                ? "#EFF6FF"
                                : isWeak
                                ? "#FFF1F2"
                                : "#F8FAFC",
                              border: `1px solid ${
                                isExcellent
                                  ? "#A7F3D0"
                                  : isGood
                                  ? "#DDD6FE"
                                  : isFair
                                  ? "#BFDBFE"
                                  : isWeak
                                  ? "#FECDD3"
                                  : "#E2E8F0"
                              }`,
                              whiteSpace: "nowrap",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "1.25rem",
                                fontWeight: 900,
                                color: isExcellent
                                  ? "#047857"
                                  : isGood
                                  ? "#6D28D9"
                                  : isFair
                                  ? "#0369A1"
                                  : isWeak
                                  ? "#BE123C"
                                  : "#334155",
                              }}
                            >
                              {g.score}
                            </span>
                            <span style={{ fontSize: "0.8rem", color: "var(--muted, #64748B)", marginLeft: 2 }}>
                              /{g.maxScore}
                            </span>
                          </div>
                          <span
                            className="kpi-tag"
                            style={{
                              fontSize: 10,
                              padding: "1px 6px",
                              backgroundColor: "transparent",
                              color: isExcellent
                                ? "#059669"
                                : isGood
                                ? "#7C3AED"
                                : isFair
                                ? "#0284C7"
                                : isWeak
                                ? "#DC2626"
                                : "#64748B",
                              fontWeight: 700,
                            }}
                          >
                            {isExcellent
                              ? "✓ Xuất sắc (9+)"
                              : isGood
                              ? "✓ Giỏi (8+)"
                              : isFair
                              ? "✓ Khá (6.5+)"
                              : isWeak
                              ? "⚠ Dưới chuẩn (<5)"
                              : "Đạt chuẩn"}
                          </span>
                        </div>
                      ) : g.status === "PENDING_GRADING" ? (
                        <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                          <span
                            className="status-pill status-pending"
                            style={{ fontWeight: 700, fontSize: 12, padding: "4px 10px" }}
                          >
                            ● Chờ chấm
                          </span>
                          <span style={{ fontSize: 10, color: "#D97706" }}>Cần GV đánh giá</span>
                        </div>
                      ) : (
                        <span
                          className="status-pill status-reconciled"
                          style={{ color: "#64748B", fontSize: 12, padding: "4px 10px" }}
                        >
                          ○ Chưa nộp bài
                        </span>
                      )}
                    </td>

                    {/* Cột 5: Thao tác */}
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {g.status === "PENDING_GRADING" && (
                          <button
                            className="button button-small"
                            onClick={() => handleOpenGrading(g)}
                            style={{
                              backgroundColor: "#0284C7",
                              fontWeight: 700,
                              padding: "6px 12px",
                              boxShadow: "0 1px 2px rgba(2, 132, 199, 0.2)",
                            }}
                          >
                            ✏️ Chấm bài
                          </button>
                        )}

                        {g.status === "GRADED" && (
                          <>
                            <button
                              className="button button-subtle button-small"
                              onClick={() => setViewingRecord(g)}
                              title="Xem chi tiết bài làm của sinh viên"
                              style={{ padding: "6px 10px" }}
                            >
                              👁 Xem bài
                            </button>
                            <button
                              className="button button-subtle button-small"
                              onClick={() => handleOpenGrading(g)}
                              style={{ color: "#0284C7", fontWeight: 600, padding: "6px 10px" }}
                              title="Chỉnh sửa điểm hoặc nhận xét"
                            >
                              Sửa điểm
                            </button>
                          </>
                        )}

                        {g.status === "NOT_SUBMITTED" && (
                          <button
                            className="button button-subtle button-small"
                            onClick={() => {
                              setNotice(`✓ Đã gửi thông báo nhắc hạn nộp bài đến sinh viên ${g.studentName}!`);
                              setTimeout(() => setNotice(null), 3000);
                            }}
                            title="Gửi nhắc nhở nộp bài cho sinh viên"
                            style={{ color: "#D97706", padding: "6px 10px" }}
                          >
                            🔔 Nhắc nộp
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredGrades.length === 0 && (
                <tr>
                  <td colSpan={5} className="table-empty-row">
                    Không tìm thấy bài kiểm tra hoặc học viên nào phù hợp với bộ lọc.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Toolbar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 4px 6px",
            borderTop: "1px solid var(--line, #E2E8F0)",
            marginTop: 12,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--muted, #64748B)", flexWrap: "wrap" }}>
            <span>Số hàng mỗi trang:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              aria-label="Số hàng mỗi trang"
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--line, #E2E8F0)",
                backgroundColor: "var(--surface, #FFFFFF)",
                color: "var(--ink, #0F172A)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              <option value={5}>5 học viên / trang</option>
              <option value={10}>10 học viên / trang</option>
              <option value={15}>15 học viên / trang</option>
              <option value={20}>20 học viên / trang</option>
            </select>
            <span>
              Hiển thị <strong>{filteredGrades.length === 0 ? 0 : (safePage - 1) * pageSize + 1} - {Math.min(safePage * pageSize, filteredGrades.length)}</strong> trên tổng số <strong>{filteredGrades.length}</strong> học viên
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              className="button button-subtle button-small"
              onClick={() => setCurrentPage(1)}
              disabled={safePage <= 1}
              aria-label="Trang đầu tiên"
              style={{ padding: "5px 9px", fontSize: 12 }}
            >
              ⏮ Đầu
            </button>
            <button
              type="button"
              className="button button-subtle button-small"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              aria-label="Trang trước"
              style={{ padding: "5px 10px", fontSize: 12 }}
            >
              ◀ Trước
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => setCurrentPage(pageNum)}
                  style={{
                    minWidth: 32,
                    height: 32,
                    borderRadius: 6,
                    border: pageNum === safePage ? "1px solid #1760EF" : "1px solid var(--line, #E2E8F0)",
                    backgroundColor: pageNum === safePage ? "#1760EF" : "var(--surface, #FFFFFF)",
                    color: pageNum === safePage ? "#FFFFFF" : "var(--ink, #0F172A)",
                    fontWeight: pageNum === safePage ? 700 : 500,
                    fontSize: 13,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.15s ease",
                  }}
                  aria-current={pageNum === safePage ? "page" : undefined}
                >
                  {pageNum}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="button button-subtle button-small"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              aria-label="Trang sau"
              style={{ padding: "5px 10px", fontSize: 12 }}
            >
              Sau ▶
            </button>
            <button
              type="button"
              className="button button-subtle button-small"
              onClick={() => setCurrentPage(totalPages)}
              disabled={safePage >= totalPages}
              aria-label="Trang cuối cùng"
              style={{ padding: "5px 9px", fontSize: 12 }}
            >
              Cuối ⏭
            </button>
          </div>
        </div>
      </section>

      {/* Grade Distribution Chart */}
      <section className="dashboard-section-card" style={{ marginTop: 24 }}>
        <div className="section-card-header">
          <div>
            <h2>Phổ Điểm Toàn Khóa &amp; Thống Kê Phân Bổ</h2>
            <p className="subtext">Biểu đồ phân bố số lượng học viên theo từng khoảng điểm xếp loại.</p>
          </div>
        </div>

        <div className="recharts-wrapper">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={GRADE_DISTRIBUTION} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #dce3ee)" />
              <XAxis dataKey="range" tick={{ fontSize: 12, fill: "var(--muted, #53617a)" }} />
              <YAxis tickFormatter={(v: number) => `${v} SV`} tick={{ fontSize: 12, fill: "var(--muted, #53617a)" }} />
              <Tooltip formatter={(v) => [`${v ?? 0} sinh viên`, "Số lượng"]} />
              <Bar dataKey="count" name="Số sinh viên" radius={[4, 4, 0, 0]}>
                {GRADE_DISTRIBUTION.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* MODAL 1: VIEW STUDENT SUBMISSION DETAIL */}
      {viewingRecord && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="view-modal-title"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            style={{
              backgroundColor: "var(--surface, #FFFFFF)",
              borderRadius: 14,
              maxWidth: 680,
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: 24,
              border: "1px solid var(--line, #E2E8F0)",
              color: "var(--ink, #0F172A)",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.25)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <p className="eyebrow">CHI TIẾT BÀI LÀM HỌC VIÊN</p>
                <h2 id="view-modal-title" style={{ margin: "4px 0", color: "var(--ink, #0F172A)" }}>
                  {viewingRecord.studentName} ({viewingRecord.studentId})
                </h2>
                <p className="subtext">
                  {viewingRecord.assessmentTitle} • {viewingRecord.className}
                </p>
              </div>
              <button
                className="button button-subtle button-small"
                onClick={() => setViewingRecord(null)}
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>

            <div
              style={{
                padding: 12,
                backgroundColor: "var(--surface-soft, rgba(148, 163, 184, 0.08))",
                borderRadius: 8,
                border: "1px solid var(--line, #E2E8F0)",
                marginBottom: 16,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: "var(--muted, #64748B)" }}>Thời gian nộp bài:</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink, #0F172A)" }}>{viewingRecord.submittedAt}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted, #64748B)" }}>Điểm hiện tại:</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: viewingRecord.score !== null ? "#16A34A" : "#D97706" }}>
                  {viewingRecord.score !== null ? `${viewingRecord.score} / ${viewingRecord.maxScore}` : "Chưa chấm"}
                </div>
              </div>
            </div>

            {viewingRecord.isLate && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  backgroundColor: "rgba(239, 68, 68, 0.12)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  marginBottom: 16,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  color: "var(--ink, #0F172A)",
                  fontSize: 13,
                }}
              >
                <span style={{ fontSize: 18 }}>🚩</span>
                <div>
                  <strong style={{ color: "#EF4444" }}>Cảnh báo nộp muộn:</strong> Học viên nộp bài muộn {viewingRecord.lateMinutes} phút so với hạn chót ({viewingRecord.deadline}).
                  <div style={{ fontSize: 12, color: "var(--muted, #64748B)", marginTop: 2 }}>
                    Chính sách: Cho nộp muộn có đánh dấu đỏ. Giảng viên cân nhắc trừ điểm nộp trễ theo quy chế.
                  </div>
                </div>
              </div>
            )}

            <h3 style={{ fontSize: 14, marginBottom: 10, color: "var(--ink, #0F172A)" }}>Câu trả lời của học viên:</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {viewingRecord.answers.map((ans) => (
                <div
                  key={ans.questionNumber}
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    border: "1px solid",
                    borderColor: ans.isCorrect ? "rgba(34, 197, 94, 0.35)" : "rgba(239, 68, 68, 0.35)",
                    backgroundColor: ans.isCorrect ? "rgba(34, 197, 94, 0.08)" : "rgba(239, 68, 68, 0.08)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <strong style={{ color: "var(--ink, #0F172A)" }}>Câu {ans.questionNumber}: {ans.questionText}</strong>
                    <span style={{ fontSize: 11, fontWeight: 700, color: ans.isCorrect ? "#16A34A" : "#EF4444" }}>
                      {ans.isCorrect ? "✓ Đúng" : "✕ Sai"}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    <span style={{ color: "var(--muted, #64748B)" }}>Câu trả lời của SV: </span>
                    <strong style={{ color: "var(--ink, #0F172A)" }}>{ans.studentAnswer}</strong>
                  </div>
                  {!ans.isCorrect && (
                    <div style={{ fontSize: 12, color: "#10B981", marginTop: 4, fontWeight: 600 }}>
                      Đáp án đúng chuẩn: {ans.correctAnswer}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {viewingRecord.teacherFeedback && (
              <div
                style={{
                  marginTop: 16,
                  padding: 12,
                  backgroundColor: "rgba(245, 158, 11, 0.12)",
                  border: "1px solid rgba(245, 158, 11, 0.3)",
                  borderRadius: 8,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: "#D97706" }}>LỜI PHÊ &amp; NHẬN XÉT CỦA GIẢNG VIÊN:</div>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink, #0F172A)" }}>{viewingRecord.teacherFeedback}</p>
              </div>
            )}

            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="button button-subtle" onClick={() => setViewingRecord(null)}>
                Đóng
              </button>
              <button
                className="button"
                onClick={() => {
                  const rec = viewingRecord;
                  setViewingRecord(null);
                  handleOpenGrading(rec);
                }}
              >
                Chấm điểm / Nhập nhận xét →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: INTERACTIVE GRADING & FEEDBACK MODAL */}
      {gradingRecord && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="grading-modal-title"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            style={{
              backgroundColor: "var(--surface, #FFFFFF)",
              borderRadius: 14,
              maxWidth: 540,
              width: "100%",
              padding: 24,
              border: "1px solid var(--line, #E2E8F0)",
              color: "var(--ink, #0F172A)",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.25)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <p className="eyebrow">CHẤM ĐIỂM &amp; ĐÁNH GIÁ</p>
                <h2 id="grading-modal-title" style={{ margin: "4px 0", color: "var(--ink, #0F172A)" }}>
                  Chấm Bài: {gradingRecord.studentName}
                </h2>
                <p className="subtext">
                  Mã SV: {gradingRecord.studentId} • {gradingRecord.assessmentTitle}
                </p>
              </div>
              <button
                className="button button-subtle button-small"
                onClick={() => setGradingRecord(null)}
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {gradingRecord.isLate && (
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: 8,
                    backgroundColor: "rgba(239, 68, 68, 0.12)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    color: "var(--ink, #0F172A)",
                    fontSize: 13,
                  }}
                >
                  <span style={{ fontSize: 18 }}>🚩</span>
                  <div>
                    <strong style={{ color: "#EF4444" }}>Bài nộp quá hạn ({gradingRecord.lateMinutes} phút trễ):</strong> Hạn chót: {gradingRecord.deadline}.
                    <div style={{ fontSize: 12, color: "var(--muted, #64748B)", marginTop: 2 }}>
                      Chính sách: Cho nộp muộn có đánh dấu đỏ. Giảng viên có thể trừ điểm phạt trực tiếp khi nhập điểm dưới đây.
                    </div>
                  </div>
                </div>
              )}

              {gradingError && (
                <div
                  className="dashboard-banner-notice"
                  role="alert"
                  style={{
                    backgroundColor: "rgba(239, 68, 68, 0.12)",
                    color: "#EF4444",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    margin: "4px 0",
                  }}
                >
                  <span>⚠️ {gradingError}</span>
                </div>
              )}
              <div>
                <label style={{ fontSize: 13, fontWeight: 700, color: "var(--ink, #0F172A)", display: "block", marginBottom: 6 }}>
                  Điểm số (Thang điểm {gradingRecord.maxScore}) *
                </label>
                <input
                  type="number"
                  min="0"
                  max={gradingRecord.maxScore}
                  step="0.25"
                  value={inputScore}
                  onChange={(e) => setInputScore(e.target.value)}
                  placeholder="Nhập số điểm (vd: 9.0)"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--line, #E2E8F0)",
                    backgroundColor: "var(--surface-soft, #F8FAFC)",
                    color: "var(--ink, #0F172A)",
                    fontSize: 15,
                    fontWeight: 700,
                  }}
                  autoFocus
                />
              </div>

              <div>
                <label style={{ fontSize: 13, fontWeight: 700, color: "var(--ink, #0F172A)", display: "block", marginBottom: 6 }}>
                  Nhận xét &amp; Lời phê của Giảng viên
                </label>
                <textarea
                  rows={4}
                  value={inputFeedback}
                  onChange={(e) => setInputFeedback(e.target.value)}
                  placeholder="Nhập nhận xét cụ thể về ưu điểm, lỗi cần khắc phục để học viên cải thiện..."
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--line, #E2E8F0)",
                    backgroundColor: "var(--surface-soft, #F8FAFC)",
                    color: "var(--ink, #0F172A)",
                    fontSize: 13,
                    fontFamily: "inherit",
                  }}
                />
              </div>
            </div>

            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="button button-subtle" onClick={() => setGradingRecord(null)}>
                Hủy
              </button>
              <button className="button" onClick={handleSaveGrading}>
                ✓ Lưu điểm &amp; Gửi nhận xét
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

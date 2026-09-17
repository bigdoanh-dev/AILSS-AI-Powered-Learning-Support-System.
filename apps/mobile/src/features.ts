import type { IconName } from "./ui";

export interface FeatureItem {
  id: string;
  label: string;
  icon: IconName;
  bgColor: string;
  iconColor: string;
  path: string;
  hasBadge?: boolean;
}

export function getFeaturesForRole(role?: string): FeatureItem[] {
  if (role === "LECTURER") {
    return [
      { id: "teaching", label: "Bàn làm việc", icon: "academic", bgColor: "#E0F2FE", iconColor: "#0284C7", path: "/teaching" },
      { id: "classes", label: "Lớp phụ trách", icon: "class", bgColor: "#CFFAFE", iconColor: "#0891B2", path: "/teaching/classes" },
      { id: "schedule", label: "Lịch dạy", icon: "calendar", bgColor: "#DCFCE7", iconColor: "#15803D", path: "/teaching/schedule" },
      { id: "courses", label: "Khóa giảng dạy", icon: "book", bgColor: "#EDE9FE", iconColor: "#7C3AED", path: "/teaching/courses" },
      { id: "ai", label: "Soạn đề AI", icon: "sparkles", bgColor: "#FEF3C7", iconColor: "#D97706", path: "/teaching/ai" },
      { id: "assessments", label: "Quản lý bài thi", icon: "award", bgColor: "#D1FAE5", iconColor: "#059669", path: "/teaching/assessments", hasBadge: true },
      { id: "notifications", label: "Thông báo", icon: "bell", bgColor: "#FCE7F3", iconColor: "#DB2777", path: "/notifications" },
      { id: "all", label: "Tất cả", icon: "grid", bgColor: "#F1F5F9", iconColor: "#475569", path: "modal:all" },
    ];
  }

  if (role === "ADMIN") {
    return [
      { id: "users", label: "Người dùng", icon: "people", bgColor: "#E0F2FE", iconColor: "#0284C7", path: "/admin/users" },
      { id: "lecturers", label: "Duyệt GV", icon: "academic", bgColor: "#EDE9FE", iconColor: "#7C3AED", path: "/admin/lecturers", hasBadge: true },
      { id: "moderation", label: "Kiểm duyệt", icon: "shield", bgColor: "#FEE2E2", iconColor: "#DC2626", path: "/admin/moderation", hasBadge: true },
      { id: "commerce", label: "Đối soát", icon: "card", bgColor: "#FEF3C7", iconColor: "#D97706", path: "/admin/commerce" },
      { id: "revenue", label: "Doanh thu", icon: "trending", bgColor: "#D1FAE5", iconColor: "#059669", path: "/admin/revenue" },
      { id: "stats", label: "Thống kê", icon: "stats", bgColor: "#CFFAFE", iconColor: "#0891B2", path: "/admin/stats" },
      { id: "logs", label: "Nhật ký Logs", icon: "document", bgColor: "#FCE7F3", iconColor: "#DB2777", path: "/admin/logs" },
      { id: "settings", label: "Cài đặt", icon: "settings", bgColor: "#F1F5F9", iconColor: "#475569", path: "/settings" },
    ];
  }

  // STUDENT or Guest: Gồm Lớp học, Khóa học, Bài tập (chấm đỏ), Bài kiểm tra (chấm đỏ)
  return [
    { id: "classes", label: "Lớp học", icon: "class", bgColor: "#E0F2FE", iconColor: "#0284C7", path: "/classes" },
    { id: "courses", label: "Khóa học", icon: "book", bgColor: "#EDE9FE", iconColor: "#7C3AED", path: "/courses" },
    { id: "assignments", label: "Bài tập", icon: "assignment", bgColor: "#FEE2E2", iconColor: "#DC2626", path: "/classes", hasBadge: true },
    { id: "assessments", label: "Bài kiểm tra", icon: "quiz", bgColor: "#FEF3C7", iconColor: "#D97706", path: "/assessments", hasBadge: true },
    { id: "learn", label: "Khóa của tôi", icon: "academic", bgColor: "#E0E7FF", iconColor: "#4F46E5", path: "/learn" },
    { id: "schedule", label: "Lịch học", icon: "calendar", bgColor: "#CFFAFE", iconColor: "#0891B2", path: "/classes?tab=schedule" },
    { id: "attendance", label: "Điểm danh", icon: "checkCircle", bgColor: "#DCFCE7", iconColor: "#16A34A", path: "/classes?tab=attendance" },
    { id: "all", label: "Tất cả", icon: "grid", bgColor: "#F1F5F9", iconColor: "#475569", path: "modal:all" },
  ];
}

import type { Role } from "./api";
export function destinations(role?: Role): { key: string; label: string; path?: string }[] {
  const common = [
    {
      key: "notifications",
      label: "Thông báo",
      path: `/api/v1/notifications?month=${new Date().toISOString().slice(0, 7)}`,
    },
    { key: "account", label: "Tài khoản" },
  ];
  if (!role)
    return [
      { key: "courses", label: "Khám phá khóa học", path: "/api/v1/courses" },
      { key: "login", label: "Đăng nhập" },
      { key: "register", label: "Đăng ký học viên" },
    ];
  if (role === "STUDENT")
    return [
      { key: "learn", label: "Khóa học của tôi", path: "/api/v1/me/courses" },
      { key: "courses", label: "Khám phá khóa học", path: "/api/v1/courses" },
      { key: "classes", label: "Lớp học", path: "/api/v1/me/classes" },
      { key: "assessments", label: "Bài kiểm tra" },
      ...common,
    ];
  if (role === "LECTURER")
    return [
      { key: "teaching", label: "Giảng dạy", path: "/api/v1/me/owned-offerings" },
      { key: "teaching/classes", label: "Lớp phụ trách", path: "/api/v1/me/owned-classes" },
      ...common,
    ];
  return [{ key: "admin", label: "Tổng quan quản trị" }, ...common];
}

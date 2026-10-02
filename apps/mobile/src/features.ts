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

/** Match protected mobile route groups to the authenticated account role. */
export function phase41RouteAvailable(pathname: string, role?: string): boolean {
  const path = pathname.split("?", 1)[0] ?? pathname;
  if (/^\/admin(?:\/|$)/u.test(path)) return role === "ADMIN";
  if (/^\/teaching(?:\/|$)/u.test(path)) return role === "LECTURER";
  return true;
}

export function getFeaturesForRole(role?: string): FeatureItem[] {
  if (role === "LECTURER" || role === "ADMIN") return [];

  // Student and guest destinations: 8 balanced quick features
  return [
    {
      id: "classes",
      label: "Lớp học",
      icon: "class",
      bgColor: "#E0F2FE",
      iconColor: "#0284C7",
      path: "/classes",
    },
    {
      id: "courses",
      label: "Khóa học",
      icon: "book",
      bgColor: "#EDE9FE",
      iconColor: "#7C3AED",
      path: "/courses",
    },
    {
      id: "assignments",
      label: "Bài tập",
      icon: "assignment",
      bgColor: "#FEE2E2",
      iconColor: "#DC2626",
      path: "/classes?tab=assignments",
    },
    {
      id: "assessments",
      label: "Bài kiểm tra",
      icon: "quiz",
      bgColor: "#FEF3C7",
      iconColor: "#D97706",
      path: "/assessments",
    },
    {
      id: "learn",
      label: "Khóa của tôi",
      icon: "academic",
      bgColor: "#E0E7FF",
      iconColor: "#4F46E5",
      path: "/learn",
    },
    {
      id: "schedule",
      label: "Lịch học",
      icon: "calendar",
      bgColor: "#CFFAFE",
      iconColor: "#0891B2",
      path: "/classes?tab=schedule",
    },
    {
      id: "attendance",
      label: "Điểm danh",
      icon: "checkCircle",
      bgColor: "#DCFCE7",
      iconColor: "#16A34A",
      path: "/classes?tab=attendance",
    },
    { id: "all", label: "Tất cả", icon: "grid", bgColor: "#F1F5F9", iconColor: "#475569", path: "modal:all" },
  ];
}

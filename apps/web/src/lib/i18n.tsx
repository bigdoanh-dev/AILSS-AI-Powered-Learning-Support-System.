import React, { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import {
  LANGUAGE_OPTIONS,
  normalizeLanguage,
  languageLocale,
  translateInterface,
  formatInterface,
  type SupportedLanguage,
  type InterfaceMessage,
} from "../../../../packages/localization/src";
export type { SupportedLanguage } from "../../../../packages/localization/src";
export { interfaceMessage, type InterfaceMessage } from "../../../../packages/localization/src";
export type LanguageOption = (typeof LANGUAGE_OPTIONS)[number];
export const LANGUAGES = LANGUAGE_OPTIONS;
export const LANGUAGE_STORAGE_KEY = "ailss-language";
export const TRANSLATIONS: Record<SupportedLanguage, Record<string, string>> = {
  vi: {
    "nav.courses": "Khóa học",
    "nav.classroom": "Lớp học",
    "nav.learning": "Học tập",
    "nav.teaching": "Giảng dạy",
    "nav.forLecturers": "Dành cho giảng viên",
    "nav.forStudents": "Dành cho học viên",
    "nav.admin": "Quản trị",
    "nav.aiLearning": "Học cùng AI",
    "nav.help": "Trợ giúp",
    "nav.notifications": "Thông báo",
    "nav.account": "Tài khoản",
    "nav.profile": "Hồ sơ",
    "nav.profileAndAvatar": "Hồ sơ và ảnh đại diện",
    "nav.accountOverview": "Tổng quan tài khoản",
    "nav.personalNotifications": "Thông báo cá nhân",
    "nav.exploreCourses": "Khám phá khóa học",
    "nav.login": "Đăng nhập",
    "nav.register": "Đăng ký",
    "nav.getStarted": "Bắt đầu học",
    "nav.logout": "Đăng xuất",
    "nav.loggingOut": "Đang đăng xuất…",
    "nav.home": "Trang chủ",
    "nav.progress": "Tiến độ",
    "nav.reports": "Báo cáo",
    "nav.gradebook": "Sổ điểm",
    "nav.navigation": "Điều hướng",
    "nav.mainNav": "Điều hướng chính",
    "nav.returnTo": "← Trở lại",
    "nav.loggedInAs": "Đăng nhập với tên",
    "nav.needHelp": "Cần hỗ trợ?",
    "tab.overview": "Tổng quan",
    "tab.courses": "Khóa học",
    "tab.classes": "Lớp học",
    "tab.schedule": "Lịch học",
    "tab.teachingSchedule": "Lịch dạy",
    "tab.attendance": "Điểm danh",
    "tab.offerings": "Đợt mở bán",
    "tab.assessments": "Bài kiểm tra",
    "tab.grades": "Bảng điểm",
    "tab.reports": "Báo cáo",
    "tab.aiStudio": "Trợ lý AI",
    "tab.progress": "Tiến độ",
    "tab.revenue": "Doanh thu",
    "tab.stats": "Thống kê",
    "tab.logs": "Nhật ký",
    "tab.users": "Người dùng",
    "tab.lecturers": "Giảng viên",
    "tab.moderation": "Kiểm duyệt",
    "tab.settings": "Cài đặt",
    "header.language": "Ngôn ngữ",
    "header.selectLanguage": "Chọn ngôn ngữ hệ thống",
    "header.darkMode": "Bật chế độ tối",
    "header.lightMode": "Bật chế độ sáng",
    "action.exportCsv": "Xuất báo cáo CSV",
    "action.search": "Tìm kiếm...",
    "action.filter": "Lọc",
    "action.all": "Tất cả",
    "action.retry": "Thử lại",
    "action.refresh": "Làm mới",
    "action.save": "Lưu thay đổi",
    "action.cancel": "Hủy bỏ",
    "action.back": "Quay lại",
    "action.viewAll": "Xem tất cả",
    "action.skipToContent": "Đến nội dung chính",
    "action.openJob": "Mở công việc",
    "action.replayIntro": "🎬 Xem lại giới thiệu",
    "action.scrollLeft": "Cuộn sang trái",
    "action.scrollRight": "Cuộn sang phải",
    "action.buyNow": "Mua ngay",
    "action.startLearning": "Bắt đầu học",
    "action.continueLearning": "Tiếp tục học",
    "action.viewDetails": "Chi tiết",
    "status.liveData": "Dữ liệu thực",
    "status.mockData": "Dữ liệu minh họa",
    "status.inProgress": "Đang học",
    "status.completed": "Đã xong",
    "status.success": "Thành công",
    "status.reconciled": "Đã đối soát",
    "status.pending": "Chờ xử lý",
    "status.owned": "Đã sở hữu",
    "status.free": "Miễn phí",
    "status.loadingSession": "Đang tải phiên…",
    "status.serviceUnavailable": "Dịch vụ hiện không khả dụng. Vui lòng thử lại sau.",
    "footer.explore": "Khám phá",
    "footer.ailss": "AILSS",
    "footer.support": "Hỗ trợ",
    "footer.legal": "Thông tin sử dụng",
    "footer.forStudents": "Dành cho học viên",
    "footer.forLecturers": "Dành cho giảng viên",
    "footer.about": "Về chúng tôi",
    "footer.features": "Tính năng",
    "footer.research": "Nghiên cứu",
    "footer.media": "Thư viện hình ảnh",
    "footer.helpCenter": "Trung tâm trợ giúp",
    "footer.faq": "Câu hỏi thường gặp",
    "footer.contact": "Liên hệ",
    "footer.security": "Bảo mật",
    "footer.privacy": "Quyền riêng tư",
    "footer.terms": "Điều khoản",
    "footer.cookies": "Cookie",
    "footer.accessibility": "Khả năng tiếp cận",
    "footer.motto": "Kết nối tri thức, con người và công nghệ. Học một điều mới, mỗi ngày.",
    "footer.tagline": "AI hỗ trợ. Con người quyết định.",
    "kpi.totalRevenue": "Doanh thu thực tế",
    "kpi.completedOrders": "Đơn hàng hoàn tất",
    "kpi.sepayRate": "Tỷ lệ SePay tự động",
    "kpi.aov": "Giá trị TB / đơn (AOV)",
    "kpi.totalStudents": "Tổng sinh viên phụ trách",
    "kpi.submissionRate": "Tỷ lệ nộp bài đánh giá",
    "kpi.avgScore": "Điểm đánh giá trung bình",
    "kpi.attendanceRate": "Tỷ lệ điểm danh có mặt",
    "kpi.totalProgress": "Tổng tiến độ hoàn thành",
    "kpi.learningHours": "Thời lượng học tích lũy",
    "kpi.completedLessons": "Bài học đã hoàn tất",
    "kpi.bloomMatrix": "Ma Trận 6 Cấp Độ Nhận Thức Bloom",
  },
  en: {
    "nav.courses": "Courses",
    "nav.classroom": "Classroom",
    "nav.learning": "Learning",
    "nav.teaching": "Teaching",
    "nav.forLecturers": "For Lecturers",
    "nav.forStudents": "For Students",
    "nav.admin": "Administration",
    "nav.aiLearning": "AI Learning",
    "nav.help": "Help",
    "nav.notifications": "Notifications",
    "nav.account": "Account",
    "nav.profile": "Profile",
    "nav.profileAndAvatar": "Profile & Avatar",
    "nav.accountOverview": "Account Overview",
    "nav.personalNotifications": "Notifications",
    "nav.exploreCourses": "Explore Courses",
    "nav.login": "Log In",
    "nav.register": "Register",
    "nav.getStarted": "Get Started",
    "nav.logout": "Sign Out",
    "nav.loggingOut": "Signing out…",
    "nav.home": "Home",
    "nav.progress": "Progress",
    "nav.reports": "Reports",
    "nav.gradebook": "Gradebook",
    "nav.navigation": "Navigation",
    "nav.mainNav": "Main Navigation",
    "nav.returnTo": "← Return to",
    "nav.loggedInAs": "Signed in as",
    "nav.needHelp": "Need Help?",
    "tab.overview": "Overview",
    "tab.courses": "Courses",
    "tab.classes": "Classes",
    "tab.schedule": "Schedule",
    "tab.teachingSchedule": "Teaching Schedule",
    "tab.attendance": "Attendance",
    "tab.offerings": "Offerings",
    "tab.assessments": "Assessments",
    "tab.grades": "Gradebook",
    "tab.reports": "Reports",
    "tab.aiStudio": "AI Studio",
    "tab.progress": "Progress",
    "tab.revenue": "Revenue",
    "tab.stats": "Statistics",
    "tab.logs": "Logs",
    "tab.users": "Users",
    "tab.lecturers": "Lecturers",
    "tab.moderation": "Moderation",
    "tab.settings": "Settings",
    "header.language": "Language",
    "header.selectLanguage": "Select System Language",
    "header.darkMode": "Switch to Dark Mode",
    "header.lightMode": "Switch to Light Mode",
    "action.exportCsv": "Export CSV Report",
    "action.search": "Search...",
    "action.filter": "Filter",
    "action.all": "All",
    "action.retry": "Retry",
    "action.refresh": "Refresh",
    "action.save": "Save Changes",
    "action.cancel": "Cancel",
    "action.back": "Back",
    "action.viewAll": "View All",
    "action.skipToContent": "Skip to main content",
    "action.openJob": "Open Job",
    "action.replayIntro": "🎬 Replay Intro",
    "action.scrollLeft": "Scroll Left",
    "action.scrollRight": "Scroll Right",
    "action.buyNow": "Buy Now",
    "action.startLearning": "Start Learning",
    "action.continueLearning": "Continue Learning",
    "action.viewDetails": "Details",
    "status.liveData": "Live Data",
    "status.mockData": "Mock Data",
    "status.inProgress": "In Progress",
    "status.completed": "Completed",
    "status.success": "Success",
    "status.reconciled": "Reconciled",
    "status.pending": "Pending",
    "status.owned": "Owned",
    "status.free": "Free",
    "status.loadingSession": "Loading session…",
    "status.serviceUnavailable": "Service currently unavailable. Please try again later.",
    "footer.explore": "Explore",
    "footer.ailss": "AILSS",
    "footer.support": "Support",
    "footer.legal": "Legal & Terms",
    "footer.forStudents": "For Students",
    "footer.forLecturers": "For Lecturers",
    "footer.about": "About Us",
    "footer.features": "Features",
    "footer.research": "Research",
    "footer.media": "Media Gallery",
    "footer.helpCenter": "Help Center",
    "footer.faq": "FAQ",
    "footer.contact": "Contact",
    "footer.security": "Security",
    "footer.privacy": "Privacy Policy",
    "footer.terms": "Terms of Service",
    "footer.cookies": "Cookie Policy",
    "footer.accessibility": "Accessibility",
    "footer.motto": "Connecting knowledge, people, and technology. Learn something new every day.",
    "footer.tagline": "AI-Assisted. Human-Decided.",
    "kpi.totalRevenue": "Actual Revenue",
    "kpi.completedOrders": "Completed Orders",
    "kpi.sepayRate": "Automated SePay Rate",
    "kpi.aov": "Average Order Value (AOV)",
    "kpi.totalStudents": "Total Students Enrolled",
    "kpi.submissionRate": "Submission Rate",
    "kpi.avgScore": "Average Assessment Score",
    "kpi.attendanceRate": "Attendance Rate",
    "kpi.totalProgress": "Overall Completion Progress",
    "kpi.learningHours": "Total Learning Hours",
    "kpi.completedLessons": "Completed Lessons",
    "kpi.bloomMatrix": "Bloom Cognitive Mastery Matrix",
  },
};

interface LanguageContextType {
  language: SupportedLanguage;
  locale: "vi-VN" | "en-US";
  setLanguage: (language: SupportedLanguage) => void;
  t: (key: string, fallback?: string) => string;
  currentOption: LanguageOption;
  languages: typeof LANGUAGES;
}
export function translation(key: string, language: SupportedLanguage, fallback?: string): string {
  const value = TRANSLATIONS[language][key];
  return typeof value === "string" ? value : translateInterface(fallback ?? key, language);
}
const LanguageContext = createContext<LanguageContextType>({
  language: "vi",
  locale: "vi-VN",
  setLanguage: () => {},
  t: (key, fallback) => translation(key, "vi", fallback),
  currentOption: LANGUAGES[0],
  languages: LANGUAGES,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  // The initial render must match Vietnamese public prerendered HTML. Restore after hydration.
  const [language, setLangState] = useState<SupportedLanguage>("vi");
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      setLangState(normalizeLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY)));
    } catch {
      /* Private browsing may block storage. */
    }
    setRestored(true);
    const sync = (event: StorageEvent) => {
      if (event.key === LANGUAGE_STORAGE_KEY || event.key === null)
        setLangState(normalizeLanguage(event.newValue));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
    if (!restored) return;
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      /* In-memory switching still works. */
    }
  }, [language, restored]);
  const t = useCallback((key: string, fallback?: string) => translation(key, language, fallback), [language]);
  return (
    <LanguageContext.Provider
      value={{
        language,
        locale: languageLocale(language),
        setLanguage: (value) => setLangState(normalizeLanguage(value)),
        t,
        currentOption: LANGUAGES.find((option) => option.code === language) ?? LANGUAGES[0],
        languages: LANGUAGES,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}
export function useLanguage() {
  return useContext(LanguageContext);
}
/** Localize only interface literals authored at the call site, never arbitrary API content. */
export function useUiText() {
  const { language } = useLanguage();
  return useCallback(
    (source: InterfaceMessage, values?: readonly unknown[]) => formatInterface(source, language, values),
    [language],
  );
}

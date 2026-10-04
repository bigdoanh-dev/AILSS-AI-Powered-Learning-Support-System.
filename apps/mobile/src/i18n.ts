import {
  LANGUAGE_OPTIONS,
  normalizeLanguage,
  translateInterface,
  type SupportedLanguage,
} from "../../../packages/localization/src";
export type { SupportedLanguage } from "../../../packages/localization/src";
export type LanguageOption = (typeof LANGUAGE_OPTIONS)[number];
export const LANGUAGES = LANGUAGE_OPTIONS;
export const TRANSLATIONS: Record<SupportedLanguage, Record<string, string>> = {
  vi: {
    "nav.home": "Trang chủ",
    "nav.courses": "Khóa học",
    "nav.classes": "Lớp học",
    "nav.tests": "Luyện thi",
    "nav.ai": "Trợ lý AI",
    "nav.analytics": "Thống kê",
    "nav.account": "Tài khoản",
    "nav.notifications": "Thông báo",
    "header.greeting": "Xin chào,",
    "header.guest": "Khách",
    "header.select_lang": "Chọn ngôn ngữ hệ thống",
    "action.login": "Đăng nhập",
    "action.register": "Đăng ký",
    "action.close": "Đóng",
    "hero.guest_title": "Trợ lý Học tập Thông minh",
    "hero.guest_sub": "Đăng nhập để vào lớp học, làm bài thi thích ứng AI và xem kết quả học tập",
    "hero.login_now": "Đăng nhập ngay",
    "stats.title": "Báo cáo thống kê chi tiết",
    "badge.platform": "NỀN TẢNG AILSS AI",
  },
  en: {
    "nav.home": "Home",
    "nav.courses": "Courses",
    "nav.classes": "Classrooms",
    "nav.tests": "Practice Tests",
    "nav.ai": "AI Assistant",
    "nav.analytics": "Analytics",
    "nav.account": "Account",
    "nav.notifications": "Notifications",
    "header.greeting": "Hello,",
    "header.guest": "Guest Visitor",
    "header.select_lang": "Select System Language",
    "action.login": "Sign In",
    "action.register": "Register",
    "action.close": "Close",
    "hero.guest_title": "Smart Learning Assistant",
    "hero.guest_sub": "Log in to join classes, take AI-adaptive tests, and view progress",
    "hero.login_now": "Sign In Now",
    "stats.title": "Detailed Analytics & Reports",
    "badge.platform": "AILSS AI PLATFORM",
  },
};
export function getTranslation(key: string, language: SupportedLanguage = "vi"): string {
  const normalized = normalizeLanguage(language);
  const value = TRANSLATIONS[normalized][key];
  return typeof value === "string" ? value : translateInterface(key, normalized);
}

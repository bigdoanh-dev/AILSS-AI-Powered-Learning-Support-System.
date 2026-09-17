/**
 * Multi-language support (i18n) for AILSS Mobile.
 * Supported languages: Tiếng Việt (default), English, 日本語, 한국어, 中文.
 */

export type SupportedLanguage = "vi" | "en" | "ja" | "ko" | "zh";

export interface LanguageOption {
  code: SupportedLanguage;
  name: string;
  nativeName: string;
  flag: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: "vi", name: "Tiếng Việt", nativeName: "Tiếng Việt", flag: "🇻🇳" },
  { code: "en", name: "English", nativeName: "English", flag: "🇬🇧" },
  { code: "ja", name: "Japanese", nativeName: "日本語", flag: "🇯🇵" },
  { code: "ko", name: "Korean", nativeName: "한국어", flag: "🇰🇷" },
  { code: "zh", name: "Chinese", nativeName: "中文", flag: "🇨🇳" },
];

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
  ja: {
    "nav.home": "ホーム",
    "nav.courses": "コース一覧",
    "nav.classes": "クラス",
    "nav.tests": "AI模試",
    "nav.ai": "AIアシスタント",
    "nav.analytics": "学習統計",
    "nav.account": "アカウント",
    "nav.notifications": "通知",
    "header.greeting": "こんにちは、",
    "header.guest": "ゲスト",
    "header.select_lang": "システム言語の選択",
    "action.login": "ログイン",
    "action.register": "新規登録",
    "action.close": "閉じる",
    "hero.guest_title": "AIスマート学習アシスタント",
    "hero.guest_sub": "ログインしてクラスに参加し、AI適応型テストを受けましょう",
    "hero.login_now": "今すぐログイン",
    "stats.title": "詳細レポートと統計",
    "badge.platform": "AILSS AI プラットフォーム",
  },
  ko: {
    "nav.home": "홈",
    "nav.courses": "강좌 목록",
    "nav.classes": "클래스",
    "nav.tests": "AI 모의고사",
    "nav.ai": "AI 튜터",
    "nav.analytics": "학습 통계",
    "nav.account": "내 계정",
    "nav.notifications": "알림",
    "header.greeting": "안녕하세요,",
    "header.guest": "게스트",
    "header.select_lang": "시스템 언어 선택",
    "action.login": "로그인",
    "action.register": "회원가입",
    "action.close": "닫기",
    "hero.guest_title": "스마트 AI 학습 어시스턴트",
    "hero.guest_sub": "로그인하여 수업에 참여하고 AI 적응형 시험을 시작하세요",
    "hero.login_now": "지금 로그인",
    "stats.title": "상세 분석 및 통계 보고서",
    "badge.platform": "AILSS AI 플랫폼",
  },
  zh: {
    "nav.home": "首页",
    "nav.courses": "课程中心",
    "nav.classes": "我的班级",
    "nav.tests": "AI 自适应模考",
    "nav.ai": "AI 助教",
    "nav.analytics": "统计分析",
    "nav.account": "个人中心",
    "nav.notifications": "通知中心",
    "header.greeting": "你好，",
    "header.guest": "访客",
    "header.select_lang": "选择系统语言",
    "action.login": "登录",
    "action.register": "注册",
    "action.close": "关闭",
    "hero.guest_title": "智能学习助手",
    "hero.guest_sub": "登录以加入班级、进行 AI 自适应测试并查看学习进度",
    "hero.login_now": "立即登录",
    "stats.title": "详细统计与分析报告",
    "badge.platform": "AILSS AI 智能平台",
  },
};

export function getTranslation(key: string, lang: SupportedLanguage = "vi"): string {
  return TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS.vi[key] ?? key;
}

import { useSyncExternalStore, useState, useEffect } from "react";
import {
  Text,
  View,
  StyleSheet,
  ScrollView,
  Modal,
  StatusBar,
  Image,
  useWindowDimensions,
} from "react-native";
import { Redirect, router, type Href } from "expo-router";
import { runtime } from "../src/runtime";
import {
  studentSchedule,
  nextUpcomingSession,
  formatTimeRange,
  parseTimestamp,
  getDateRangeForSchedule,
  type StudentScheduleEntry,
  studentClasses,
  type StudentClass,
} from "../src/classroom";
import { ownedOfferings, uniqueCoursesFromOfferings } from "../src/teaching";
import { courses as decodeCourses, type Course } from "../src/learning";
import { Button, Badge, Icon, tokens, styles, BottomNavBar, type IconName } from "../src/ui";
import { CinematicIntro } from "../src/CinematicIntro";
import { FadeSlideIn, ScalePressable, StaggerPop, PulseBadge, FloatingElement } from "../src/motion";
import { TutorAvatar } from "../src/TutorAvatar";

import { getFeaturesForRole, type FeatureItem } from "../src/features";
export { getFeaturesForRole, type FeatureItem };
import { getSystemSettings, updateSystemSettings, subscribeSystemSettings } from "../src/settings";
import { LANGUAGES, getTranslation } from "../src/i18n";

interface HomeAssignment {
  id: string;
  title: string;
  className: string;
  dueDate: string;
  status: "PENDING" | "SUBMITTED";
}

interface HomeAssessment {
  id: string;
  title: string;
  className: string;
  questionsCount: number;
  durationMinutes: number;
  status: "PENDING" | "COMPLETED";
  score?: number;
}

// The sections stay empty until they can display authoritative assignments/results.
const DEFAULT_ASSIGNMENTS: HomeAssignment[] = [];
const DEFAULT_ASSESSMENTS: HomeAssessment[] = [];

export default function Home() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.3;
  const [upcomingSession, setUpcomingSession] = useState<StudentScheduleEntry | null>(null);
  const [lecturerInfo, setLecturerInfo] = useState<{ courses: number; offerings: number } | null>(null);
  const [featuredCourses, setFeaturedCourses] = useState<Course[]>([]);
  const [enrolledList, setEnrolledList] = useState<Course[]>([]);
  const [classList, setClassList] = useState<StudentClass[]>([]);
  const [showAllModal, setShowAllModal] = useState(false);
  const [showLangModal, setShowLangModal] = useState(false);
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(null);

  const settings = useSyncExternalStore(subscribeSystemSettings, getSystemSettings);
  const currentLang = LANGUAGES.find((l) => l.code === settings.language) ?? LANGUAGES[0];
  const t = (key: string) => getTranslation(key, settings.language);

  useEffect(() => {
    let active = true;
    if (snapshot.state === "AUTHENTICATED") {
      setUserAvatarUrl(null);
      void session
        .request("/api/v1/me/avatar")
        .then((res) => {
          if (active && res && typeof res === "object" && "dataUrl" in res) {
            setUserAvatarUrl((res as { dataUrl: string | null }).dataUrl);
          }
        })
        .catch(() => {
          if (active) setUserAvatarUrl(null);
        });
    } else {
      setUserAvatarUrl(null);
    }
    return () => {
      active = false;
    };
  }, [snapshot.state, snapshot.user?.userId, session]);

  useEffect(() => {
    let active = true;
    async function loadUpcoming() {
      if (snapshot.state === "AUTHENTICATED" && snapshot.user?.role === "STUDENT") {
        if (active) setUpcomingSession(null);
        try {
          const range = getDateRangeForSchedule(new Date(), 7);
          const data = await session.request(`/api/v1/me/schedule?from=${range.from}&to=${range.to}`);
          const scheduleList = studentSchedule(data);
          const next = nextUpcomingSession(scheduleList);
          if (active) setUpcomingSession(next ?? null);
        } catch {
          if (active) setUpcomingSession(null);
        }
      } else {
        if (active) setUpcomingSession(null);
      }
    }
    void loadUpcoming();
    return () => {
      active = false;
    };
  }, [snapshot.state, snapshot.user?.role, snapshot.user?.userId, session]);

  useEffect(() => {
    let active = true;
    async function loadLecturer() {
      if (snapshot.state === "AUTHENTICATED" && snapshot.user?.role === "LECTURER") {
        try {
          const data = await session.request("/api/v1/me/owned-offerings");
          const items = ownedOfferings(data);
          const courses = uniqueCoursesFromOfferings(items);
          if (active) setLecturerInfo({ courses: courses.length, offerings: items.length });
        } catch {
          // Non-fatal enhancement
        }
      } else {
        if (active) setLecturerInfo(null);
      }
    }
    void loadLecturer();
    return () => {
      active = false;
    };
  }, [snapshot.state, snapshot.user?.role, session]);

  useEffect(() => {
    let active = true;
    async function loadCourses() {
      try {
        const path = "/api/v1/courses?categoryId=10000000-0000-4000-8000-000000000001&limit=4";
        const data =
          snapshot.state === "AUTHENTICATED" ? await session.request(path) : await session.api.request(path);
        if (active) {
          setFeaturedCourses(decodeCourses(data));
        }
      } catch {
        // Non-fatal enhancement
      }
    }
    void loadCourses();
    return () => {
      active = false;
    };
  }, [snapshot.state, session]);

  useEffect(() => {
    let active = true;
    async function loadEnrolled() {
      if (snapshot.state === "AUTHENTICATED" && snapshot.user?.role === "STUDENT") {
        if (active) setEnrolledList([]);
        try {
          const data = await session.request("/api/v1/me/courses");
          if (active) {
            setEnrolledList(decodeCourses(data));
          }
        } catch {
          if (active) setEnrolledList([]);
        }
      } else {
        if (active) setEnrolledList([]);
      }
    }
    void loadEnrolled();
    return () => {
      active = false;
    };
  }, [snapshot.state, snapshot.user?.role, snapshot.user?.userId, session]);

  useEffect(() => {
    let active = true;
    async function loadClasses() {
      if (snapshot.state === "AUTHENTICATED" && snapshot.user?.role === "STUDENT") {
        if (active) setClassList([]);
        try {
          const data = await session.request("/api/v1/me/classes");
          if (active) {
            setClassList(studentClasses(data));
          }
        } catch {
          if (active) setClassList([]);
        }
      } else {
        if (active) setClassList([]);
      }
    }
    void loadClasses();
    return () => {
      active = false;
    };
  }, [snapshot.state, snapshot.user?.role, snapshot.user?.userId, session]);

  const activeCourse = enrolledList[0];
  const displayName = snapshot.user?.displayName || "HỌC VIÊN AILSS";
  const features = getFeaturesForRole(snapshot.user?.role);

  const handleFeaturePress = (feature: FeatureItem) => {
    if (feature.path === "modal:all") {
      setShowAllModal(true);
      return;
    }
    if (
      snapshot.state !== "AUTHENTICATED" &&
      (feature.id === "learn" ||
        feature.id === "grades" ||
        feature.id === "ai_quiz" ||
        feature.id === "schedule")
    ) {
      router.push("/login" as Href);
      return;
    }
    router.push(feature.path as Href);
  };

  // The offline workspace presents cached learning data with its sync status.
  if (snapshot.state === "OFFLINE_CACHE" && snapshot.user?.role === "STUDENT") {
    return <Redirect href="/student" />;
  }
  if (snapshot.state === "AUTHENTICATED" && snapshot.user?.role === "LECTURER") {
    return <Redirect href="/teaching" />;
  }
  if (snapshot.state === "AUTHENTICATED" && snapshot.user?.role === "ADMIN") {
    return <Redirect href="/admin" />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#F8FAFC" }}>
      <StatusBar barStyle="light-content" backgroundColor="#062E3F" />

      {/* Cinematic Intro Video Overlay */}
      <CinematicIntro />

      <ScrollView
        testID="student-home"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 116 }}
      >
        {/* Top Deep Navy/Teal Banner */}
        <FadeSlideIn delay={0} duration={400} fromY={-12}>
          <View style={hStyles.topBanner}>
            <View style={[hStyles.headerRow, largeText && hStyles.headerRowLarge]}>
              {/* Left: User Avatar & Greeting with spring touch */}
              <ScalePressable
                testID={
                  snapshot.state === "AUTHENTICATED" && snapshot.user?.role === "STUDENT"
                    ? "student-home-authenticated-profile"
                    : undefined
                }
                style={[hStyles.userProfile, largeText && hStyles.userProfileLarge]}
                scaleTo={0.93}
                onPress={() =>
                  router.push(snapshot.state === "AUTHENTICATED" ? ("/account" as Href) : ("/login" as Href))
                }
                accessibilityRole="button"
                accessibilityLabel="Hồ sơ tài khoản"
              >
                <View style={hStyles.avatarCircle}>
                  {userAvatarUrl ? (
                    <Image source={{ uri: userAvatarUrl }} style={hStyles.avatarImg} />
                  ) : (
                    <Icon name="user" size={20} color="#FFFFFF" />
                  )}
                </View>
                <View style={hStyles.greetingTextWrap}>
                  <Text style={hStyles.greetingSub}>{t("header.greeting")}</Text>
                  <Text style={hStyles.greetingName} numberOfLines={1} ellipsizeMode="tail">
                    {snapshot.state === "AUTHENTICATED"
                      ? displayName.toUpperCase()
                      : t("header.guest").toUpperCase()}
                  </Text>
                </View>
              </ScalePressable>

              {/* Right Side: Language Switcher and Bell Notification */}
              <View style={[hStyles.headerActions, largeText && hStyles.headerActionsLarge]}>
                <ScalePressable
                  style={hStyles.langButton}
                  scaleTo={0.92}
                  onPress={() => setShowLangModal(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t("header.select_lang")}
                >
                  <Text style={hStyles.langFlag}>{currentLang.flag}</Text>
                  <Text style={hStyles.langText}>{currentLang.code.toUpperCase()}</Text>
                </ScalePressable>

                {snapshot.state === "AUTHENTICATED" && (
                  <ScalePressable
                    style={hStyles.bellButton}
                    scaleTo={0.88}
                    onPress={() => router.push("/notifications" as Href)}
                    accessibilityRole="button"
                    accessibilityLabel={t("nav.notifications")}
                  >
                    <Icon name="bell" size={18} color="#FFFFFF" />
                    <PulseBadge style={hStyles.bellDotWrapper}>
                      <View style={hStyles.bellDot} />
                    </PulseBadge>
                  </ScalePressable>
                )}
              </View>
            </View>
          </View>
        </FadeSlideIn>

        {/* Overlapping Hero Card: Current/Upcoming Session OR Active Course OR Guest Welcome with tactile spring touch & float */}
        <FadeSlideIn delay={70} duration={450} fromY={18}>
          {snapshot.state !== "AUTHENTICATED" ? (
            <View style={hStyles.guestHeroCard}>
              <View style={hStyles.guestHeroHeader}>
                <FloatingElement distance={3} duration={1600}>
                  <View style={hStyles.guestHeroIconWrap}>
                    <Icon name="sparkles" size={24} color="#0284C7" />
                  </View>
                </FloatingElement>
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Badge label={t("badge.platform")} variant="ai" icon="sparkles" />
                  </View>
                  <Text style={hStyles.guestHeroTitle}>{t("hero.guest_title")}</Text>
                  <Text style={hStyles.guestHeroSub}>{t("hero.guest_sub")}</Text>
                </View>
              </View>
              <View style={hStyles.guestHeroActions}>
                <ScalePressable
                  testID="student-login-entry"
                  style={hStyles.guestBtnPrimary}
                  scaleTo={0.95}
                  onPress={() => router.push("/login" as Href)}
                  accessibilityRole="button"
                  accessibilityLabel={t("action.login")}
                >
                  <Icon name="user" size={15} color="#FFFFFF" />
                  <Text style={hStyles.guestBtnPrimaryText}>{t("hero.login_now")}</Text>
                </ScalePressable>
                <ScalePressable
                  style={hStyles.guestBtnSecondary}
                  scaleTo={0.95}
                  onPress={() => router.push("/register" as Href)}
                  accessibilityRole="button"
                  accessibilityLabel="Tạo tài khoản mới"
                >
                  <Text style={hStyles.guestBtnSecondaryText}>Tạo tài khoản mới</Text>
                </ScalePressable>
              </View>
            </View>
          ) : upcomingSession ? (
            <ScalePressable
              style={hStyles.heroClassCard}
              scaleTo={0.96}
              onPress={() =>
                router.push(
                  `/classes/${upcomingSession.classId}/sessions/${upcomingSession.sessionId}` as Href,
                )
              }
              accessibilityRole="button"
              accessibilityLabel="Chi tiết buổi học sắp diễn ra"
            >
              <FloatingElement distance={3} duration={1600}>
                <View style={hStyles.heroIconBox}>
                  <Icon name="calendar" size={26} color="#0284C7" />
                </View>
              </FloatingElement>

              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Badge
                    label={upcomingSession.mode === "ONLINE" ? "LIVE CLASS" : "TRỰC TIẾP"}
                    variant={upcomingSession.mode === "ONLINE" ? "success" : "neutral"}
                  />
                  <Text style={{ fontSize: 11, fontWeight: "700", color: "#0284C7" }}>SẮP TỚI</Text>
                </View>
                <Text style={hStyles.heroSubjectTitle} numberOfLines={1}>
                  {upcomingSession.title}
                </Text>
                <Text style={hStyles.heroTimeText} numberOfLines={1}>
                  {formatTimeRange(
                    parseTimestamp(upcomingSession.startAt),
                    parseTimestamp(upcomingSession.endAt),
                    upcomingSession.timezone,
                  )}{" "}
                  • {upcomingSession.className}
                </Text>
                <Text style={hStyles.heroRoomText} numberOfLines={1}>
                  {upcomingSession.mode === "ONLINE" ? "Trực tuyến • Live Classroom" : "Phòng học trực tiếp"}
                </Text>
              </View>

              <View style={hStyles.heroChevronCircle}>
                <Text style={hStyles.heroChevron}>›</Text>
              </View>
            </ScalePressable>
          ) : activeCourse ? (
            <ScalePressable
              style={hStyles.heroClassCard}
              scaleTo={0.96}
              onPress={() => router.push(`/learn/${activeCourse.courseId}` as Href)}
              accessibilityRole="button"
              accessibilityLabel="Tiếp tục bài học gần nhất"
            >
              <FloatingElement distance={3} duration={1600}>
                <View style={[hStyles.heroIconBox, { backgroundColor: "#EDE9FE" }]}>
                  <Icon name="play" size={24} color="#7C3AED" />
                </View>
              </FloatingElement>

              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Badge label="TIẾP TỤC HỌC" variant="ai" icon="sparkles" />
                </View>
                <Text style={hStyles.heroSubjectTitle} numberOfLines={1}>
                  {activeCourse.title}
                </Text>
                <Text style={hStyles.heroTimeText} numberOfLines={1}>
                  Bài học tiếp theo đã sẵn sàng • Bấm để vào học
                </Text>
              </View>

              <View style={hStyles.heroChevronCircle}>
                <Text style={hStyles.heroChevron}>›</Text>
              </View>
            </ScalePressable>
          ) : snapshot.user?.role === "ADMIN" ? (
            <ScalePressable
              style={hStyles.heroClassCard}
              scaleTo={0.96}
              onPress={() => router.push("/admin" as Href)}
              accessibilityRole="button"
              accessibilityLabel="Mở Trung tâm Quản trị AILSS"
            >
              <FloatingElement distance={3} duration={1600}>
                <View style={[hStyles.heroIconBox, { backgroundColor: "#FEE2E2" }]}>
                  <Icon name="shield" size={26} color="#DC2626" />
                </View>
              </FloatingElement>

              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Badge label="QUẢN TRỊ VIÊN HỆ THỐNG" variant="danger" icon="shield" />
                  <Text style={{ fontSize: 11, fontWeight: "700", color: "#DC2626" }}>ADMIN DASHBOARD</Text>
                </View>
                <Text style={hStyles.heroSubjectTitle} numberOfLines={2}>
                  Trung tâm Điều hành & Quản trị
                </Text>
                <Text style={hStyles.heroTimeText} numberOfLines={2}>
                  Duyệt giảng viên, kiểm duyệt báo cáo, đối soát tự động & doanh thu
                </Text>
                <Text style={[hStyles.heroRoomText, { color: "#DC2626", fontWeight: "700" }]}>
                  Mở Bảng điều khiển Quản trị →
                </Text>
              </View>

              <View style={hStyles.heroChevronCircle}>
                <Text style={hStyles.heroChevron}>›</Text>
              </View>
            </ScalePressable>
          ) : snapshot.user?.role === "LECTURER" ? (
            <ScalePressable
              style={hStyles.heroClassCard}
              scaleTo={0.96}
              onPress={() => router.push("/teaching" as Href)}
              accessibilityRole="button"
              accessibilityLabel="Mở Bàn làm việc Giảng dạy"
            >
              <FloatingElement distance={3} duration={1600}>
                <View style={[hStyles.heroIconBox, { backgroundColor: "#EDE9FE" }]}>
                  <Icon name="academic" size={26} color="#7C3AED" />
                </View>
              </FloatingElement>

              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Badge label="GIẢNG VIÊN AILSS" variant="ai" icon="academic" />
                </View>
                <Text style={hStyles.heroSubjectTitle} numberOfLines={2}>
                  Bàn làm việc Giảng dạy & Soạn đề
                </Text>
                <Text style={hStyles.heroTimeText} numberOfLines={2}>
                  Quản lý lớp phụ trách, khóa học và soạn bài thi thích ứng AI
                </Text>
                <Text style={[hStyles.heroRoomText, { color: "#7C3AED", fontWeight: "700" }]}>
                  Vào không gian Giảng dạy →
                </Text>
              </View>

              <View style={hStyles.heroChevronCircle}>
                <Text style={hStyles.heroChevron}>›</Text>
              </View>
            </ScalePressable>
          ) : (
            <ScalePressable
              style={hStyles.heroClassCard}
              scaleTo={0.96}
              onPress={() => router.push("/courses" as Href)}
              accessibilityRole="button"
              accessibilityLabel="Khám phá khóa học AILSS"
            >
              <FloatingElement distance={3} duration={1600}>
                <View style={[hStyles.heroIconBox, { backgroundColor: "#E0F2FE" }]}>
                  <Icon name="sparkles" size={26} color="#0284C7" />
                </View>
              </FloatingElement>

              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Badge label="AILSS EDTECH AI" variant="primary" icon="academic" />
                </View>
                <Text style={hStyles.heroSubjectTitle} numberOfLines={1}>
                  Học tập thông minh cùng Trợ lý AI
                </Text>
                <Text style={hStyles.heroTimeText} numberOfLines={1}>
                  Bài giảng video, luyện đề trắc nghiệm AI &amp; phản hồi trực tiếp
                </Text>
                <Text style={hStyles.heroRoomText} numberOfLines={1}>
                  Khám phá thư viện khóa học ngay →
                </Text>
              </View>

              <View style={hStyles.heroChevronCircle}>
                <Text style={hStyles.heroChevron}>›</Text>
              </View>
            </ScalePressable>
          )}
        </FadeSlideIn>

        {/* Role-tailored Academic / Business Indicators Strip */}
        {snapshot.state === "AUTHENTICATED" && (
          <FadeSlideIn delay={110} duration={450}>
            {snapshot.user?.role === "LECTURER" ? (
              <ScalePressable
                scaleTo={0.98}
                onPress={() => router.push("/teaching" as Href)}
                accessibilityRole="button"
                accessibilityLabel="Mở Bàn làm việc Giảng dạy"
              >
                <View style={hStyles.academicMetricsStrip}>
                  <View style={hStyles.academicMetricItem}>
                    <View style={[hStyles.academicMetricIconWrap, { backgroundColor: "#CFFAFE" }]}>
                      <Icon name="class" size={16} color="#0891B2" />
                    </View>
                    <View>
                      <Text style={hStyles.academicMetricValue}>{lecturerInfo?.offerings ?? "—"}</Text>
                      <Text style={hStyles.academicMetricLabel}>Phụ trách</Text>
                    </View>
                  </View>

                  <View style={hStyles.academicMetricDivider} />

                  <View style={hStyles.academicMetricItem}>
                    <View style={[hStyles.academicMetricIconWrap, { backgroundColor: "#EDE9FE" }]}>
                      <Icon name="people" size={16} color="#7C3AED" />
                    </View>
                    <View>
                      <Text style={hStyles.academicMetricValue}>—</Text>
                      <Text style={hStyles.academicMetricLabel}>Học viên</Text>
                    </View>
                  </View>

                  <View style={hStyles.academicMetricDivider} />

                  <View style={hStyles.academicMetricItem}>
                    <View style={[hStyles.academicMetricIconWrap, { backgroundColor: "#FEE2E2" }]}>
                      <Icon name="award" size={16} color="#DC2626" />
                    </View>
                    <View>
                      <Text style={[hStyles.academicMetricValue, { color: "#DC2626" }]}>—</Text>
                      <Text style={hStyles.academicMetricLabel}>Chờ chấm 🔥</Text>
                    </View>
                  </View>
                </View>
              </ScalePressable>
            ) : snapshot.user?.role === "ADMIN" ? (
              <ScalePressable
                scaleTo={0.98}
                onPress={() => router.push("/admin" as Href)}
                accessibilityRole="button"
                accessibilityLabel="Mở Trung tâm Quản trị Admin"
              >
                <View style={hStyles.academicMetricsStrip}>
                  <View style={hStyles.academicMetricItem}>
                    <View style={[hStyles.academicMetricIconWrap, { backgroundColor: "#DCFCE7" }]}>
                      <Icon name="trending" size={16} color="#15803D" />
                    </View>
                    <View>
                      <Text style={[hStyles.academicMetricValue, { color: tokens.color.muted }]}>—</Text>
                      <Text style={hStyles.academicMetricLabel}>Doanh thu</Text>
                    </View>
                  </View>

                  <View style={hStyles.academicMetricDivider} />

                  <View style={hStyles.academicMetricItem}>
                    <View style={[hStyles.academicMetricIconWrap, { backgroundColor: "#E0F2FE" }]}>
                      <Icon name="people" size={16} color="#0284C7" />
                    </View>
                    <View>
                      <Text style={hStyles.academicMetricValue}>—</Text>
                      <Text style={hStyles.academicMetricLabel}>Học viên</Text>
                    </View>
                  </View>

                  <View style={hStyles.academicMetricDivider} />

                  <View style={hStyles.academicMetricItem}>
                    <View style={[hStyles.academicMetricIconWrap, { backgroundColor: "#FEE2E2" }]}>
                      <Icon name="shield" size={16} color="#DC2626" />
                    </View>
                    <View>
                      <Text style={[hStyles.academicMetricValue, { color: "#DC2626" }]}>—</Text>
                      <Text style={hStyles.academicMetricLabel}>Chờ duyệt 🔥</Text>
                    </View>
                  </View>
                </View>
              </ScalePressable>
            ) : (
              <ScalePressable
                testID="student-home-mastery-navigation"
                scaleTo={0.98}
                onPress={() => router.push("/progress" as Href)}
                accessibilityRole="button"
                accessibilityLabel="Mở Báo cáo tiến độ và năng lực học tập"
              >
                <View style={hStyles.academicMetricsStrip}>
                  <View style={hStyles.academicMetricItem}>
                    <View style={[hStyles.academicMetricIconWrap, { backgroundColor: "#FEF3C7" }]}>
                      <Icon name="award" size={16} color="#D97706" />
                    </View>
                    <View>
                      <Text style={hStyles.academicMetricValue}>—</Text>
                      <Text style={hStyles.academicMetricLabel}>Năng lực</Text>
                    </View>
                  </View>

                  <View style={hStyles.academicMetricDivider} />

                  <View style={hStyles.academicMetricItem}>
                    <View style={[hStyles.academicMetricIconWrap, { backgroundColor: "#FEE2E2" }]}>
                      <Icon name="sparkles" size={16} color="#DC2626" />
                    </View>
                    <View>
                      <Text style={hStyles.academicMetricValue}>—</Text>
                      <Text style={hStyles.academicMetricLabel}>Hoạt động học</Text>
                    </View>
                  </View>

                  <View style={hStyles.academicMetricDivider} />

                  <View style={hStyles.academicMetricItem}>
                    <View style={[hStyles.academicMetricIconWrap, { backgroundColor: "#E0F2FE" }]}>
                      <Icon name="calendar" size={16} color="#0284C7" />
                    </View>
                    <View>
                      <Text style={[hStyles.academicMetricValue, { color: "#DC2626" }]}>—</Text>
                      <Text style={hStyles.academicMetricLabel}>Hạn hôm nay</Text>
                    </View>
                  </View>
                </View>
              </ScalePressable>
            )}
          </FadeSlideIn>
        )}

        {/* Section: Chức năng AILSS — chỉ hiển thị khi đã đăng nhập */}
        {snapshot.state === "AUTHENTICATED" && (
          <FadeSlideIn delay={140} duration={450}>
            <View style={hStyles.sectionContainer}>
              <View style={hStyles.sectionHeader}>
                <Text style={hStyles.sectionTitle}>Chức năng</Text>
                <ScalePressable scaleTo={0.9} onPress={() => setShowAllModal(true)}>
                  <Text style={hStyles.sectionLink}>Tuỳ chỉnh</Text>
                </ScalePressable>
              </View>

              <View style={hStyles.featuresGrid}>
                {features.map((item, index) => (
                  <StaggerPop
                    key={item.id}
                    index={index}
                    baseDelay={160}
                    staggerStep={35}
                    style={hStyles.featureItem}
                  >
                    <ScalePressable
                      scaleTo={0.88}
                      style={{ alignItems: "center", gap: 6 }}
                      onPress={() => handleFeaturePress(item)}
                      accessibilityRole="button"
                      accessibilityLabel={item.label}
                    >
                      <View style={[hStyles.featureIconWrap, { backgroundColor: item.bgColor }]}>
                        <Icon name={item.icon} size={22} color={item.iconColor} />
                        {item.hasBadge && <View style={hStyles.featureBadgeDot} />}
                      </View>
                      <Text style={hStyles.featureLabel} numberOfLines={2}>
                        {item.label}
                      </Text>
                    </ScalePressable>
                  </StaggerPop>
                ))}
              </View>
            </View>
          </FadeSlideIn>
        )}

        {/* Role-Specific Work Sections */}
        {snapshot.state === "AUTHENTICATED" &&
          (snapshot.user?.role === "LECTURER" ? (
            <>
              {/* LECTURER SECTION 1: Lớp giảng dạy phụ trách */}
              <FadeSlideIn delay={160} duration={450}>
                <View style={hStyles.sectionContainer}>
                  <View style={hStyles.sectionHeader}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={hStyles.sectionTitle}>Lớp giảng dạy phụ trách</Text>
                      <Badge label="3 LỚP ĐANG DẠY" variant="primary" />
                    </View>
                    <ScalePressable scaleTo={0.92} onPress={() => router.push("/teaching/classes" as Href)}>
                      <Text style={hStyles.sectionLink}>Tất cả lớp &gt;</Text>
                    </ScalePressable>
                  </View>

                  <View style={{ gap: 10 }}>
                    <ScalePressable
                      style={hStyles.compactCard}
                      scaleTo={0.97}
                      onPress={() =>
                        router.push("/teaching/classes/10000000-0000-4000-8000-000000000001" as Href)
                      }
                    >
                      <View style={hStyles.cardBadgeRow}>
                        <Badge label="LỚP TRỰC TIẾP (P.302)" variant="neutral" />
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <View
                            style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#10B981" }}
                          />
                          <Text style={{ fontSize: 11, fontWeight: "700", color: "#10B981" }}>Đang dạy</Text>
                        </View>
                      </View>
                      <Text style={hStyles.compactCardTitle} numberOfLines={1}>
                        Cơ sở dữ liệu Nâng cao & Tối ưu hóa - Nhóm 01
                      </Text>
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginTop: 4,
                          gap: 8,
                        }}
                      >
                        <Text style={[styles.small, { flex: 1 }]} numberOfLines={1}>
                          👥 62 Học viên · 12/15 buổi · 96.4%
                        </Text>
                        <View style={hStyles.actionMiniBtn}>
                          <Text style={hStyles.actionMiniBtnText}>Vào lớp</Text>
                          <Icon name="chevronRight" size={12} color="#FFFFFF" />
                        </View>
                      </View>
                    </ScalePressable>

                    <ScalePressable
                      style={hStyles.compactCard}
                      scaleTo={0.97}
                      onPress={() =>
                        router.push("/teaching/classes/10000000-0000-4000-8000-000000000002" as Href)
                      }
                    >
                      <View style={hStyles.cardBadgeRow}>
                        <Badge label="LIVE CLASSROOM" variant="ai" />
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <View
                            style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#10B981" }}
                          />
                          <Text style={{ fontSize: 11, fontWeight: "700", color: "#10B981" }}>Đang dạy</Text>
                        </View>
                      </View>
                      <Text style={hStyles.compactCardTitle} numberOfLines={1}>
                        Lập trình Web & Trợ lý AI Fullstack - Nhóm 02
                      </Text>
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginTop: 4,
                          gap: 8,
                        }}
                      >
                        <Text style={[styles.small, { flex: 1 }]} numberOfLines={1}>
                          👥 58 Học viên · 10/16 buổi · 97.2%
                        </Text>
                        <View style={hStyles.actionMiniBtn}>
                          <Text style={hStyles.actionMiniBtnText}>Vào lớp</Text>
                          <Icon name="chevronRight" size={12} color="#FFFFFF" />
                        </View>
                      </View>
                    </ScalePressable>
                  </View>
                </View>
              </FadeSlideIn>

              {/* LECTURER SECTION 2: Hàng đợi bài tập cần chấm */}
              <FadeSlideIn delay={180} duration={450}>
                <View style={hStyles.sectionContainer}>
                  <View style={hStyles.sectionHeader}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={hStyles.sectionTitle}>Bài tập sinh viên cần chấm</Text>
                      <View style={hStyles.pendingHeaderDot}>
                        <Text style={hStyles.pendingHeaderDotText}>14</Text>
                      </View>
                    </View>
                    <ScalePressable
                      scaleTo={0.92}
                      onPress={() => router.push("/teaching/assessments" as Href)}
                    >
                      <Text style={hStyles.sectionLink}>Chấm tất cả &gt;</Text>
                    </ScalePressable>
                  </View>

                  <View style={{ gap: 10 }}>
                    <ScalePressable
                      style={hStyles.compactCard}
                      scaleTo={0.97}
                      onPress={() => router.push("/teaching/assessments" as Href)}
                    >
                      <View style={hStyles.cardBadgeRow}>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: "#0284C7" }}>
                          CSDL NÂNG CAO
                        </Text>
                        <View style={hStyles.pendingDotBadge}>
                          <View style={hStyles.pendingDot} />
                          <Text style={hStyles.pendingDotText}>⏰ Nộp 35 phút trước</Text>
                        </View>
                      </View>
                      <Text style={hStyles.compactCardTitle} numberOfLines={1}>
                        Lê Văn Đức (SV-202601) — Bài tập lớn: Thiết kế CSDL 3NF
                      </Text>
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginTop: 4,
                          gap: 8,
                        }}
                      >
                        <Text style={[styles.small, { flex: 1 }]} numberOfLines={1}>
                          Tệp đính kèm: schema_3nf.sql (245 KB)
                        </Text>
                        <View style={[hStyles.actionMiniBtn, { backgroundColor: "#0284C7" }]}>
                          <Text style={hStyles.actionMiniBtnText}>Chấm bài →</Text>
                        </View>
                      </View>
                    </ScalePressable>

                    <ScalePressable
                      style={hStyles.compactCard}
                      scaleTo={0.97}
                      onPress={() => router.push("/teaching/assessments" as Href)}
                    >
                      <View style={hStyles.cardBadgeRow}>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: "#7C3AED" }}>
                          WEB & AI FULLSTACK
                        </Text>
                        <View style={hStyles.pendingDotBadge}>
                          <View style={hStyles.pendingDot} />
                          <Text style={hStyles.pendingDotText}>⏰ Nộp 2 giờ trước</Text>
                        </View>
                      </View>
                      <Text style={hStyles.compactCardTitle} numberOfLines={1}>
                        Nguyễn Mai Phương (SV-202602) — Lab 03: REST API & Vector DB
                      </Text>
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginTop: 4,
                          gap: 8,
                        }}
                      >
                        <Text style={[styles.small, { flex: 1 }]} numberOfLines={1}>
                          Tệp đính kèm: fast_api_lab03.zip (1.2 MB)
                        </Text>
                        <View style={[hStyles.actionMiniBtn, { backgroundColor: "#0284C7" }]}>
                          <Text style={hStyles.actionMiniBtnText}>Chấm bài →</Text>
                        </View>
                      </View>
                    </ScalePressable>
                  </View>
                </View>
              </FadeSlideIn>

              {/* LECTURER SECTION 3: Lịch giảng dạy sắp tới */}
              <FadeSlideIn delay={200} duration={450}>
                <View style={hStyles.sectionContainer}>
                  <View style={hStyles.sectionHeader}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={hStyles.sectionTitle}>Lịch dạy hôm nay & tuần này</Text>
                      <Badge label="2 CA DẠY HÔM NAY" variant="ai" />
                    </View>
                    <ScalePressable scaleTo={0.92} onPress={() => router.push("/teaching/schedule" as Href)}>
                      <Text style={hStyles.sectionLink}>Xem lịch dạy &gt;</Text>
                    </ScalePressable>
                  </View>

                  <View style={{ gap: 10 }}>
                    <ScalePressable
                      style={hStyles.compactCard}
                      scaleTo={0.97}
                      onPress={() => router.push("/teaching/schedule" as Href)}
                    >
                      <View style={hStyles.cardBadgeRow}>
                        <Badge label="07:30 - 09:30 · TIẾT 1-3" variant="neutral" />
                        <Text style={{ fontSize: 11, fontWeight: "700", color: "#059669" }}>
                          Phòng P.302 (Tòa H1)
                        </Text>
                      </View>
                      <Text style={hStyles.compactCardTitle} numberOfLines={1}>
                        Cơ sở dữ liệu Nâng cao & Tối ưu hóa - Nhóm 01
                      </Text>
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginTop: 4,
                          gap: 8,
                        }}
                      >
                        <Text style={[styles.small, { flex: 1 }]} numberOfLines={1}>
                          Chương 4: Chỉ mục B-Tree & Tối ưu truy vấn EXPLAIN
                        </Text>
                        <View style={[hStyles.actionMiniBtn, { backgroundColor: "#059669" }]}>
                          <Text style={hStyles.actionMiniBtnText}>Điểm danh SV</Text>
                        </View>
                      </View>
                    </ScalePressable>

                    <ScalePressable
                      style={hStyles.compactCard}
                      scaleTo={0.97}
                      onPress={() => router.push("/teaching/schedule" as Href)}
                    >
                      <View style={hStyles.cardBadgeRow}>
                        <Badge label="13:30 - 15:30 · TIẾT 7-9" variant="ai" />
                        <Text style={{ fontSize: 11, fontWeight: "700", color: "#0284C7" }}>
                          Live Classroom Trực tuyến
                        </Text>
                      </View>
                      <Text style={hStyles.compactCardTitle} numberOfLines={1}>
                        Lập trình Web & Trợ lý AI Fullstack - Nhóm 02
                      </Text>
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginTop: 4,
                          gap: 8,
                        }}
                      >
                        <Text style={[styles.small, { flex: 1 }]} numberOfLines={1}>
                          Thực hành REST API với FastAPI & Vector DB Pinecone
                        </Text>
                        <View style={[hStyles.actionMiniBtn, { backgroundColor: "#0284C7" }]}>
                          <Text style={hStyles.actionMiniBtnText}>Vào phòng Live</Text>
                        </View>
                      </View>
                    </ScalePressable>
                  </View>
                </View>
              </FadeSlideIn>
            </>
          ) : snapshot.user?.role === "ADMIN" ? (
            <>
              {/* ADMIN SECTION 1: Hồ sơ Giảng viên chờ phê duyệt */}
              <FadeSlideIn delay={160} duration={450}>
                <View style={hStyles.sectionContainer}>
                  <View style={hStyles.sectionHeader}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={hStyles.sectionTitle}>Hồ sơ Giảng viên chờ duyệt</Text>
                      <Badge label="3 CHỜ XÉT" variant="danger" />
                    </View>
                    <ScalePressable scaleTo={0.92} onPress={() => router.push("/admin/lecturers" as Href)}>
                      <Text style={hStyles.sectionLink}>Duyệt tất cả &gt;</Text>
                    </ScalePressable>
                  </View>

                  <View style={{ gap: 10 }}>
                    <ScalePressable
                      style={hStyles.compactCard}
                      scaleTo={0.97}
                      onPress={() => router.push("/admin/lecturers" as Href)}
                    >
                      <View style={hStyles.cardBadgeRow}>
                        <Badge label="TIẾN SĨ CNTT" variant="neutral" />
                        <Text style={{ fontSize: 11, fontWeight: "700", color: "#D97706" }}>
                          Chờ phê duyệt
                        </Text>
                      </View>
                      <Text style={hStyles.compactCardTitle} numberOfLines={1}>
                        TS. Nguyễn Minh Trí — Cơ sở dữ liệu & Big Data
                      </Text>
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginTop: 4,
                          gap: 8,
                        }}
                      >
                        <Text style={[styles.small, { flex: 1 }]} numberOfLines={1}>
                          12 năm kinh nghiệm · Đầy đủ bằng cấp & minh chứng
                        </Text>
                        <View style={[hStyles.actionMiniBtn, { backgroundColor: "#7C3AED" }]}>
                          <Text style={hStyles.actionMiniBtnText}>Thẩm định →</Text>
                        </View>
                      </View>
                    </ScalePressable>

                    <ScalePressable
                      style={hStyles.compactCard}
                      scaleTo={0.97}
                      onPress={() => router.push("/admin/lecturers" as Href)}
                    >
                      <View style={hStyles.cardBadgeRow}>
                        <Badge label="THẠC SĨ AI" variant="neutral" />
                        <Text style={{ fontSize: 11, fontWeight: "700", color: "#D97706" }}>
                          Chờ phê duyệt
                        </Text>
                      </View>
                      <Text style={hStyles.compactCardTitle} numberOfLines={1}>
                        ThS. Hoàng Quốc Bảo — Web & Trợ lý AI Copilot
                      </Text>
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginTop: 4,
                          gap: 8,
                        }}
                      >
                        <Text style={[styles.small, { flex: 1 }]} numberOfLines={1}>
                          8 năm kinh nghiệm · Hồ sơ chứng chỉ hoàn tất
                        </Text>
                        <View style={[hStyles.actionMiniBtn, { backgroundColor: "#7C3AED" }]}>
                          <Text style={hStyles.actionMiniBtnText}>Thẩm định →</Text>
                        </View>
                      </View>
                    </ScalePressable>
                  </View>
                </View>
              </FadeSlideIn>

              {/* ADMIN SECTION 2: Giao dịch Thanh toán & Đối soát tự động */}
              <FadeSlideIn delay={180} duration={450}>
                <View style={hStyles.sectionContainer}>
                  <View style={hStyles.sectionHeader}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={hStyles.sectionTitle}>Giao dịch Thanh toán tự động</Text>
                      <Badge label="CHỜ DỮ LIỆU" variant="neutral" />
                    </View>
                    <ScalePressable scaleTo={0.92} onPress={() => router.push("/admin/commerce" as Href)}>
                      <Text style={hStyles.sectionLink}>Xem đối soát &gt;</Text>
                    </ScalePressable>
                  </View>

                  <ScalePressable
                    style={hStyles.compactCard}
                    scaleTo={0.97}
                    onPress={() => router.push("/admin/revenue" as Href)}
                  >
                    <Text style={hStyles.compactCardTitle}>Chưa có giao dịch đã đối soát để hiển thị</Text>
                    <Text style={styles.small}>
                      Không sử dụng giao dịch mẫu. Mở dashboard để kiểm tra trạng thái projection tài chính.
                    </Text>
                  </ScalePressable>
                </View>
              </FadeSlideIn>

              {/* ADMIN SECTION 3: Vận hành & Giám sát Hệ thống */}
              <FadeSlideIn delay={200} duration={450}>
                <View style={hStyles.sectionContainer}>
                  <View style={hStyles.sectionHeader}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={hStyles.sectionTitle}>Hạ tầng & Dịch vụ AILSS</Text>
                      <Badge label="CHƯA XÁC MINH" variant="neutral" />
                    </View>
                    <ScalePressable scaleTo={0.92} onPress={() => router.push("/admin" as Href)}>
                      <Text style={hStyles.sectionLink}>Trung tâm Admin &gt;</Text>
                    </ScalePressable>
                  </View>

                  <View style={{ gap: 10 }}>
                    <ScalePressable
                      style={hStyles.compactCard}
                      scaleTo={0.97}
                      onPress={() => router.push("/admin" as Href)}
                    >
                      <View style={hStyles.cardBadgeRow}>
                        <Badge label="CHỜ TELEMETRY" variant="neutral" />
                        <Text style={{ fontSize: 11, fontWeight: "700", color: tokens.color.muted }}>
                          Độ trễ: —
                        </Text>
                      </View>
                      <Text style={hStyles.compactCardTitle} numberOfLines={1}>
                        Cổng Webhook Đối Soát Tự Động
                      </Text>
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginTop: 4,
                          gap: 8,
                        }}
                      >
                        <Text style={[styles.small, { flex: 1 }]} numberOfLines={1}>
                          Tự động nhận biến động số dư VietQR & kích hoạt học viên
                        </Text>
                        <View style={hStyles.actionMiniBtn}>
                          <Text style={hStyles.actionMiniBtnText}>Kiểm tra</Text>
                        </View>
                      </View>
                    </ScalePressable>
                  </View>
                </View>
              </FadeSlideIn>
            </>
          ) : (
            <>
              {/* STUDENT SECTION 1: Lớp học của tôi */}
              <FadeSlideIn delay={160} duration={450}>
                <View style={hStyles.sectionContainer}>
                  <View style={hStyles.sectionHeader}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={hStyles.sectionTitle}>Lớp học của tôi</Text>
                      <Badge label="CHÍNH KHÓA" variant="primary" />
                    </View>
                    <ScalePressable scaleTo={0.92} onPress={() => router.push("/classes" as Href)}>
                      <Text style={hStyles.sectionLink}>Tất cả lớp &gt;</Text>
                    </ScalePressable>
                  </View>

                  <View style={{ gap: 10 }}>
                    {classList.slice(0, 2).map((c) => (
                      <ScalePressable
                        key={c.classId}
                        style={hStyles.compactCard}
                        scaleTo={0.97}
                        onPress={() => router.push(`/classes/${c.classId}` as Href)}
                        accessibilityRole="button"
                        accessibilityLabel={`Lớp học ${c.name}`}
                      >
                        <View style={hStyles.cardBadgeRow}>
                          <Badge
                            label={c.classKind === "LIVE_COHORT" ? "LỚP TRỰC TUYẾN" : "LỚP HỌC"}
                            variant="neutral"
                          />
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <View
                              style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#10B981" }}
                            />
                            <Text style={{ fontSize: 11, fontWeight: "700", color: "#10B981" }}>
                              Đang học
                            </Text>
                          </View>
                        </View>
                        <Text style={hStyles.compactCardTitle} numberOfLines={1}>
                          {c.name}
                        </Text>
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginTop: 4,
                            gap: 8,
                          }}
                        >
                          <Text style={[styles.small, { flex: 1 }]} numberOfLines={1}>
                            Mở chi tiết lớp để xem giảng viên phụ trách
                          </Text>
                          <View style={hStyles.actionMiniBtn}>
                            <Text style={hStyles.actionMiniBtnText}>Vào lớp</Text>
                            <Icon name="chevronRight" size={12} color="#FFFFFF" />
                          </View>
                        </View>
                      </ScalePressable>
                    ))}
                    {classList.length === 0 && (
                      <Text style={styles.small}>Lớp được ghi danh sẽ xuất hiện ở đây.</Text>
                    )}
                  </View>
                </View>
              </FadeSlideIn>

              {/* STUDENT SECTION 2: Bài tập cần hoàn thành */}
              <FadeSlideIn delay={180} duration={450}>
                <View style={hStyles.sectionContainer}>
                  <View style={hStyles.sectionHeader}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={hStyles.sectionTitle}>Bài tập</Text>
                    </View>
                    <ScalePressable scaleTo={0.92} onPress={() => router.push("/classes" as Href)}>
                      <Text style={hStyles.sectionLink}>Xem tất cả &gt;</Text>
                    </ScalePressable>
                  </View>

                  <View style={{ gap: 10 }}>
                    {DEFAULT_ASSIGNMENTS.length === 0 && (
                      <ScalePressable
                        style={hStyles.compactCard}
                        scaleTo={0.97}
                        onPress={() => router.push("/classes?tab=assignments" as Href)}
                        accessibilityRole="button"
                        accessibilityLabel="Mở lớp học để xem bài tập được giao"
                      >
                        <Text style={hStyles.compactCardTitle}>Xem bài tập trong lớp học</Text>
                        <Text style={styles.small}>Bài được giao hiển thị trong từng lớp bạn đang học.</Text>
                      </ScalePressable>
                    )}
                    {DEFAULT_ASSIGNMENTS.map((asg) => (
                      <ScalePressable
                        key={asg.id}
                        style={hStyles.compactCard}
                        scaleTo={0.97}
                        onPress={() => {
                          const targetClassId =
                            classList[0]?.classId || "10000000-0000-4000-8000-000000000001";
                          router.push(
                            `/classes/${targetClassId}?tab=assignments&action=${asg.status === "PENDING" ? "submit" : "review"}&asgId=${asg.id}` as Href,
                          );
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={asg.title}
                      >
                        <View style={hStyles.cardBadgeRow}>
                          <Text style={{ fontSize: 12, fontWeight: "700", color: "#0284C7" }}>
                            {asg.className}
                          </Text>
                          {asg.status === "PENDING" ? (
                            <View style={hStyles.pendingDotBadge}>
                              <View style={hStyles.pendingDot} />
                              <Text style={hStyles.pendingDotText}>Chưa nộp</Text>
                            </View>
                          ) : (
                            <View style={hStyles.completedBadge}>
                              <Icon name="check" size={11} color="#16A34A" />
                              <Text style={hStyles.completedBadgeText}>Đã nộp</Text>
                            </View>
                          )}
                        </View>
                        <Text style={hStyles.compactCardTitle} numberOfLines={2}>
                          {asg.title}
                        </Text>
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginTop: 4,
                            gap: 8,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 12,
                              color: asg.status === "PENDING" ? "#DC2626" : "#64748B",
                              fontWeight: asg.status === "PENDING" ? "600" : "500",
                              flex: 1,
                            }}
                            numberOfLines={1}
                          >
                            ⏰ Hạn nộp: {asg.dueDate}
                          </Text>
                          <View
                            style={[
                              hStyles.actionMiniBtn,
                              asg.status === "PENDING"
                                ? { backgroundColor: "#DC2626" }
                                : { backgroundColor: "#64748B" },
                            ]}
                          >
                            <Text style={hStyles.actionMiniBtnText}>
                              {asg.status === "PENDING" ? "Làm bài →" : "Xem lại"}
                            </Text>
                          </View>
                        </View>
                      </ScalePressable>
                    ))}
                  </View>
                </View>
              </FadeSlideIn>

              {/* STUDENT SECTION 3: Bài kiểm tra & Đề thi AI */}
              <FadeSlideIn delay={200} duration={450}>
                <View style={hStyles.sectionContainer}>
                  <View style={hStyles.sectionHeader}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={hStyles.sectionTitle}>Bài kiểm tra &amp; Đề thi AI</Text>
                    </View>
                    <ScalePressable scaleTo={0.92} onPress={() => router.push("/assessments" as Href)}>
                      <Text style={hStyles.sectionLink}>Tất cả đề thi &gt;</Text>
                    </ScalePressable>
                  </View>

                  <View style={{ gap: 10 }}>
                    {DEFAULT_ASSESSMENTS.length === 0 && (
                      <ScalePressable
                        style={hStyles.compactCard}
                        scaleTo={0.97}
                        onPress={() => router.push("/assessments" as Href)}
                        accessibilityRole="button"
                        accessibilityLabel="Mở bài kiểm tra đã phát hành"
                      >
                        <Text style={hStyles.compactCardTitle}>Xem bài kiểm tra đã phát hành</Text>
                        <Text style={styles.small}>Chọn đề và xem kết quả chính thức tại đây.</Text>
                      </ScalePressable>
                    )}
                    {DEFAULT_ASSESSMENTS.map((quiz) => (
                      <ScalePressable
                        key={quiz.id}
                        style={hStyles.compactCard}
                        scaleTo={0.97}
                        onPress={() => {
                          router.push(`/assessments/${quiz.id}` as Href);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={quiz.title}
                      >
                        <View style={hStyles.cardBadgeRow}>
                          <Badge label="AI ADAPTIVE" variant="ai" icon="sparkles" />
                          {quiz.status === "PENDING" ? (
                            <View style={hStyles.pendingDotBadge}>
                              <View style={hStyles.pendingDot} />
                              <Text style={hStyles.pendingDotText}>Chưa làm</Text>
                            </View>
                          ) : (
                            <View style={hStyles.completedBadge}>
                              <Icon name="award" size={11} color="#16A34A" />
                              <Text style={hStyles.completedBadgeText}>Đã thi: {quiz.score}/10</Text>
                            </View>
                          )}
                        </View>
                        <Text style={hStyles.compactCardTitle} numberOfLines={2}>
                          {quiz.title}
                        </Text>
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginTop: 4,
                            gap: 8,
                          }}
                        >
                          <Text style={[styles.small, { flex: 1 }]} numberOfLines={1}>
                            ⏱️ {quiz.durationMinutes} phút • {quiz.questionsCount} câu hỏi
                          </Text>
                          <View
                            style={[
                              hStyles.actionMiniBtn,
                              quiz.status === "PENDING"
                                ? { backgroundColor: "#D97706" }
                                : { backgroundColor: "#059669" },
                            ]}
                          >
                            <Text style={hStyles.actionMiniBtnText}>
                              {quiz.status === "PENDING" ? "Vào thi →" : "Xem điểm"}
                            </Text>
                          </View>
                        </View>
                      </ScalePressable>
                    ))}
                  </View>
                </View>
              </FadeSlideIn>
            </>
          ))}

        {/* ============================================================
            GUEST LANDING PAGE — chỉ hiển thị khi chưa đăng nhập
            ============================================================ */}
        {snapshot.state !== "AUTHENTICATED" && (
          <>
            {/* Feature Preview Cards */}
            <FadeSlideIn delay={170} duration={450}>
              <View style={hStyles.sectionContainer}>
                <View style={hStyles.sectionHeader}>
                  <Text style={hStyles.sectionTitle}>Tính năng nổi bật</Text>
                </View>
                <View style={{ gap: 10 }}>
                  {[
                    {
                      icon: "sparkles" as const,
                      color: "#7C3AED",
                      bg: "#EDE9FE",
                      title: "Đề thi AI thích ứng",
                      desc: "AI tự động điều chỉnh độ khó theo năng lực, phân tích điểm yếu và cá nhân hóa lộ trình ôn tập.",
                      cta: "Thử ngay",
                    },
                    {
                      icon: "academic" as const,
                      color: "#0284C7",
                      bg: "#E0F2FE",
                      title: "Lớp học trực tuyến Live",
                      desc: "Tham gia buổi học trực tiếp với giảng viên, hỏi đáp thời gian thực và xem lại bài giảng bất cứ lúc nào.",
                      cta: "Xem lớp học",
                    },
                    {
                      icon: "award" as const,
                      color: "#D97706",
                      bg: "#FEF3C7",
                      title: "Theo dõi tiến độ học tập",
                      desc: "Theo dõi mục tiêu, nội dung học tập và các hạn được hệ thống cung cấp.",
                      cta: "Tìm hiểu",
                    },
                    {
                      icon: "book" as const,
                      color: "#059669",
                      bg: "#D1FAE5",
                      title: "Thư viện khóa học phong phú",
                      desc: "Video bài giảng chất lượng cao, tài liệu PDF, bài tập thực hành và cộng đồng học viên sôi động.",
                      cta: "Khám phá",
                    },
                  ].map((f, idx) => (
                    <StaggerPop key={f.title} index={idx} baseDelay={180} staggerStep={40} style={{}}>
                      <ScalePressable
                        style={guestStyles.featureCard}
                        scaleTo={0.97}
                        onPress={() => router.push("/login" as Href)}
                        accessibilityRole="button"
                        accessibilityLabel={f.title}
                      >
                        <View style={[guestStyles.featureCardIcon, { backgroundColor: f.bg }]}>
                          <Icon name={f.icon} size={22} color={f.color} />
                        </View>
                        <View style={{ flex: 1, gap: 3 }}>
                          <Text style={guestStyles.featureCardTitle}>{f.title}</Text>
                          <Text style={guestStyles.featureCardDesc} numberOfLines={2}>
                            {f.desc}
                          </Text>
                        </View>
                        <View style={[guestStyles.featureCardCta, { backgroundColor: f.bg }]}>
                          <Text style={[guestStyles.featureCardCtaText, { color: f.color }]}>{f.cta}</Text>
                        </View>
                      </ScalePressable>
                    </StaggerPop>
                  ))}
                </View>
              </View>
            </FadeSlideIn>

            {/* CTA Banner — đăng ký miễn phí */}
            <FadeSlideIn delay={210} duration={450}>
              <View style={guestStyles.ctaBanner}>
                <FloatingElement distance={4} duration={1800}>
                  <View style={guestStyles.ctaBannerIcon}>
                    <Icon name="sparkles" size={28} color="#FFFFFF" />
                  </View>
                </FloatingElement>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={guestStyles.ctaBannerTitle}>Tham gia miễn phí hôm nay</Text>
                  <Text style={guestStyles.ctaBannerSub}>
                    Tạo tài khoản trong 30 giây. Không cần thẻ tín dụng.
                  </Text>
                </View>
                <ScalePressable
                  style={guestStyles.ctaBannerBtn}
                  scaleTo={0.93}
                  onPress={() => router.push("/register" as Href)}
                  accessibilityRole="button"
                  accessibilityLabel="Đăng ký miễn phí"
                >
                  <Text style={guestStyles.ctaBannerBtnText}>Đăng ký →</Text>
                </ScalePressable>
              </View>
            </FadeSlideIn>
          </>
        )}

        {/* Errors / Warnings Banner */}
        {snapshot.error && (
          <View
            style={[
              styles.card,
              { marginHorizontal: 16, marginTop: 12, backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" },
            ]}
          >
            <Text accessibilityRole="alert" style={styles.error}>
              {snapshot.error}
            </Text>
            {snapshot.state === "SESSION_EXPIRED" && (
              <Button
                label="Xóa phiên trên thiết bị"
                variant="danger"
                size="sm"
                onPress={() => {
                  void session.logout().catch(() => {});
                }}
              />
            )}
            {snapshot.state === "NETWORK_UNAVAILABLE" && (
              <Button
                label="Thử khôi phục phiên"
                size="sm"
                onPress={() => {
                  void session.restore();
                }}
              />
            )}
          </View>
        )}

        {/* Lecturer Quick Studio Widget */}
        {lecturerInfo && (
          <FadeSlideIn delay={280} duration={450}>
            <View style={hStyles.lecturerWidget}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Badge label="KHÔNG GIAN GIẢNG VIÊN" variant="primary" icon="academic" />
                <Text style={{ fontSize: 12, fontWeight: "700", color: tokens.color.brand }}>
                  {lecturerInfo.courses} Khóa • {lecturerInfo.offerings} Lớp
                </Text>
              </View>
              <Text style={{ fontSize: 17, fontWeight: "800", color: tokens.color.ink, marginTop: 4 }}>
                Quản lý giảng dạy &amp; Lớp học
              </Text>
              <Text style={styles.small}>
                Theo dõi điểm danh buổi học, tạo bài kiểm tra AI và công bố điểm số.
              </Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                <Button label="Bàn làm việc" size="sm" onPress={() => router.push("/teaching" as Href)} />
                <Button
                  label="Báo cáo"
                  icon={<Icon name="chart" size={13} color={tokens.color.brand} />}
                  variant="outline"
                  size="sm"
                  onPress={() => router.push("/teaching/reports" as Href)}
                />
                <Button
                  label="Trợ lý AI"
                  icon={<Icon name="sparkles" size={14} color="#FFF" />}
                  variant="ai"
                  size="sm"
                  onPress={() => router.push("/teaching/ai" as Href)}
                />
              </View>
            </View>
          </FadeSlideIn>
        )}

        {/* Student Learning Progress Card with Animated Progress Fill */}
        {activeCourse && (
          <FadeSlideIn delay={300} duration={450}>
            <View style={hStyles.resumeCard}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Badge label="TIẾP TỤC HỌC TẬP" variant="ai" icon="sparkles" />
              </View>
              <Text style={{ fontSize: 17, fontWeight: "800", color: tokens.color.ink }}>
                {activeCourse.title}
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: 4,
                }}
              >
                <ScalePressable scaleTo={0.95} onPress={() => router.push("/progress" as Href)}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: tokens.color.brand }}>
                    📊 Xem báo cáo học tập →
                  </Text>
                </ScalePressable>
                <Button
                  label="Học tiếp"
                  icon={<Icon name="play" size={13} color="#FFF" />}
                  size="sm"
                  variant="ai"
                  onPress={() => router.push(`/learn/${activeCourse.courseId}` as Href)}
                />
              </View>
              <Button
                testID="student-home-study-plan"
                label="Mở lộ trình học"
                variant="outline"
                size="sm"
                onPress={() =>
                  router.push({
                    pathname: "/student/study-plan",
                    params: { courseId: activeCourse.courseId },
                  })
                }
              />
            </View>
          </FadeSlideIn>
        )}

        {/* Featured Courses Section */}
        {featuredCourses.length > 0 && (
          <FadeSlideIn delay={360} duration={450}>
            <View style={hStyles.sectionContainer}>
              <View style={hStyles.sectionHeader}>
                <Text style={hStyles.sectionTitle}>Khóa học Lập trình</Text>
                <ScalePressable scaleTo={0.92} onPress={() => router.push("/courses" as Href)}>
                  <Text style={hStyles.sectionLink}>Tất cả &gt;</Text>
                </ScalePressable>
              </View>

              <View style={{ gap: 10 }}>
                {featuredCourses.slice(0, 3).map((c, index) => (
                  <ScalePressable
                    key={c.courseId}
                    style={hStyles.courseCard}
                    scaleTo={0.97}
                    onPress={() => router.push(`/courses/${c.courseId}` as Href)}
                    accessibilityRole="button"
                    accessibilityLabel={`Khóa học ${c.title}`}
                  >
                    <View
                      style={[
                        hStyles.courseBanner,
                        { backgroundColor: index % 2 === 0 ? "#0A7E85" : "#4F46E5" },
                      ]}
                    >
                      <Icon name="academic" size={24} color="#FFFFFF" />
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <Badge
                          label={c.priceType === "FREE" ? "Miễn phí" : "Chính khóa"}
                          variant={c.priceType === "FREE" ? "success" : "neutral"}
                        />
                      </View>
                      <Text
                        style={{ fontSize: 15, fontWeight: "700", color: tokens.color.ink }}
                        numberOfLines={1}
                      >
                        {c.title}
                      </Text>
                      <Text style={styles.small} numberOfLines={1}>
                        Hệ thống hỗ trợ học tập thông minh AILSS
                      </Text>
                    </View>
                  </ScalePressable>
                ))}
              </View>
            </View>
          </FadeSlideIn>
        )}
      </ScrollView>

      {/* Modern 4-Tab Bottom Dock matching Screenshot */}
      <BottomNavBar
        currentRoute="home"
        role={snapshot.user?.role}
        onNavigate={(path) => router.push(path as Href)}
      />

      {snapshot.state === "AUTHENTICATED" && snapshot.user?.role === "STUDENT" && (
        <ScalePressable
          testID="student-home-tutor-launcher"
          style={hStyles.tutorLauncher}
          scaleTo={0.94}
          onPress={() => router.push("/student/tutor" as Href)}
          accessibilityRole="button"
          accessibilityLabel="Trò chuyện với Gia sư AI"
          accessibilityHint="Hỏi bài học hoặc tìm khóa học phù hợp"
        >
          <TutorAvatar size={58} decorative />
          <Text style={hStyles.tutorLauncherLabel}>Hỏi AI</Text>
        </ScalePressable>
      )}

      {/* All Features Modal */}
      <Modal
        visible={showAllModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAllModal(false)}
      >
        <View style={hStyles.modalBackdrop}>
          <View style={hStyles.modalSheet}>
            <View style={hStyles.modalHeader}>
              <Text style={hStyles.modalTitle}>Tất cả chức năng AILSS</Text>
              <ScalePressable
                onPress={() => setShowAllModal(false)}
                style={hStyles.modalCloseBtn}
                accessibilityRole="button"
                accessibilityLabel="Đóng"
              >
                <Icon name="close" size={18} color="#64748B" />
              </ScalePressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 380 }}>
              <View style={hStyles.modalGrid}>
                {features
                  .map((item) =>
                    item.id === "all"
                      ? {
                          id: "account",
                          label: "Cá nhân",
                          icon: "user" as IconName,
                          bgColor: "#F1F5F9",
                          iconColor: "#475569",
                          path: "/account",
                        }
                      : item,
                  )
                  .map((item) => (
                    <ScalePressable
                      key={item.id}
                      style={hStyles.modalItem}
                      scaleTo={0.88}
                      onPress={() => {
                        setShowAllModal(false);
                        handleFeaturePress(item);
                      }}
                    >
                      <View style={[hStyles.featureIconWrap, { backgroundColor: item.bgColor }]}>
                        <Icon name={item.icon} size={22} color={item.iconColor} />
                        {item.hasBadge && <View style={hStyles.featureBadgeDot} />}
                      </View>
                      <Text style={hStyles.modalItemLabel} numberOfLines={2}>
                        {item.label}
                      </Text>
                    </ScalePressable>
                  ))}
              </View>
            </ScrollView>

            <Button
              label="Đóng bảng chức năng"
              variant="outline"
              size="md"
              onPress={() => setShowAllModal(false)}
            />
          </View>
        </View>
      </Modal>

      {/* Language Selection Modal */}
      <Modal
        visible={showLangModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLangModal(false)}
      >
        <View style={hStyles.modalBackdrop}>
          <View style={hStyles.modalSheet}>
            <View style={hStyles.modalHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ fontSize: 20 }}>🌐</Text>
                <Text style={hStyles.modalTitle}>{t("header.select_lang")}</Text>
              </View>
              <ScalePressable
                onPress={() => setShowLangModal(false)}
                style={hStyles.modalCloseBtn}
                accessibilityRole="button"
                accessibilityLabel={t("action.close")}
              >
                <Icon name="close" size={18} color="#64748B" />
              </ScalePressable>
            </View>

            <View style={hStyles.langListContainer}>
              {LANGUAGES.map((item) => {
                const isSelected = item.code === settings.language;
                return (
                  <ScalePressable
                    key={item.code}
                    style={[hStyles.langOptionCard, isSelected && hStyles.langOptionCardActive]}
                    scaleTo={0.97}
                    onPress={() => {
                      updateSystemSettings({ language: item.code });
                      setShowLangModal(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={item.name}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <Text style={{ fontSize: 26 }}>{item.flag}</Text>
                      <View>
                        <Text style={[hStyles.langOptionTitle, isSelected && hStyles.langOptionTitleActive]}>
                          {item.nativeName}
                        </Text>
                        <Text style={hStyles.langOptionSub}>{item.name}</Text>
                      </View>
                    </View>
                    {isSelected && (
                      <View style={hStyles.langCheckmark}>
                        <Icon name="check" size={16} color="#0284C7" />
                      </View>
                    )}
                  </ScalePressable>
                );
              })}
            </View>

            <Button
              label={t("action.close")}
              variant="outline"
              size="md"
              onPress={() => setShowLangModal(false)}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const hStyles = StyleSheet.create({
  tutorLauncher: {
    position: "absolute",
    right: 18,
    bottom: 82,
    width: 76,
    minHeight: 82,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 23,
    borderWidth: 1,
    borderColor: "#B8EDE5",
    backgroundColor: "#FFFFFF",
    shadowColor: "#0A5264",
    shadowOpacity: 0.19,
    shadowRadius: 12,
    elevation: 6,
  },
  tutorLauncherLabel: { color: "#0A5E6A", fontSize: 11, fontWeight: "800", marginTop: -4 },
  academicMetricsStrip: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 8,
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    ...tokens.shadow.subtle,
  },
  academicMetricItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  academicMetricIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  academicMetricValue: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0F172A",
  },
  academicMetricLabel: {
    fontSize: 10,
    color: "#64748B",
    fontWeight: "600",
  },
  academicMetricDivider: {
    width: 1,
    height: 28,
    backgroundColor: "#E2E8F0",
  },
  topBanner: {
    backgroundColor: "#062E3F",
    paddingTop: 52,
    paddingHorizontal: 16,
    paddingBottom: 42,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerRowLarge: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 12,
  },
  userProfile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
    marginRight: 10,
  },
  userProfileLarge: {
    flex: 0,
    alignSelf: "stretch",
    marginRight: 0,
  },
  greetingTextWrap: {
    gap: 1,
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  greetingSub: {
    fontSize: 11,
    color: "#94A3B8",
    fontWeight: "500",
    lineHeight: 14,
  },
  greetingName: {
    fontSize: 13.5,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.3,
    lineHeight: 17,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    justifyContent: "flex-end",
  },
  headerActionsLarge: {
    width: "100%",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(14, 116, 144, 0.75)",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
    flexShrink: 0,
  },
  avatarImg: {
    width: "100%",
    height: "100%",
    borderRadius: 19,
  },
  langButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.28)",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  langFlag: {
    fontSize: 13,
  },
  langText: {
    fontSize: 10.5,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },
  bellButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.28)",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
    flexShrink: 0,
  },
  langListContainer: {
    gap: 10,
    paddingVertical: 8,
  },
  langOptionCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
  },
  langOptionCardActive: {
    backgroundColor: "#F0F9FF",
    borderColor: "#0284C7",
  },
  langOptionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1E293B",
  },
  langOptionTitleActive: {
    color: "#0284C7",
  },
  langOptionSub: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  langCheckmark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#E0F2FE",
    alignItems: "center",
    justifyContent: "center",
  },
  bellDotWrapper: {
    position: "absolute",
    top: 6,
    right: 7,
  },
  bellDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#38BDF8",
    borderWidth: 1.5,
    borderColor: "#062E3F",
  },
  loginPillBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 32,
    paddingHorizontal: 9,
    borderRadius: 16,
    backgroundColor: "rgba(2, 132, 199, 0.88)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.40)",
    shadowColor: "#0284C7",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 2,
    justifyContent: "center",
  },
  loginPillText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  registerPillBtn: {
    height: 32,
    paddingHorizontal: 9,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.28)",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  registerPillText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  guestHeroCard: {
    marginTop: -26,
    marginHorizontal: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  guestHeroHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  guestHeroIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#E0F2FE",
    alignItems: "center",
    justifyContent: "center",
  },
  guestHeroTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.2,
  },
  guestHeroSub: {
    fontSize: 12,
    color: "#64748B",
    lineHeight: 17,
  },
  guestHeroActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  guestBtnPrimary: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 132,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#0284C7",
    paddingVertical: 11,
    borderRadius: 12,
  },
  guestBtnPrimaryText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  guestBtnSecondary: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 132,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1F5F9",
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  guestBtnSecondaryText: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "700",
  },
  guestDemoBtn: {
    width: "100%",
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  guestDemoBtnText: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "600",
  },
  heroClassCard: {
    marginTop: -26,
    marginHorizontal: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  heroIconBox: {
    width: 50,
    height: 50,
    borderRadius: 14,
    backgroundColor: "#E0F2FE",
    alignItems: "center",
    justifyContent: "center",
  },
  heroSubjectTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
  },
  heroTimeText: {
    fontSize: 12,
    color: "#64748B",
    fontWeight: "500",
  },
  heroRoomText: {
    fontSize: 12,
    color: "#0284C7",
    fontWeight: "700",
  },
  heroChevronCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  heroChevron: {
    fontSize: 18,
    fontWeight: "600",
    color: "#64748B",
    marginTop: -2,
  },
  sectionContainer: {
    marginTop: 22,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.2,
  },
  sectionLink: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0284C7",
  },
  featuresGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 14,
  },
  featureItem: {
    width: "23%",
    alignItems: "center",
  },
  featureIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  featureLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#334155",
    textAlign: "center",
    lineHeight: 14,
  },
  newsScrollContainer: {
    gap: 12,
    paddingRight: 16,
  },
  newsCard: {
    width: 250,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  newsCardBanner: {
    height: 105,
    padding: 12,
    justifyContent: "space-between",
    alignItems: "flex-start",
    position: "relative",
    overflow: "hidden",
  },
  newsDecoCircle1: {
    position: "absolute",
    right: -20,
    bottom: -20,
    width: 85,
    height: 85,
    borderRadius: 43,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  newsDecoCircle2: {
    position: "absolute",
    right: 35,
    top: -15,
    width: 55,
    height: 55,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  newsIconBadge: {
    position: "absolute",
    bottom: 10,
    right: 12,
  },
  newsCardBody: {
    padding: 12,
    gap: 4,
  },
  newsCardDate: {
    fontSize: 11,
    color: "#94A3B8",
    fontWeight: "500",
  },
  newsCardReadTime: {
    fontSize: 10,
    color: tokens.color.brand,
    fontWeight: "600",
  },
  newsCardTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
    lineHeight: 18,
  },
  devBanner: {
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    padding: 10,
    marginHorizontal: 16,
    marginTop: 14,
    gap: 6,
  },
  devBannerTitle: {
    fontSize: 10,
    fontWeight: "800",
    color: "#64748B",
    letterSpacing: 0.5,
  },
  lecturerWidget: {
    marginHorizontal: 16,
    marginTop: 18,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "#BAE6FD",
    gap: 8,
    ...tokens.shadow.card,
  },
  resumeCard: {
    marginHorizontal: 16,
    marginTop: 18,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "#E0E7FF",
    gap: 10,
    ...tokens.shadow.card,
  },
  courseCard: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 12,
    alignItems: "center",
    ...tokens.shadow.subtle,
  },
  courseBanner: {
    width: 60,
    height: 60,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
  },
  modalCloseBtn: {
    padding: 6,
  },
  modalGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 18,
    paddingVertical: 12,
  },
  modalItem: {
    width: "25%",
    alignItems: "center",
    paddingHorizontal: 2,
    gap: 6,
  },
  modalItemLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#334155",
    textAlign: "center",
    lineHeight: 16,
    maxWidth: 78,
  },
  featureBadgeDot: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: "#EF4444",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  compactCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    gap: 8,
  },
  compactCardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
    lineHeight: 20,
  },
  cardBadgeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pendingHeaderDot: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  pendingHeaderDotText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
  },
  pendingDotBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  pendingDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#EF4444",
  },
  pendingDotText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#DC2626",
  },
  completedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  completedBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#16A34A",
  },
  actionMiniBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#0284C7",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    flexShrink: 0,
  },
  actionMiniBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
});

const guestStyles = StyleSheet.create({
  statsStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
    marginHorizontal: 16,
    paddingVertical: 15,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    ...tokens.shadow.subtle,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  statValue: {
    color: "#062E3F",
    fontSize: 15,
    fontWeight: "800",
  },
  statLabel: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "600",
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: "#E2E8F0",
  },
  featureCard: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    ...tokens.shadow.subtle,
  },
  featureCardIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  featureCardTitle: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "800",
  },
  featureCardDesc: {
    color: "#64748B",
    fontSize: 11,
    lineHeight: 16,
  },
  featureCardCta: {
    minHeight: 32,
    paddingHorizontal: 9,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  featureCardCtaText: {
    fontSize: 10,
    fontWeight: "800",
  },
  ctaBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 22,
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 18,
    backgroundColor: "#062E3F",
  },
  ctaBannerIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaBannerTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  ctaBannerSub: {
    color: "#BAE6FD",
    fontSize: 10,
    lineHeight: 15,
  },
  ctaBannerBtn: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 11,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaBannerBtnText: {
    color: "#0369A1",
    fontSize: 11,
    fontWeight: "800",
  },
});

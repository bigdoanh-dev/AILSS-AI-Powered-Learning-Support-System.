import { loadAssignedQuizzes, type AssignedQuiz } from "../src/assigned-quizzes";
import { useSyncExternalStore, useState, useEffect, useRef } from "react";
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
import { Button, Badge, Icon, tokens, styles, BottomNavBar, notifyNavScroll, type IconName } from "../src/ui";
import { CinematicIntro } from "../src/CinematicIntro";
import { FadeSlideIn, ScalePressable, StaggerPop, PulseBadge, FloatingElement } from "../src/motion";
import { TutorAvatar } from "../src/TutorAvatar";

import { getFeaturesForRole, type FeatureItem } from "../src/features";
export { getFeaturesForRole, type FeatureItem };
import { getSystemSettings, updateSystemSettings, subscribeSystemSettings } from "../src/settings";
import { loadCourseCategories, loadConfiguredCoursePreview } from "../src/catalog-preview";
import { ApiError } from "../src/api";
import { LANGUAGES, getTranslation } from "../src/i18n";

export default function Home() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.3;
  const [upcomingSession, setUpcomingSession] = useState<StudentScheduleEntry | null>(null);
  const [lecturerInfo, setLecturerInfo] = useState<{ courses: number; offerings: number } | null>(null);
  const [featuredCourses, setFeaturedCourses] = useState<Course[]>([]);
  const [enrolledList, setEnrolledList] = useState<Course[]>([]);
  const [homeError, setHomeError] = useState("");
  const [homeRevision, setHomeRevision] = useState(0);
  const [homeQuizzes, setHomeQuizzes] = useState<AssignedQuiz[]>([]);
  const [quizLoadState, setQuizLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [classList, setClassList] = useState<StudentClass[]>([]);
  const [showAllModal, setShowAllModal] = useState(false);
  const [showLangModal, setShowLangModal] = useState(false);
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(null);
  const lastScrollY = useRef(0);

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
  }, [snapshot.state, snapshot.user?.role, snapshot.user?.userId, session, homeRevision]);

  useEffect(() => {
    let active = true;
    async function loadLecturer() {
      if (snapshot.state === "AUTHENTICATED" && snapshot.user?.role === "LECTURER") {
        setLecturerInfo(null);
        try {
          const data = await session.request("/api/v1/me/owned-offerings");
          const items = ownedOfferings(data);
          const courses = uniqueCoursesFromOfferings(items);
          if (active) setLecturerInfo({ courses: courses.length, offerings: items.length });
        } catch {
          if (active) setHomeError("Không tải được khóa nổi bật. Hãy thử lại.");
        }
      } else {
        if (active) setLecturerInfo(null);
      }
    }
    void loadLecturer();
    return () => {
      active = false;
    };
  }, [snapshot.state, snapshot.user?.role, snapshot.user?.userId, session, homeRevision]);

  useEffect(() => {
    let active = true;
    async function loadCourses() {
      try {
        const request = (path: string, options: { signal?: AbortSignal }) =>
          snapshot.state === "AUTHENTICATED"
            ? session.request(path, options)
            : session.api.request(path, options);
        const categories = await loadCourseCategories(request);
        const preview = await loadConfiguredCoursePreview(request, undefined, categories);
        if (active) {
          setFeaturedCourses(preview.courses.slice(0, 4));
          if (preview.failedCategories.length) setHomeError("Một số danh mục chưa tải được. Hãy thử lại.");
        }
      } catch {
        if (active) setHomeError("Không tải được khóa nổi bật. Hãy thử lại.");
      }
    }
    void loadCourses();
    return () => {
      active = false;
    };
  }, [snapshot.state, session, homeRevision]);

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
          if (active) setHomeError("Không tải được khóa học của bạn. Hãy thử lại.");
        }
      } else {
        if (active) setEnrolledList([]);
      }
    }
    void loadEnrolled();
    return () => {
      active = false;
    };
  }, [snapshot.state, snapshot.user?.role, snapshot.user?.userId, session, homeRevision]);

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
          if (active) setHomeError("Không tải được lớp học của bạn. Hãy thử lại.");
        }
      } else {
        if (active) setClassList([]);
      }
    }
    void loadClasses();
    return () => {
      active = false;
    };
  }, [snapshot.state, snapshot.user?.role, snapshot.user?.userId, session, homeRevision]);

  useEffect(() => {
    const abort = new AbortController();
    setHomeQuizzes([]);
    setQuizLoadState("idle");
    if (snapshot.state === "AUTHENTICATED" && snapshot.user?.role === "STUDENT") {
      setQuizLoadState("loading");
      void loadAssignedQuizzes((path, options) => session.request(path, options), abort.signal)
        .then((quizzes) => {
          if (!abort.signal.aborted) {
            setHomeQuizzes(quizzes);
            setQuizLoadState("ready");
          }
        })
        .catch((cause: unknown) => {
          if (!abort.signal.aborted) {
            setQuizLoadState("error");
            setHomeError(cause instanceof ApiError ? cause.message : "Không tải được đề đã giao.");
          }
        });
    }
    return () => abort.abort();
  }, [snapshot.state, snapshot.user?.userId, snapshot.user?.role, session, homeRevision]);

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
        feature.id === "assignments" ||
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

  return (
    <View style={{ flex: 1, backgroundColor: "#F8FAFC" }}>
      <StatusBar barStyle="light-content" backgroundColor="#062E3F" />

      {/* Cinematic Intro Video Overlay */}
      <CinematicIntro />

      <ScrollView
        testID="student-home"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 116 }}
        scrollEventThrottle={16}
        onScroll={(event) => {
          const currentY = event.nativeEvent.contentOffset.y;
          const deltaY = currentY - lastScrollY.current;
          lastScrollY.current = currentY;
          notifyNavScroll(currentY, deltaY);
        }}
      >
        {homeError ? (
          <View style={styles.card}>
            <Text accessibilityRole="alert" style={styles.error}>
              {homeError}
            </Text>
            <Button
              label="Thử tải lại"
              onPress={() => {
                setHomeError("");
                setHomeRevision((v) => v + 1);
              }}
            />
          </View>
        ) : null}

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
                <View style={{ gap: 2, flexShrink: 1 }}>
                  <Text style={hStyles.greetingSub}>{t("header.greeting")}</Text>
                  <Text style={hStyles.greetingName} numberOfLines={largeText ? 2 : 1}>
                    {snapshot.state === "AUTHENTICATED"
                      ? displayName.toUpperCase()
                      : t("header.guest").toUpperCase()}
                  </Text>
                </View>
              </ScalePressable>

              {/* Right Side: Language Switcher and (if Authenticated) Bell Notification */}
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
                    <Icon name="bell" size={19} color="#FFFFFF" />
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
                  testID="student-register-entry"
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

        {/* Global Home Error Notice */}
        {homeError ? (
          <FadeSlideIn delay={90} duration={350}>
            <View style={[styles.card, { marginHorizontal: 16, marginTop: 14, marginBottom: 4 }]}>
              <Text accessibilityRole="alert" style={styles.error}>
                {homeError}
              </Text>
              <Button
                label="Thử tải lại"
                onPress={() => {
                  setHomeError("");
                  setHomeRevision((v) => v + 1);
                }}
              />
            </View>
          </FadeSlideIn>
        ) : null}

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

        {/* Section: Chức năng AILSS */}
        {features.length > 0 && (
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

        {/* Role-Specific Work Sections (Chỉ hiển thị bài tập/kiểm tra khi đã đăng nhập) */}
        {snapshot.state === "AUTHENTICATED" &&
          snapshot.user?.role !== "LECTURER" &&
          snapshot.user?.role !== "ADMIN" && (
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
                  ))}
                </View>
              </FadeSlideIn>

              {/* Assigned assessments from the authenticated student's backend data. */}
              <FadeSlideIn delay={200} duration={450}>
                <View style={hStyles.sectionContainer}>
                  <View style={hStyles.sectionHeader}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={hStyles.sectionTitle}>Bài kiểm tra được giao</Text>
                      {quizLoadState === "ready" && (
                        <View style={[hStyles.pendingHeaderDot, { backgroundColor: "#D97706" }]}>
                          <Text style={hStyles.pendingHeaderDotText}>{homeQuizzes.length}</Text>
                        </View>
                      )}
                    </View>
                    <ScalePressable scaleTo={0.92} onPress={() => router.push("/assessments" as Href)}>
                      <Text style={hStyles.sectionLink}>Tất cả đề thi &gt;</Text>
                    </ScalePressable>
                  </View>

                  <View style={{ gap: 8 }}>
                    {homeQuizzes.slice(0, 2).map((quiz) => {
                      const quizId = quiz.quizId;
                      const title = quiz.title;
                      const count = quiz.questionCount;

                      return (
                        <ScalePressable
                          key={quizId}
                          style={hStyles.compactRowCard}
                          scaleTo={0.98}
                          onPress={() => router.push(`/assessments/${quizId}` as Href)}
                          accessibilityRole="button"
                          accessibilityLabel={title}
                        >
                          <View style={[hStyles.rowIconBox, { backgroundColor: "#FEF3C7" }]}>
                            <Icon name="sparkles" size={16} color="#D97706" />
                          </View>
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={hStyles.rowCardTitle} numberOfLines={1}>
                              {title}
                            </Text>
                            {quiz.targetName && (
                              <Text style={hStyles.rowCardSub} numberOfLines={1}>
                                {quiz.targetName}
                              </Text>
                            )}
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <View style={hStyles.adaptiveMiniBadge}>
                                <Text style={hStyles.adaptiveMiniText}>Bài kiểm tra</Text>
                              </View>
                              <Text style={{ fontSize: 10, color: "#94A3B8" }}>•</Text>
                              <Text style={hStyles.rowCardSub}>{count} câu hỏi</Text>
                            </View>
                          </View>
                          <View style={[hStyles.rowActionBtn, { backgroundColor: "#FFFBEB" }]}>
                            <Text style={[hStyles.rowActionText, { color: "#D97706" }]}>Xem đề</Text>
                            <Icon name="chevronRight" size={12} color="#D97706" />
                          </View>
                        </ScalePressable>
                      );
                    })}
                    {quizLoadState === "loading" && <Text style={styles.small}>Đang tải đề được giao…</Text>}
                    {quizLoadState === "ready" && homeQuizzes.length === 0 && (
                      <Text style={styles.small}>
                        Chưa có bài kiểm tra được giao. Đề do giảng viên xuất bản sẽ hiển thị ở đây.
                      </Text>
                    )}
                  </View>
                </View>
              </FadeSlideIn>
            </>
          )}

        {/* ============================================================
            GUEST LANDING PAGE — chỉ hiển thị khi chưa đăng nhập
            ============================================================ */}
        {snapshot.state !== "AUTHENTICATED" && (
          <>
            {/* Quick Stats Banner for Guests */}
            <FadeSlideIn delay={160} duration={450}>
              <View style={guestStyles.statsStrip}>
                <View style={guestStyles.statItem}>
                  <Text style={guestStyles.statValue}>100%</Text>
                  <Text style={guestStyles.statLabel}>AI Tương tác</Text>
                </View>
                <View style={guestStyles.statDivider} />
                <View style={guestStyles.statItem}>
                  <Text style={guestStyles.statValue}>40+ Giờ</Text>
                  <Text style={guestStyles.statLabel}>Bài giảng chuẩn</Text>
                </View>
                <View style={guestStyles.statDivider} />
                <View style={guestStyles.statItem}>
                  <Text style={guestStyles.statValue}>24/7</Text>
                  <Text style={guestStyles.statLabel}>Trợ lý AI Copilot</Text>
                </View>
              </View>
            </FadeSlideIn>

            {/* Guest Platform Introduction / Highlights */}
            <FadeSlideIn delay={190} duration={450}>
              <View style={hStyles.sectionContainer}>
                <View style={hStyles.sectionHeader}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={hStyles.sectionTitle}>Trải nghiệm AILSS Copilot</Text>
                    <Badge label="NỔI BẬT" variant="ai" icon="sparkles" />
                  </View>
                </View>

                <View style={{ gap: 10 }}>
                  <ScalePressable
                    style={guestStyles.featureCard}
                    scaleTo={0.97}
                    onPress={() => router.push("/courses" as Href)}
                    accessibilityRole="button"
                    accessibilityLabel="Khám phá các khóa học công nghệ"
                  >
                    <View style={[guestStyles.featureCardIcon, { backgroundColor: "#E0F2FE" }]}>
                      <Icon name="book" size={22} color="#0284C7" />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={guestStyles.featureCardTitle}>Thư viện khóa học chuyên sâu</Text>
                      <Text style={guestStyles.featureCardDesc}>
                        Lập trình Web, CSDL nâng cao, Trí tuệ nhân tạo và LLMs thực chiến.
                      </Text>
                    </View>
                    <View style={[guestStyles.featureCardCta, { backgroundColor: "#F0F9FF" }]}>
                      <Text style={[guestStyles.featureCardCtaText, { color: "#0284C7" }]}>Xem ngay</Text>
                    </View>
                  </ScalePressable>

                  <ScalePressable
                    style={guestStyles.featureCard}
                    scaleTo={0.97}
                    onPress={() => router.push("/login" as Href)}
                    accessibilityRole="button"
                    accessibilityLabel="Luyện thi trắc nghiệm AI"
                  >
                    <View style={[guestStyles.featureCardIcon, { backgroundColor: "#FEF3C7" }]}>
                      <Icon name="sparkles" size={22} color="#D97706" />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={guestStyles.featureCardTitle}>Luyện đề thi Thích ứng AI</Text>
                      <Text style={guestStyles.featureCardDesc}>
                        Hệ thống tự động điều chỉnh độ khó theo năng lực và phân tích điểm yếu ngay lập tức.
                      </Text>
                    </View>
                    <View style={[guestStyles.featureCardCta, { backgroundColor: "#FFFBEB" }]}>
                      <Text style={[guestStyles.featureCardCtaText, { color: "#D97706" }]}>Khám phá</Text>
                    </View>
                  </ScalePressable>

                  <ScalePressable
                    style={guestStyles.featureCard}
                    scaleTo={0.97}
                    onPress={() => router.push("/login" as Href)}
                    accessibilityRole="button"
                    accessibilityLabel="Lớp học trực tiếp tương tác"
                  >
                    <View style={[guestStyles.featureCardIcon, { backgroundColor: "#EDE9FE" }]}>
                      <Icon name="class" size={22} color="#7C3AED" />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={guestStyles.featureCardTitle}>Lớp học LIVE &amp; Điểm danh tự động</Text>
                      <Text style={guestStyles.featureCardDesc}>
                        Tương tác trực tiếp cùng giảng viên, hỏi đáp tài liệu và theo dõi điểm chuyên cần.
                      </Text>
                    </View>
                    <View style={[guestStyles.featureCardCta, { backgroundColor: "#F5F3FF" }]}>
                      <Text style={[guestStyles.featureCardCtaText, { color: "#7C3AED" }]}>Tìm hiểu</Text>
                    </View>
                  </ScalePressable>
                </View>
              </View>
            </FadeSlideIn>

            {/* CTA Banner — đăng ký miễn phí */}
            <FadeSlideIn delay={220} duration={450}>
              <View style={guestStyles.ctaBanner}>
                <FloatingElement distance={4} duration={1800}>
                  <View style={guestStyles.ctaBannerIcon}>
                    <Icon name="sparkles" size={28} color="#FFFFFF" />
                  </View>
                </FloatingElement>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={guestStyles.ctaBannerTitle}>Tham gia miễn phí hôm nay</Text>
                  <Text style={guestStyles.ctaBannerSub}>
                    Tạo tài khoản trong 30 giây. Đăng nhập để lưu tiến độ và làm bài kiểm tra.
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
          scaleTo={0.93}
          onPress={() => router.push("/student/tutor" as Href)}
          accessibilityRole="button"
          accessibilityLabel="Trò chuyện với Gia sư AI"
          accessibilityHint="Hỏi bài học hoặc tìm khóa học phù hợp"
        >
          {/* Web-identical Speech Bubble */}
          <View style={hStyles.tutorSpeechBubble}>
            <Text style={hStyles.tutorSpeechText}>Hỏi AI ✨</Text>
            <View style={hStyles.tutorSpeechArrow} />
          </View>

          {/* Web-identical Mascot Pod */}
          <View style={hStyles.tutorMascotPod}>
            <TutorAvatar size={48} decorative />
            {/* Green online status indicator dot */}
            <View style={hStyles.tutorStatusDot} />
          </View>
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
    bottom: 70,
    alignItems: "center",
    zIndex: 25,
  },
  tutorSpeechBubble: {
    backgroundColor: "rgba(15, 23, 42, 0.94)",
    borderColor: "rgba(56, 189, 248, 0.45)",
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginBottom: 6,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  tutorSpeechText: {
    color: "#F8FAFC",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  tutorSpeechArrow: {
    position: "absolute",
    bottom: -4,
    width: 8,
    height: 8,
    backgroundColor: "rgba(15, 23, 42, 0.94)",
    borderColor: "rgba(56, 189, 248, 0.45)",
    borderRightWidth: 1,
    borderBottomWidth: 1,
    transform: [{ rotate: "45deg" }],
  },
  tutorMascotPod: {
    position: "relative",
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: "#0B1528",
    borderWidth: 2,
    borderColor: "rgba(56, 189, 248, 0.65)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 8,
  },
  tutorStatusDot: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#22C55E",
    borderWidth: 2.5,
    borderColor: "#0B1528",
    shadowColor: "#22C55E",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 3,
  },
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
    paddingHorizontal: 20,
    paddingBottom: 44,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerRowLarge: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 14,
  },
  userProfile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  userProfileLarge: {
    flex: 0,
    alignSelf: "stretch",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerActionsLarge: {
    width: "100%",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(14, 116, 144, 0.85)",
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.65)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#38BDF8",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarImg: {
    width: "100%",
    height: "100%",
    borderRadius: 22,
  },
  greetingSub: {
    fontSize: 12,
    color: "#94A3B8",
    fontWeight: "500",
  },
  greetingName: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
  langButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.32)",
    justifyContent: "center",
  },
  langFlag: {
    fontSize: 15,
  },
  langText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.5,
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
  bellButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.3)",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  bellDotWrapper: {
    position: "absolute",
    top: 8,
    right: 9,
  },
  bellDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#38BDF8",
    borderWidth: 1.5,
    borderColor: "#062E3F",
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
  // Compact succinct rows for assignments and assessments
  compactRowCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 10,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  rowIconBox: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowCardTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
  },
  rowCardSub: {
    fontSize: 11,
    color: "#64748B",
    fontWeight: "500",
  },
  rowCardDue: {
    fontSize: 11,
    fontWeight: "600",
  },
  rowActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    flexShrink: 0,
  },
  rowActionText: {
    fontSize: 11,
    fontWeight: "700",
  },
  adaptiveMiniBadge: {
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  adaptiveMiniText: {
    fontSize: 9.5,
    fontWeight: "800",
    color: "#B45309",
    letterSpacing: 0.3,
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

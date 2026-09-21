import OperationResultPage from "./components/OperationResult";
import { LecturerApplication, AdminLecturerApplications } from "./pages/LecturerApplication";
import { AuthLayout } from "./components/AuthLayout";
import { Motion } from "./components/Motion";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CinematicIntro } from "./components/CinematicIntro";
import { AvatarProvider, PreferencesProvider } from "./components/Preferences";
import { LanguageProvider } from "./lib/i18n";
import { SessionProvider } from "./auth/session";
import { AppShell, Account, AppHome } from "./pages/Workspace";
import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { PageHero, Section, ButtonLink } from "./components/ui";
import { metadata } from "./metadata";
import Home from "./pages/Home";
import Courses, { CourseDetail } from "./pages/Courses";
const student = (name: keyof typeof import("./student/Learning")) =>
  lazy(() => import("./student/Learning").then((m) => ({ default: m[name] })));
const Learn = student("Learn"),
  CourseLearning = student("CourseLearning"),
  ProgressPage = student("ProgressPage");
const StudentGuard = lazy(() => import("./student/ui").then((m) => ({ default: m.StudentGuard })));
const LecturerGuard = lazy(() => import("./lecturer/ui").then((m) => ({ default: m.LecturerGuard })));
const LecturerComments = lazy(() => import("./lecturer/Comments"));
const teaching = (name: keyof typeof import("./lecturer/Teaching")) =>
  lazy(() => import("./lecturer/Teaching").then((m) => ({ default: m[name] })));
const classroom = (name: keyof typeof import("./lecturer/Classroom")) =>
  lazy(() => import("./lecturer/Classroom").then((m) => ({ default: m[name] })));
const lecturerAssessment = (name: keyof typeof import("./lecturer/Assessment")) =>
  lazy(() => import("./lecturer/Assessment").then((m) => ({ default: m[name] })));
const lecturerAi = (name: keyof typeof import("./lecturer/AiStudio")) =>
  lazy(() => import("./lecturer/AiStudio").then((m) => ({ default: m[name] })));
const GradebookDashboard = lazy(() => import("./lecturer/GradebookDashboard"));
const LecturerReportsDashboard = lazy(() => import("./lecturer/LecturerReportsDashboard"));
const TeachingHome = teaching("TeachingHome"),
  TeachingCourses = teaching("TeachingCourses"),
  CourseCreate = teaching("CourseCreate"),
  TeachingCourse = teaching("CourseDetail"),
  Lessons = teaching("Lessons"),
  TeachingLesson = teaching("LessonDetail"),
  CourseRoster = teaching("CourseRoster"),
  Offerings = teaching("Offerings"),
  OfferingCreate = teaching("OfferingCreate"),
  OfferingDetail = teaching("OfferingDetail"),
  TeachingClasses = classroom("Classes"),
  ClassCreate = classroom("ClassCreate"),
  TeachingClass = classroom("ClassDetail"),
  ClassRoster = classroom("ClassRoster"),
  Announcements = classroom("Announcements"),
  Schedule = classroom("Schedule"),
  TeachingSession = classroom("SessionDetail"),
  Attendance = classroom("Attendance"),
  TeachingAssessments = lecturerAssessment("Assessments"),
  TeachingAssessment = lecturerAssessment("AssessmentDetail"),
  TeachingResults = lecturerAssessment("Results"),
  AiStudio = lecturerAi("AiStudio"),
  AiJob = lecturerAi("AiJob");
const Classes = lazy(() => import("./student/Classes").then((m) => ({ default: m.Classes })));
const ClassDetail = lazy(() => import("./student/Classes").then((m) => ({ default: m.ClassDetail })));
const StudentSchedule = lazy(() =>
  import("./student/Planning").then((m) => ({ default: m.StudentSchedule })),
);
const StudentAttendance = lazy(() =>
  import("./student/Planning").then((m) => ({ default: m.StudentAttendance })),
);
const TeachingSchedule = lazy(() =>
  import("./lecturer/Planning").then((m) => ({ default: m.TeachingSchedule })),
);
const TeachingAttendance = lazy(() =>
  import("./lecturer/Planning").then((m) => ({ default: m.TeachingAttendance })),
);
const StudyPlanPage = lazy(() =>
  import("./student/StudyPlan").then((m) => ({ default: m.StudyPlanPage })),
);
const AiTutorPage = lazy(() =>
  import("./student/AiTutor").then((m) => ({ default: m.AiTutorPage })),
);
const TeacherCopilotPage = lazy(() =>
  import("./lecturer/TeacherCopilot").then((m) => ({ default: m.TeacherCopilotPage })),
);
const InstitutionWizardPage = lazy(() =>
  import("./admin/InstitutionWizard").then((m) => ({ default: m.InstitutionWizardPage })),
);
const UnifiedStudentWorkspacePage = lazy(() =>
  import("./student/UnifiedStudentWorkspace").then((m) => ({ default: m.UnifiedStudentWorkspace })),
);
const CourseAuthoringStudioPage = lazy(() =>
  import("./lecturer/CourseAuthoringStudio").then((m) => ({ default: m.CourseAuthoringStudio })),
);
const FleetOperationsCenterPage = lazy(() =>
  import("./admin/FleetOperationsCenter").then((m) => ({ default: m.FleetOperationsCenter })),
);
const Notifications = lazy(() => import("./pages/Notifications"));
const Moderation = lazy(() => import("./admin/Moderation"));
const admin = (name: keyof typeof import("./admin/Admin")) =>
  lazy(() => import("./admin/Admin").then((m) => ({ default: m[name] })));
const AdminGuard = admin("AdminGuard"),
  AdminHome = admin("AdminHome"),
  AdminUsers = admin("Users"),
  AdminUserDetail = admin("UserDetail"),
  CourseGovernance = admin("CourseGovernance"),
  AdminRevenue = admin("RevenueDashboard"),
  AdminStats = admin("StatsDashboard"),
  AdminLogs = admin("LogsDashboard"),
  AdminSettings = admin("SettingsDashboard");
const Purchase = lazy(() => import("./student/Commerce"));
const assessment = (name: keyof typeof import("./student/Assessment")) =>
  lazy(() => import("./student/Assessment").then((m) => ({ default: m[name] })));
const Assessments = assessment("Assessments"),
  QuizDetail = assessment("QuizDetail"),
  AttemptPage = assessment("AttemptPage"),
  ResultPage = assessment("ResultPage");
const platform = (name: Exclude<keyof typeof import("./pages/Platform"), "featureItems">) =>
  lazy(() => import("./pages/Platform").then((m) => ({ default: m[name] })));
const support = (name: keyof typeof import("./pages/Support")) =>
  lazy(() => import("./pages/Support").then((m) => ({ default: m[name] })));
const trust = (name: keyof typeof import("./pages/Trust")) =>
  lazy(() => import("./pages/Trust").then((m) => ({ default: m[name] })));
const About = platform("About"),
  Features = platform("Features"),
  How = platform("HowItWorks"),
  Ai = platform("AiLearning"),
  Quiz = platform("AiQuiz"),
  Experience = platform("Experience"),
  Architecture = platform("ArchitecturePage");
const Contact = support("Contact"),
  Faq = support("FaqPage"),
  Help = support("Help"),
  Auth = support("Auth"),
  Media = support("Media");
const Security = trust("Security"),
  Research = trust("Research"),
  Roadmap = trust("Roadmap"),
  Policy = trust("Policy");
function Head() {
  const { pathname } = useLocation();
  useEffect(() => {
    const [title, description] = metadata(pathname);
    document.title = `${title} | AILSS`;
    const set = (query: string, content: string) =>
      document.querySelector(query)?.setAttribute("content", content);
    set('meta[name="description"]', description);
    set('meta[property="og:title"]', `${title} | AILSS`);
    set('meta[property="og:description"]', description);
    set('meta[property="og:url"]', `${location.origin}${pathname}`);
    document.querySelector('link[rel="canonical"]')?.setAttribute("href", `${location.origin}${pathname}`);
    const main = document.getElementById("main");
    if (main && window.history.state?.idx > 0) main.focus({ preventScroll: true });
  }, [pathname]);
  return null;
}
export default function App() {
  const location = useLocation();
  return (
    <>
      <LanguageProvider>
        <PreferencesProvider>
          <CinematicIntro />
          <SessionProvider>
            <AvatarProvider>
              <Head />
            <Suspense
              fallback={
                <div className="route-loading" role="status">
                  Đang mở trang…
                </div>
              }
            >
              <Motion />
              <ErrorBoundary>
                <Routes>
                  <Route path="auth" element={<AuthLayout />}>
                    <Route path="result" element={<OperationResultPage />} />
                    <Route path="register/lecturer" element={<Auth key={location.pathname} />} />
                    <Route path="register/lecturer/application" element={<LecturerApplication />} />
                    <Route path="register/lecturer/status" element={<LecturerApplication />} />
                    {["login", "register", "register/student", "forgot-password"].map((path) => (
                      <Route key={path} path={path} element={<Auth key={location.pathname} />} />
                    ))}
                  </Route>
                  <Route path="app" element={<AppShell />}>
                    <Route index element={<AppHome />} />
                    <Route path="account" element={<Account />} />
                    <Route path="notifications" element={<Notifications />} />
                    <Route path="result" element={<OperationResultPage />} />
                    <Route path="resources" element={<Navigate to="/app/learn" replace />} />
                    <Route element={<StudentGuard />}>
                      <Route path="learn" element={<Learn />} />
                      <Route path="learn/:courseId" element={<CourseLearning />} />
                      <Route path="learn/:courseId/lessons/:lessonId" element={<CourseLearning />} />
                      <Route path="purchase/:courseId" element={<Purchase />} />
                      <Route path="progress" element={<ProgressPage />} />
                      <Route path="classes" element={<Classes />} />
                      <Route path="schedule" element={<StudentSchedule />} />
                      <Route path="attendance" element={<StudentAttendance />} />
                      <Route path="classes/:classId" element={<ClassDetail />} />
                      <Route path="study-plan" element={<StudyPlanPage />} />
                      <Route path="ai-tutor" element={<AiTutorPage />} />
                      <Route path="workspace" element={<UnifiedStudentWorkspacePage />} />

                      <Route path="assessments" element={<Assessments />} />
                      <Route path="assessments/:quizId" element={<QuizDetail />} />
                      <Route path="attempts/:attemptId" element={<AttemptPage />} />
                      <Route path="attempts/:attemptId/result" element={<ResultPage />} />
                    </Route>
                    <Route element={<LecturerGuard />}>
                      <Route path="teaching" element={<TeachingCourses />} />
                      <Route path="teaching/courses/new" element={<CourseCreate />} />
                      <Route path="teaching/courses/:courseId" element={<TeachingCourse />} />
                      <Route path="teaching/courses/:courseId/lessons" element={<Lessons />} />
                      <Route path="teaching/courses/:courseId/roster" element={<CourseRoster />} />
                      <Route path="teaching/lessons/:lessonId" element={<TeachingLesson />} />
                      <Route path="teaching/offerings" element={<Offerings />} />
                      <Route path="teaching/offerings/new" element={<OfferingCreate />} />
                      <Route path="teaching/offerings/:offeringId" element={<OfferingDetail />} />
                      <Route path="teaching/classes" element={<TeachingClasses />} />
                      <Route path="teaching/classes/new" element={<ClassCreate />} />
                      <Route path="teaching/schedule" element={<TeachingSchedule />} />
                      <Route path="teaching/attendance" element={<TeachingAttendance />} />
                      <Route path="teaching/classes/:classId" element={<TeachingClass />} />
                      <Route path="teaching/classes/:classId/roster" element={<ClassRoster />} />
                      <Route path="teaching/classes/:classId/announcements" element={<Announcements />} />
                      <Route path="teaching/classes/:classId/schedule" element={<Schedule />} />
                      <Route path="teaching/sessions/:sessionId" element={<TeachingSession />} />
                      <Route path="teaching/sessions/:sessionId/attendance" element={<Attendance />} />
                      <Route path="teaching/assessments" element={<TeachingAssessments />} />
                      <Route path="teaching/grades" element={<GradebookDashboard />} />
                      <Route path="teaching/reports" element={<LecturerReportsDashboard />} />
                      <Route path="teaching/assessments/:quizId" element={<TeachingAssessment />} />
                      <Route path="teaching/assessments/:quizId/results" element={<TeachingResults />} />
                      <Route path="teaching/ai" element={<AiStudio />} />
                      <Route path="teaching/ai/jobs/:jobId" element={<AiJob />} />
                      <Route path="teaching/copilot" element={<TeacherCopilotPage />} />
                      <Route path="teaching/course-authoring" element={<CourseAuthoringStudioPage />} />
                      <Route
                        path="teaching/discussion/:resourceType/:resourceId"
                        element={<LecturerComments />}
                      />
                    </Route>
                    <Route element={<AdminGuard />}>
                      <Route path="admin" element={<AdminHome />} />
                      <Route path="admin/revenue" element={<AdminRevenue />} />
                      <Route path="admin/stats" element={<AdminStats />} />
                      <Route path="admin/logs" element={<AdminLogs />} />
                      <Route path="admin/users" element={<AdminUsers />} />
                      <Route path="admin/users/:userId" element={<AdminUserDetail />} />
                      <Route path="admin/courses" element={<CourseGovernance />} />
                      <Route path="admin/lecturer-applications" element={<AdminLecturerApplications />} />
                      <Route path="admin/moderation" element={<Moderation />} />
                      <Route path="admin/settings" element={<AdminSettings />} />
                      <Route path="admin/onboarding" element={<InstitutionWizardPage />} />
                      <Route path="admin/integrations" element={<InstitutionWizardPage />} />
                      <Route path="admin/fleet-operations" element={<FleetOperationsCenterPage />} />
                    </Route>
                  </Route>
                  <Route element={<Layout />}>
                    <Route index element={<Home />} />
                    <Route path="about" element={<About />} />
                    <Route path="features" element={<Features />} />
                    <Route path="how-it-works" element={<How />} />
                    <Route path="courses" element={<Courses />} />
                    <Route path="courses/:id" element={<CourseDetail />} />
                    <Route path="ai-learning" element={<Ai />} />
                    <Route path="ai-quiz" element={<Quiz />} />
                    {["students", "lecturers", "classroom", "assessment", "progress", "notifications"].map(
                      (path) => (
                        <Route key={path} path={path} element={<Experience key={path} />} />
                      ),
                    )}
                    <Route path="architecture" element={<Architecture />} />
                    <Route path="security" element={<Security />} />
                    <Route path="research" element={<Research />} />
                    <Route path="roadmap" element={<Roadmap />} />
                    <Route path="contact" element={<Contact />} />
                    <Route path="faq" element={<Faq />} />
                    <Route path="help" element={<Help />} />
                    <Route path="media" element={<Media />} />

                    {["legal/privacy", "legal/terms", "legal/cookies", "accessibility"].map((path) => (
                      <Route key={path} path={path} element={<Policy />} />
                    ))}
                    <Route
                      path="*"
                      element={
                        <>
                          <PageHero
                            label="404"
                            title="Trang này chưa có ở đây."
                            description="Đường dẫn có thể đã thay đổi. Bạn có thể quay lại trang chủ hoặc khám phá khóa học."
                          />
                          <Section>
                            <ButtonLink to="/">Về trang chủ</ButtonLink>
                          </Section>
                        </>
                      }
                    />
                  </Route>
                </Routes>
              </ErrorBoundary>
            </Suspense>
          </AvatarProvider>
        </SessionProvider>
      </PreferencesProvider>
    </LanguageProvider>
  </>
);
}

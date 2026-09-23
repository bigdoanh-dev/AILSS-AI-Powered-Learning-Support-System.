import { existsSync } from "node:fs";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "docs", "phase41");
const read = (file) => readFile(file, "utf8");
async function walk(folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const absolute = path.join(folder, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else if (entry.isFile() && entry.name.endsWith(".tsx")) files.push(absolute);
  }
  return files;
}
const codeExtensions = [".ios.tsx", ".android.tsx", ".native.tsx", ".tsx", ".ios.ts", ".android.ts", ".native.ts", ".ts", ".jsx", ".js", ".mjs"];
function resolveLocalImport(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const bases = specifier.endsWith(".js")
    ? [base, base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx"]
    : [base];
  for (const candidate of bases) {
    if (existsSync(candidate) && !candidate.endsWith(".d.ts")) return candidate;
    for (const extension of codeExtensions) {
      if (existsSync(candidate + extension)) return candidate + extension;
    }
    for (const extension of codeExtensions) {
      const index = path.join(candidate, `index${extension}`);
      if (existsSync(index)) return index;
    }
  }
  return null;
}
function parseSource(file, source) {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") || file.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}
function moduleSpecifiers(file, source) {
  const ast = parseSource(file, source);
  const found = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) found.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) found.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return [...new Set(found)];
}
async function dependencyClosure(entry) {
  const queue = [entry];
  const seen = new Set();
  const sources = new Map();
  const unresolvedImports = [];
  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const source = await read(file);
    sources.set(file, source);
    for (const specifier of moduleSpecifiers(file, source)) {
      if (!specifier.startsWith(".")) continue;
      const target = resolveLocalImport(file, specifier);
      if (target) queue.push(target);
      else unresolvedImports.push({ source: path.relative(root, file), specifier });
    }
  }
  return { sources, unresolvedImports };
}
function apiPathsInSource(file, source) {
  const ast = parseSource(file, source);
  const paths = new Set();
  let hasApiRequest = false;
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      if (
        (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "request") ||
        (ts.isIdentifier(node.expression) && ["fetch", "request"].includes(node.expression.text))
      ) hasApiRequest = true;
    }
    if (ts.isStringLiteralLike(node)) {
      for (const match of node.text.matchAll(/\/api\/v1\/[^\s"'`]+/gu)) paths.add(normalizeApiPath(match[0]));
    } else if (ts.isTemplateExpression(node)) {
      let value = node.head.text;
      for (const span of node.templateSpans) value += `:param${span.literal.text}`;
      for (const match of value.matchAll(/\/api\/v1\/[^\s"'`]+/gu)) paths.add(normalizeApiPath(match[0]));
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return hasApiRequest ? [...paths] : [];
}
function normalizeApiPath(value) {
  return value
    .replace(/\$\{[^}]*\}/gu, ":param")
    .split("?")[0]
    .replace(/[),.;]+$/u, "")
    .replace(/\/{2,}/gu, "/")
    .replace(/\/$/u, "");
}
function routePatternRegex(pattern) {
  return new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/:[A-Za-z0-9_]+/gu, "[^/]+")}/?$`, "u");
}
function routeFor(file) {
  if (path.basename(file) === "_layout.tsx") return null;
  let route = path
    .relative(path.join(root, "app"), file)
    .replaceAll(path.sep, "/")
    .replace(/\.tsx$/u, "");
  if (route.endsWith("/_layout")) return null;
  route = route.replace(/(^|\/)index$/u, "").replace(/\[\.\.\.([^\]]+)\]/gu, "*$1");
  return `/${route}`.replace(/\/$/u, "") || "/";
}
function roleFor(route) {
  if (
    route === "/" ||
    route === "/login" ||
    route === "/register" ||
    route === "/courses" ||
    route === "/result"
  )
    return "PUBLIC_OR_ROLE_BASED";
  if (route.startsWith("/admin")) return "ADMIN";
  if (route.startsWith("/teaching")) return "LECTURER";
  if (
    route.startsWith("/student") ||
    ["/learn", "/classes", "/assessments", "/notifications", "/progress"].some(
      (prefix) => route === prefix || route.startsWith(`${prefix}/`),
    )
  )
    return "STUDENT";
  if (route === "/account" || route === "/settings") return "AUTHENTICATED_ROLE";
  return "PUBLIC_OR_ROLE_BASED";
}
function decision(route) {
  if (route.startsWith("/admin") || route.startsWith("/teaching")) return "DEFER";
  if (
    route.startsWith("/student") ||
    [
      "/learn",
      "/classes",
      "/assessments",
      "/notifications",
      "/login",
      "/register",
      "/courses",
      "/account",
      "/settings",
      "/progress",
    ].some((prefix) => route === prefix || route.startsWith(`${prefix}/`))
  )
    return "CONNECT";
  return "DEFER";
}

const routeFiles = (await walk(path.join(root, "app")))
  .map((file) => ({ file, route: routeFor(file) }))
  .filter((entry) => entry.route !== null)
  .sort((a, b) => a.route.localeCompare(b.route));
const inventory = [];
const sharedApiDependencies = new Set();
for (const { file, route } of routeFiles) {
  const source = await read(file);
  const closure = await dependencyClosure(file);
  const apiSources = new Map();
  for (const [dependency, dependencySource] of closure.sources) {
    const relative = path.relative(root, dependency).replaceAll(path.sep, "/");
    const found = apiPathsInSource(dependency, dependencySource);
    if (relative === "src/session.ts") {
      found.forEach((apiPath) => sharedApiDependencies.add(apiPath));
      continue;
    }
    for (const apiPath of found) {
      if (!apiSources.has(apiPath)) apiSources.set(apiPath, new Set());
      apiSources.get(apiPath).add(relative);
    }
  }
  const fixturePattern = /\b(?:CLASS_ASSIGNMENTS|CLASS_DOCUMENTS|CLASS_MEMBERS|CATALOG_COURSES|STUDENT_BLOOM|STUDENT_COURSES|RECENT_QUIZZES|MOCK_[A-Z0-9_]*|SAMPLE_[A-Z0-9_]*|DEMO_[A-Z0-9_]*)\b|\b(?:asg|quiz)-\d+\b|(?:fixture|sample|demo|mock)\s+(?:course|student|assignment|assessment|grade|class|member|document|quiz|score|progress)/iu;
  const mockPattern = /\b(?:MOCK_DATA|MOCK_COURSES|MOCK_STUDENTS|FIXTURE_DATA|DEMO_DATA|SAMPLE_DATA|native_(?:google|apple)_token)\b/iu;
  const fixtureFiles = [...closure.sources.keys()]
    .filter((dependency) => fixturePattern.test(closure.sources.get(dependency) ?? ""))
    .map((dependency) => path.relative(root, dependency).replaceAll(path.sep, "/"));
  const mockFiles = [...closure.sources.keys()]
    .filter((dependency) => mockPattern.test(closure.sources.get(dependency) ?? ""))
    .map((dependency) => path.relative(root, dependency).replaceAll(path.sep, "/"));
  const storageFiles = [...closure.sources.keys()].map((dependency) => path.relative(root, dependency).replaceAll(path.sep, "/"));
  const localStorage = [];
  if (storageFiles.some((dependency) => dependency.endsWith("src/runtime.ts")))
    localStorage.push("Refresh credential/session secret in SecureStore; access token memory-only");
  if (storageFiles.some((dependency) => dependency.endsWith("src/offline-store.ts")))
    localStorage.push("User-scoped encrypted SQLCipher cache and lesson-completion queue");
  const component =
    source.match(/export\s+default\s+function\s+([A-Za-z0-9_]+)/u)?.[1] ?? path.basename(file, ".tsx");
  const mockUsage = mockFiles.length > 0;
  const redirectTargets = [...source.matchAll(/<Redirect\s+href=\s*\{?["']([^"']+)["']/gu)].map((match) => match[1].split("?")[0]);
  inventory.push({
    route,
    sourceFile: path.relative(root, file).replaceAll(path.sep, "/"),
    component,
    intendedRole: roleFor(route),
    apiDependencies: [...apiSources.keys()].sort(),
    apiDependencySources: Object.fromEntries(
      [...apiSources].sort(([a], [b]) => a.localeCompare(b)).map(([apiPath, files]) => [apiPath, [...files].sort()]),
    ),
    localStorageDependencies: localStorage,
    fixtureUsage: fixtureFiles.length > 0,
    fixtureFiles,
    mockUsage,
    mockFiles,
    unresolvedImports: closure.unresolvedImports,
    redirectTargets,
    productionReachable: decision(route) !== "DEFER",
    decision: decision(route),
  });
}

const graph = {
  baseline: { tag: "v6.2.0-rc.6", sourceGitSha: "c435de9468d39527f46aac83aae22ffa4af2efdf" },
  status: "PHASE_41_IN_PROGRESS",
  features: [
    {
      id: "native-auth-password",
      status: "SHIP",
      nativeRoute: "/login",
      screen: "app/[screen].tsx",
      apiPath: "/api/v1/auth/login → /api/v1/me → /api/v1/auth/refresh",
      gatewayPath: "API Gateway identity proxy",
      backendService: "identity-service",
      repository: "Identity session repository",
      tableStore: "Cassandra session tables",
      featureFlag: null,
      authorization: "Public login; protected APIs validate bearer session; role comes from /me",
      offlineBehavior:
        "Authentication and refresh require network; refresh token only in Keychain/Android secure storage",
    },
    {
      id: "native-social-oidc",
      status: "DEFERRED_PROVIDER_CONFIGURATION_AND_PKCE_FLOW",
      nativeRoute: "/login",
      screen: "app/[screen].tsx",
      apiPath: "/api/v1/auth/social/:provider (ID-token endpoint exists; native OIDC callback not configured)",
      gatewayPath: "API Gateway identity proxy",
      backendService: "identity-service",
      repository: "Identity session repository",
      tableStore: "Cassandra session tables",
      featureFlag: null,
      authorization: "No Google or Apple token is requested or accepted by the current Mobile UI",
      offlineBehavior: "Online-only; provider client IDs and redirect URIs are not configured",
    },
    {
      id: "student-workspace",
      status: "SHIP",
      nativeRoute: "/student",
      screen: "app/student/index.tsx",
      apiPath:
        "/api/v1/me/courses; /api/v1/mastery/courses/:courseId; /api/v1/study-plan/current?courseId=...",
      gatewayPath: "Learning commerce and Adaptive Learning proxies",
      backendService: "learning-service",
      repository: "Learning commerce repository; AdaptiveRuntimeRepository",
      tableStore: "Cassandra enrollment, mastery_v2_by_student_concept, study_plans_v2",
      featureFlag: null,
      authorization: "Authenticated STUDENT; actor and user derived by Gateway",
      offlineBehavior: "Per-user SQLCipher cache for enrolled courses, last-synced Mastery and Study Plan; offline screens are labeled and cannot mutate plans",
    },
    {
      id: "course-lessons",
      status: "SHIP",
      nativeRoute: "/learn and /learn/:courseId/lessons/:lessonId",
      screen: "app/learn",
      apiPath:
        "/api/v1/me/courses; /api/v1/courses/:courseId/lessons; /api/v1/targets/COURSE/:courseId/quizzes; /api/v1/lessons/:lessonId; /api/v1/lessons/:lessonId/completion",
      gatewayPath: "Learning catalog, lessons and progress proxies",
      backendService: "learning-service",
      repository: "Catalog, LessonRepository, LearningProgressRepository",
      tableStore: "Cassandra course, lesson, progress and completion tables; approved object storage",
      featureFlag: null,
      authorization: "Enrollment/preview entitlement enforced by Learning Service",
      offlineBehavior: "Course metadata and progress projections may use labeled encrypted cache; lesson bodies remain online-only; completion is queued and not authoritative until server acknowledgement",
    },
    {
      id: "mastery-v2",
      status: "SHIP",
      nativeRoute: "/student/mastery and legacy /progress redirect",
      screen: "app/student/mastery.tsx",
      apiPath: "/api/v1/mastery/courses/:courseId",
      gatewayPath: "Adaptive Learning proxy",
      backendService: "learning-service",
      repository: "AdaptiveRuntimeRepository",
      tableStore: "Cassandra mastery_v2_by_student_concept",
      featureFlag: null,
      authorization: "Authenticated STUDENT; backend derives actor",
      offlineBehavior: "Last-synced projection may be read from a user-scoped SQLCipher cache with LAST_SYNCED; no local mastery calculation",
    },
    {
      id: "study-plan-v2",
      status: "SHIP",
      nativeRoute: "/student/study-plan",
      screen: "app/student/study-plan.tsx",
      apiPath: "/api/v1/study-plan/current; /generate; /items/:itemId/{accept,complete,skip}",
      gatewayPath: "Adaptive Learning proxy",
      backendService: "learning-service",
      repository: "AdaptiveRuntimeRepository and StudyPlanService",
      tableStore: "Cassandra study_plans_v2 and study_plan_items_status",
      featureFlag: null,
      authorization: "Authenticated STUDENT; ownership and transition validated server-side",
      offlineBehavior: "Last-synced read is available from SQLCipher cache; plan mutations remain online-only and 409 reloads server state",
    },
    {
      id: "ai-tutor-v2",
      status: "SHIP",
      nativeRoute: "/student/tutor",
      screen: "app/student/tutor.tsx",
      apiPath: "/api/v1/assistant/chat",
      gatewayPath: "Assistant proxy",
      backendService: "ai-service plus authorized Learning material search",
      repository: "AssistantRepository and material retrieval repository",
      tableStore: "Cassandra conversation/message tables and configured vector index",
      featureFlag: null,
      authorization: "Authenticated actor, course entitlement and citation allowlist checked by services",
      offlineBehavior: "Online-only; timeout/cancel is shown as failure and never fabricates an answer",
    },
    {
      id: "assessments",
      status: "SHIP_ONLINE_ONLY",
      nativeRoute: "/assessments",
      screen: "app/assessments",
      apiPath: "/api/v1/targets/:targetType/:targetId/quizzes; /api/v1/attempts; /submit",
      gatewayPath: "Assessment proxy",
      backendService: "assessment-service",
      repository: "AssessmentRepository",
      tableStore: "Cassandra quiz, attempt, answer and result tables",
      featureFlag: null,
      authorization: "Authenticated student; attempt/visibility rules from Assessment Service",
      offlineBehavior:
        "Online-only; answers remain in memory; stable submit idempotency key and same-payload retry while attempt screen remains mounted; no resume after process restart",
    },
    {
      id: "notifications",
      status: "SHIP_IN_APP_ONLY",
      nativeRoute: "/notifications",
      screen: "app/notifications.tsx",
      apiPath: "/api/v1/notifications; /api/v1/notifications/:id/read",
      gatewayPath: "Notifications proxy",
      backendService: "notification-service",
      repository: "NotificationRepository",
      tableStore: "Cassandra notification tables",
      featureFlag: null,
      authorization: "Authenticated user; server scopes by actor",
      offlineBehavior: "In-app list/read only; push installation binding remains unavailable until trusted tenant/session contract ships",
    },
    {
      id: "account-registration",
      status: "SHIP",
      nativeRoute: "/register",
      screen: "app/register.tsx → app/[screen].tsx",
      apiPath: "/api/v1/auth/register",
      gatewayPath: "API Gateway identity proxy",
      backendService: "identity-service",
      repository: "Identity user repository",
      tableStore: "Cassandra identity tables",
      featureFlag: null,
      authorization: "Public registration; resulting identity is server-issued",
      offlineBehavior: "Online-only",
    },
    {
      id: "account-settings",
      status: "SHIP",
      nativeRoute: "/account and /settings",
      screen: "app/account.tsx; app/settings.tsx",
      apiPath: "/api/v1/me; /api/v1/me/avatar; /api/v1/me/password; /api/v1/auth/logout",
      gatewayPath: "API Gateway identity proxy",
      backendService: "identity-service",
      repository: "Identity session and profile repositories",
      tableStore: "Cassandra identity tables",
      featureFlag: null,
      authorization: "Authenticated account; account data and logout are server-backed",
      offlineBehavior: "Account mutation requires network; local logout always clears local credentials and cache",
    },
    {
      id: "public-course-catalog",
      status: "SHIP",
      nativeRoute: "/courses and /courses/:courseId",
      screen: "app/courses and app/courses/[courseId].tsx",
      apiPath: "/api/v1/courses; /api/v1/courses/search; /api/v1/courses/:courseId; /api/v1/courses/:courseId/offerings; review APIs",
      gatewayPath: "Learning catalog and Interaction proxies",
      backendService: "learning-service plus interaction-service",
      repository: "LearningCatalogRepository, OfferingRepository, InteractionRepository",
      tableStore: "Cassandra published catalog, offering and review projections",
      featureFlag: null,
      authorization: "Published catalog is public; enrollment/review mutations remain server-authorized",
      offlineBehavior: "Online-only; catalog results are never fabricated or replaced with fallback records",
    },
    {
      id: "student-classroom-schedule",
      status: "SHIP_READ_ONLY",
      nativeRoute: "/classes and /classes/:classId and /classes/:classId/sessions/:sessionId",
      screen: "app/classes",
      apiPath: "/api/v1/me/classes; /api/v1/me/schedule; /api/v1/me/attendance; /api/v1/classes/:classId; /api/v1/classes/:classId/sessions; /api/v1/class-sessions/:sessionId",
      gatewayPath: "Classroom proxy",
      backendService: "classroom-service",
      repository: "ClassroomRepository",
      tableStore: "Cassandra classroom and attendance tables",
      featureFlag: null,
      authorization: "Student membership is verified by Classroom Service; detail screens are read-only",
      offlineBehavior: "Online-only; no assignment, roster or document fixture fallback",
    },
    {
      id: "push-registration",
      status: "DEFERRED_SECURITY_ARCHITECTURE",
      nativeRoute: "/notifications",
      screen: "No device-registration UI or client hook",
      apiPath: "No Mobile push token registration endpoint wired",
      gatewayPath: "No Mobile Gateway route used",
      backendService: "notification-service (in-app APIs only from Mobile)",
      repository: "Not applicable",
      tableStore: "Not applicable",
      featureFlag: null,
      authorization: "No authoritative tenant-installation binding contract exists; do not register or retain a private notification token",
      offlineBehavior: "IN_APP_ONLY; push registration and delivery are not Phase 41 product claims",
    },
  ],
};

const routeMappings = [
  { featureId: "native-auth-password", routes: ["/login"], apiPatterns: ["/api/v1/auth/login"] },
  { featureId: "account-registration", routes: ["/register"], apiPatterns: ["/api/v1/auth/register"] },
  {
    featureId: "student-workspace",
    routes: ["/student"],
    apiPatterns: ["/api/v1/me/courses", "/api/v1/mastery/courses/:courseId", "/api/v1/study-plan/current"],
  },
  {
    featureId: "course-lessons",
    routes: ["/learn", "/learn/:courseId", "/learn/:courseId/lessons/:lessonId"],
    apiPatterns: [
      "/api/v1/me/courses",
      "/api/v1/courses/:courseId/lessons",
      "/api/v1/targets/COURSE/:courseId/quizzes",
      "/api/v1/lessons/:lessonId",
      "/api/v1/lessons/:lessonId/completion",
      "/api/v1/courses/:courseId/progress",
    ],
  },
  {
    featureId: "mastery-v2",
    routes: ["/student/mastery", "/progress"],
    apiPatterns: ["/api/v1/mastery/courses/:courseId"],
  },
  {
    featureId: "study-plan-v2",
    routes: ["/student/study-plan"],
    apiPatterns: [
      "/api/v1/study-plan/current",
      "/api/v1/study-plan/generate",
      "/api/v1/study-plan/items/:itemId/:action",
    ],
  },
  { featureId: "ai-tutor-v2", routes: ["/student/tutor"], apiPatterns: ["/api/v1/assistant/chat"] },
  {
    featureId: "assessments",
    routes: ["/assessments", "/assessments/:quizId", "/assessments/:quizId/attempt/:attemptId", "/assessments/:quizId/result/:resultId"],
      apiPatterns: [
      "/api/v1/me/courses",
      "/api/v1/classes",
      "/api/v1/targets/COURSE/:targetId/quizzes",
      "/api/v1/targets/CLASS/:targetId/quizzes",
      "/api/v1/quizzes/:quizId",
      "/api/v1/quizzes/:quizId/attempts",
      "/api/v1/attempts/:attemptId",
      "/api/v1/attempts/:attemptId/result",
      "/api/v1/attempts/:attemptId/submit",
    ],
  },
  {
    featureId: "notifications",
    routes: ["/notifications"],
    apiPatterns: ["/api/v1/notifications", "/api/v1/notifications/:notificationId/read"],
  },
  {
    featureId: "account-settings",
    routes: ["/account", "/settings"],
    apiPatterns: ["/api/v1/me/avatar", "/api/v1/me/password"],
  },
  {
    featureId: "public-course-catalog",
    routes: ["/courses", "/courses/:courseId"],
    apiPatterns: [
      "/api/v1/courses",
      "/api/v1/courses/search",
      "/api/v1/courses/:courseId",
      "/api/v1/courses/:courseId/offerings",
      "/api/v1/courses/:courseId/reviews",
      "/api/v1/courses/:courseId/enrollments",
      "/api/v1/reviews/:reviewId",
    ],
  },
  {
    featureId: "student-classroom-schedule",
    routes: ["/classes", "/classes/:classId", "/classes/:classId/sessions/:sessionId"],
    apiPatterns: [
      "/api/v1/me/classes",
      "/api/v1/me/schedule",
      "/api/v1/me/attendance",
      "/api/v1/classes/:classId",
      "/api/v1/classes/:classId/sessions",
      "/api/v1/class-sessions/:sessionId",
    ],
  },
];

graph.routeMappings = routeMappings;
graph.sharedApiDependencies = [
  "/api/v1/me",
  "/api/v1/auth/refresh",
  "/api/v1/auth/logout",
];
graph.sharedApiDependencies = [...new Set([...graph.sharedApiDependencies, ...sharedApiDependencies])].sort();

function apiPatternRegex(pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escaped.replace(/:[A-Za-z0-9_]+/gu, "[^/]+")}/?$`, "u");
}
const routeMappingIssues = [];
const mappedApiPatterns = [
  ...graph.sharedApiDependencies,
  ...routeMappings.flatMap((mapping) => mapping.apiPatterns),
];
for (const feature of graph.features.filter((item) => item.status.startsWith("SHIP"))) {
  const mapping = routeMappings.find((item) => item.featureId === feature.id);
  if (!mapping) {
    routeMappingIssues.push(`SHIP_FEATURE_WITHOUT_ROUTE_MAPPING:${feature.id}`);
    continue;
  }
  const mappedRoutes = inventory.filter((entry) =>
    mapping.routes.some((pattern) => routePatternRegex(pattern).test(entry.route)),
  );
  if (mappedRoutes.length === 0) routeMappingIssues.push(`FEATURE_ROUTE_NOT_FOUND:${feature.id}`);
  for (const pattern of mapping.apiPatterns) {
    const observed = graph.sharedApiDependencies.some((apiPath) => apiPatternRegex(pattern).test(apiPath)) ||
      mappedRoutes.some((entry) => entry.apiDependencies.some((apiPath) => apiPatternRegex(pattern).test(apiPath)));
    if (!observed) routeMappingIssues.push(`FEATURE_API_NOT_OBSERVED:${feature.id}:${pattern}`);
  }
}
for (const route of inventory.filter((entry) => entry.decision === "CONNECT")) {
  const matchingMappings = routeMappings.filter((mapping) =>
    mapping.routes.some((pattern) => routePatternRegex(pattern).test(route.route)),
  );
  if (matchingMappings.length === 0) routeMappingIssues.push(`CONNECT_ROUTE_UNMAPPED:${route.route}`);
  if (route.fixtureUsage || route.mockUsage) routeMappingIssues.push(`CONNECT_ROUTE_HAS_BUSINESS_FIXTURE:${route.route}`);
  if (route.unresolvedImports.length > 0) routeMappingIssues.push(`CONNECT_ROUTE_HAS_UNRESOLVED_IMPORT:${route.route}`);
  for (const apiPath of route.apiDependencies) {
    if (!mappedApiPatterns.some((pattern) => apiPatternRegex(pattern).test(apiPath)))
      routeMappingIssues.push(`ROUTE_API_NOT_IN_RUNTIME_GRAPH:${route.route}:${apiPath}`);
  }
}
const apiRouteRefs = new Map();
for (const route of inventory.filter((entry) => entry.decision === "CONNECT")) {
  for (const apiPath of route.apiDependencies) {
    if (!apiRouteRefs.has(apiPath)) apiRouteRefs.set(apiPath, new Set());
    apiRouteRefs.get(apiPath).add(route.route);
  }
}
graph.apiInventory = [...apiRouteRefs]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([apiPath, routes]) => ({ apiPath, routes: [...routes].sort() }));
graph.routeDependencySnapshot = inventory
  .filter((entry) => entry.decision === "CONNECT")
  .map((entry) => ({ route: entry.route, apiDependencies: entry.apiDependencies }));
graph.inventoryConsistency = {
  status: routeMappingIssues.length === 0 ? "PASS" : "FAIL",
  checkedConnectRoutes: inventory.filter((entry) => entry.decision === "CONNECT").length,
  checkedShipFeatures: graph.features.filter((feature) => feature.status.startsWith("SHIP")).length,
  violations: routeMappingIssues,
};
if (routeMappingIssues.length > 0) {
  process.stderr.write(`${JSON.stringify({ stage: "phase41-route-graph-consistency", status: "FAIL", violations: routeMappingIssues }, null, 2)}\n`);
  process.exitCode = 1;
}

const policy = {
  schemaVersion: 1,
  status: "SQLCIPHER_CACHE_AND_PERSISTENT_COMPLETION_QUEUE_IMPLEMENTED",
  localDatabase: {
    engine: "expo-sqlite with SQLCipher",
    schemaVersion: 1,
    migrations: [1],
    cacheRetentionDays: 30,
    encryption: "SQLCipher key is generated randomly and stored in device-only SecureStore; key is applied before any database read",
    sensitiveColumns: "No passwords, access tokens, refresh tokens, session secrets, assessment answers or lesson bodies",
  },
  conflictRules: {
    mastery: "Server projection always wins; never calculate locally",
    studyPlan: "Server wins; reload on 409 before showing updated plan",
    lessonCompletion: "Queueing is PENDING_SYNC only; server acknowledgement is required before authoritative completion",
    assessmentSubmission: "ONLINE_ONLY; server attempt/version and idempotency rules win",
  },
  datasets: [
    {
      name: "published course metadata",
      classification: "CACHEABLE_READ",
      currentState: "Cached per authenticated user after successful /me/courses response",
      requirement: "Authoritative Learning Service entitlement is checked before cache population",
    },
    {
      name: "published lesson content and approved media references",
      classification: "ONLINE_ONLY",
      currentState: "Never persisted in local database",
      requirement: "Content remains online-only until an appropriate authorization-aware secure content design exists",
    },
    {
      name: "last-synced Study Plan",
      classification: "CACHEABLE_READ",
      currentState: "Cached per authenticated user and course after successful live response",
      requirement: "Display LIVE or OFFLINE_CACHE and LAST_SYNCED; successful live response always wins",
    },
    {
      name: "last-synced Mastery",
      classification: "CACHEABLE_READ",
      currentState: "Cached per authenticated user and course after successful live response",
      requirement: "Display LAST_SYNCED; never recalculate from offline activity",
    },
    {
      name: "notification metadata",
      classification: "CACHEABLE_READ",
      currentState: "No offline cache",
      requirement: "Avoid private lesson/assessment details in lock-screen payload",
    },
    {
      name: "lesson completion operation",
      classification: "QUEUEABLE_WRITE",
      currentState: "Persisted in SQLCipher; retry on reconnect with the same idempotency key",
      requiredFields: ["operationId", "resourceId", "idempotencyKey", "createdAt", "attemptCount", "state"],
      syncStates: ["PENDING", "SYNCING", "SYNCED", "FAILED_RETRYABLE", "FAILED_FINAL", "CONFLICT"],
      conflictPolicy: "Server completion/version wins; re-read progress before retry",
    },
    {
      name: "assessment answers and final submission",
      classification: "ONLINE_ONLY",
      currentState: "No offline persistence",
    },
    {
      name: "refresh credential and session secret",
      classification: "SECURE_STORAGE_ONLY",
      currentState: "Device-only Keychain/Android Keystore SecureStore; never copied into SQLCipher or logs",
    },
    {
      name: "access token",
      classification: "MEMORY_ONLY",
      currentState: "Process memory only; not persisted",
    },
    {
      name: "password",
      classification: "NEVER_PERSIST",
      currentState: "Used only for the login request; never written to storage, logs or analytics",
    },
    {
      name: "plaintext credentials and session secrets",
      classification: "NEVER_PERSIST_PLAINTEXT",
      currentState: "Never written to AsyncStorage, ordinary SQLite, logs, analytics, URL parameters or clipboard",
    },
    {
      name: "final grading, payment, credential issuance and security administration",
      classification: "ONLINE_ONLY",
      currentState: "Never queued from mobile",
    },
  ],
};

await mkdir(out, { recursive: true });
await writeFile(
  path.join(out, "phase41-mobile-feature-inventory.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      sourceRoots: ["app", "src"],
      routeCount: inventory.length,
      summary: {
        connect: inventory.filter((x) => x.decision === "CONNECT").length,
        refactor: inventory.filter((x) => x.decision === "REFACTOR").length,
        defer: inventory.filter((x) => x.decision === "DEFER").length,
        remove: inventory.filter((x) => x.decision === "REMOVE").length,
      },
      routes: inventory,
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  path.join(out, "phase41-mobile-runtime-feature-graph.json"),
  JSON.stringify(graph, null, 2) + "\n",
);
await writeFile(path.join(out, "mobile-offline-data-policy.json"), JSON.stringify(policy, null, 2) + "\n");
process.stdout.write(
  JSON.stringify({
    status: routeMappingIssues.length === 0 ? "PASS" : "FAIL",
    routeCount: inventory.length,
    connectRouteFixtureCount: inventory.filter((x) => x.decision === "CONNECT" && (x.fixtureUsage || x.mockUsage)).length,
    consistency: graph.inventoryConsistency.status,
    violations: routeMappingIssues,
    summary: {
      connect: inventory.filter((x) => x.decision === "CONNECT").length,
      refactor: inventory.filter((x) => x.decision === "REFACTOR").length,
      defer: inventory.filter((x) => x.decision === "DEFER").length,
    },
  }) + "\n",
);

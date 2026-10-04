import { z } from "zod";
const uuid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const page = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(16384).optional(),
  })
  .strict();
const userPage = z
  .object({
    role: z.enum(["STUDENT", "LECTURER", "ADMIN"]),
    status: z.enum(["ACTIVE", "SUSPENDED"]),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(16).max(16384).optional(),
    q: z.string().trim().min(1).max(320).optional(),
  })
  .strict();
const statusChange = z
  .object({
    status: z.enum(["ACTIVE", "SUSPENDED"]),
    currentPassword: z.string().min(1).max(128),
    reason: z.string().min(1).max(200).optional(),
  })
  .strict();
const courseAction = z.object({ currentPassword: z.string().min(1).max(1024) }).strict();
const keyOf = (headers) =>
  z
    .string()
    .regex(/^[!-~]{1,200}$/)
    .parse(headers["idempotency-key"]);
const moderate = z
  .object({
    action: z.enum(["HIDE", "RESTORE", "DISMISS", "WARN"]),
    reason: z.string().min(1).max(1000),
    currentPassword: z.string().min(1).max(128),
  })
  .strict();
export function adminOperation(url, method, body, headers) {
  if (!url.startsWith("/web-session/admin/")) return null;
  const raw = url.slice("/web-session/admin".length),
    [path, query = ""] = raw.split("?");
  if (raw.includes("#") || /[%\\]/.test(path)) throw Error("INVALID_ADMIN_REQUEST");
  if (method === "POST" && path === "/assistant/chat" && !query) {
    z.object({
      conversationId: z.string().uuid().optional(),
      mode: z.literal("ADMIN_SUPPORT"),
      message: z.string().trim().min(1).max(4000),
    })
      .strict()
      .parse(body);
    return { path: "/assistant/chat", headers: {} };
  }
  if (method === "GET" && path === "/assistant/conversations" && !query) {
    return { path: "/assistant/conversations", headers: {} };
  }
  if (method === "GET" && path === "/assistant/admin-status" && !query) {
    return { path: "/assistant/admin-status", headers: {} };
  }
  const assistantConversation = new RegExp(`^/assistant/conversations/(${uuid})$`).exec(path);
  if (method === "GET" && assistantConversation && !query) {
    return { path: `/assistant/conversations/${assistantConversation[1]}`, headers: {} };
  }
  if (method === "GET" && path === "/users") {
    const params = new URLSearchParams(query),
      values = {};
    for (const [k, v] of params) {
      if (k in values) throw Error("INVALID_ADMIN_REQUEST");
      values[k] = v;
    }
    userPage.parse(values);
    return { path: "/admin/users?" + params.toString(), headers: {} };
  }
  const user = new RegExp(`^/users/(${uuid})$`).exec(path);
  if (method === "GET" && user && !query) return { path: `/admin/users/${user[1]}`, headers: {} };
  const status = new RegExp(`^/users/(${uuid})/status$`).exec(path);
  if (method === "PATCH" && status && !query) {
    statusChange.parse(body);
    return { path: `/admin/users/${status[1]}/status`, headers: {}, key: keyOf(headers) };
  }
  const course = new RegExp(`^/courses/(${uuid})/(publish|archive)$`).exec(path);
  if (method === "POST" && course && !query) {
    courseAction.parse(body);
    return { path: `/admin/courses/${course[1]}/${course[2]}`, headers: {}, key: keyOf(headers) };
  }
  if (method === "GET" && path === "/interaction-reports") {
    const values = Object.fromEntries(new URLSearchParams(query));
    if ([...new URLSearchParams(query).keys()].length !== Object.keys(values).length)
      throw Error("INVALID_ADMIN_REQUEST");
    page.parse(values);
    return { path: "/admin/reports" + (query ? `?${new URLSearchParams(query)}` : ""), headers: {} };
  }
  // --- Dashboard data routes ---
  if (method === "GET" && path === "/dashboard/operations") {
    const params = new URLSearchParams(query);
    const values = {};
    for (const [key, value] of params) {
      if (key in values) throw Error("INVALID_ADMIN_REQUEST");
      values[key] = value;
    }
    const parsed = z
      .object({ range: z.enum(["7d", "30d", "90d", "365d"]).default("30d") })
      .strict()
      .parse(values);
    return { path: `/admin/dashboard/operations?range=${parsed.range}`, headers: {} };
  }
  if (method === "GET" && path === "/monitoring" && !query) {
    return { path: "/admin/monitoring", headers: {} };
  }
  if (method === "GET" && path === "/dashboard/revenue") {
    const params = new URLSearchParams(query);
    const range = params.get("range") ?? "30d";
    if (!["today", "7d", "30d", "all"].includes(range)) throw Error("INVALID_ADMIN_REQUEST");
    return { path: `/admin/dashboard/revenue?range=${encodeURIComponent(range)}`, headers: {} };
  }
  if (method === "GET" && path === "/payouts" && !query) {
    return { path: "/admin/payouts", headers: {} };
  }
  if (method === "GET" && path === "/commission" && !query) {
    return { path: "/admin/commission", headers: {} };
  }
  if (method === "POST" && path === "/commission" && !query) {
    z.object({ basisPoints: z.number().int().min(0).max(5000), expectedEffectiveAt: z.string().datetime() })
      .strict()
      .parse(body);
    return { path: "/admin/commission", headers: {}, key: keyOf(headers) };
  }
  if (method === "POST" && path === "/payouts/prepare" && !query) {
    z.object({ lecturerId: z.string().uuid().optional() }).strict().parse(body);
    return { path: "/admin/payouts/prepare", headers: {}, key: keyOf(headers) };
  }
  const payoutApproval = new RegExp(`^/payouts/(\\d{4}-(?:0[1-9]|1[0-2]))/(${uuid})/approve$`).exec(path);
  if (method === "POST" && payoutApproval && !query) {
    z.object({}).strict().parse(body);
    return {
      path: `/admin/payouts/${payoutApproval[1]}/${payoutApproval[2]}/approve`,
      headers: {},
      key: keyOf(headers),
    };
  }
  if (method === "GET" && path === "/dashboard/stats" && !query) {
    return { path: "/admin/dashboard/stats", headers: {} };
  }
  if (method === "GET" && path === "/audit-logs") {
    const params = new URLSearchParams(query);
    const allowed = ["category", "search", "limit", "cursor"];
    for (const k of params.keys()) {
      if (!allowed.includes(k)) throw Error("INVALID_ADMIN_REQUEST");
    }
    page.parse(Object.fromEntries([...params.entries()].filter(([k]) => ["limit", "cursor"].includes(k))));
    return { path: "/admin/audit-logs" + (query ? `?${params.toString()}` : ""), headers: {} };
  }
  // --- Export routes ---
  if (method === "GET" && path === "/export/revenue") {
    const params = new URLSearchParams(query);
    const range = params.get("range") ?? "30d";
    if (!["today", "7d", "30d", "all"].includes(range)) throw Error("INVALID_ADMIN_REQUEST");
    return { path: `/admin/export/revenue?range=${encodeURIComponent(range)}`, headers: {}, export: true };
  }
  if (method === "GET" && path === "/export/audit-logs") {
    const params = new URLSearchParams(query);
    const category = params.get("category");
    if (category && !["COMMERCE", "AUTH", "MODERATION", "ADMIN"].includes(category))
      throw Error("INVALID_ADMIN_REQUEST");
    return {
      path: `/admin/export/audit-logs` + (query ? `?${params.toString()}` : ""),
      headers: {},
      export: true,
    };
  }
  const match = new RegExp(`^/interaction-reports/(${uuid})/moderate$`).exec(path);
  if (method !== "POST" || !match) throw Error("INVALID_ADMIN_REQUEST");
  moderate.parse(body);
  const key = keyOf(headers);
  const ifMatch = z
    .string()
    .regex(/^"v[1-9][0-9]{0,9}"$/)
    .parse(headers["if-match"]);
  return { path: `/admin/reports/${match[1]}/moderate`, headers: { "If-Match": ifMatch }, key };
}

export function adminEnvelope(value) {
  return {
    data: value.data ?? null,
    meta: {
      ...(value.meta?.page ? { page: value.meta.page } : {}),
      ...(value.meta?.pagination ? { pagination: value.meta.pagination } : {}),
      ...(typeof value.meta?.replayed === "boolean" ? { replayed: value.meta.replayed } : {}),
    },
  };
}

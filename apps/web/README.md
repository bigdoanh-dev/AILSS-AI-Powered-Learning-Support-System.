# AILSS Web — Phase 12.2

React + Vite + TypeScript in the existing pnpm workspace. No authenticated dashboard is implemented.

## Run from repository root

```sh
pnpm install --frozen-lockfile
pnpm dev:web
pnpm typecheck:web
pnpm lint:web
pnpm test:web
pnpm build:web
pnpm --filter @ailss/web preview
```

Dev: `http://127.0.0.1:5173`. Production preview: `http://127.0.0.1:4174`.

`AILSS_GATEWAY_URL` defaults to `http://127.0.0.1:8080`, matching the repository gateway. Both servers forward `/api/*` without changing backend paths or request/response contracts. The Node host and Vite development middleware share the narrow session adapter; it is Web infrastructure, not a new business service.

Set `AILSS_PUBLIC_ORIGIN` to the actual deployment origin **at build time** to generate absolute canonical URLs, Open Graph URLs and the sitemap. Without an origin the build emits relative canonical metadata and an empty sitemap instead of inventing a production domain. `PORT` configures the preview port; its bind address is intentionally loopback.

## Hosting

`dist` includes 28 route directories, `404.html`, and a non-prerendered `course-shell.html` for live `/courses/:id` data. Use the included `scripts/serve.mjs` for correct local production behavior. A generic SPA fallback that serves the Home HTML for all paths causes hydration mismatch and must not be used.

For an external static host/reverse proxy:

- Serve `/<route>/index.html` for each public route, preserving the URL and React route.
- Serve `course-shell.html` only for supported `/courses/:id` paths; public Course API resolves visibility/404.
- Serve `404.html` with HTTP 404 for unknown routes.
- Proxy `/api/*` to the existing gateway before static routing; retain headers, methods, JSON, status codes and request bodies.
- Serve WebM byte ranges and correct MIME types; use gzip/Brotli for text and immutable caching only for hashed assets.
- Supply HTTPS through the deployment's existing trusted ingress. Do not place service secrets in `VITE_*` variables.
- The preview adds CSP, nosniff, referrer policy and restricted camera/microphone/geolocation. Mirror these headers at the production ingress.

## Contract boundaries

- Courses use `LRN-02 GET /api/v1/courses/search?q=...&limit=12&cursor=...` and `LRN-03 GET /api/v1/courses/:id`.
- Search matches the backend's leading normalized token/prefix behavior. There is no fabricated full-text search, category registry, rating, lecturer name or course image field.
- Public catalog by category requires a real category UUID; no invented taxonomy UI is added.
- Course art is explicitly generic illustration. Production never seeds courses. API fixtures exist only in tests.
- Registration uses `IDN-01` with email/password/displayName and a stable idempotency key for retries until fields change. Login uses `IDN-02`; logout uses `IDN-04`.
- Authentication uses `/web-session/*` on the same origin. Identity access/refresh tokens remain in the Web server memory; only a random HttpOnly session handle is sent to the browser. `/app` and `/app/account` load canonical `/me` data. Password change uses IDN-07 and requires sign-in again.
- No forgot-password or contact submission endpoint was found. Recovery guidance is truthful; Contact downloads a local draft and never reports that it sent a message.

## Visual and media system

Semantic CSS variables in `src/styles.css`; components in `src/components`; page content in `src/pages`. English identifiers and Vietnamese UI copy. System typography avoids external font requests and supports Vietnamese.

Original SVG brand files: `public/assets/brand`. Optimized media and attribution: `public/assets/media`. Regenerable source rasters are in `assets/source`, outside the deployed public directory. `pnpm --filter @ailss/web assets` regenerates exports with Sharp; `pnpm --filter @ailss/web video` regenerates the silent 18-second VP9 workflow using installed Chrome and MediaRecorder.

Three.js is imported only after an eligible desktop hero intersects the viewport. DPR capped at 1.5; one low-detail mesh and one ring, unlit materials; no textures or expensive postprocessing. Render pauses offscreen/hidden/reduced motion; geometry/materials/renderer dispose on teardown. Poster and HTML workflow labels remain available. Mobile and reduced motion skip the import entirely.

## Verification

```sh
cd apps/web
AILSS_QA_URL=http://127.0.0.1:4174 node scripts/verify-browser.mjs
AILSS_QA_URL=http://127.0.0.1:4174 node scripts/audit.mjs
```

These scripts use an isolated headless Chrome session, not the user's profile. Browser fixtures intercept requests locally and never create real accounts/courses. Evidence is written to `docs/evidence/p12.1`. See the phase report for exact executed checks, visual findings, local metrics and remaining limitations.

## Phase 12.2 session deployment

Use the Node runtime for authenticated routes. A static-only host cannot provide this session architecture. Keep the current single process; its bounded in-memory store holds at most 1,000 sessions until their absolute Identity refresh expiry. Restarting it signs browsers out of the Web host, without claiming Identity revocation. No Redis or business data is introduced. Multi-instance shared sessions, durable persistence and rolling session continuity are outside this implementation; do not scale this process horizontally without a separate deployment design.

Set `NODE_ENV=production` and `AILSS_WEB_ORIGIN` to the exact external HTTPS origin. The server refuses production HTTP origins. Use the trusted TLS ingress to forward the original Host and Origin to the loopback Node port. The adapter does not trust `X-Forwarded-Host` to derive security policy. Development origin is `http://127.0.0.1:5173` (strict port); preview is `http://127.0.0.1:4174`. Use the configured hostname consistently.

Cookies: production `__Host-ailss`, HttpOnly, Secure, SameSite=Lax, Path=/, no Domain; local HTTP `ailss` omits Secure. Cookie contains an opaque random handle, never a refresh token. It is replaced at login and cleared after confirmed logout or session invalidation. Refresh credentials rotate only in server memory; keeping the opaque handle stable avoids concurrent Set-Cookie rollback. State-changing adapter calls require an exact Origin and expected Host plus application/json; cross-site fetch metadata is rejected. All adapter results have Cache-Control: no-store. No service worker caches auth.

Each session has one refresh flight. Concurrent expired requests join it, retry their original call once, and ignore results after the session is closed. A timeout or ambiguous infrastructure failure during refresh stops further rotation retries: the old credential may already have rotated, so the user must sign in again. Logout failure retains enough server state for a truthful retry and hides protected UI; it never reports confirmed revocation on an outage.

Serve the empty `app-shell.html` only for `/app` and `/app/account`; never prerender private profiles. Route guards are UX and do not replace Gateway/Identity authorization. Account supports only displayName updates and the exact currentPassword/newPassword contract. No dashboards or fabricated learning statistics.

```sh
cd apps/web
node scripts/verify-session.mjs
AILSS_QA_URL=http://127.0.0.1:4174 AILSS_QA_OUT=../../docs/evidence/p12.2/public-regression node scripts/verify-browser.mjs
```

The session suite starts an isolated mock Gateway on 4185 and Web host on 4184, exercising the real adapter with Chrome. This is not live Identity/Cassandra acceptance. Screenshots and results are written to `docs/evidence/p12.2`. Animations use native Web Animations/IntersectionObserver and CSS; scrolling remains native and reduced motion removes decorative transitions.

## P12.2A experience refinement

Auth uses a dedicated `AuthLayout` without the public header/footer. `/auth/register` is a role chooser; `/auth/register/student` retains the exact IDN-01 submission; `/auth/register/lecturer` is truthful onboarding guidance because the current registry has no lecturer signup/application/role-request API. IDN-12 verifies an existing ACTIVE LECTURER as ADMIN with current-password reauthentication; it does not create a lecturer or promote a STUDENT.

There are now 30 public prerender routes. Public Home copy leads with learning/teaching benefits. Architecture-specific implementation details remain on the architecture/research/security surfaces. Existing session adapter and backend contracts are unchanged.

`src/motion/scroll.ts` uses passive scroll events and requestAnimationFrame to smooth decorative position/velocity. It never writes the document scroll position. Desktop parallax is bounded; touch/mobile and reduced motion skip it. `Motion.tsx` implements text/mask/depth/stagger/line reveals, with visible HTML before JavaScript enhancement. View Transitions capture incoming/outgoing public route content when supported; unsupported/reduced-motion paths retain normal routing. Protected routes are excluded from old-page snapshots. Route chunks remain lazy. Rapid navigation ignores an obsolete pending chunk load.

The Home/AI Learning scroll story is HTML with a lightweight CSS perspective document stack. Three.js remains one simple mesh and ring; camera/pointer/scroll depth settles gradually. Auth background is optimized existing imagery with CSS geometry, a pause control and hidden/offscreen/reduced-motion pause. Video loads only on request, keeps captions/transcript/native controls, and pauses offscreen or hidden.

Run `node scripts/verify-premium.mjs` from `apps/web` for four-viewport public/auth/motion QA. Evidence goes to `docs/evidence/p12.2a`. Run session regression with `AILSS_SESSION_OUT=../../docs/evidence/p12.2a/session node scripts/verify-session.mjs`. Browser fixtures are not live backend acceptance. Do not start P12.3 until the user approves this experience.

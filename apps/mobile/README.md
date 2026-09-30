# AILSS Mobile — P14.1

Native foundation: Expo SDK 57, React Native 0.86.3, React 19.2.3, Expo Router,
SecureStore and TypeScript 6.0.3 (mobile-local). Node 24.20.0 / pnpm 11.19.0.
Versions follow the official Expo template and SDK bundledNativeModules manifest:
https://docs.expo.dev/versions/v57.0.0/ . Root backend TypeScript remains unchanged.

## Development

From repository root, run `pnpm install --frozen-lockfile`. Copy
`apps/mobile/.env.example` to `apps/mobile/.env.local` and explicitly set:

- `EXPO_PUBLIC_AILSS_ENV`: development, research, or production.
- `EXPO_PUBLIC_AILSS_API_BASE_URL`: the Gateway origin only, without a path.

Simulator examples (not defaults): iOS `http://127.0.0.1:8080`, Android emulator
`http://10.0.2.2:8080`. For a physical device, bind the Gateway's mobile port
`18080` to the host's trusted LAN IP and use `http://<host-LAN-IP>:18080`.
The default binding stays on loopback. Do not expose this development HTTP
Gateway publicly.

Production requires HTTPS and has no fabricated domain. Expo public variables
are bundled public configuration: NEVER put secrets there. Non-production HTTP
gets explicit native development network exceptions; production disables them.
Changing native configuration requires rebuilding the development client.
SQLCipher is unavailable in Expo Go. In that client the app runs online with
encrypted offline cache and lesson queue disabled. If a custom client reports
`SQLCIPHER_REQUIRED_FOR_OFFLINE_STORAGE`, rebuild and reinstall it with
`pnpm --filter @ailss/mobile ios` (or `android`); a Metro reload cannot change
the native SQLite library. The app never writes private offline data to plain SQLite.

Run `pnpm --filter @ailss/mobile start`, then launch an installed development
client. `pnpm --filter @ailss/mobile ios` / `android` build and launch local debug
clients when full native toolchains exist. SDK 57 requires Xcode 26.4+, an iOS
simulator runtime, or Android SDK API 36, Java and an emulator/adb. No distribution
signing, EAS upload, App Store or Play publication is configured.

## Quality

Package scripts: `typecheck`, `lint`, `test`, `format:check`, `validate:config`,
`build:development`. The latter exports iOS/Android Hermes bundles; it is NOT
proof of native compilation or simulator launch. `expo install --check` verifies
SDK compatibility. Root lint/typecheck exclude mobile's separate native project.
Tests use Vitest for platform-neutral transport/session logic with injected
fetch/storage. OS-backed SecureStore still needs native device verification.

`test:integration` needs explicit `AILSS_MOBILE_TEST_ORIGIN` (HTTP loopback only),
`AILSS_MOBILE_TEST_EMAIL` and `AILSS_MOBILE_TEST_PASSWORD` supplied locally. It uses
the real dev Gateway, creates/revokes a login session and retains credentials only
in process memory. It does not seed/reset data or call live payment/AI providers.

## Boundaries and behavior

Only Gateway API operations are used: IDN-01/02/03/04/05, avatar IDN-18,
LRN-02 search, LRN-15 enrolled courses, LRN-28 owned offerings, CLS-05/06 classes,
notification list NOT-01, and lecturer media asset upload/status/attach (verify
identifiers against contracts/api-registry.json).
Student registration omits role/status; server chooses them. Direct Lecturer
onboarding remains available through the existing Web journey, not exposed here.
No client verification, Admin registration, service credentials or internal imports.

Access token is memory-only. SecureStore holds sessionId and refresh token,
scoped to Gateway/environment with device-only unlocked Keychain accessibility.
Restore and refresh are single-flight. Credential writes serialize with logout;
late login/refresh responses cannot revive a logged-out session. Startup waits
for restore. Foreground revalidates /me; server roles determine visible routes.
Transient restore failures preserve refresh material for retry; revoked/invalid
sessions clear it. Local logout clears memory/storage even if remote revocation
fails; failure is surfaced separately. Storage failures fail closed with retry.

Guest supports keyword search/login/Student registration. Students have the
learning flows described above. Lecturers can open a scoped native media workflow
from Home: choose an owned course and non-preview lesson, pick an MP4/WebM video,
upload resumable multipart chunks, watch server processing, then attach only a
READY asset. A user/Gateway-scoped SecureStore record lets the lecturer reselect
a video with matching name, size and type to resume after leaving or restarting
the app; only upload metadata is stored, and signed object-store URLs are never
persisted. The server enforces ownership, quota and file policy. Mobile also has
role-specific Student, Lecturer and Admin AI entry points; Lecturer revenue,
payout account and public profile editing; Admin commission and payout preparation;
and public course reviews and lecturer profiles. Payout preparation creates manual
transfer instructions, not a bank transfer. Lists show loading, empty, error and retry; first-page/current-month
scope is intentional.
Avatar is authenticated Gateway JSON containing a bounded validated image data
URI; never a direct MinIO URL. Sensitive server responses are not persisted.
Animations are disabled (also honors reduced motion), labels/touch targets/text
scaling are included. Accessibility has not been certified on native devices.

P13.2A RC is untouched. P13 target remains deferred; P13.2B is not started.

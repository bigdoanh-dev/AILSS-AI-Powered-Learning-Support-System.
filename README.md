# AILSS — AI-Powered Learning Support System

[![Node.js](https://img.shields.io/badge/Node.js-24.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=111827)](https://react.dev/)
[![Cassandra](https://img.shields.io/badge/Cassandra-5.0-1287b1?logo=apachecassandra&logoColor=white)](https://cassandra.apache.org/)
[![RabbitMQ](https://img.shields.io/badge/RabbitMQ-4.1-ff6600?logo=rabbitmq&logoColor=white)](https://www.rabbitmq.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

AILSS là nền tảng học tập đa nền tảng theo kiến trúc microservices, contract-first và event-driven. Hệ thống quản lý danh tính, khóa học, lớp học, tiến độ, đánh giá, tương tác, thông báo, thương mại và các quy trình AI có con người kiểm soát.

> Web responsive là bề mặt pilot chính. Repository có ứng dụng Expo/React Native cho Student, Lecturer và Admin; player media đã được kiểm chứng trên iOS Simulator và Android Emulator. Native production release và kiểm tra hỗ trợ tiếp cận trên thiết bị thật chưa được xác nhận.

> **Triết lý thiết kế:** Contract-First, Service Ownership, Query-Driven Cassandra, Event-Driven Processing và Human-in-the-loop AI.

---

## 📋 Mục lục

- [Tổng quan và mục tiêu](#tổng-quan-và-mục-tiêu)
- [Trạng thái hiện tại](#trạng-thái-hiện-tại)
- [Tính năng chính](#tính-năng-chính)
  - [1. Guest, Authentication và Account](#1-guest-authentication-và-account)
  - [2. Student Learning](#2-student-learning)
  - [3. Lecturer Teaching](#3-lecturer-teaching)
  - [4. Admin Governance](#4-admin-governance)
  - [5. Course và Offering](#5-course-và-offering)
  - [6. Classroom và Attendance](#6-classroom-và-attendance)
  - [7. Assessment và Quiz](#7-assessment-và-quiz)
  - [8. Interaction và Notification](#8-interaction-và-notification)
  - [9. Document và AI Quiz Generation](#9-document-và-ai-quiz-generation)
  - [10. Media và phát video](#10-media-và-phát-video)
- [Kiến trúc hệ thống](#kiến-trúc-hệ-thống)
  - [Sơ đồ tổng quan](#sơ-đồ-tổng-quan)
  - [Service Ownership](#service-ownership)
- [Công nghệ sử dụng](#công-nghệ-sử-dụng)
- [Thiết kế và nguyên tắc vận hành](#thiết-kế-và-nguyên-tắc-vận-hành)
  - [Cassandra Design](#cassandra-design)
  - [Event-Driven và Recovery](#event-driven-và-recovery)
  - [Security và Privacy](#security-và-privacy)
  - [Web UX, Accessibility và Motion](#web-ux-accessibility-và-motion)
- [Cài đặt và chạy dự án](#cài-đặt-và-chạy-dự-án)
  - [Yêu cầu môi trường](#yêu-cầu-môi-trường)
  - [Chạy nhanh](#chạy-nhanh)
  - [Development profiles](#development-profiles)
  - [Kiểm tra chất lượng](#kiểm-tra-chất-lượng)
- [Cấu trúc repository](#cấu-trúc-repository)
- [Quy tắc phát triển](#quy-tắc-phát-triển)
- [Trạng thái phát triển](#trạng-thái-phát-triển)
- [Phạm vi và giới hạn của AI](#phạm-vi-và-giới-hạn-của-ai)
- [Giới hạn hiện tại](#giới-hạn-hiện-tại)
- [Tác giả, bản quyền và giấy phép](#tác-giả-bản-quyền-và-giấy-phép)

---

## Tổng quan và mục tiêu

AILSS được xây dựng để nghiên cứu và triển khai một hệ thống học tập phân tán có thể:

- quản lý vòng đời tài khoản Student, Lecturer và Admin;
- hỗ trợ tenant/institution, external authentication và identity federation;
- xây dựng, duyệt và phân phối Course qua Offering;
- quản lý Class, lịch học, session và attendance;
- theo dõi Lesson completion và Learning progress;
- tổ chức Quiz, Attempt, chấm điểm objective và trả kết quả an toàn;
- hỗ trợ Comment, Review, Report, Moderation và Notification;
- xử lý tài liệu riêng tư và sinh AI draft có Lecturer review;
- cung cấp Study Plan, Mastery V2 và AI Tutor theo feature flag của tenant;
- theo dõi doanh thu, payment projection, refund bền vững và product analytics;
- vận hành nhất quán trên Cassandra, RabbitMQ và MinIO;
- cung cấp trải nghiệm Web responsive và mobile, có accessibility/reduced-motion controls.

## Trạng thái hiện tại

- 4 actor: `GUEST`, `STUDENT`, `LECTURER`, `ADMIN`.
- Phiên bản trong `package.json`: `6.1.4`; baseline release candidate hiện có là `v6.2.0-rc.7`, chưa phải bản phát hành 6.2 ổn định.
- 6 business services: Identity, Learning, Classroom, Assessment, Interaction và AI; API Gateway là public entry point. Media Delivery và Media Worker là hai runtime riêng cho luồng video.
- API, Query ID và Event Type được quản lý trong các registry tại `contracts/`.
- Cassandra 5 lưu dữ liệu theo domain, RabbitMQ xử lý sự kiện bất đồng bộ và MinIO lưu tài liệu cùng media ở chế độ private.
- Redis không được sử dụng.
- Web có workspace theo vai trò; mobile dùng Expo Router và SecureStore cho dữ liệu phiên nhạy cảm, kèm player HLS native đã kiểm chứng trên simulator/emulator.
- Phase 42 Revision B đạt `OPEN_REVISION_B_LOCAL_PLATFORM_COMPLETE`; Revision C đang mở để chuẩn bị cấu hình và hạ tầng staging/production. Template, policy và validator hiện có chưa phải bằng chứng đã triển khai môi trường thật.
- Các acceptance gate còn thiếu của Phase 40 Revision H vẫn mở; controlled product pilot đang `REVOKED` cho đến khi được nghiệm thu lại.

## Tính năng chính

### 1. Guest, Authentication và Account

- Trang giới thiệu, khám phá khóa học, AI learning, trợ giúp, liên hệ và pháp lý.
- Đăng ký tạo tài khoản `STUDENT / ACTIVE`; không có role picker để tự tạo Lecturer.
- Đăng nhập, refresh, logout, hồ sơ và đổi mật khẩu qua cookie phiên HttpOnly cùng origin.
- External authentication/federation có runtime repository, tenant policy và các migration riêng; rollout vẫn phụ thuộc cấu hình và acceptance theo môi trường.
- Student muốn trở thành Lecturer phải nộp đơn, được Admin phê duyệt, đăng nhập lại, rồi được Admin xác minh riêng.

### 2. Student Learning

- Khóa học miễn phí và luồng mua mô phỏng cho Offering trả phí.
- Entitlement bất đồng bộ, bài học, hoàn thành bài và tiến độ.
- Tham gia Class, xem lịch, session, announcement và attendance của chính mình.
- Quiz/Attempt có thao tác bắt đầu và nộp bài rõ ràng; đáp án đúng không lộ trước policy.
- Comment, reply một cấp, review, report và notification với cursor opaque.
- Study Plan, mastery projection và AI Tutor đã có đường runtime từ assessment evidence; các nguồn evidence khác và full-stack acceptance chưa hoàn tất.

### 3. Lecturer Teaching

- Soạn Course/Lesson và gửi Course cho Admin duyệt; Lecturer không tự publish Course.
- Tạo và publish Offering cho Course phù hợp.
- Quản lý Class thuộc sở hữu, roster, lịch, session, announcement và attendance thủ công.
- Tạo Quiz với bốn loại câu hỏi và xem kết quả theo contract.
- Upload tài liệu, chạy extraction/generation, review AI draft và import thành Assessment Quiz `DRAFT`. AI không tự approve hoặc publish.

### 4. Admin Governance

- Tra cứu user, xem chi tiết, đổi trạng thái tài khoản với current-password reauthentication.
- Xử lý đơn và xác minh Lecturer.
- Publish/archive Course bằng UUID trực tiếp.
- Xử lý report và moderation theo version/idempotency.
- Dashboard thống kê, doanh thu, audit log và export; observability stack có Prometheus, Alertmanager và Grafana.
- Không có vai trò `MODERATOR` riêng và chưa có Admin Course review queue.

### 5. Course và Offering

- Course và Offering là hai aggregate riêng; một Course có thể có nhiều Offering.
- Offering hỗ trợ `SELF_PACED` và `LIVE_COHORT` với lifecycle `DRAFT → PUBLISHED → CLOSED`.
- Course publication thuộc quyền Admin; Offering authoring/publishing tuân theo owner và trạng thái Course.
- Free enrollment giữ legacy default-Offering behavior; paid access dùng Order và payment simulation.
- Entitlement hội tụ qua at-least-once event delivery, idempotency và reconciliation.
- Finance runtime có projection/backfill, durable refund và recovery cho SePay; thanh toán thương mại production vẫn fail-closed.

### 6. Classroom và Attendance

- Class hỗ trợ `LIVE_COHORT`, `PRIVATE` và `INSTITUTIONAL`.
- Student tham gia bằng canonical join code và chỉ xem tài nguyên được phép.
- Lecturer quản lý roster, schedule, session, meeting rule và announcement của Class thuộc sở hữu.
- Attendance online được bảo vệ bởi presence rule; attendance offline/manual dùng version và idempotency.

### 7. Assessment và Quiz

- Quiz có `DRAFT`, version, bốn loại câu hỏi và thao tác publish riêng.
- Xem Quiz detail không tự tạo Attempt; Student phải gọi start/resume rõ ràng.
- Attempt submit idempotent và chấm điểm phía server.
- Correct answer không xuất hiện trong Student projection trước policy cho phép.

### 8. Interaction và Notification

- Comment Course/Class, reply một cấp, edit theo version và soft delete.
- Review yêu cầu eligibility và hỗ trợ create/update/delete.
- Report queue và moderation dùng current-password reauthentication, `If-Match` và `Idempotency-Key`.
- Notification phân trang theo tháng, cursor và locator opaque; không có fake global unread total.

### 9. Document và AI Quiz Generation

```text
Upload intent → Direct private upload → Confirm → Extraction
→ AI generation → AI_DRAFT → Lecturer review
→ Human approval → Assessment Quiz DRAFT → Optional publish
```

- Binary tài liệu không lưu trong Cassandra.
- Document Worker kiểm tra checksum, kích thước, MIME/magic bytes và giới hạn giải nén/parser.
- AI output được validate theo schema trước khi tạo draft.
- `QUIZ_GENERATION` không dùng trạng thái `COMPLETED`; AI không tự approve hoặc publish.

### 10. Media và phát video

- Lecturer tải media lên private object storage; hệ thống áp dụng quota, xác thực nguồn và tách quyền cho API, worker và delivery.
- Media Worker kiểm tra đầu vào và tạo HLS ở các mức 360p, 480p và 720p; job, output journal và phục hồi được theo dõi bền vững.
- Student phát nội dung theo quyền ghi danh qua playback token giới hạn theo asset; video trailer được mở công khai theo policy của Course.
- Phụ đề WebVTT, poster và các segment HLS được phân phối qua Media Delivery từ MinIO private; thay video đã xuất bản dùng chuyển đổi nguyên tử.
- Revision B có acceptance cục bộ cho upload, quota, transcode, playback, phụ đề, cô lập tenant và tải giới hạn. Kết quả cục bộ không xác nhận cloud staging hay production.

---

## Kiến trúc hệ thống

### Sơ đồ tổng quan

```text
Browser → React Web → same-origin adapter ─┐  cookie HttpOnly
                                             ├→ API Gateway :8080
Expo app → API client + SecureStore ──────┘  bearer/refresh
                                                │
                         auth • rate limit • security headers
                         Actor Context • routing • metrics
                                                │
       ┌───────────────────────┼───────────────────────┐
       ▼                       ▼                       ▼
Identity :8101            Learning :8102            Classroom :8103
users/session/tenant      course/commerce/mastery   class/schedule/presence
       ▼                       ▼                       ▼
Assessment :8104          Interaction :8105         AI :8106
quiz/attempt/grading      comment/review/moderation document/quiz/assistant
                         Media Delivery :8211
                         private HLS/poster/captions
       └───────────────────────┴───────────────────────┘
              Internal HTTP • Service JWS • signed Actor Context
                                                │
       ┌───────────────────────┼───────────────────────┐
       ▼                       ▼                       ▼
Cassandra 5              RabbitMQ 4.1              Private MinIO
keyspace per service     exchange/retry/DLQ        document/media objects
                               │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
    Domain relays    Async workers    Reconciliation worker
    outbox+confirm   AI/Document/     repair interrupted work
                     Notification/Audit/Media

All runtimes → structured logs + Prometheus metrics → Alertmanager / Grafana
```

Kiến trúc có ba đường giao tiếp chính:

| Đường giao tiếp           | Cơ chế                                                                                | Bảo đảm                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Client → Gateway          | HTTPS/JSON; Web dùng cookie HttpOnly cùng origin, mobile dùng token trong SecureStore | Rate limit theo nhóm route, security headers, request context và public contract |
| Gateway/service → service | Internal HTTP, Ed25519 Service JWS và signed Actor Context                            | Xác thực service, truyền actor/tenant/purpose; không đọc chéo keyspace           |
| Service → worker/service  | RabbitMQ event envelope qua transactional outbox                                      | Publisher confirm, manual ACK, bounded retry, DLQ, idempotency và reconciliation |

Luồng ghi quan trọng không dựa vào distributed transaction. Service ghi canonical state và outbox trong domain của mình; relay claim event bằng lease/fence, publish có confirm, sau đó consumer hội tụ projection bằng operation/event ID ổn định. Mastery consumer là một ví dụ: nhận assessment event, lưu evidence bền vững, tính lại Mastery V2 và sinh Study Plan retry-safe. Delivery là at-least-once, không tuyên bố distributed exactly-once.

Media jobs được lưu và quét từ Cassandra; worker xử lý file rồi ghi rendition vào MinIO private. Gateway proxy playback tới Media Delivery, nơi xác thực token trước khi trả HLS, poster hoặc phụ đề.

### Service Ownership

Repository có **16 application package**: 2 client, 1 gateway, 6 business service, 6 worker và 1 Media Delivery runtime. Cassandra, RabbitMQ, MinIO, Prometheus, Alertmanager và Grafana là dependency hạ tầng, không được tính là business service.

| Nhóm             | Package/runtime                |      Cổng local | Trách nhiệm chính                                                                                                                | Dữ liệu sở hữu/phụ thuộc                                |
| ---------------- | ------------------------------ | --------------: | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Client           | `@ailss/web`                   |   `5173`/`5177` | React Web cho Guest, Student, Lecturer, Admin; same-origin server adapter chuyển cookie session sang public API                  | Không sở hữu business data; browser không persist token |
| Client           | `@ailss/mobile`                | Expo dev server | Expo/React Native cho Student, Lecturer, Admin; public API client, SecureStore và offline progress sync                          | SecureStore trên thiết bị; canonical data vẫn ở backend |
| Edge             | `@ailss/api-gateway`           |          `8080` | Public entry point, auth boundary, rate limit, security headers, route proxy, Actor Context và metrics                           | Không sở hữu business data                              |
| Business service | `@ailss/identity-service`      |          `8101` | Account, credential, session, profile/avatar, tenant, lecturer onboarding, social login, SAML/LTI federation và admin identity   | `identity_keyspace`, private avatar objects             |
| Business service | `@ailss/learning-service`      |          `8102` | Course, Lesson, Offering, enrollment/entitlement, progress, commerce/SePay, finance, Mastery V2, Study Plan và product analytics | `learning_keyspace`                                     |
| Business service | `@ailss/classroom-service`     |          `8103` | Class, roster, join code, schedule, session, announcement, WebSocket presence và attendance                                      | `classroom_keyspace`                                    |
| Business service | `@ailss/assessment-service`    |          `8104` | Quiz/question authoring, publish, attempt, submission, objective/manual grading và result projection                             | `assessment_keyspace`                                   |
| Business service | `@ailss/interaction-service`   |          `8105` | Comment/reply, review/rating, report và moderation queue                                                                         | `interaction_keyspace`                                  |
| Business service | `@ailss/ai-service`            |          `8106` | Upload intent, document/extraction state, AI quiz job/draft/approval và AI Assistant conversation/tool orchestration             | `ai_keyspace`, private MinIO objects                    |
| Media delivery   | `@ailss/media-delivery`        |          `8211` | Xác thực playback token và phân phối HLS, poster, WebVTT từ storage private                                                      | MinIO với quyền đọc riêng; không sở hữu business data   |
| Worker           | `@ailss/ai-worker`             |          `8201` | Nhận quiz-generation event, gọi AI provider, validate `objective-v1`, ghi kết quả/draft xác định                                 | AI-owned repository, private MinIO, RabbitMQ            |
| Worker           | `@ailss/document-worker`       |          `8202` | Tải object riêng tư, kiểm tra checksum/MIME/magic bytes, trích xuất nội dung có giới hạn                                         | AI-owned repository, private MinIO, RabbitMQ            |
| Worker           | `@ailss/media-worker`          |          `8210` | Poll media jobs, kiểm tra nguồn, tạo HLS bằng FFmpeg và phục hồi/dọn output gián đoạn                                            | `learning_keyspace`, quota ledger, private MinIO        |
| Worker           | `@ailss/notification-worker`   |          `8203` | Chuyển domain event thành notification projection theo user/tháng                                                                | `notification_keyspace`, RabbitMQ                       |
| Worker           | `@ailss/audit-worker`          |          `8204` | Ghi audit event tách khỏi synchronous request path                                                                               | `audit_support_keyspace`, RabbitMQ                      |
| Worker           | `@ailss/reconciliation-worker` |          `8205` | Quét và repair operation/projection bị gián đoạn; hội tụ entitlement và các eventual workflow                                    | Không tạo business authority mới                        |

Runtime role không được tạo/sửa schema và không được đọc trực tiếp keyspace của service khác. Cross-domain read phải đi qua registered internal API hoặc projection có authority rõ ràng. Binary tài liệu và provider artifact nằm trong private MinIO thay vì Cassandra; Redis không thuộc kiến trúc.

Các luồng tham chiếu chi tiết cho registration/outbox, SePay/entitlement, AI quiz generation và failure recovery nằm trong [architecture-sequences.md](./docs/architecture/architecture-sequences.md); bản đồ workflow thực tế nằm trong [SYSTEM_WORKFLOWS.md](./docs/architecture/SYSTEM_WORKFLOWS.md).

## Công nghệ sử dụng

| Thành phần          | Công nghệ                                      |
| ------------------- | ---------------------------------------------- |
| Runtime             | Node.js 24, TypeScript 5.9, pnpm 11            |
| Web                 | React 19, React Router 7, Vite 7, Three.js     |
| Mobile              | Expo 57, React Native 0.86, Expo Router        |
| Media               | FFmpeg, adaptive HLS, WebVTT                   |
| HTTP                | Express 5                                      |
| Database            | Apache Cassandra 5.0.9                         |
| Messaging           | RabbitMQ 4.1                                   |
| Object storage      | MinIO S3-compatible                            |
| Observability       | Prometheus, Alertmanager, Grafana, Pino        |
| Test/QA             | Vitest, Node test runner, Playwright, axe-core |
| Local orchestration | Docker Compose                                 |

## Thiết kế và nguyên tắc vận hành

### Cassandra Design

- Thiết kế theo access pattern và Query ID; không dùng JOIN/foreign key.
- Không dùng `ALLOW FILTERING` để né thiết kế business query.
- Không tạo schema ở runtime và không cross-keyspace query bằng application role.
- Canonical row là authority; projection có thể được repair/reconcile.
- Redis=false: hệ thống không phụ thuộc shared Redis cache.

### Event-Driven và Recovery

- RabbitMQ dùng durable exchange/queue, publisher confirm, manual ACK, retry và DLQ.
- Outbox duy trì stable event/operation identity.
- Consumer xử lý duplicate/redelivery và tự reconnect/re-register sau broker restart.
- Delivery guarantee là at-least-once kết hợp idempotency/reconciliation.

### Security và Privacy

- Browser dùng same-origin adapter và cookie phiên HttpOnly; không lưu access/refresh token phía client.
- Internal call dùng Ed25519 Service JWS và signed Actor Context.
- Password dùng Argon2id; thao tác Admin nhạy cảm yêu cầu current-password reauthentication theo operation.
- Cursor/locator là opaque; private answer, AI provider payload và object secret không đi vào public projection.
- Media gốc và rendition ở MinIO private; API, worker và delivery dùng credential riêng, playback token giới hạn theo asset và thời hạn.
- Secrets/keys được inject từ môi trường và không được commit.

### Web UX, Accessibility và Motion

- React Web hỗ trợ Guest, Student, Lecturer và Admin workspace.
- Responsive tại 375, 768, 1440 và 1920px; desktop là phạm vi chạy chính hiện tại.
- Keyboard/focus, dialog, labels, aria feedback và axe checks có browser regression.
- Public Home có Three.js lazy-load; authenticated workspace không chạy scene 3D liên tục.
- Route/scroll/workspace animation tôn trọng `prefers-reduced-motion` và không scroll-jacking.
- Expo app có các luồng Student, Lecturer và Admin cho account, course, class, assessment, notification, teaching và governance; release native production chưa được tuyên bố.

---

## Cài đặt và chạy dự án

### Yêu cầu môi trường

- Node.js `>=24 <27`; Node 24 là runtime chuẩn của build/release.
- pnpm `>=11 <12`.
- Docker Desktop với Compose v2.
- Khoảng 12 GiB RAM khả dụng để chạy đầy đủ Cassandra và các service.
- Các cổng chính trống: `8080`, `5173`/`5177`, `9042`, `5672`, `15672`, `9000`, `9001`.

### Chạy nhanh

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
pnpm keys:dev
pnpm env:dev-async
pnpm dev:web
```

Mở địa chỉ Vite hiển thị trong terminal, mặc định `http://127.0.0.1:5173`.

`env:dev-async` khởi tạo Cassandra roles/migrations, RabbitMQ topology, MinIO, Gateway, business services và workers. Hướng dẫn chi tiết cho Web nằm tại [WEB_DEVELOPMENT_GUIDE.md](./WEB_DEVELOPMENT_GUIDE.md).

Để chạy mobile sau khi cài dependency:

```bash
pnpm --filter @ailss/mobile start
# hoặc: pnpm --filter @ailss/mobile android
# hoặc: pnpm --filter @ailss/mobile ios
```

Để bootstrap sạch và xóa toàn bộ dữ liệu local hiện tại:

```bash
AILSS_CONFIRM_RESET=YES pnpm env:reset
pnpm env:dev-async
```

Lệnh reset xóa Cassandra/RabbitMQ/MinIO volumes local. Không chạy khi cần giữ dữ liệu phát triển.

### Development profiles

| Lệnh                 | Mục đích                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm env:dev-core`  | Cassandra và các service đồng bộ cốt lõi                                                 |
| `pnpm env:dev-async` | Môi trường đầy đủ, gồm RabbitMQ/MinIO/workers                                            |
| `pnpm env:research`  | Môi trường thí nghiệm resilience                                                         |
| `pnpm env:demo`      | Demo HTTPS local                                                                         |
| `pnpm env:down`      | Dừng môi trường và giữ volume                                                            |
| `pnpm env:reset`     | Xóa môi trường/volume khi đã đặt biến xác nhận                                           |
| Media overlay        | `docker-compose.media.yml`; cần policy kích thước/thời lượng và credential storage riêng |

Media là overlay tùy chọn. Sau khi khai báo các biến bắt buộc trong `.env.media`, có thể bật cùng profile bất đồng bộ:

```bash
docker compose --env-file .env --env-file .env.media \
  -f docker-compose.yml -f docker-compose.async.yml -f docker-compose.media.yml \
  --profile dev-async up -d api-gateway learning-service media-delivery media-worker
```

### Kiểm tra chất lượng

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm validate:contracts
pnpm validate:compose
pnpm scan:secrets
pnpm format:check

pnpm typecheck:web
pnpm lint:web
pnpm test:web
pnpm build:web

pnpm --filter @ailss/mobile typecheck
pnpm --filter @ailss/mobile test
pnpm --filter @ailss/mobile validate:config
```

Acceptance thực phải chạy khi profile `dev-async` đã sẵn sàng. Ví dụ:

```bash
pnpm acceptance:p7.17   # Offering/commerce/entitlement
pnpm acceptance:p10.1   # Secure document extraction
pnpm acceptance:p10.2   # AI quiz generation
pnpm acceptance:p10.3   # Human approval/import
pnpm acceptance:p11     # Notification
```

## Cấu trúc repository

```text
apps/                    Gateway, services, workers, React Web và Expo mobile
contracts/               OpenAPI, API/query/event registries và schemas
database/migrations/     Cassandra migrations theo profile
packages/                Thư viện runtime dùng chung
ops/                     Prometheus, Alertmanager, Grafana và Vault policy
scripts/                 Bootstrap, CI, acceptance, operations và research tooling
tests/                   Unit, contract, security, load và smoke tests
docs/                    ADR, hướng dẫn, audit và báo cáo theo phase
artifacts/, evidence/     Bằng chứng runtime/release sinh bởi tooling
```

## Quy tắc phát triển

1. Không thêm business service, API ID, Query ID hoặc Event Type ngoài contract/ADR được phê duyệt.
2. Không truy cập Cassandra keyspace của service khác và không tạo schema ở runtime.
3. Không dùng `ALLOW FILTERING` để né thiết kế access pattern.
4. Không hard-code hoặc log credential, JWT, password, private key và presigned secret.
5. Mutation quan trọng phải có idempotency; update versioned phải giữ optimistic concurrency.
6. Projection không được thay thế canonical authority.
7. RabbitMQ consumer phải an toàn trước duplicate/redelivery và tự phục hồi kết nối.
8. AI output phải được validate và Lecturer review trước khi import; publish luôn là thao tác riêng.
9. Web không persist token, answer draft, AI reviewed draft, notification locator hay Admin proof.
10. Code thay đổi phải qua typecheck, lint, test, contract validation và secret scan phù hợp.
11. Feature chỉ được tuyên bố pilot-ready khi có API, repository bền vững, authorization và acceptance evidence tương ứng.
12. Grades, credentials, authorization, security parameters và payment không được đưa vào experimentation scope.

## Trạng thái phát triển

- [x] Identity, session security và Lecturer onboarding
- [x] Learning, Course, Lesson, Offering và entitlement
- [x] Classroom, schedule, session và attendance
- [x] Assessment, Attempt, result và AI draft import
- [x] Interaction, moderation và Notification
- [x] Secure Document processing và AI Quiz Generation
- [x] Web Guest/Student/Lecturer/Admin responsive
- [x] Expo mobile app cho các luồng Student/Lecturer/Admin cốt lõi
- [x] Local clean bootstrap và event consumer recovery
- [x] Assessment evidence → durable Mastery V2 → Study Plan feedback path
- [x] Finance projection/backfill, durable refund và observability stack
- [x] Phase 42 Revision B: media upload, quota, HLS, playback token và WebVTT; acceptance cục bộ trên Docker/Web/mobile simulator
- [x] Phase 42 Revision C: redacted staging config, IAM/S3/CDN templates và validator/runbook scripts trong source
- [ ] Hoàn tất các authoritative mastery evidence producer còn lại
- [ ] AI Tutor tool registry và Mastery/Study Plan tools đầy đủ
- [ ] Full-stack Student/Teacher/Admin/failure E2E cho Phase 40 Revision H
- [ ] Staging/cloud deployment với credential thật, external S3/CDN acceptance và production telemetry
- [ ] VoiceOver/TalkBack trên thiết bị thật và native mobile production release

Phase 40 Revision H vẫn được ghi nhận là `RUNTIME_INTEGRATION_INCOMPLETE` và `CONTROLLED_PRODUCT_PILOT_STATUS = REVOKED`. Báo cáo Phase 42 Revision B ghi nhận acceptance trên môi trường cục bộ; Revision C bổ sung cấu hình mẫu và kiểm tra sẵn sàng. Các kết quả này chưa chứng minh staging/production deployment hay external assurance.

## Phạm vi và giới hạn của AI

**Nguyên tắc:** AI hỗ trợ giảng viên và không thay thế quyền quyết định của giảng viên.

AI có thể:

- trích xuất nội dung từ tài liệu riêng tư;
- sinh câu hỏi theo schema được kiểm soát;
- tạo `AI_DRAFT` để Lecturer review và chỉnh sửa;
- import draft đã được con người approve thành Assessment Quiz `DRAFT`.

AI không được:

- tự publish Quiz hoặc Course;
- tự sửa điểm Student;
- bỏ qua Lecturer review/approval;
- tự cấp quyền Course/Class;
- đọc cross-service data ngoài contract;
- truy cập hoặc đưa credential/private payload vào output công khai.

## Giới hạn hiện tại

- Practice completion, lesson completion và approved-instructor evidence chưa được nối đầy đủ vào Mastery V2.
- Course requirement, deadline, assessment schedule và teacher-priority adapter cho Study Plan còn thiếu.
- AI Tutor authorized tool registry và các Mastery/Study Plan tool thật chưa hoàn tất.
- Teacher Copilot, Question Bank V2, Institution Onboarding, Curriculum Intelligence, Fleet Operations và Advanced Experimentation đang `DEFERRED_UNSHIPPED`; không nên xem route/UI thử nghiệm là runtime production-ready.
- Full failure-injection retry/DLQ và full-stack Student/Teacher/Admin/failure E2E cho Phase 40 Revision H chưa có bằng chứng hoàn tất.
- Phase 42 có bounded-load acceptance cục bộ; chưa có production load/SLO acceptance hoặc staging/production deployment với cloud storage thật. Template staging và policy IaC hiện chỉ là cấu hình mẫu.
- External SAML/LTI, Vault-backed deployment, penetration test và ASV chưa được xác nhận hoàn tất.
- Thanh toán thương mại production và payout vẫn bị chặn theo cơ chế fail-closed.
- Mobile có trong repository và có test, nhưng phát hành native production chưa nằm trong phạm vi đã xác nhận.

## Tác giả, bản quyền và giấy phép

- **Dự án:** AILSS — AI-Powered Learning Support System
- **Tác giả chính:** Nguyễn Viết Doanh
- **Năm:** 2026
- **Mục đích:** Học tập, nghiên cứu và phát triển hệ thống phần mềm phân tán ứng dụng Cassandra, RabbitMQ, Microservices và AI.

Copyright © 2026 AILSS contributors.

Dự án được phát hành theo **MIT License**. Giấy phép cho phép sử dụng, sao chép, chỉnh sửa, hợp nhất, xuất bản, phân phối, cấp phép lại và bán bản sao phần mềm với điều kiện giữ nguyên thông báo bản quyền và nội dung giấy phép.

Phần mềm được cung cấp **“AS IS”**, không kèm bảo đảm dưới bất kỳ hình thức nào. Nội dung pháp lý đầy đủ nằm trong [LICENSE](./LICENSE).

Các thư viện, container image, font và media của bên thứ ba tiếp tục tuân theo giấy phép riêng của từng nhà cung cấp. Xem [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) và attribution trong `apps/web/public/assets/media/`.

> README chỉ tóm tắt giấy phép để người đọc dễ hiểu; khi có khác biệt, file `LICENSE` là nội dung pháp lý có hiệu lực cho repository.

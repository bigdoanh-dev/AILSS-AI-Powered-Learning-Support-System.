# AILSS — AI-Powered Learning Support System

[![Node.js](https://img.shields.io/badge/Node.js-24.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=111827)](https://react.dev/)
[![Cassandra](https://img.shields.io/badge/Cassandra-5.0-1287b1?logo=apachecassandra&logoColor=white)](https://cassandra.apache.org/)
[![RabbitMQ](https://img.shields.io/badge/RabbitMQ-4.1-ff6600?logo=rabbitmq&logoColor=white)](https://www.rabbitmq.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

AILSS là nền tảng học tập Web theo kiến trúc microservices, contract-first và event-driven. Hệ thống quản lý tài khoản, khóa học, lớp học, tiến độ, bài kiểm tra, tương tác, thông báo và quy trình dùng AI để tạo bản nháp câu hỏi có giảng viên duyệt.

> Phiên bản hiện tại tập trung vào Web desktop/responsive. Ứng dụng mobile chưa nằm trong phạm vi chạy của repository này.

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
- xây dựng, duyệt và phân phối Course qua Offering;
- quản lý Class, lịch học, session và attendance;
- theo dõi Lesson completion và Learning progress;
- tổ chức Quiz, Attempt, chấm điểm objective và trả kết quả an toàn;
- hỗ trợ Comment, Review, Report, Moderation và Notification;
- xử lý tài liệu riêng tư và sinh AI draft có Lecturer review;
- vận hành nhất quán trên Cassandra, RabbitMQ và MinIO;
- cung cấp trải nghiệm Web responsive, accessible và có reduced motion.

## Trạng thái hiện tại

- 4 actor: `GUEST`, `STUDENT`, `LECTURER`, `ADMIN`.
- 6 business services: Identity, Learning, Classroom, Assessment, Interaction và AI.
- 98 public APIs, 15 internal APIs, 74 Query IDs và 22 Event Types.
- Cassandra 5 cho dữ liệu theo domain, RabbitMQ cho xử lý bất đồng bộ và MinIO cho tài liệu riêng tư.
- Redis không được sử dụng.
- Web production build có 30 public routes, trang 404 và workspace theo vai trò.

## Tính năng chính

### 1. Guest, Authentication và Account

- Trang giới thiệu, khám phá khóa học, AI learning, trợ giúp, liên hệ và pháp lý.
- Đăng ký tạo tài khoản `STUDENT / ACTIVE`; không có role picker để tự tạo Lecturer.
- Đăng nhập, refresh, logout, hồ sơ và đổi mật khẩu qua cookie phiên HttpOnly cùng origin.
- Student muốn trở thành Lecturer phải nộp đơn, được Admin phê duyệt, đăng nhập lại, rồi được Admin xác minh riêng.

### 2. Student Learning

- Khóa học miễn phí và luồng mua mô phỏng cho Offering trả phí.
- Entitlement bất đồng bộ, bài học, hoàn thành bài và tiến độ.
- Tham gia Class, xem lịch, session, announcement và attendance của chính mình.
- Quiz/Attempt có thao tác bắt đầu và nộp bài rõ ràng; đáp án đúng không lộ trước policy.
- Comment, reply một cấp, review, report và notification với cursor opaque.

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
- Không có vai trò `MODERATOR` riêng và chưa có Admin Course review queue.

### 5. Course và Offering

- Course và Offering là hai aggregate riêng; một Course có thể có nhiều Offering.
- Offering hỗ trợ `SELF_PACED` và `LIVE_COHORT` với lifecycle `DRAFT → PUBLISHED → CLOSED`.
- Course publication thuộc quyền Admin; Offering authoring/publishing tuân theo owner và trạng thái Course.
- Free enrollment giữ legacy default-Offering behavior; paid access dùng Order và payment simulation.
- Entitlement hội tụ qua at-least-once event delivery, idempotency và reconciliation.

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

---

## Kiến trúc hệ thống

### Sơ đồ tổng quan

```text
Browser → Web same-origin adapter → API Gateway
                                  ├── Identity    → identity_keyspace
                                  ├── Learning    → learning_keyspace
                                  ├── Classroom   → classroom_keyspace
                                  ├── Assessment  → assessment_keyspace
                                  ├── Interaction → interaction_keyspace
                                  └── AI          → ai_keyspace + private MinIO
                                                       │
                                                    RabbitMQ
                                                       ├── AI Worker
                                                       ├── Document Worker
                                                       ├── Notification Worker
                                                       ├── Audit Worker
                                                       └── Reconciliation Worker
```

Mỗi service chỉ sở hữu keyspace của mình. Giao tiếp đồng bộ giữa service dùng internal HTTP có Service JWS; xử lý bất đồng bộ dùng event envelope, outbox, idempotency và reconciliation. Delivery là at-least-once, không tuyên bố distributed exactly-once.

### Service Ownership

| Service             | Keyspace sở hữu        |
| ------------------- | ---------------------- |
| Identity Service    | `identity_keyspace`    |
| Learning Service    | `learning_keyspace`    |
| Classroom Service   | `classroom_keyspace`   |
| Assessment Service  | `assessment_keyspace`  |
| Interaction Service | `interaction_keyspace` |
| AI Service          | `ai_keyspace`          |

Runtime role không được tạo/sửa schema và không được đọc trực tiếp keyspace của service khác. Cross-domain read phải đi qua registered internal API hoặc projection đã có authority rõ ràng.

## Công nghệ sử dụng

| Thành phần          | Công nghệ                                      |
| ------------------- | ---------------------------------------------- |
| Runtime             | Node.js 24, TypeScript 5.9, pnpm 11            |
| Web                 | React 19, React Router 7, Vite 7, Three.js     |
| HTTP                | Express 5                                      |
| Database            | Apache Cassandra 5.0.9                         |
| Messaging           | RabbitMQ 4.1                                   |
| Object storage      | MinIO S3-compatible                            |
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
- Secrets/keys được inject từ môi trường và không được commit.

### Web UX, Accessibility và Motion

- React Web hỗ trợ Guest, Student, Lecturer và Admin workspace.
- Responsive tại 375, 768, 1440 và 1920px; desktop là phạm vi chạy chính hiện tại.
- Keyboard/focus, dialog, labels, aria feedback và axe checks có browser regression.
- Public Home có Three.js lazy-load; authenticated workspace không chạy scene 3D liên tục.
- Route/scroll/workspace animation tôn trọng `prefers-reduced-motion` và không scroll-jacking.

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

Để bootstrap sạch và xóa toàn bộ dữ liệu local hiện tại:

```bash
AILSS_CONFIRM_RESET=YES pnpm env:reset
pnpm env:dev-async
```

Lệnh reset xóa Cassandra/RabbitMQ/MinIO volumes local. Không chạy khi cần giữ dữ liệu phát triển.

### Development profiles

| Lệnh                 | Mục đích                                       |
| -------------------- | ---------------------------------------------- |
| `pnpm env:dev-core`  | Cassandra và các service đồng bộ cốt lõi       |
| `pnpm env:dev-async` | Môi trường đầy đủ, gồm RabbitMQ/MinIO/workers  |
| `pnpm env:research`  | Môi trường thí nghiệm resilience               |
| `pnpm env:demo`      | Demo HTTPS local                               |
| `pnpm env:down`      | Dừng môi trường và giữ volume                  |
| `pnpm env:reset`     | Xóa môi trường/volume khi đã đặt biến xác nhận |

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
apps/                    Gateway, services, workers và React Web
contracts/               OpenAPI, API/query/event registries và schemas
database/migrations/     Cassandra migrations theo profile
packages/                Thư viện runtime dùng chung
scripts/                 Bootstrap, CI, acceptance và research tooling
tests/                   Unit, contract, security và smoke tests
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

## Trạng thái phát triển

- [x] Identity, session security và Lecturer onboarding
- [x] Learning, Course, Lesson, Offering và entitlement
- [x] Classroom, schedule, session và attendance
- [x] Assessment, Attempt, result và AI draft import
- [x] Interaction, moderation và Notification
- [x] Secure Document processing và AI Quiz Generation
- [x] Web Guest/Student/Lecturer/Admin responsive
- [x] Local clean bootstrap và event consumer recovery
- [ ] Mobile application
- [ ] Production deployment và provider telemetry

Repository hiện đạt trạng thái Web release-ready trong môi trường local đã kiểm thử. Điều này không đồng nghĩa production deployment đã được thực hiện.

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

- Chưa có authoritative owned-Course index, Admin Course review queue hoặc Student order-history list.
- Chưa có answer autosave, global quiz history hay global notification unread total.
- Chưa có searchable all-Document index hoặc AI review server autosave.
- Chưa có provider cost/quality telemetry.
- Chưa có ứng dụng mobile trong phạm vi hiện tại.

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

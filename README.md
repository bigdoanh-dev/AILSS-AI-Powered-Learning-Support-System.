# AILSS — AI-Powered Learning Support System

Bộ dữ liệu học viên và hai giảng viên demo, liên kết lớp/lịch/bảng điểm: [Linked demo guide](LINKED_DEMO_GUIDE.md).

[![Node.js](https://img.shields.io/badge/Node.js-24.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=111827)](https://react.dev/)
[![Cassandra](https://img.shields.io/badge/Cassandra-5.0-1287b1?logo=apachecassandra&logoColor=white)](https://cassandra.apache.org/)
[![RabbitMQ](https://img.shields.io/badge/RabbitMQ-4.1-ff6600?logo=rabbitmq&logoColor=white)](https://www.rabbitmq.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI dev](https://github.com/bigdoanh-dev/AILSS-AI-Powered-Learning-Support-System./actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/bigdoanh-dev/AILSS-AI-Powered-Learning-Support-System./actions/workflows/ci.yml?query=branch%3Adev)

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
  - [Cấu hình tích hợp local](#cấu-hình-tích-hợp-local)
  - [Chạy mobile và điện thoại thật](#chạy-mobile-và-điện-thoại-thật)
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
- Đăng nhập, refresh, logout, hồ sơ và đổi mật khẩu; Web dùng cookie phiên HttpOnly cùng origin, mobile dùng bearer token và SecureStore.
- Google login trên Web/mobile dùng cấu hình Gateway và Identity; native cần client theo nền tảng và bản build có Google Sign-In.
- Quên mật khẩu qua email SMTP: nhập email, xác nhận OTP, đặt mật khẩu mới; OTP dùng một lần và hết hạn sau 15 phút.
- Dữ liệu cá nhân lấy từ backend theo tài khoản hiện tại. Tài khoản mới hiển thị trạng thái trống khi chưa có dữ liệu; không tự gán điểm, chuỗi học, khóa học hay doanh thu mẫu.
- External authentication/federation có runtime repository, tenant policy và các migration riêng; rollout vẫn phụ thuộc cấu hình và acceptance theo môi trường.
- Student muốn trở thành Lecturer phải nộp đơn, được Admin phê duyệt, đăng nhập lại, rồi được Admin xác minh riêng.

### 2. Student Learning

- Khám phá khóa học, đăng ký miễn phí hoặc tạo Order cho Offering trả phí bằng VietQR/SePay và chuyển khoản ngân hàng theo cấu hình backend.
- Entitlement bất đồng bộ, bài học, hoàn thành bài và tiến độ.
- Tham gia Class, xem lịch, session, announcement và attendance của chính mình.
- Quiz/Attempt có thao tác bắt đầu và nộp bài rõ ràng; đáp án đúng không lộ trước policy.
- Danh sách bài kiểm tra trên mobile chỉ lấy Quiz đã publish của khóa học/lớp mà học viên có quyền truy cập.
- Comment, reply một cấp, review, report và notification với cursor opaque.
- Study Plan, mastery projection và AI Tutor đã có đường runtime từ assessment evidence; các nguồn evidence khác và full-stack acceptance chưa hoàn tất.
- Biểu đồ radar năng lực theo từng bài học/bài kiểm tra: Web tại Tiến độ, mobile tại Năng lực học tập. Điểm lấy từ mastery đã ghi nhận; chưa có bằng chứng hiển thị “Chưa đánh giá”, không gán điểm 0. Có chọn khóa học, nhóm nội dung và xem số bằng chứng/độ tin cậy.

### 3. Lecturer Teaching

- Soạn Course/Lesson và gửi Course cho Admin duyệt; Lecturer không tự publish Course.
- Tự nhập danh mục đào tạo, mô tả khóa học và tải ảnh bìa; dữ liệu được lưu phía backend và dùng chung cho Web/mobile.
- Tạo và publish Offering cho Course phù hợp.
- Quản lý Class thuộc sở hữu, roster, lịch, session, announcement và attendance thủ công.
- Tạo lớp trường học/tổ chức, chia sẻ mã tham gia, tải ảnh/ảnh bìa, xem hồ sơ học viên, cảnh báo và xóa thành viên theo điều kiện backend; xuất roster khóa học ra CSV.
- Tạo Quiz với bốn loại câu hỏi và xem kết quả theo contract.
- Radar giảng viên mặc định hiển thị tổng quan năng lực khóa học (Web/mobile), hoặc khóa học đã chọn tại Bảng điểm trên Web; không cần chọn học viên. Mỗi trục là điểm trung bình của những học viên đã có bằng chứng ở bài học/bài kiểm tra đó, kèm số người được đánh giá. Chưa có bằng chứng không gán điểm 0. Xem riêng từng học viên là tùy chọn chi tiết. API chỉ cho chủ khóa học xem, chỉ tổng hợp học viên có entitlement đang ACTIVE và không trả danh tính trong dữ liệu tổng hợp.
- Upload tài liệu, chạy extraction/generation, review AI draft và import thành Assessment Quiz `DRAFT`. AI không tự approve hoặc publish.

### 4. Admin Governance

- Tra cứu user, xem chi tiết, đổi trạng thái tài khoản với current-password reauthentication.
- Xử lý đơn và xác minh Lecturer.
- Publish/archive Course bằng UUID trực tiếp.
- Xử lý report và moderation theo version/idempotency.
- Dashboard thống kê, doanh thu, audit log và export; observability stack có Prometheus, Alertmanager và Grafana.
- Hướng dẫn quản trị local hoạt động với `AI_ADMIN_SUPPORT_MODE=local-guide`, không cần API key AI. Chế độ này hướng dẫn thao tác và không tự thực hiện hành động quản trị.
- Không có vai trò `MODERATOR` riêng và chưa có Admin Course review queue.

### 5. Course và Offering

- Course và Offering là hai aggregate riêng; một Course có thể có nhiều Offering.
- Offering hỗ trợ `SELF_PACED` và `LIVE_COHORT` với lifecycle `DRAFT → PUBLISHED → CLOSED`.
- Course publication thuộc quyền Admin; Offering authoring/publishing tuân theo owner và trạng thái Course.
- Free enrollment giữ legacy default-Offering behavior; paid access dùng giá và Order do backend trả về.
- Checkout Web/mobile chỉ mô phỏng khi backend trả `paymentMode=simulation`. Luồng SePay kiểm tra trạng thái Order và cấp quyền theo giao dịch được backend xác minh qua webhook; nút kiểm tra thanh toán không tự đánh dấu đã trả tiền.
- MoMo, thẻ quốc tế và VNPAY chưa có tích hợp thanh toán thực tế trong checkout hiện tại.
- Entitlement hội tụ qua at-least-once event delivery, idempotency và reconciliation.
- Finance runtime có projection/backfill, durable refund và recovery cho SePay; thanh toán thương mại production vẫn fail-closed.

### 6. Classroom và Attendance

- Class hỗ trợ `LIVE_COHORT`, `PRIVATE` và `INSTITUTIONAL`.
- Student tham gia bằng canonical join code và chỉ xem tài nguyên được phép.
- Lecturer quản lý roster, schedule, session, meeting rule và announcement của Class thuộc sở hữu.
- Roster có tên, email che bớt và ngày đăng ký tài khoản. Nhãn/màu học viên mới áp dụng trong 21 ngày từ ngày đăng ký tài khoản, không tính từ ngày vào lớp.
- Cảnh báo và xóa thành viên tuân theo quyền sở hữu cùng ràng buộc lịch/quyền học. Chỉ xóa lớp có lịch còn `DRAFT`, không liên kết khóa học, không có thành viên đang hoạt động và không có session.
- Ảnh lớp và ảnh bìa được lưu để hiển thị trên cả Web và mobile.
- Attendance online được bảo vệ bởi presence rule; attendance offline/manual dùng version và idempotency.

### 7. Assessment và Quiz

- Quiz có `DRAFT`, version, bốn loại câu hỏi và thao tác publish riêng.
- Hạn đóng bài (`closesAt`) được lưu tại backend; không có luồng bài luận/dự án độc lập ngoài contract Quiz hiện tại.
- Xem Quiz detail không tự tạo Attempt; Student phải gọi start/resume rõ ràng.
- Attempt submit idempotent và chấm điểm phía server.
- Correct answer không xuất hiện trong Student projection trước policy cho phép.

### 8. Interaction và Notification

- Comment Course/Class, reply một cấp, edit theo version và soft delete.
- Review yêu cầu eligibility và hỗ trợ create/update/delete.
- Report queue và moderation dùng current-password reauthentication, `If-Match` và `Idempotency-Key`.
- Notification phân trang theo tháng, cursor và locator opaque; không có fake global unread total.
- Web/mobile giữ metadata và cursor phân trang của backend cho review, comment, hàng đợi quản trị và AI job.

### 9. Document và AI Quiz Generation

```text
Upload intent → Direct private upload → Confirm → Extraction
→ AI generation → AI_DRAFT → Lecturer review
→ Human approval → Assessment Quiz DRAFT → Optional publish
```

- Binary tài liệu không lưu trong Cassandra.
- Mobile chọn PDF, DOCX hoặc TXT tối đa 25 MiB, tính SHA-256, tải lên bằng private upload intent và theo dõi extraction/generation trước khi review draft.
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
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
test -f .env || cp .env.example .env
test -f .env.local || touch .env.local
pnpm keys:dev
pnpm env:dev-async
pnpm dev:web
```

> **Lưu ý cấu hình môi trường (`.env`):**
> Chỉ sao chép file mẫu khi `.env` chưa tồn tại (`test -f .env || cp .env.example .env`).
>
> - Chạy `cp .env.example .env` khi `.env` đã tồn tại sẽ thay cấu hình đã điền bằng giá trị mẫu, bao gồm các biến Google/SePay để trống.
> - **Khắc phục:** Cấu hình riêng của máy nên đặt trong `.env.local`; file này được nạp sau `.env` và không bị ghi đè khi sao chép mẫu hoặc kéo code mới.

Mở địa chỉ Vite hiển thị trong terminal, mặc định `http://127.0.0.1:5173`.

`env:dev-async` khởi tạo Cassandra roles/migrations, RabbitMQ topology, MinIO, Gateway, business services, workers và observability. Hướng dẫn chi tiết cho Web nằm tại [WEB_DEVELOPMENT_GUIDE.md](./WEB_DEVELOPMENT_GUIDE.md).

### Cấu hình tích hợp local

Giữ Google, SMTP và SePay trong `.env.local` ở **gốc repo**; các lệnh `pnpm env:*` nạp file này sau `.env` qua Docker Compose. Sau khi sửa biến môi trường, chạy lại `pnpm env:dev-async` để cập nhật container; chỉ `docker compose restart` không nạp giá trị mới.

- **Google:** Gateway dùng `GOOGLE_WEB_CLIENT_ID`; Identity dùng `GOOGLE_CLIENT_IDS`. Đăng ký đúng origin Web đang mở trong Google Cloud, kể cả khác biệt giữa `localhost` và `127.0.0.1`. Client Secret không được đưa vào frontend.
- **SMTP:** điền `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` và `SMTP_FROM` theo nhà cung cấp; Gmail dùng mật khẩu ứng dụng cho `SMTP_PASS`. Thư OTP dùng nội dung văn bản; kiểm tra đúng hộp thư nhận và thư rác khi thử luồng.
- **SePay:** điền `SEPAY_ACCOUNT_NUMBER`, `SEPAY_ACCOUNT_NAME`, `SEPAY_BANK`, `SEPAY_WEBHOOK_API_KEY` và đặt `PAYMENT_MODE=sepay` để dùng giao dịch thật. API key cấu hình trong SePay phải khớp backend. URL nhận `/api/v1/payments/sepay/webhook` cần HTTPS public để SePay gọi được; local cần tunnel đang hoạt động. Không dùng `127.0.0.1` làm URL nhận webhook trên SePay.
- **Quản trị và giám sát local:** cấu hình như dưới đây; Prometheus/Grafana giao tiếp giữa container qua địa chỉ nội bộ, còn nút mở trên Web dùng URL public của máy phát triển.

```dotenv
AI_ADMIN_SUPPORT_MODE=local-guide
PROMETHEUS_PUBLIC_URL=http://127.0.0.1:9090
GRAFANA_PUBLIC_URL=http://127.0.0.1:3001
```

Tên biến cấu hình nằm trong [.env.example](./.env.example); hướng dẫn Google origin, giám sát và chuyển các tích hợp lên VPS nằm tại [LOCAL_TO_VPS_CONFIGURATION.md](./LOCAL_TO_VPS_CONFIGURATION.md). Các trợ lý học viên/giảng viên và tạo đề vẫn cần cấu hình nhà cung cấp AI hợp lệ. Alertmanager local không gửi cảnh báo ra ngoài; kênh nhận thật cấu hình khi triển khai VPS.

### Chạy mobile và điện thoại thật

Tạo cấu hình riêng cho Expo mà không ghi đè file đã điền. Đặt địa chỉ API trong file theo bảng bên dưới trước khi khởi động app:

```bash
test -f apps/mobile/.env.local || cp apps/mobile/.env.example apps/mobile/.env.local
pnpm --filter @ailss/mobile start
```

| Nơi chạy app     | `EXPO_PUBLIC_AILSS_API_BASE_URL`     |
| ---------------- | ------------------------------------ |
| iOS Simulator    | `http://127.0.0.1:8080`              |
| Android Emulator | `http://10.0.2.2:8080`               |
| Điện thoại thật  | `http://<IP-LAN-của-máy-tính>:18080` |

Với điện thoại thật, đặt `AILSS_MOBILE_GATEWAY_BIND_ADDRESS=<IP-LAN-của-máy-tính>` trong `.env.local` gốc rồi chạy lại `pnpm env:dev-async`. Điện thoại cần truy cập được `http://<IP-LAN-của-máy-tính>:18080/health/ready` và có đường mạng tới máy tính. `127.0.0.1` trên điện thoại trỏ vào điện thoại. URL object storage cho upload cũng cần truy cập được từ thiết bị; cấu hình chi tiết trong [MOBILE_DEVELOPMENT_GUIDE.md](./MOBILE_DEVELOPMENT_GUIDE.md).

Expo Go không chứa native module `RNGoogleSignin` hoặc SQLCipher. Để kiểm tra Google Sign-In native và lưu trữ offline mã hóa, build/cài development client với công cụ iOS/Android tương ứng:

```bash
pnpm --filter @ailss/mobile ios
# hoặc trên Android:
pnpm --filter @ailss/mobile android

# Những lần chạy Metro tiếp theo cho development client:
pnpm --filter @ailss/mobile start:development
```

Google native cần client iOS/Android, URL scheme hoặc SHA-1 đúng khóa ký theo hướng dẫn mobile. Sau khi đổi native module/plugin hoặc cấu hình Google native, cần build/cài lại app; reload Metro không bổ sung module vào binary đã cài.

**Chỉ khi muốn xóa toàn bộ dữ liệu local và bootstrap lại**, dùng:

```bash
AILSS_CONFIRM_RESET=YES pnpm env:reset
pnpm env:dev-async
```

Lệnh reset xóa Cassandra/RabbitMQ/MinIO volumes local. Không chạy khi cần giữ dữ liệu phát triển.

### Development profiles

| Lệnh                 | Mục đích                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm env:dev-core`  | Cassandra, Gateway, Identity và observability                                            |
| `pnpm env:dev-async` | Môi trường đầy đủ, gồm business services, RabbitMQ/MinIO/workers và observability        |
| `pnpm env:research`  | Môi trường thí nghiệm resilience                                                         |
| `pnpm env:demo`      | Demo HTTPS local                                                                         |
| `pnpm env:down`      | Dừng môi trường và giữ volume                                                            |
| `pnpm env:reset`     | Xóa môi trường/volume khi đã đặt biến xác nhận                                           |
| Media overlay        | `docker-compose.media.yml`; cần policy kích thước/thời lượng và credential storage riêng |

Media là overlay tùy chọn. Sau khi khai báo các biến bắt buộc trong `.env.media`, có thể bật cùng profile bất đồng bộ:

```bash
docker compose --env-file .env --env-file .env.local --env-file .env.media \
  -f docker-compose.yml -f docker-compose.async.yml \
  -f docker-compose.observability.yml -f docker-compose.media.yml \
  --profile dev-async up -d api-gateway learning-service media-delivery media-worker
```

### Kiểm tra chất lượng

```bash
pnpm typecheck
pnpm lint:no-regression
pnpm audit:source-tracking
pnpm test
pnpm validate:contracts
pnpm validate:migration-bootstrap
pnpm validate:compose
pnpm validate:production-config
pnpm scan:secrets
pnpm build
pnpm format:check
pnpm acceptance:phase40:revision-h

pnpm typecheck:web
pnpm lint:web
pnpm test:web
pnpm build:web

pnpm --filter @ailss/mobile typecheck
pnpm --filter @ailss/mobile lint:phase41
pnpm --filter @ailss/mobile test
pnpm --filter @ailss/mobile validate:config
pnpm --filter @ailss/mobile build:development
```

`pnpm test:all` chạy các bộ test backend, Web và mobile. CI trong [ci.yml](./.github/workflows/ci.yml) gồm `static-gates`, `web-gates`, `mobile-gates` và `dev-core-smoke`. Lint backend dùng baseline `lint:no-regression` để chặn lỗi mới; `validate:production-config` kiểm tra cấu hình mẫu, không xác nhận đã triển khai production. `build:development` của mobile là export bundle iOS/Android, không tạo bản native có thể cài.

Kiểm tra kết nối dịch vụ sau khi môi trường tương ứng đã khởi động:

```bash
AILSS_PROFILE=dev-core pnpm smoke
# Hoặc khi đã khởi động dev-async:
AILSS_PROFILE=dev-async pnpm smoke
```

`pnpm verify:clean-cassandra-bootstrap` kiểm tra migration bằng container/volume Cassandra tạm riêng, tự dọn sau khi chạy và không reset volume phát triển hiện có.

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
- [x] Nối các mastery evidence producer hiện có: quiz theo course/class, lesson completion và teacher observation
- [ ] Assignment/Lab/Final Project evidence producers (chưa có adapter tới bản ghi nguồn chính thống trong các dịch vụ hiện tại; API từ chối fail-closed khi không xác minh được nguồn)
- [x] AI Tutor tool registry và Mastery/Study Plan tools đầy đủ
- [x] Full-stack Phase 40 Revision H E2E trên stack local thật: Student/Teacher/Admin, tạo và nộp assessment, mastery → Study Plan, Gia sư AI grounded, từ chối sai role và chặn Study Plan khi thiếu mastery
- [ ] Staging/cloud deployment với credential thật, external S3/CDN acceptance và production telemetry (blocker: thiếu remote cloud endpoints AWS/GCP, live S3/CDN buckets, production IAM secrets và telemetry collectors)
- [ ] VoiceOver/TalkBack trên thiết bị thật và native mobile production release (iPhone XS đã ghép đôi; bản Development đã build và cài, nhưng iOS chặn mở cho đến khi người dùng tin cậy profile nhà phát triển trong Cài đặt. Chưa có thiết bị Android và chứng chỉ ký phát hành App Store/Google Play.)

Phase 40 Revision H chưa được nghiệm thu toàn bộ vì Assignment/Lab/Final Project chưa có adapter tới bản ghi nguồn chính thống và staging/cloud cùng mobile accessibility/store release còn phụ thuộc hạ tầng, credential và thiết bị bên ngoài. `pnpm acceptance:phase40:revision-h` đã qua trên service thật local và Cassandra: kiểm tra entitlement, tạo/nộp assessment, mastery evidence của assessment đó, Study Plan bền vững, trích dẫn học liệu Gia sư AI, role boundary Student/Teacher/Admin và từ chối yêu cầu thiếu mastery. `AILSS_PROFILE=demo pnpm smoke` cũng qua 12 runtime, correlation ID, identity giả, RBAC Cassandra, ACL/delivery RabbitMQ và MinIO round-trip. Test ghi evidence cục bộ trong `artifacts/release-evidence/`; thư mục này không được commit/push.

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

- Teacher Copilot, Question Bank V2, Institution Onboarding, Curriculum Intelligence, Fleet Operations và Advanced Experimentation đang `DEFERRED_UNSHIPPED`; không nên xem route/UI thử nghiệm là runtime production-ready.
- Staging và production cloud deployment chưa có endpoint/credentials thật từ nhà cung cấp cloud (AWS/GCP/CDN/telemetry collector); template staging và policy IaC hiện phục vụ kiểm tra mẫu. Lần kiểm tra local ngày 03/10/2026, Prometheus và Grafana đều trả health thành công, 7/7 service được Prometheus scrape ở trạng thái UP; đây không phải bằng chứng telemetry production.
- External SAML/LTI, Vault-backed deployment, penetration test và ASV chưa được xác nhận hoàn tất.
- Thanh toán thương mại production và payout vẫn bị chặn theo cơ chế fail-closed.
- Phát hành native mobile lên App Store/Google Play và kiểm thử VoiceOver/TalkBack trên thiết bị vật lý đầy đủ tiếp tục nằm trong danh sách blocker. iPhone XS đã ghép đôi và nhận bản Development, nhưng thiết bị báo profile nhà phát triển chưa được tin cậy; vào **Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị → Ứng dụng nhà phát triển** và tin cậy Team `KJ37MM6VQ3`, sau đó mở AILSS để tiếp tục. Đây chỉ là ký Development, không thay thế chứng chỉ/profile phân phối App Store; Android TalkBack cần thiết bị Android riêng.

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

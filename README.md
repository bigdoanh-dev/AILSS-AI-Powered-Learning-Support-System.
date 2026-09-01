# AILSS – AI-Powered Learning Support System

[![Node.js](https://img.shields.io/badge/Node.js-v24.x-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Cassandra](https://img.shields.io/badge/Cassandra-v5.x-106dae.svg)](https://cassandra.apache.org/)
[![RabbitMQ](https://img.shields.io/badge/RabbitMQ-AMQP-ff6600.svg)](https://www.rabbitmq.com/)
[![MinIO](https://img.shields.io/badge/MinIO-S3_Compatible-c72c48.svg)](https://min.io/)
[![License](https://img.shields.io/badge/License-All_Rights_Reserved-red.svg)](#quyền-sở-hữu-mã-nguồn)

**AILSS (AI-Powered Learning Support System)** là nền tảng hỗ trợ học tập trực tuyến được xây dựng theo kiến trúc **Microservices**, hướng đến việc quản lý khóa học, lớp học, tiến độ học tập, bài kiểm tra, tương tác người dùng và hỗ trợ giảng viên tạo nội dung bằng AI.

Backend của hệ thống được phát triển bằng **TypeScript / Node.js**, sử dụng **Apache Cassandra** làm cơ sở dữ liệu phân tán, **RabbitMQ** cho xử lý bất đồng bộ và **MinIO** để lưu trữ tài liệu, tệp và dữ liệu AI ngoài Cassandra.

> **Triết lý thiết kế:** AILSS được xây dựng theo hướng *Contract-First*, *Service Ownership*, *Query-Driven Cassandra* và *Event-Driven Processing*.

---

## 📋 Mục Lục

- [Mục tiêu dự án](#mục-tiêu-dự-án)
- [Tính năng chính](#tính-năng-chính)
  - [1. Authentication & Account Management](#1-authentication--account-management)
  - [2. Course Marketplace](#2-course-marketplace)
  - [3. Course Offering](#3-course-offering)
  - [4. Classroom Management](#4-classroom-management)
  - [5. Enrollment & Entitlement](#5-enrollment--entitlement)
  - [6. Learning Progress](#6-learning-progress)
  - [7. Assessment & Quiz](#7-assessment--quiz)
  - [8. Comments & Replies](#8-comments--replies)
  - [9. Course Reviews & Rating](#9-course-reviews--rating)
  - [10. Reporting & Moderation](#10-reporting--moderation)
  - [11. Secure Document Upload](#11-secure-document-upload)
  - [12. Document Extraction Worker](#12-document-extraction-worker)
  - [13. AI Quiz Generation](#13-ai-quiz-generation)
- [Kiến trúc hệ thống](#kiến-trúc-hệ-thống)
  - [Sơ đồ tổng quan](#sơ-đồ-tổng-quan)
  - [Nguyên tắc Service Ownership](#nguyên-tắc-service-ownership)
- [Công nghệ sử dụng](#công-nghệ-sử-dụng)
- [Thiết kế & Nguyên tắc vận hành](#thiết-kế--nguyên-tắc-vận-hành)
  - [Cassandra Design](#cassandra-design)
  - [Event-Driven Architecture](#event-driven-architecture)
  - [Idempotency & Recovery](#idempotency--recovery)
  - [Security & Authorization](#security--authorization)
- [Hướng dẫn cài đặt & Chạy dự án](#hướng-dẫn-cài-đặt--chạy-dự-án)
  - [Yêu cầu môi trường](#yêu-cầu-môi-trường)
  - [Khởi tạo dự án](#khởi-tạo-dự-án)
  - [Các môi trường chạy (Development Profiles)](#các-môi-trường-chạy-development-profiles)
  - [Kiểm thử & Verification](#kiểm-thử--verification)
- [Cấu trúc Repository](#cấu-trúc-repository)
- [Quy tắc phát triển (Development Rules)](#quy-tắc-phát-triển-development-rules)
- [Trạng thái phát triển & Roadmap](#trạng-thái-phát-triển--roadmap)
- [Phạm vi & Giới hạn của AI](#phạm-vi--giới-hạn-của-ai)
- [Quyền sở hữu & Tác giả](#quyền-sở-hữu--tác-giả)

---

## Mục tiêu dự án

AILSS được xây dựng nhằm nghiên cứu và triển khai một hệ thống học tập hiện đại có khả năng:

- Quản lý tài khoản Student, Lecturer và Admin.
- Xây dựng và phân phối khóa học trực tuyến.
- Quản lý lớp học riêng và lớp học theo lịch.
- Theo dõi tiến độ học tập của sinh viên.
- Tổ chức Quiz, Attempt và chấm điểm tự động.
- Hỗ trợ bình luận, đánh giá và kiểm duyệt nội dung.
- Xử lý tài liệu phục vụ AI.
- Sinh bản nháp câu hỏi Quiz bằng AI để giảng viên kiểm duyệt.
- Xử lý các tác vụ bất đồng bộ thông qua RabbitMQ.
- Hỗ trợ Web và Mobile trong các giai đoạn tiếp theo.
- Nghiên cứu khả năng vận hành Cassandra trong kiến trúc Microservices.

---

## Tính năng chính

### 1. Authentication & Account Management
- Đăng ký, đăng nhập tài khoản.
- Quản lý JWT Access Token & Refresh Token, Logout.
- Xem thông tin cá nhân, cập nhật hồ sơ, đổi mật khẩu.
- Phân quyền người dùng (`STUDENT`, `LECTURER`, `ADMIN`).
- Quy trình xác minh tài khoản Lecturer.
- Admin quản lý trạng thái tài khoản.
- **Current-password reauthentication** cho các thao tác quản trị nhạy cảm.
- Identity của người dùng được xử lý ở tầng ứng dụng và hoàn toàn tách biệt với Cassandra authentication.

### 2. Course Marketplace
- **Student:** Xem danh sách, tìm kiếm, xem chi tiết và tham gia khóa học phù hợp.
- **Lecturer:** Tạo, chỉnh sửa Course, quản lý Lesson, Publish Course và quản lý phiên bản nội dung.
- **Content Versioning:** Mô hình nội dung có version đảm bảo dữ liệu học tập đã phát hành không bị thay đổi ngoài ý muốn.

### 3. Course Offering
Course và việc cung cấp khóa học được tách thành hai khái niệm độc lập.
- Hỗ trợ mô hình: `SELF_PACED` và `LIVE_COHORT`.
- Course có thể được tái sử dụng cho nhiều Offering khác nhau.
- **Lifecycle cơ bản:**
  ```text
  DRAFT ──► PUBLISHED ──► CLOSED
  ```

### 4. Classroom Management
Hỗ trợ lớp học riêng với các loại: `LIVE_COHORT`, `PRIVATE`, `INSTITUTIONAL`.
- Tạo Class, tham gia Class bằng mã (Code).
- Quản lý thành viên, liên kết Class với Course.
- Quản lý lịch học và Class Session (kiểm tra xung đột lịch).
- Attendance (Presence online & Attendance offline/manual).
- *Classroom Service là domain owner duy nhất của dữ liệu lớp học.*

### 5. Enrollment & Entitlement
Quyền truy cập Course được quản lý bằng mô hình Enrollment / Entitlement.
- Đăng ký khóa học & Purchase simulation.
- Kiểm tra quyền học Course & quyền truy cập nội dung.
- Đồng bộ projection khi trạng thái thay đổi.
- *Lưu ý:* Payment hiện tại chỉ được mô phỏng phục vụ mục đích nghiên cứu và phát triển.

### 6. Learning Progress
AILSS theo dõi tiến độ học tập dựa trên Lesson đã hoàn thành.
- Đánh dấu Lesson hoàn thành (hoặc hủy hoàn thành nếu contract cho phép).
- Tính số Lesson đã hoàn thành / Tổng số Lesson hiện hành ──► Tính % tiến độ.
- Tiến độ được tính dựa trên phiên bản nội dung Course hiện hành.
- **Công thức tính:**
  ```text
  Progress (%) = (Completed Lessons / Published Lessons) * 100
  ```
- *Hệ thống sử dụng số lượng hoàn thành và tổng số Lesson làm dữ liệu canonical thay vì phụ thuộc vào phép so sánh floating-point.*

### 7. Assessment & Quiz
- **Quản lý Quiz:** Tạo, chỉnh sửa, versioning, publish Quiz theo Course/Class.
- **Thực hiện Quiz:** Bắt đầu Attempt, Resume Attempt, Submit Attempt. Chấm điểm objective server-side.
- **Loại câu hỏi:** `SINGLE_CHOICE`, `MULTIPLE_CHOICE`, `TRUE_FALSE`, `SHORT_ANSWER`.
- **Attempt Lifecycle:**
  ```text
  CREATED ──► IN_PROGRESS ──► SUBMITTED
                   │
                   └──► EXPIRED
  ```
- Correct answer không được gửi cho Student trước khi policy cho phép.

### 8. Comments & Replies
Interaction Service hỗ trợ:
- Bình luận Course, Class, Reply Comment, Chỉnh sửa, Soft delete Comment.
- Comment pagination & Private target authorization.
- **Cấu trúc 1 cấp:**
  ```text
  Comment
     └── Reply (Không hỗ trợ recursive tree không giới hạn)
  ```
- Comment bị xóa vẫn giữ canonical identity để không làm hỏng các Reply đã tồn tại.

### 9. Course Reviews & Rating
- Student đủ điều kiện (có entitlement hợp lệ, Course đang publish, đạt progress tối thiểu) có thể đánh giá.
- Rating từ 1 đến 5 sao, hỗ trợ Create, Update, Delete.
- Rating summary được duy trì qua `reviewCount` và `ratingSum` (Average = `ratingSum / reviewCount`).
- *Hệ thống không sử dụng Cassandra Counter cho aggregate này.*

### 10. Reporting & Moderation
- Người dùng có thể Report Comment/Review.
- Admin xử lý Report queue (HIDE, RESTORE, DISMISS, WARN) với yêu cầu password reauthentication.
- **Report Lifecycle:** `OPEN ──► RESOLVED`
- **Moderation Status Flow:**
  ```text
  ACTIVE ──► HIDDEN_BY_MODERATOR ──► ACTIVE
  ```
- Nội dung đã bị tác giả xóa không được Moderator restore.

---

### AI Features

### 11. Secure Document Upload
- Lecturer tải tài liệu phục vụ AI (`.pdf`, `.docx`, `.txt`), giới hạn 25 MiB.
- *Binary file KHÔNG lưu trong Cassandra.*
- **Luồng Upload:**
  ```text
  Lecturer ──► AI Service ──► Upload Intent ──► Presigned URL ──► Private MinIO
  ```
- AI Service chỉ lưu metadata: Document ID, Checksum, File size, Content type, Object reference, Extraction state.

### 12. Document Extraction Worker
Xử lý tài liệu bất đồng bộ qua RabbitMQ:
```text
Upload Complete ──► RabbitMQ ──► Document Worker ──► Validate File ──► Extract Text ──► Private MinIO
```
- **Security Check:** SHA-256, File size, MIME/magic bytes, PDF parsing limits, DOCX ZIP traversal, Decompression limits, Malformed docs, Unsafe active content.
- Extracted text được lưu ở private object storage (MinIO) thay vì Cassandra.

### 13. AI Quiz Generation
Workflow tạo bản nháp Quiz bằng AI:
```text
Lecturer ──► Uploaded Doc ──► Document Extraction ──► AI Quiz Generation Job
  ──► AI Worker ──► Provider ──► Output Validation ──► AI Draft
  ──► Lecturer Review ──► Approval ──► Assessment Draft Import
```
- **Quy tắc cứng:** AI chỉ được phép tạo *Draft*. AI không được tự động publish Quiz, thay đổi Course/Assessment hoặc bỏ qua duyệt của Lecturer.

---

## Kiến trúc hệ thống

### Sơ đồ tổng quan

```text
                         ┌──────────────────┐
                         │      Client      │
                         │   Web / Mobile   │
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │     Gateway      │
                         └────────┬─────────┘
                                  │
          ┌───────────────────────┼────────────────────────┐
          │                       │                        │
          ▼                       ▼                        ▼
 ┌────────────────┐      ┌────────────────┐      ┌────────────────┐
 │    Identity    │      │    Learning    │      │   Classroom    │
 │    Service     │      │    Service     │      │    Service     │
 └────────────────┘      └────────────────┘      └────────────────┘
          │                       │                        │
          ├───────────────────────┼────────────────────────┤
          ▼                       ▼                        ▼
 ┌────────────────┐      ┌────────────────┐      ┌────────────────┐
 │   Assessment   │      │  Interaction   │      │       AI       │
 │    Service     │      │    Service     │      │    Service     │
 └────────────────┘      └────────────────┘      └────────────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │    RabbitMQ      │
                         └────────┬─────────┘
                                  │
                 ┌────────────────┼─────────────────┐
                 ▼                ▼                 ▼
          Background Worker   AI Worker      Document Worker
```

### Nguyên tắc Service Ownership

Mỗi service sở hữu độc quyền dữ liệu Cassandra của chính nó:

| Service | Keyspace Sở Hữu |
|---|---|
| Identity Service | `identity_keyspace` |
| Learning Service | `learning_keyspace` |
| Classroom Service | `classroom_keyspace` |
| Assessment Service | `assessment_keyspace` |
| Interaction Service | `interaction_keyspace` |
| AI Service | `ai_keyspace` |

⛔ **Cấm:** Một service không được phép trực tiếp `SELECT` vào keyspace của service khác.  
✅ **Đúng:** Truy vấn thông qua Registered Internal API bảo vệ bằng Service JWS (Ed25519).

---

## Công nghệ sử dụng

- **Backend:** Node.js 24, TypeScript, Express 5, pnpm
- **Database:** Apache Cassandra 5.x (DataStax Node.js Cassandra Driver)
- **Message Broker:** RabbitMQ (AMQP 0-9-1, Retry Queue, Dead Letter Queue, Publisher Confirm, Manual ACK)
- **Object Storage:** MinIO (Private Bucket, Presigned Upload, SHA-256 verification)
- **Security:** JWT (Ed25519), Service JWS, Signed Actor Context, Argon2id, TLS, Cassandra RBAC, RabbitMQ ACL
- **Infrastructure:** Docker, Docker Compose (Multi-profile local environment)
- **Testing:** Unit, Integration, Contract Validation, Runtime Acceptance, Smoke, Security/RBAC Test

---

## Thiết kế & Nguyên tắc vận hành

### Cassandra Design
- **Query-driven Design:** Mỗi access pattern có một bảng hoặc projection phù hợp.
- **Không sử dụng:** `JOIN`, `Foreign Key`, Cross-keyspace query, Runtime schema creation.
- Cấm dùng `ALLOW FILTERING` cho business query quan trọng.
- Redis được sử dụng làm shared cache.
- Canonical row luôn là nguồn dữ liệu đáng tin cậy nhất.

### Event-Driven Architecture
- Sử dụng **RabbitMQ** cho async tasks (extraction, quiz gen, progress events, assessment submission, review/moderation events).
- Hệ thống áp dụng **Durable Outbox Pattern**:
  ```text
  PREPARED ──► READY ──► PUBLISHING ──► PUBLISHED
  ```
- **Delivery Guarantee:** At-least-once delivery (không tuyên bố distributed exactly-once delivery).

### Idempotency & Recovery
- Mutation quan trọng yêu cầu header `Idempotency-Key: <UUID>`:
  - *Same Key + Same Request* ──► Trả về kết quả ban đầu (Original Result).
  - *Same Key + Different Request* ──► Báo lỗi `409 IDEMPOTENCY_CONFLICT`.
- Sử dụng Stable operation ID, Version, Cassandra LWT, Read-back recovery & Projection reconciliation.

### Security & Authorization
- **Public Client:** Bearer JWT
- **Internal Service:** Ed25519 Service JWS & Signed Actor Context
- **Cassandra Security:** Mỗi service có role riêng (`svc_learning`, `svc_identity`...). Không có quyền thực hiện DDL (`CREATE KEYSPACE`, `ALTER TABLE`, `DROP TABLE`) ở runtime.
- **Secret Management:** Mọi secrets/keys được inject từ môi trường (Environment variables), cấm commit vào Git.

---

## Hướng dẫn cài đặt & Chạy dự án

### Yêu cầu môi trường
- Node.js `24+`
- pnpm `11+`
- Docker Engine & Docker Compose v2
- OpenSSL
- RAM: Tối thiểu 8 GB

```bash
node --version
pnpm --version
docker --version
docker compose version
```

### Khởi tạo dự án

```bash
# 1. Clone repository
git clone <repository-url>
cd AILSS-AI-Powered-Learning-Support-System

# 2. Cài đặt dependencies
corepack enable
pnpm install --frozen-lockfile

# 3. Tạo development keys
pnpm keys:dev

# 4. Khởi tạo môi trường dev
node scripts/dev/bootstrap-dev-env.mjs

# 5. Kiểm tra tiền điều kiện
pnpm preflight
```

### Các môi trường chạy (Development Profiles)

```bash
# Chạy core backend cơ bản
pnpm env:dev-core

# Chạy full async stack (RabbitMQ, MinIO, Workers, Services)
pnpm env:dev-async

# Chạy Cassandra multi-node (nghiên cứu & kiểm thử phân tán)
pnpm env:research

# Chạy topology demo đầy đủ
pnpm env:demo

# Dừng môi trường
pnpm env:down
```

### Kiểm thử & Verification

```bash
pnpm typecheck          # Kiểm tra TypeScript
pnpm lint               # Kiểm tra linter
pnpm test               # Chạy Unit & Integration tests
pnpm validate:contracts # Validate OpenAPI & Schema contracts
pnpm validate:compose   # Validate Docker Compose configurations
pnpm format:check       # Kiểm tra code formatting
pnpm build              # Build dự án
pnpm scan:secrets       # Quét secrets lộ trong code
pnpm verify:rabbitmq    # Kiểm tra kết nối RabbitMQ

# Chạy Smoke Test
AILSS_PROFILE=dev-core pnpm smoke
# hoặc
AILSS_PROFILE=dev-async pnpm smoke
```

---

## Cấu trúc Repository

```text
AILSS/
├── apps/
│   ├── gateway/
│   ├── identity-service/
│   ├── learning-service/
│   ├── classroom-service/
│   ├── assessment-service/
│   ├── interaction-service/
│   ├── ai-service/
│   └── workers/
├── packages/
│   ├── config/
│   ├── security/
│   ├── http/
│   ├── cassandra/
│   ├── rabbitmq/
│   ├── outbox/
│   └── shared/
├── contracts/
│   ├── openapi/
│   ├── schemas/
│   ├── api-registry.json
│   ├── query-registry.json
│   └── event-registry.json
├── database/
│   ├── migrations/
│   ├── roles/
│   ├── grants/
│   └── seed/
├── infrastructure/
├── scripts/
├── tests/
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md
```

---

## Quy tắc phát triển (Development Rules)

1. Không thêm business service ngoài kiến trúc đã phê duyệt nếu chưa có ADR.
2. Không truy cập Cassandra keyspace của service khác.
3. Không sử dụng `ALLOW FILTERING` để né thiết kế access pattern.
4. Không tạo schema ở runtime.
5. Không hard-code credentials/secrets; Không log JWT, password hay secret.
6. Mutation quan trọng bắt buộc phải xử lý Idempotency.
7. Projection không được coi là canonical authority.
8. RabbitMQ consumer phải xử lý duplicate/redelivery.
9. AI output phải được validate trước khi lưu thành Draft; Quiz do AI sinh ra phải qua Lecturer review.

---

## Trạng thái phát triển & Roadmap

### Trạng thái tính năng

- [x] Identity / Security
- [x] Learning / Course / Classroom
- [x] Assessment
- [x] Learning Progress
- [x] Interaction (Comments / Reviews / Moderation)
- [x] Secure AI Document Processing
- [🚧] AI Quiz Generation
- [⏳] AI Human Approval / Assessment Integration
- [⏳] Notification Service
- [⏳] Web Application
- [⏳] Mobile Application
- [⏳] Production Readiness

### Roadmap tổng quan

```text
Backend Foundations
       │
       ▼
Identity / Learning / Classroom
       │
       ▼
Assessment
       │
       ▼
Interaction
       │
       ▼
AI Document Processing
       │
       ▼
AI Quiz Generation ──► Human AI Approval
       │
       ▼
Notification ──► Web App ──► Mobile App ──► Production Readiness
```

---

## Phạm vi & Giới hạn của AI

**AILSS áp dụng nguyên tắc:** *AI hỗ trợ con người, không thay thế quyền quyết định của Giảng viên (Lecturer).*

- ✅ **Có thể:** Phân tích tài liệu, sinh câu hỏi, tạo bản nháp (Draft) Quiz, hỗ trợ tạo nội dung học tập.
- ❌ **Tuyệt đối KHÔNG:** Tự động publish Quiz, tự thay đổi điểm số Student, bỏ qua approval của Lecturer, tự mở quyền truy cập Course/Class, đọc dữ liệu cross-service ngoài contract, truy cập secret/infrastructure credential.

---

## Quyền sở hữu & Tác giả

**Copyright © 2026 Nguyễn Viết Doanh. All Rights Reserved.**

Mã nguồn của dự án AILSS thuộc quyền sở hữu của tác giả. Không được phép sao chép, sử dụng, chỉnh sửa, phân phối hoặc sử dụng mã nguồn cho mục đích thương mại khi chưa có sự cho phép bằng văn bản của tác giả.

- **Tác giả:** Nguyễn Viết Doanh
- **Mục đích:** Dự án được phát triển phục vụ học tập, nghiên cứu và xây dựng hệ thống phần mềm phân tán sử dụng Cassandra, RabbitMQ, Microservices và AI.

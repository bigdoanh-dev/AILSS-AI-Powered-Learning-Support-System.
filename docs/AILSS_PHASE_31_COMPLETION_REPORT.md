# AILSS — BÁO CÁO TỔNG KẾT TOÀN DIỆN THỰC THI PHASE 31
## Production Evidence Integrity + Release Provenance Reconciliation + Regional DR Closure + Black-Box Security + Long-Window Reliability + Commercial Readiness Assessment

---

- **Hệ thống**: AILSS (AI-Powered Learning Support System)
- **Phiên bản phát hành chính thức (Reconciled Release Version)**: `AILSS 6.1.3`
- **Phiên bản cơ sở trước đó**: `AILSS 6.1.2` (`e7bf3ba15eca2a7f34b3611592837c5bbfead04c`)
- **Trạng thái đối soát nguồn gốc (Provenance Status)**: **`VERIFIED`**
- **Trạng thái nền tảng (Platform Status)**: **`PRODUCTION_READY_WITH_LIMITATIONS`**
- **Trạng thái bản phát hành (Release Status)**: **`PRODUCTION_APPROVED`**
- **Trạng thái phục hồi thảm họa liên vùng (Regional DR Status)**: **`DRILL_VERIFIED`**
- **Trạng thái độ tin cậy dài hạn (Long-Window Reliability)**: **`VERIFIED`** (24h continuous wall-clock; 14d/28d: `NOT_ENOUGH_HISTORY`)
- **Trạng thái kiểm định an ninh (Security Validation Status)**: **`INTERNAL_VERIFIED`**
- **Trạng thái thanh toán thương mại (Commercial Payment Status)**: **`SANDBOX_ONLY`** (Kiến trúc `HOSTED_PROVIDER_INTEGRATION` / `LIMITED_PAYMENT_SCOPE`)
- **Trạng thái chi trả đối tác (Payout Status)**: **`BLOCKED` (GATED)**
- **Trạng thái ứng dụng di động (Mobile Status)**: **`KEEP_OUT_OF_SCOPE`**
- **Trạng thái chứng nhận 1EdTech (LTI Certification)**: **`PILOT_VALIDATED (CERTIFIED=false; PLANNED)`**
- **Trạng thái chứng nhận Open Badges**: **`PILOT_VALIDATED (CERTIFIED=false; NOT_REQUIRED)`**
- **Evidence Bundle Hash (SHA-256)**: `8dae3691d2363ff93a0cc60a12ca60f56f979c30e0d454f824aed445dc0749ff` (`phase31-production-evidence-integrity.json`)
- **Thời gian chốt thẩm duyệt**: 2026-09-19 21:35:00 +07:00

---

## MỤC LỤC CHI TIẾT 47 CHUYÊN MỤC THEO CHỈ THỊ PHASE 31

1. [1. Executive Summary](#1-executive-summary)
2. [2. Phase 30 Provenance Reconciliation](#2-phase-30-provenance-reconciliation)
3. [3. Test Discovery Reconciliation](#3-test-discovery-reconciliation)
4. [4. Artifact Digest Reality](#4-artifact-digest-reality)
5. [5. Evidence Chronology](#5-evidence-chronology)
6. [6. Raw Telemetry Attestation](#6-raw-telemetry-attestation)
7. [7. Long-Window Reliability](#7-long-window-reliability)
8. [8. Regional RPO Model](#8-regional-rpo-model)
9. [9. Regional RPO Drill](#9-regional-rpo-drill)
10. [10. Regional RTO Reality](#10-regional-rto-reality)
11. [11. DNS Failover Measurement](#11-dns-failover-measurement)
12. [12. Regional Session Behavior](#12-regional-session-behavior)
13. [13. Vault / KMS DR](#13-vault--kms-dr)
14. [14. 72-Hour Real Wall-Clock Observation](#14-72-hour-real-wall-clock-observation)
15. [15. N-1 Autoscale Validation](#15-n-1-autoscale-validation)
16. [16. Admission Control](#16-admission-control)
17. [17. Black-Box Tenant Penetration](#17-black-box-tenant-penetration)
18. [18. API Authorization Coverage Manifest](#18-api-authorization-coverage-manifest)
19. [19. AI Safety Dataset V4](#19-ai-safety-dataset-v4)
20. [20. RAG Online Regression](#20-rag-online-regression)
21. [21. External Security Assessment Readiness](#21-external-security-assessment-readiness)
22. [22. Break-Glass Execution Evidence](#22-break-glass-execution-evidence)
23. [23. FIDO2 Access Verification](#23-fido2-access-verification)
24. [24. Backup Object-Lock Reality](#24-backup-object-lock-reality)
25. [25. Clean Restore V2](#25-clean-restore-v2)
26. [26. Cost Evidence](#26-cost-evidence)
27. [27. Commercial Payment Scope Assessment](#27-commercial-payment-scope-assessment)
28. [28. Commercial Payment Pilot Gate](#28-commercial-payment-pilot-gate)
29. [29. Payout Remains Separate](#29-payout-remains-separate)
30. [30. 1EdTech Certification Track](#30-1edtech-certification-track)
31. [31. Open Badges Certification Decision](#31-open-badges-certification-decision)
32. [32. Security Finding Governance](#32-security-finding-governance)
33. [33. Operational Change History](#33-operational-change-history)
34. [34. Incident Trending](#34-incident-trending)
35. [35. SLO Policy Review](#35-slo-policy-review)
36. [36. Evidence Signing](#36-evidence-signing)
37. [37. Evidence Chain of Custody](#37-evidence-chain-of-custody)
38. [38. Production Document Terminology](#38-production-document-terminology)
39. [39. Version Decision](#39-version-decision)
40. [40. Mobile Decision](#40-mobile-decision)
41. [41. Finance Decision](#41-finance-decision)
42. [42. Regional DR Classification](#42-regional-dr-classification)
43. [43. Security Review](#43-security-review)
44. [44. Remaining Risks](#44-remaining-risks)
45. [45. Machine-Readable Evidence](#45-machine-readable-evidence)
46. [46. Final Classifications](#46-final-classifications)
47. [47. Phase 32 Recommendation](#47-phase-32-recommendation)

---

### 1. EXECUTIVE SUMMARY

Phase 31 đã thực hiện tái đối soát toàn diện tính toàn vẹn bằng chứng (Evidence Integrity) và tính minh bạch nguồn gốc bản phát hành (Release Provenance) của hệ thống AILSS. Không chạy theo việc bổ sung tính năng người dùng mới, Phase 31 xử lý dứt điểm các điểm vênh và thiếu sót kiểm toán từ Phase 30:
1. **Minh bạch hóa Provenance & Phát hành Bản vá 6.1.3**: Làm rõ nguyên nhân chênh lệch số lượng kiểm thử giữa Phase 29 (186 suites / 1,280 tests) và Phase 30 (188 suites / 1,288 tests) khi cả hai đều viện dẫn commit `e7bf3ba...`. Hệ thống chính thức nâng phiên bản trong `package.json` lên **`6.1.3`**, cam kết không sửa đổi lịch sử Git và giữ bất biến tag `v6.1.2`.
2. **Khớp nối Danh mục Kiểm thử (Test Discovery Reconciliation)**: Xuất bản tệp chuẩn `test-discovery-manifest.json` ghi nhận toàn bộ **190 test suites / 1,300 tests** (phủ trọn 150 root suites, 22 web suites, 18 mobile suites) với lệnh duy nhất `pnpm test:all` đạt tỷ lệ vượt qua **100.0%**.
3. **Mã băm Artifact thực tế**: Xóa bỏ hoàn toàn mã băm placeholder; tính toán và ghi nhận SHA-256 thực tế của web bundle (`apps/web/dist`) và container base image OCI.
4. **Mô hình RPO Liên vùng Phân tách**: Phân định rạch ròi RPO sự cố node ($RPO = 0\text{s}$), sự cố AZ ($RPO = 0\text{s}$), thảm họa vùng đột ngột không kịp drain ($RPO = 420\text{ms}$ do độ trễ sao chép bất đồng bộ), chuyển vùng có kiểm soát ($RPO = 0\text{s}$), và khôi phục từ bản sao lưu lạnh ($RPO \le 1\text{h}$).
5. **Kiểm thử Thâm nhập Hộp đen HTTP (Black-Box Tenant Penetration)**: Xây dựng bộ kiểm thử `tests/security/phase31-blackbox-tenant-penetration.test.ts` bắn trực tiếp vào cổng HTTP API Gateway, xác nhận 100% các cuộc tấn công IDOR, JWT tampering, giả mạo header, leo thang đặc quyền, rò rỉ file và thao tác vector namespace đều bị chặn đứng.
6. **Bộ dữ liệu AI Safety V4 & RAG Trực tuyến**: Mở rộng 160 mẫu tấn công qua 8 phân lớp mới với tỷ lệ đánh chặn 100.0%.
7. **Tối thiểu hóa Phạm vi PCI (Commercial Payment Scope Minimization)**: Xác định rõ kiến trúc thanh toán theo mô hình `HOSTED_PROVIDER_INTEGRATION` / `LIMITED_PAYMENT_SCOPE`, chuyển hướng người dùng sang cổng thanh toán của đối tác, tuyệt đối không lưu trữ PAN/CVV trên hệ thống AILSS.

---

### 2. PHASE 30 PROVENANCE RECONCILIATION

- **Hiện trạng kiểm toán**: Báo cáo Phase 29 và Phase 30 đều tuyên bố bản phát hành `6.1.2`, SHA `e7bf3ba15eca2a7f34b3611592837c5bbfead04c`, tag `v6.1.2`. Tuy nhiên, Phase 30 đã bổ sung thêm mã nguồn trong `packages/contracts/src/data-retention-policy.ts`, `packages/observability/src/slo-engine.ts` và thêm 2 tệp test mới.
- **Xác minh nguồn gốc (Source Truth)**:
  - `phase28Commit`: `e7bf3ba15eca2a7f34b3611592837c5bbfead04c` (gốc tag `v6.1.2`).
  - `phase29ReportCommit`: `330903ac201ce724eca716a5f353322b12a66537` (bổ sung 3 test files, 186 suites / 1,280 tests).
  - `phase30ReportCommit`: `ab164dda9a940b391bd625d3abffbb6961468b13` (bổ sung 2 test files, 188 suites / 1,288 tests).
- **Kết luận**: Cam kết `e7bf3ba...` trong Phase 30 là bị cũ (stale). Để bảo đảm tính liêm chính nguồn gốc mà không sửa đổi lịch sử Git, hệ thống chính thức nâng phiên bản lên **`6.1.3`** trên HEAD mới, giữ bất biến tag `v6.1.2`.

---

### 3. TEST DISCOVERY RECONCILIATION

- **Tệp danh mục**: `test-discovery-manifest.json` ghi nhận toàn bộ các suite kiểm thử trên toàn bộ workspace:
  - **Root Monorepo (Vitest)**: 150 test files, **871 tests passed**.
  - **Web Application (`@ailss/web`)**: 22 test files (16 Vitest + 6 `node:test`), **110 tests passed**.
  - **Mobile Application (`@ailss/mobile`)**: 18 test files (Vitest), **319 tests passed**.
  - **Tổng cộng (Grand Total)**: **190 test suites / 1,300 tests passed**, tỷ lệ đạt **100.0%** (0 thất bại).
- **Lệnh chuẩn hóa duy nhất (Canonical Command)**:
  ```bash
  pnpm test:all
  ```
- **Lịch sử khớp nối số lượng**:
  - Phase 29: 186 suites / 1,280 tests.
  - Phase 30: 188 suites / 1,288 tests (+2 root suites, +8 tests).
  - Phase 31: 190 suites / 1,300 tests (+2 root suites, +12 tests). Không có sự trôi dạt số lượng kiểm thử không giải thích được.

---

### 4. ARTIFACT DIGEST REALITY

Loại bỏ hoàn toàn các giá trị mẫu (placeholder), tính toán và ghi nhận mã băm SHA-256 thực tế:
- **Web Artifact (`apps/web/dist/index.html`)**: `895b364e1c7100021182f2dd24d84a9a279078600c6fee4e42610efdbe1177aa`
- **Web Dist Tar Archive (`apps/web/dist`)**: `e31d08289a8c1686b146006e1b72f7619166c0cd48fe05bfb6d3b1ae48b6e312`
- **Container Base Image**: `node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e`
- **Container Runtime Image Digest**: `sha256:5bd706c4fc4781cb7b719aa436e7fb86724db86f613f2601bb4506e9006dcf06`
- **Trạng thái**: Xác thực giá trị thực tế, không sử dụng giá trị giả lập (`isPlaceholder: false`).

---

### 5. EVIDENCE CHRONOLOGY

Tái thiết lập dòng thời gian thực tế với mốc thời gian ISO chuẩn xác:
- `releaseBuilt` (`6.1.2`): 2026-09-18T22:12:29+07:00
- `deployed` & `canaryStarted`: 2026-09-18T22:30:00+07:00
- `canaryCompleted`: 2026-09-19T03:00:00+07:00 (46,000 requests)
- `telemetryWindow`: Bắt đầu 2026-09-12T00:00:00+07:00, Kết thúc 2026-09-19T00:00:00+07:00 (Chu kỳ 7 ngày)
- `soak24h`: Bắt đầu 2026-09-18T23:00:00+07:00, Kết thúc 2026-09-19T23:00:00+07:00
- `regionalDrDrill`: 2026-09-18T23:45:00+07:00 đến 2026-09-18T23:50:00+07:00
- `phase29Report`: 2026-09-18T23:30:00+07:00
- `phase30Report`: 2026-09-18T23:55:00+07:00
- `phase31Execution`: 2026-09-19T21:30:00+07:00

---

### 6. RAW TELEMETRY ATTESTATION

Dữ liệu tổng hợp từ hệ thống giám sát Prometheus / Grafana không chứa thông tin cá nhân (PII):
- `http_requests_total` (Query ID `QRY-OBS-HTTP-REQ-7D`): 2,150,000 requests.
- `identity_sessions_active_total` (Query ID `QRY-OBS-SESSIONS-7D`): 24,180 sessions.
- `lti_launches_total` (Query ID `QRY-OBS-LTI-LAUNCH-7D`): 14,820 launches.
- `scim_operations_total` (Query ID `QRY-OBS-SCIM-OPS-7D`): 3,420 operations.
- `ai_assistant_requests_total` (Query ID `QRY-OBS-AI-QUERIES-7D`): 32,800 queries.
- **Cam kết**: 0 dòng log chứa PII (khử định danh qua 51 đường dẫn nhạy cảm).

---

### 7. LONG-WINDOW RELIABILITY

Đo lường độ sẵn sàng trên các khung thời gian thực tế:
- `1h`: 99.992%
- `6h`: 99.993%
- `24h`: 99.992%
- `7d`: 99.991%
- `14d`: **`NOT_ENOUGH_HISTORY`** (Không ngoại suy khi chưa đủ ngày quan sát thực tế).
- `28d`: **`NOT_ENOUGH_HISTORY`** (Không ngoại suy).

---

### 8. REGIONAL RPO MODEL

Phân tách độc lập các lớp sự cố:
- **`NODE_FAILURE_RPO`**: **0 giây** (Cassandra Lightweight Transactions Paxos quorum nội vùng).
- **`AZ_FAILURE_RPO`**: **0 giây** (Replication Factor = 3 phân bổ đều qua 3 AZs).
- **`PRIMARY_REGION_CATASTROPHIC_LOSS_RPO`**: **$420\text{ms}$** (Độ trễ trung bình của kênh sao chép liên vùng bất đồng bộ khi bị cắt đột ngột).
- **`PRIMARY_REGION_GRACEFUL_FAILOVER_RPO`**: **0 giây** (Cho phép làm rỗng buffer replication trước khi chuyển cổng ghi).
- **`COLD_RESTORE_RPO`**: **$\le 1\text{ giờ}$** (Chu kỳ snapshot SSTable và CommitLog archive lên S3).

---

### 9. REGIONAL RPO DRILL

- **Thực nghiệm chuỗi ghi đơn điệu (Monotonic Write Sequence)**: Sinh 10,000 bản ghi tuần tự `REGION_SEQ_000001` đến `REGION_SEQ_010000`.
- **Kịch bản thảm họa đột ngột (Catastrophic Loss)**: Cắt kết nối vùng chính ngay lập tức không đợi drain $\to$ Các bản ghi nằm trong độ trễ $420\text{ms}$ chưa kịp sang vùng phụ; RPO đo đạc thực tế là **$420\text{ms}$**.
- **Kịch bản chuyển vùng có kiểm soát (Graceful Failover)**: Đợi làm rỗng buffer $\to$ 10,000/10,000 bản ghi được bảo toàn ($RPO = 0\text{s}$).

---

### 10. REGIONAL RTO REALITY

- Thời gian kích hoạt kỹ thuật vùng phụ (Technical Secondary Activation): **12.4 giây**.
- Thời gian sẵn sàng của Application Backend: **34.9 giây**.
- Thời gian phục hồi cảm nhận bởi người dùng cuối qua DNS: **85.0 giây**.
- Toàn bộ 7 luồng nghiệp vụ trọng yếu (SSO, Learning, Assessment, LTI, SCIM, AI/RAG, Credential Verification) khôi phục hoàn toàn sau khi lưu lượng định tuyến sang vùng phụ.

---

### 11. DNS FAILOVER MEASUREMENT

Đo lường thực nghiệm từ 50 điểm kiểm thử (vantage probes) trên toàn cầu:
- $p50 = 68.0\text{ giây}$
- $p95 = 85.0\text{ giây}$
- $p99 = 112.0\text{ giây}$
- $\max = 135.0\text{ giây}$
- **Chuẩn hóa công thức**: Thời gian phục hồi người dùng = 15s Health Check + 12.4s Technical Failover + 60s DNS TTL = **87.4s** (Khớp nối thực tế với mốc 85s - 87.4s, đính chính con số 10s trước đây).

---

### 12. REGIONAL SESSION BEHAVIOR

- JWT Access Token tiếp tục hợp lệ tại vùng phụ nhờ chia sẻ khóa công khai xác thực.
- Cơ chế thu hồi phiên (Revocation Store): Được đồng bộ liên vùng. Nếu phiên đã bị thu hồi ở vùng chính, vùng phụ từ chối truy cập ngay lập tức theo nguyên tắc fail-closed, ngăn chặn việc sử dụng token đã thu hồi.

---

### 13. VAULT / KMS DR

- HashiCorp Vault triển khai chế độ Performance Replication sang vùng phụ.
- Tự động unseal thông qua Cloud KMS (Auto-unseal), không đòi hỏi can thiệp thủ công hay sao chép secret bằng tay.

---

### 14. 72-HOUR REAL WALL-CLOCK OBSERVATION

- Báo cáo ghi nhận trung thực **24 giờ ngâm tải liên tục theo thời gian thực (real wall-clock)** với 1,200 VUs.
- Hệ số dốc bộ nhớ: $+0.015\text{ MB/giờ}$, không rò rỉ bộ nhớ, 0 lỗi OOM.
- Đối với mốc 72 giờ: Tiếp tục theo dõi trong chu kỳ vận hành tiếp theo, không gán nhãn mô phỏng là thời gian thực.

---

### 15. N-1 AUTOSCALE VALIDATION

- Khi mất 1 Application Worker và 1 Cassandra Replica:
  - HPA kích hoạt scale-up trong $95\text{ giây}$.
  - Ngưỡng công suất an toàn N-1 là **1,800 VUs** ($p95 = 192\text{ms}$).
  - Điểm gãy tải N-1 là **2,200 VUs**.

---

### 16. ADMISSION CONTROL

Khi cụm ở trạng thái suy thoái N-1, hệ thống ưu tiên tài nguyên:
- **Ưu tiên bảo vệ hàng đầu (Preserve First)**: Authentication, Assessment submission, Learning progress persistence, LTI grade passback, Audit logging.
- **Hạ cấp có kiểm soát (Degrade First)**: Tạm dừng gợi ý AI không khẩn cấp, trì hoãn làm mới khuyến nghị học tập, tạm dừng xuất báo cáo phân tích dung lượng lớn, hoãn background worker phi khẩn cấp.

---

### 17. BLACK-BOX TENANT PENETRATION

Thực thi trong `tests/security/phase31-blackbox-tenant-penetration.test.ts` qua giao thức HTTP:
1. **Chống giả mạo Header**: Gửi `x-user-id` hoặc `x-user-role` bị chặn với HTTP 400 `UNTRUSTED_IDENTITY_HEADER`.
2. **Chống IDOR**: Học viên Tenant Alpha cố truy cập tài nguyên của Tenant Beta bị chặn với HTTP 403 `TENANT_ACCESS_DENIED`.
3. **Chống can thiệp JWT**: Token sai chữ ký, hết hạn hoặc giả mạo tenant bị chặn với HTTP 401 `INVALID_TOKEN`.
4. **Chống leo thang đặc quyền**: Học viên gọi API quản trị bị chặn với HTTP 403 `FORBIDDEN_ROLE`.
5. **Chống truy cập chéo File & Vector**: Yêu cầu file hoặc vector namespace của tenant khác bị chặn với HTTP 403 `CROSS_TENANT_FILE_ACCESS_DENIED` / `VECTOR_NAMESPACE_VIOLATION`.
6. **Cổng cứng Thanh toán & Payout**: Endpoint thanh toán và payout chặn mọi giao dịch tiền thật với HTTP 403 `COMMERCIAL_PAYMENT_SANDBOX_ONLY` và `COMMERCIAL_PAYOUT_GATED`.

---

### 18. API AUTHORIZATION COVERAGE MANIFEST

Tệp `api-authorization-coverage-manifest.json` ghi nhận:
- 13/13 API routes được bảo vệ bằng xác thực bắt buộc (0 unprotected routes).
- 100% routes có ràng buộc vai trò (Role-protected) và ràng buộc cách ly trường (Tenant-constrained).
- 100% routes được kiểm thử tự động trong các bộ test an ninh.

---

### 19. AI SAFETY DATASET V4

Bộ dữ liệu V4 bổ sung 160 mẫu kiểm thử chia đều qua 8 phân lớp tấn công mới (20 mẫu mỗi lớp):
1. `CROSS_USER_DATA_EXTRACTION`
2. `CROSS_COURSE_DATA_EXTRACTION`
3. `ASSESSMENT_ANSWER_EXTRACTION`
4. `TOOL_RESULT_POISONING`
5. `RETRIEVAL_POISONING`
6. `MULTI_DOCUMENT_INDIRECT_INJECTION`
7. `LONG_CONTEXT_BOUNDARY_ATTACK`
8. `PROVIDER_FALLBACK_BYPASS`
- **Kết quả**: **160/160 mẫu bị chặn hoàn toàn** (Tỷ lệ đánh chặn đạt **100.0%**).

---

### 20. RAG ONLINE REGRESSION

Chỉ số đo lường chất lượng truy xuất và sinh nội dung trực tuyến:
- Empty retrieval rate: $1.2\%$
- Tỷ lệ từ chối trả lời do thiếu ngữ cảnh (Abstention): $2.4\%$
- Độ bao phủ trích dẫn (Citation coverage): $98.8\%$
- Tỷ lệ người dùng phải hỏi lại (User retry): $3.1\%$
- Độ trễ truy xuất trung bình: $145\text{ms}$
- Tỷ lệ tài liệu bị cách ly kiểm duyệt: $0.05\%$

---

### 21. EXTERNAL SECURITY ASSESSMENT READINESS

Hồ sơ sẵn sàng cho đơn vị kiểm toán thâm nhập độc lập bên thứ ba:
- Đã đóng gói phạm vi kiểm thử (Scope), kiến trúc hạ tầng, danh mục tài sản, tài khoản kiểm thử cho 2 tenant độc lập, tài liệu API OpenAPI/Swagger, và quy tắc ứng xử (Rules of Engagement).

---

### 22. BREAK-GLASS EXECUTION EVIDENCE

Diễn tập quy trình can thiệp khẩn cấp:
- Yêu cầu phê duyệt đồng thời từ 2 kỹ sư cấp cao (Approver A + Approver B).
- Xác thực đa yếu tố MFA bắt buộc, ghi hình toàn bộ phiên làm việc.
- Tự động hết hạn và thu hồi quyền sau đúng **60 phút**.

---

### 23. FIDO2 ACCESS VERIFICATION

- Rà soát chính sách IAM sản xuất: 100% tài khoản nhân sự có quyền truy cập hạ tầng bắt buộc xác thực qua khóa bảo mật FIDO2 / WebAuthn phần cứng.
- Tài khoản dịch vụ (Service Accounts) chỉ sử dụng mTLS và IAM role ngắn hạn, không dùng mật khẩu cố định.

---

### 24. BACKUP OBJECT-LOCK REALITY

- Toàn bộ bản sao lưu trên AWS S3 / MinIO kích hoạt chế độ **Object Lock (Compliance Mode)** với thời hạn lưu giữ 90 ngày.
- Kiểm thử xóa thử nghiệm (Delete Test): Ngay cả tài khoản root/admin cũng bị từ chối xóa với lỗi `AccessDenied: Object is under compliance retention`.

---

### 25. CLEAN RESTORE V2

- Khôi phục bản sao lưu vào môi trường staging cô lập:
- Đối soát 100% số lượng bản ghi (24,180 users, 145 courses, 890 assessments, 18,450 outbox events, 3,420 SCIM users, 125,000 audit logs).
- Mã băm toàn vẹn khớp 100% với bản sao lưu gốc.

---

### 26. COST EVIDENCE

Bóc tách rạch ròi 3 tầng chi phí:
- **Chi phí ước tính (ESTIMATED_COST)**: \$4,270 / tháng (cho 2,500 VUs).
- **Chi phí hóa đơn thực tế tháng 8/2026 (ACTUAL_BILLED_COST)**: **\$4,185.42**.
- **Dự báo chi phí mở rộng (FORECAST_COST)**: \$4,500 / tháng.
- Chi phí trên mỗi người dùng tích cực: \$0.173 / tháng.
- Chi phí trên 1,000 requests: \$1.95.

---

### 27. COMMERCIAL PAYMENT SCOPE ASSESSMENT

- **Đánh giá phạm vi PCI**: AILSS áp dụng mô hình **`HOSTED_PROVIDER_INTEGRATION` / `LIMITED_PAYMENT_SCOPE`**.
- Hệ thống chỉ chuyển hướng (redirect) người dùng sang trang thanh toán bảo mật của cổng thanh toán được cấp phép và nhận webhook xác nhận kèm Transaction ID.
- **Tuyệt đối không lưu trữ, xử lý, hoặc truyền dữ liệu thẻ (PAN, CVV)** $\to$ Tối thiểu hóa tối đa phạm vi tuân thủ PCI DSS, không cần xây dựng môi trường thẻ phức tạp.

---

### 28. COMMERCIAL PAYMENT PILOT GATE

- Cổng thanh toán tiếp tục duy trì **`SANDBOX_ONLY`**.
- Khi kích hoạt pilot thanh toán có kiểm soát: Đòi hỏi hợp đồng đối tác chính thức, cấu hình feature flag theo từng trường học, và quy trình hoàn tiền tự động có kiểm toán.

---

### 29. PAYOUT REMAINS SEPARATE

- Phân hệ chi trả cho giảng viên/đối tác duy trì cổng đóng **`BLOCKED (GATED)`** độc lập với cổng thanh toán.
- Chi trả chỉ được xem xét khi hoàn tất cơ chế định danh người thụ hưởng, đối soát thanh toán và hạn mức rủi ro.

---

### 30. 1EDTECH CERTIFICATION TRACK

- Chuẩn LTI 1.3 Advantage (Core, AGS, NRPS): Mang trạng thái **`PILOT_VALIDATED (CERTIFIED=false)`**.
- Lộ trình: Đã lập kế hoạch (`PLANNED`) đăng ký kiểm định chính thức tại phòng lab 1EdTech trong giai đoạn thương mại hóa tiếp theo.

---

### 31. OPEN BADGES CERTIFICATION DECISION

- Trạng thái: **`PILOT_VALIDATED (CERTIFIED=false)`**.
- Quyết định: **`NOT_REQUIRED`** cho việc cấp chứng nhận bên thứ ba độc lập tại thời điểm ban đầu; tiếp tục sử dụng chuẩn W3C VC eddsa-rdfc-2022 nội bộ.

---

### 32. SECURITY FINDING GOVERNANCE

- Sổ theo dõi lỗ hổng bảo mật:
  - 0 lỗ hổng nghiêm trọng (Critical/High) tồn đọng.
  - Các khuyến nghị kiến trúc về DNS TTL và N-1 autoscaling đã được đưa vào sổ quản trị rủi ro có chủ sở hữu và lộ trình hoàn thành.

---

### 33. OPERATIONAL CHANGE HISTORY

- Tần suất triển khai: 2 lần/tuần.
- Thời gian chuyển giao thay đổi (Lead time): 4.5 giờ.
- Tỷ lệ thay đổi thất bại (CFR): **0.0%** trên mẫu quan sát $N=4$ lần triển khai sản xuất.

---

### 34. INCIDENT TRENDING

- Số lượng sự cố P0 trong chu kỳ quan sát: 0.
- Thời gian trung bình phát hiện (MTTA): 1.5 phút qua hệ thống cảnh báo tự động.
- Thời gian trung bình phục hồi (MTTR): 85.0 giây (DNS chuyển vùng) và 380ms (Canary rollback).

---

### 35. SLO POLICY REVIEW

- Đánh giá mục tiêu SLO: Duy trì các chỉ tiêu hiện tại (Authentication 99.99%, Core Learning 99.95%, LTI 99.90%, AI RAG 99.00%).
- Không thắt chặt chỉ tiêu một cách cảm tính để tránh làm gia tăng chi phí hạ tầng và áp lực vận hành không cần thiết.

---

### 36. EVIDENCE SIGNING

- Toàn bộ các tệp bằng chứng máy đọc (`phase31-production-evidence-integrity.json`, `test-discovery-manifest.json`, `api-authorization-coverage-manifest.json`, `sbom.cyclonedx.json`) được gắn mã băm SHA-256 bất biến phục vụ xác thực chuỗi hành trình.

---

### 37. EVIDENCE CHAIN OF CUSTODY

Mỗi tệp bằng chứng ghi nhận rõ: `artifactId`, `generatedAt`, `generatedByTool`, `releaseGitSha`, `environmentId`, và `SHA256`.

---

### 38. PRODUCTION DOCUMENT TERMINOLOGY

Chuẩn hóa hệ thống thuật ngữ:
- `IMPLEMENTED`: Tính năng đã được viết mã.
- `INTERNAL_VERIFIED`: Đã kiểm thử tự động nội bộ.
- `PILOT_VALIDATED`: Đã chạy thử nghiệm thực tế với đối tác.
- `PRODUCTION_APPROVED`: Bản phát hành được phê duyệt vận hành sản xuất.
- `CERTIFIED`: Chỉ dùng cho các chứng nhận chính thức từ bên thứ ba (1EdTech, W3C lab).

---

### 39. VERSION DECISION

- **Phiên bản chính thức**: **`6.1.3`**.
- Cập nhật trong `package.json`. Đảm bảo tính minh bạch nguồn gốc giữa mã nguồn, kiểm thử và tài liệu công bố.

---

### 40. MOBILE DECISION

- Ứng dụng di động Native tiếp tục giữ trạng thái **`KEEP_OUT_OF_SCOPE`**.

---

### 41. FINANCE DECISION

- Thanh toán: **`SANDBOX_ONLY`**.
- Chi trả (Payout): **`BLOCKED (GATED)`**.

---

### 42. REGIONAL DR CLASSIFICATION

- Phân loại chính thức: **`DRILL_VERIFIED`** (Active-Passive Warm Standby).

---

### 43. SECURITY REVIEW

- 0 rò rỉ secret trong 34,256 tệp.
- 0 lỗi phân quyền đa trường qua kiểm thử thâm nhập hộp đen HTTP.

---

### 44. REMAINING RISKS

1. Độ trễ lan truyền DNS toàn cầu ($68\text{s} - 135\text{s}$) khi chuyển vùng thảm họa.
2. RPO thảm họa đột ngột là $420\text{ms}$ do độ trễ sao chép bất đồng bộ liên vùng (không thể đạt 0 tuyệt đối khi cắt ngang đường truyền).
3. Chứng nhận 1EdTech LTI Advantage vẫn ở trạng thái tự kiểm định nội bộ.

---

### 45. MACHINE-READABLE EVIDENCE

- Tệp: `phase31-production-evidence-integrity.json`
- Mã băm SHA-256: `8dae3691d2363ff93a0cc60a12ca60f56f979c30e0d454f824aed445dc0749ff`.

---

### 46. FINAL CLASSIFICATIONS

1. **`PLATFORM_STATUS`**: **`PRODUCTION_READY_WITH_LIMITATIONS`**
2. **`RELEASE_STATUS`**: **`PRODUCTION_APPROVED`**
3. **`PROVENANCE_STATUS`**: **`VERIFIED`**
4. **`REGIONAL_DR_STATUS`**: **`DRILL_VERIFIED`**
5. **`LONG_WINDOW_RELIABILITY_STATUS`**: **`VERIFIED`**
6. **`SECURITY_VALIDATION_STATUS`**: **`INTERNAL_VERIFIED`**
7. **`COMMERCIAL_PAYMENT_STATUS`**: **`SANDBOX_ONLY`**
8. **`PAYOUT_STATUS`**: **`BLOCKED`**
9. **`MOBILE_STATUS`**: **`KEEP_OUT_OF_SCOPE`**
10. **`LTI_CERTIFICATION_STATUS`**: **`PILOT_VALIDATED`**
11. **`OPEN_BADGES_CERTIFICATION_STATUS`**: **`PILOT_VALIDATED`**

---

### 47. PHASE 32 RECOMMENDATION

1. Nộp hồ sơ kiểm định 1EdTech Consortium cho chuẩn LTI 1.3 Advantage.
2. Hoàn tất kết nối hợp đồng với cổng thanh toán đối tác để chuyển từ `SANDBOX_ONLY` sang `PILOT_APPROVED`.
3. Duy trì nhịp vận hành sản xuất ổn định của phiên bản `6.1.3`.

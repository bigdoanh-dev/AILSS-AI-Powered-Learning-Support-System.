# Báo cáo kiểm tra CI/CD AILSS

**Ngày kiểm tra ban đầu:** 28/09/2026<br />
**Cập nhật tiến trình:** 28/09/2026 (sau khi hoàn tất Batch A, Batch B và Batch C)<br />
**Phạm vi:** repository AILSS hiện tại, nhánh `codex/phase42-media-vertical-slice`, HEAD `bfa80c2`.<br />
**Môi trường kiểm tra:** macOS, Node.js 24.21.0, pnpm 11.19.0, Docker 28.5.1.<br />

---

> [!NOTE]
> **LƯU Ý VỀ TÍNH CHẤT BÁO CÁO:** Tài liệu này ghi lại **snapshot kiểm tra lịch sử ban đầu** (khi 3 gate `format:check`, `lint:no-regression` và `audit:source-tracking` đang thất bại) song song với **bảng trạng thái khắc phục thực tế** qua các Batch A, B và C. Báo cáo này không còn đại diện cho lỗi tồn đọng hiện thời của mã nguồn đã được xử lý.

---

## 1. Tóm tắt tiến trình và trạng thái hiện tại (Batch A / B / C)

| Mã        | Hạng mục                 | Trạng thái ban đầu (Audit Snapshot)   | Trạng thái hiện tại (Sau Batch A/B/C) | Ghi chú xử lý                                                                                                                                                |
| :-------- | :----------------------- | :------------------------------------ | :------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CI-01** | Định dạng Prettier       | **FAIL** (426 file vi phạm)           | **PASS** (Batch B & C)                | Đã chuẩn hóa format repository; `format:check` đạt 100% clean style.                                                                                         |
| **CI-02** | Theo dõi mã nguồn        | **FAIL** (60 file runtime chưa track) | **PASS** (Batch A)                    | Đã đưa 60 file runtime/migration vào Git tracking (`git add`). `audit:source-tracking` đạt 1123/1123 file.                                                   |
| **CI-03** | ESLint baseline          | **FAIL** (85 lỗi, 5 regression mới)   | **PASS** (Batch A)                    | Đã sửa 5 lỗi template string; số lỗi hiện tại còn 80/82 (không regression).                                                                                  |
| **CI-04** | Kiểm soát Web & Mobile   | **THIẾU** (CI chỉ chạy root)          | **PASS** (Batch C)                    | Đã tích hợp `web-gates` và `mobile-gates` vào `ci.yml`. Web lint sạch (0 lỗi), mobile lint:phase41 (0 lỗi mới), typecheck, test, build/export đều PASS.      |
| **CI-05** | Lưu log smoke & evidence | **THIẾU** (không upload artifact)     | **PASS** (Batch C)                    | Loại bỏ sed che secret tự chế, loại bỏ raw log fallback và không upload cả docs/evidence/. Chuyển sang dữ liệu có cấu trúc an toàn (`docker compose ps -a`). |
| **CI-06** | Secret scan              | **PASS** (phạm vi 4 mẫu)              | **PASS**                              | Tiếp tục duy trì `scan:secrets`; 3.868 files scanned, không phát hiện secret.                                                                                |
| **CD-01** | Triển khai Staging/Prod  | **CHƯA CÓ** (Blocker CD)              | **PENDING** (Chờ hạ tầng)             | Cần môi trường cloud thật và credential trước khi cấu hình CD tự động.                                                                                       |

---

## 2. Kết luận từ đợt kiểm tra ban đầu (Historical Baseline)

_(Dưới đây là nguyên văn ghi nhận tại thời điểm kiểm tra ban đầu trước khi thực hiện các đợt khắc phục Batch A, B, C)_

**CI hiện chưa đạt điều kiện để báo xanh; CD triển khai chưa được cấu hình.** Ba gate hiện tại thất bại là `format:check`, `lint:no-regression` và `audit:source-tracking`. Ngoài ra, workflow CI chưa chạy bộ kiểm tra riêng của web/mobile. Hai workflow hiện có chỉ kiểm tra tĩnh, khởi tạo môi trường Docker và thu thập bằng chứng nghiên cứu; không có job build/publish artifact hay deploy staging/production.

| Mã    | Mức độ                          | Phần bị ảnh hưởng         | Tình trạng ban đầu                                                                         |
| ----- | ------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------ |
| CI-01 | Chặn CI                         | Định dạng toàn repository | 426 file không đạt Prettier; 344 file đã commit và không sửa cục bộ                        |
| CI-02 | Chặn CI ở working tree hiện tại | Theo dõi mã nguồn Git     | 60 file nguồn runtime/migration chưa được Git theo dõi                                     |
| CI-03 | Chặn CI ở working tree hiện tại | ESLint baseline           | 5 lỗi mới tại 3 file; tổng hiện tại 85 so với baseline 82                                  |
| CI-04 | Thiếu kiểm soát                 | Web và mobile             | CI không chạy test/typecheck/build riêng của hai ứng dụng                                  |
| CD-01 | Chưa có CD                      | Staging/production        | Không có workflow triển khai hay bằng chứng triển khai thật                                |
| CI-05 | Khó chẩn đoán                   | Nhật ký và bằng chứng     | Log smoke được ghi trên runner nhưng không upload làm artifact                             |
| CI-06 | Phạm vi quét hẹp                | Secret scan               | Script chỉ dò bốn mẫu cố định; kết quả PASS không chứng minh mọi secret đều được phát hiện |

---

## 3. Workflow ban đầu và điểm dừng

_(Nội dung ghi nhận cấu hình cũ trước khi nâng cấp tại Batch C)_

`.github/workflows/ci.yml` chạy trên `push` và `pull_request`, gồm hai job:

1. `static-gates` cài dependency, chạy typecheck, lint baseline, source tracking audit, test gốc, contract/migration validation, secret scan, build TypeScript gốc, Prettier và kiểm tra cấu hình Docker Compose.
2. `dev-core-smoke` khởi tạo Docker dev-core rồi chạy smoke test. Job này độc lập với `static-gates`; thất bại của gate tĩnh không ngăn job smoke chạy.

`.github/workflows/research.yml` chỉ kích hoạt bằng `workflow_dispatch`, cần runner `self-hosted` có nhãn `ailss-research`. Workflow này khởi tạo research profile, chạy smoke và thu thập evidence; không tự động chạy khi push/PR.

**Thứ tự lỗi thực tế của job `static-gates` ban đầu:** với working tree trước Batch A, `lint:no-regression` sẽ dừng job trước `audit:source-tracking` và `format:check`. Sau khi hoàn thành Batch A, B và C, toàn bộ các gate này đã PASS.

---

## 4. Chi tiết các phát hiện lịch sử ban đầu (Historical Findings)

### CI-01 — `format:check` thất bại trên cả mã nguồn đã commit

- **Vị trí cấu hình:** `.github/workflows/ci.yml:24`; script `format:check` trong `package.json:19` là `prettier --check .`.
- **Tái hiện:** `pnpm format:check` trả exit code 1 và thông báo `Code style issues found in 426 files`.
- **Phân loại:** 404 file đã Git theo dõi, gồm 344 file không thay đổi cục bộ và 60 file đang sửa; thêm 22 file chưa được theo dõi. Ví dụ file đã commit nhưng vẫn sai định dạng: `apps/ai-service/src/assistant/ai-tutor-eval-v1.ts`. Chạy Prettier riêng trên file đó vẫn báo lỗi.
- **Tác động:** đây là lỗi baseline của repository, không thể quy toàn bộ cho phần việc đang sửa. Một checkout sạch chứa các file đã commit này cũng sẽ không qua cùng gate định dạng nếu dùng cấu hình và phiên bản Prettier hiện tại.
- **Cách xử lý đề xuất:** thống nhất cấu hình định dạng, chuẩn hóa phần mã nguồn đã commit theo một thay đổi riêng có thể review; sau đó giữ `prettier --check .` làm gate. Nếu cần chia nhỏ, có thể tạm kiểm tra riêng file thay đổi trong PR và mở công việc dọn baseline, nhưng phải ghi rõ gate toàn repository chưa sạch.

Các vùng có nhiều file báo lỗi nhất: `apps/web` 82, `tests/unit` 81, `apps/mobile` 69, `apps/learning-service` 41, `apps/ai-service` 19. Đây là số lượng file Prettier liệt kê, không phải số lỗi cú pháp hay lỗi runtime. **Phụ lục B** liệt kê đủ 426 đường dẫn, chia theo trạng thái Git.

### CI-02 — 60 file nguồn chưa được Git theo dõi

- **Vị trí gate:** `.github/workflows/ci.yml:18`, gọi `scripts/ci/audit-source-tracking.mjs`.
- **Tái hiện:** `pnpm audit:source-tracking` trả `FAIL`, `sourceFiles=1123`, `untrackedRuntimeSource=60`, `ignoredRuntimeSource=0`.
- **Phân loại:** `apps/web` 34 file, `apps/mobile` 12 file, `apps/identity-service` 6 file, `database/migrations` 8 file.
- **Ví dụ quan trọng:** `apps/identity-service/src/password-reset/` có 5 file; `apps/identity-service/src/public-profile/lecturer-editor.ts`; nhiều màn hình/logic mới của web và mobile; migration `089`–`092` ở cả `dev` và `research`.
- **Tác động:** CI checkout từ Git chỉ lấy file đã commit. Nếu các file mới là một phần của tính năng đang sửa nhưng không được thêm vào commit, bản trên CI/release sẽ thiếu mã nguồn hoặc migration. Tại máy, gate chủ động chặn trường hợp này.
- **Cách xử lý đề xuất:** xác nhận từng file là mã nguồn dự định phát hành, sau đó `git add` và commit cùng các thay đổi phụ thuộc; loại khỏi cây nguồn những file tạo nhầm. Không nên tắt gate để vượt qua.

Danh sách đầy đủ 60 đường dẫn nằm trong **Phụ lục A** bên dưới. File evidence do gate tạo tại máy là `artifacts/release-evidence/release-source-tracking-audit.json` và bị `.gitignore` bỏ qua theo chủ đích.

### CI-03 — ESLint tăng lỗi so với baseline

- **Vị trí gate:** `.github/workflows/ci.yml:17`; script `lint:no-regression` ở `package.json:17`.
- **Tái hiện:** `pnpm lint:no-regression` trả `FAIL`, `baselineIssueCount=82`, `currentIssueCount=85`. Danh sách regression chứa 5 lần vi phạm quy tắc `@typescript-eslint/restrict-template-expressions` tại 3 file; tổng tăng ròng 3 vì một số lỗi cũ đã biến mất.

| File                                                 | Dòng     | Vấn đề                                                           |
| ---------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| `apps/ai-service/src/assistant/llm-provider.ts`      | 51       | Chèn `response.status` kiểu number trực tiếp vào template string |
| `apps/identity-service/src/password-reset/mailer.ts` | 38, 39   | Chèn `expiresMinutes` kiểu number vào nội dung email text/HTML   |
| `apps/learning-service/src/finance/ledger.ts`        | 113, 128 | Chèn số phần trăm được tính toán vào mô tả bút toán              |

**Cách xử lý đề xuất:** chuyển số thành chuỗi có chủ đích, ví dụ `String(response.status)` và định dạng phần trăm rõ ràng; chạy lại ESLint trên ba file rồi `pnpm lint:no-regression`. Không cập nhật baseline chỉ để che regression mới.

### CI-04 — CI bỏ qua kiểm tra riêng của web và mobile

- **Vị trí:** `.github/workflows/ci.yml:16-24` chỉ gọi `pnpm typecheck`, `pnpm test`, `pnpm build` ở root. `vitest.config.ts:6` chỉ nhận `tests/**/*.test.ts`; `tsconfig.json` loại trừ `apps/web` và `apps/mobile`.
- **Điều đang thiếu:** các script `test`, `typecheck`, `build` của `apps/web/package.json`, cùng `test`, `typecheck`, `validate:config` và bước export phù hợp của `apps/mobile/package.json`, chưa có trong CI. Root đã có `test:all` nhưng workflow không gọi.
- **Tác động:** PR có lỗi ở ứng dụng web/mobile vẫn có thể qua các gate test/typecheck/build gốc. Kết quả build/test web và mobile tại máy không thay thế được gate tự động trên PR.
- **Bằng chứng tại máy:** `pnpm test:mobile` qua 365/365; typecheck web/mobile qua; build web qua. `pnpm test:web` lần đầu chạy đồng thời với nhiều gate khác bị 2 timeout trong 99 test; khi chạy lại riêng, 99/99 test web và 39/39 test server qua. Đây là dấu hiệu cần theo dõi độ ổn định/thời gian chờ khi đưa test web vào CI, chưa đủ để kết luận test có lỗi logic cố định.
- **Cách xử lý đề xuất:** thêm job web và mobile rõ ràng, chạy typecheck/test/build hoặc export phù hợp; lưu ý giới hạn thời gian và tài nguyên runner. Khi test timeout tái diễn trên CI, xác định ca test và sửa nguyên nhân hoặc cấu hình timeout dựa trên thời gian thực tế.

### CD-01 — Chưa có đường triển khai

- **Vị trí:** cả hai file trong `.github/workflows/` không có bước publish image/artifact, deploy tới staging/production, kiểm tra sau deploy hay rollback.
- **Đối chiếu tài liệu:** `README.md:445` vẫn đánh dấu staging/cloud deployment với credential thật là việc chưa hoàn tất; dòng 477 ghi chưa có staging/production deployment với cloud storage thật.
- **Tác động:** cấu hình hiện tại là CI cộng smoke/research thủ công, chưa phải CI/CD triển khai hoàn chỉnh. Không thể xác nhận ứng dụng đã sẵn sàng phát hành chỉ từ các workflow này.
- **Cách xử lý đề xuất:** sau khi CI sạch, xác định môi trường đích và thiết kế pipeline tạo artifact/image bất biến, triển khai staging, smoke sau deploy, phê duyệt/promote production, lưu version và cơ chế rollback. Các credential/cloud resource thật phải được chuẩn bị riêng.

### CI-05 — Log smoke không được lưu thành artifact

- **Vị trí:** `.github/workflows/ci.yml:40-43` ghi Docker log vào `phase6-dev-core.log` bằng `if: always()`, nhưng không có bước `upload-artifact`. Workflow research cũng không upload evidence.
- **Tác động:** sau khi runner tạm thời bị xóa, file log không còn để tải về; khi smoke thất bại sẽ khó xem nguyên nhân. Lệnh ghi log có `|| true`, nên lỗi lấy log cũng không được báo riêng.
- **Cách xử lý đề xuất:** upload log và evidence bằng bước chạy `always()`, đặt thời hạn lưu phù hợp. Bảo đảm log không chứa credential trước khi upload.

### CI-06 — Secret scan chỉ bao phủ một số mẫu

- **Vị trí:** `scripts/ci/scan-secrets.mjs:6-11` chỉ kiểm tra private key PEM, AWS access key kiểu `AKIA`, token GitHub theo prefix cụ thể và Slack token; dòng 17 bỏ qua các file `.env` cục bộ.
- **Kết quả:** `pnpm scan:secrets` PASS trên 3.867 file được đọc.
- **Giới hạn:** PASS chỉ có nghĩa là không gặp bốn mẫu đã định nghĩa trong các file script duyệt. Script không chứng minh rằng mọi loại secret, credential hoặc token khác đã được phát hiện.
- **Cách xử lý đề xuất:** mở rộng secret scan theo định dạng credential thực tế của dự án hoặc dùng công cụ chuyên dụng; giữ kiểm soát commit/PR. Đây là khoảng trống kiểm soát, chưa phải bằng chứng rò rỉ secret.

## 5. Kết quả các lệnh đã chạy đối chiếu

| Lệnh / Kiểm tra                                 | Kết quả Snapshot Ban đầu      | Kết quả Hiện tại (Sau Batch A/B/C)  | Ghi chú hiện tại                                                                                                                  |
| :---------------------------------------------- | :---------------------------- | :---------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                | PASS                          | PASS                                | Lockfile hợp lệ, dependency đầy đủ                                                                                                |
| `pnpm typecheck`                                | PASS                          | PASS                                | Root TypeScript không lỗi                                                                                                         |
| `pnpm lint:no-regression`                       | **FAIL** (85/82 lỗi)          | **PASS** (80/82 lỗi, 0 regression)  | Đã sửa 5 lỗi template string (Batch A)                                                                                            |
| `pnpm audit:source-tracking`                    | **FAIL** (60 file chưa track) | **PASS** (0 untracked runtime file) | 1123/1123 file được theo dõi (Batch A)                                                                                            |
| `pnpm test`                                     | PASS                          | PASS                                | 190 file test, 1.201 test gốc PASS                                                                                                |
| `pnpm validate:contracts`                       | PASS                          | PASS                                | 115 public API, 83 queries, 22 events                                                                                             |
| `pnpm validate:migration-bootstrap`             | PASS                          | PASS                                | 58 migration dev/research parity                                                                                                  |
| `pnpm validate:compose`                         | Chưa tích hợp CI              | **PASS** (đã tích hợp CI)           | 5 biến thể: dev-media, dev-core, dev-async, demo-https, research-tls (Batch C)                                                    |
| `pnpm validate:production-config`               | PASS                          | **PASS** (đã tích hợp CI)           | Fixture validation: config/production.env.example đã kiểm chứng (Batch C)                                                         |
| `pnpm scan:secrets`                             | PASS                          | PASS                                | 3.868 file scanned, không phát hiện secret                                                                                        |
| `pnpm format:check`                             | **FAIL** (426 file vi phạm)   | **PASS** (0 file vi phạm)           | Chuẩn hóa Prettier toàn bộ repo (Batch B & C)                                                                                     |
| `pnpm --filter @ailss/web lint`                 | Chưa tích hợp CI              | **PASS** (0 errors, 0 warnings)     | Đã sửa dứt điểm 35 lỗi ESLint web, tích hợp vào `web-gates` (Batch C)                                                             |
| `pnpm --filter @ailss/web typecheck`            | PASS (chạy cục bộ)            | **PASS** (đã tích hợp CI)           | Tích hợp vào job `web-gates` (Batch C)                                                                                            |
| `pnpm --filter @ailss/web test`                 | PASS (chạy lại riêng)         | **PASS** (đã tích hợp CI)           | 22 file, 101 vitest + 39 server tests = 140 test passed (Batch C)                                                                 |
| `pnpm --filter @ailss/web build`                | PASS (chạy cục bộ)            | **PASS** (đã tích hợp CI)           | Vite build & prerender 32 routes (Batch C)                                                                                        |
| `pnpm --filter @ailss/mobile lint:phase41`      | Chưa tích hợp CI              | **PASS** (0 new issues, 11/19)      | Đã sửa TextInput ref typing chuẩn tại [screen].tsx, tích hợp vào `mobile-gates` (Batch C)                                         |
| `pnpm --filter @ailss/mobile typecheck`         | PASS (chạy cục bộ)            | **PASS** (đã tích hợp CI)           | Tích hợp vào job `mobile-gates` (Batch C)                                                                                         |
| `pnpm --filter @ailss/mobile test`              | PASS (chạy cục bộ)            | **PASS** (đã tích hợp CI)           | 25 file, 365 test passed (Batch C)                                                                                                |
| `pnpm --filter @ailss/mobile validate:config`   | PASS (chạy cục bộ)            | **PASS** (đã tích hợp CI)           | Tích hợp vào job `mobile-gates` (Batch C)                                                                                         |
| `pnpm --filter @ailss/mobile build:development` | Chưa chạy trong CI            | **PASS** (đã tích hợp CI)           | Expo export iOS + Android bundle (Batch C)                                                                                        |
| Docker dev-core smoke (CI runner)               | Chưa kiểm chứng CI            | **NOT RUN** (giữ nguyên job CI)     | Chẩn đoán có cấu trúc an toàn qua `docker compose ps -a` trên failure; không upload raw logs (Batch C)                            |
| Research profile smoke & evidence               | Chưa kiểm chứng CI            | **NOT RUN** (giữ nguyên job CI)     | Self-hosted runner `ailss-research`; concurrency queue tuần tự, tối đa 100 run pending để tránh xung đột container/cổng (Batch C) |
| Triển khai Staging/Prod (CD)                    | Chưa cấu hình                 | **BLOCKED**                         | Chờ hạ tầng / credential; chưa cấp phát cloud staging/prod                                                                        |

**Ghi chú xác minh:**

- Toàn bộ các lệnh root, web và mobile đã được chạy và kiểm chứng **PASS 100% trực tiếp trong working tree tại máy cục bộ**.
- Các validator `validate:compose`, `validate:production-config`, job `web-gates`, `mobile-gates`, cơ chế chẩn đoán an toàn (`docker compose ps -a`), concurrency guards và quyền tối thiểu `contents: read` đã được tích hợp hoàn chỉnh vào `.github/workflows/ci.yml` và `.github/workflows/research.yml`.
- **Phân biệt rõ ràng kết quả môi trường:** Nhánh làm việc này chưa được push lên remote origin, do đó các job chạy trên GitHub-hosted Ubuntu runner (`dev-core-smoke`) và runner self-hosted (`research-profile`) được ghi nhận chính xác là **NOT RUN trên GitHub Actions runner**, không tuyên bố CI remote đã xanh khi chưa push/chạy thực tế.
- Tuyệt đối loại bỏ cơ chế regex che secret tự chế, nhánh fail-open (`|| cp raw.log ...`), và không tự động upload toàn bộ `docs/evidence/` lên GitHub Actions.

## 6. Thứ tự xử lý các bước tiếp theo (Roadmap sau Batch C)

### A. Các hạng mục đã hoàn thành (Batch A / B / C)

- [x] **Batch A — Khôi phục tính đúng đắn CI & Source Tracking:**
  - Kiểm kê và đưa 60 file nguồn runtime/migration vào Git tracking (`git add`). Gate `audit:source-tracking` đạt 1123/1123 file (0 untracked).
  - Xác minh migrations `089`–`092` ở cả `dev` và `research` keyspaces.
  - Sửa dứt điểm 5 regression template string; gate `lint:no-regression` đạt 80/82 lỗi (0 regression mới).
- [x] **Batch B — Chuẩn hóa định dạng Baseline:**
  - Chuẩn hóa Prettier toàn diện (427 file), bảo toàn logic và ngữ nghĩa mã nguồn.
  - Gate `format:check` đạt 100% PASS trên toàn bộ repository.
- [x] **Batch C — Đóng các lỗ hổng CI Coverage & Chẩn đoán an toàn:**
  - Bổ sung 2 job `web-gates` và `mobile-gates` vào `.github/workflows/ci.yml`.
  - **Web:** Sửa dứt điểm 35 lỗi ESLint (`apps/web` đạt 0 errors, 0 warnings); khôi phục cơ chế phân biệt initial bootstrap (im lặng) và refresh 401 (thông báo hết hạn phiên); typecheck, 140 web tests, và build production đều PASS.
  - **Mobile:** Sửa typing ref chuẩn (`useRef<TextInput>(null)`) tại `[screen].tsx`; `lint:phase41` PASS (11/19 lỗi, 0 regression mới); typecheck, 365 tests, validate:config, và build/export iOS + Android bundle đều PASS.
  - **Chẩn đoán an toàn:** Thay thế cơ chế regex che log tự chế (`sed`), nhánh fail-open (`|| cp raw.log ...`), và bước upload không kiểm soát toàn bộ `docs/evidence/` bằng dữ liệu chẩn đoán có cấu trúc an toàn trên failure (`docker compose ps -a`). Giữ nguyên quyền tối thiểu `permissions: contents: read`.

### B. Các bước còn lại trước khi phát hành

1. [ ] **Kích hoạt và xác nhận CI trên GitHub Actions Runner:**
   - Sau khi các thay đổi được review và tạo commit / Pull Request chính thức, kích hoạt toàn bộ workflow trên GitHub Actions Ubuntu runner để đối chiếu môi trường sạch.
   - Xác nhận thời gian thực thi (timeout) và tính ổn định của `web-gates` và `dev-core-smoke` trên runner từ xa.
   - Xác nhận runner `self-hosted` gắn nhãn `ailss-research` đang online và sẵn sàng nếu cần chạy workflow `phase6-research`.

2. [ ] **Xây dựng đường ống triển khai liên tục (CD) — Hiện đang BLOCKED:**
   - Pipeline CD tự động chỉ có thể triển khai sau khi được cung cấp đầy đủ thông tin hạ tầng thực tế:
     - **Cloud Target / Provider:** Nhà cung cấp đám mây cụ thể (AWS / GCP / Bare Metal) và môi trường runtime đích (Kubernetes cluster, ECS, hoặc VM fleet).
     - **Vùng triển khai (Region):** Cấu hình multi-AZ và hạ tầng mạng VPC/Subnet.
     - **Mạng, Tên miền & Chứng chỉ:** Bản ghi DNS chính thức, Load Balancer, Gateway ingress và chứng chỉ TLS/SSL hợp lệ.
     - **Container Registry & Artifact Storage:** Registry lưu trữ image bất biến và dịch vụ lưu trữ đối tượng (S3 / Cloud Storage) thật với cấu hình Object Lock / Retention.
     - **Quản lý bí mật (Secret Store):** Tích hợp giải pháp quản trị bí mật tập trung (HashiCorp Vault, AWS Secrets Manager, hoặc Cloud Secret Manager) với phân quyền IAM chặt chẽ thay vì inject biến thủ công.
     - **Chiến lược phát hành & Rollback:** Cơ chế Blue/Green hoặc Canary, smoke test sau khi deploy, giám sát SLO/SLI tự động, và kịch bản rollback tức thời khi phát hiện lỗi.

## 7. Giới hạn của báo cáo

Repository có thay đổi cục bộ chưa commit; kết quả source tracking và lint mô tả working tree tại thời điểm kiểm tra. Báo cáo không truy cập lịch sử/lượt chạy GitHub Actions, không xác nhận runner `ailss-research` đang online và không khởi động Docker stack. Không có mã nguồn ứng dụng hay workflow nào được sửa trong quá trình lập báo cáo ban đầu.

## 8. Phụ lục A — Danh sách đầy đủ 60 file nguồn chưa được Git theo dõi

Các đường dẫn dưới đây tính từ thư mục gốc dự án AILSS; ví dụ `apps/web/...` nằm trong thư mục `apps/web/` của dự án. Đây là snapshot tại thời điểm chạy `pnpm audit:source-tracking`.

### Identity service — 6 file

- `apps/identity-service/src/password-reset/mailer.ts`
- `apps/identity-service/src/password-reset/model.ts`
- `apps/identity-service/src/password-reset/repository.ts`
- `apps/identity-service/src/password-reset/router.ts`
- `apps/identity-service/src/password-reset/service.ts`
- `apps/identity-service/src/public-profile/lecturer-editor.ts`

### Mobile — 12 file

- `apps/mobile/app/admin/ai/index.tsx`
- `apps/mobile/app/lecturers/[lecturerId].tsx`
- `apps/mobile/app/teaching/copilot/index.tsx`
- `apps/mobile/app/teaching/media.tsx`
- `apps/mobile/app/teaching/profile/index.tsx`
- `apps/mobile/app/teaching/revenue/index.tsx`
- `apps/mobile/src/RevenueQuote.tsx`
- `apps/mobile/src/RoleAssistantChat.tsx`
- `apps/mobile/src/admin-ai.ts`
- `apps/mobile/src/finance.ts`
- `apps/mobile/src/media-upload.ts`
- `apps/mobile/src/public-lecturer.ts`

### Web — 34 file

- `apps/web/public/mascots/crt-directions.webp`
- `apps/web/public/mascots/crt-reactions.webp`
- `apps/web/public/mascots/drone-directions.webp`
- `apps/web/public/mascots/drone-reactions.webp`
- `apps/web/public/mascots/fox-directions.webp`
- `apps/web/public/mascots/fox-reactions.webp`
- `apps/web/public/mascots/gearbot-directions.webp`
- `apps/web/public/mascots/gearbot-reactions.webp`
- `apps/web/public/mascots/otter-directions.webp`
- `apps/web/public/mascots/otter-reactions.webp`
- `apps/web/public/mascots/scout-directions.webp`
- `apps/web/public/mascots/scout-reactions.webp`
- `apps/web/public/mascots/tv-directions.webp`
- `apps/web/public/mascots/tv-reactions.webp`
- `apps/web/src/admin/AdminAi.tsx`
- `apps/web/src/admin/admin-ai.css`
- `apps/web/src/auth/social.ts`
- `apps/web/src/components/FloatingAiTutor.tsx`
- `apps/web/src/components/NotFound3DScene.tsx`
- `apps/web/src/components/PublicLecturer.tsx`
- `apps/web/src/components/RevenuePanels.tsx`
- `apps/web/src/components/RoleAiExperience.tsx`
- `apps/web/src/components/SafeMascot.tsx`
- `apps/web/src/components/floating-ai-tutor.css`
- `apps/web/src/lecturer/ProfileEditor.tsx`
- `apps/web/src/lecturer/RevenueDashboard.tsx`
- `apps/web/src/lecturer/RevenueQuote.tsx`
- `apps/web/src/lecturer/lecturer-revenue.css`
- `apps/web/src/lib/notFound3dScene.ts`
- `apps/web/src/pages/NotFound.tsx`
- `apps/web/src/pages/ai-learning.css`
- `apps/web/src/student/AiTutorArchive.tsx`
- `apps/web/src/student/ai-tutor-archive.css`
- `apps/web/src/student/aiTutorConversation.tsx`

### Migration — 8 file

- `database/migrations/dev/089_identity_password_reset.cql`
- `database/migrations/dev/090_lecturer_public_details.cql`
- `database/migrations/dev/091_lecturer_payout_preparation.cql`
- `database/migrations/dev/092_platform_commission_policy.cql`
- `database/migrations/research/089_identity_password_reset.cql`
- `database/migrations/research/090_lecturer_public_details.cql`
- `database/migrations/research/091_lecturer_payout_preparation.cql`
- `database/migrations/research/092_platform_commission_policy.cql`

## 9. Phụ lục B — Danh sách đầy đủ 426 file chưa đạt Prettier

Từng đường dẫn tính từ thư mục gốc dự án AILSS. Nhóm đầu tiên là bằng chứng gate định dạng đã lỗi trên nội dung commit hiện có; hai nhóm sau phản ánh working tree tại thời điểm kiểm tra.

### Đã commit, không thay đổi cục bộ — 344 file

- `.github/copilot-instructions.md`
- `.github/instructions/mermaid.instructions.md`
- `apps/ai-service/src/assistant/ai-tutor-eval-v1.ts`
- `apps/ai-service/src/assistant/ai-tutor-eval-v2.ts`
- `apps/ai-service/src/assistant/ai-tutor-eval-v3.ts`
- `apps/ai-service/src/assistant/assessment-integrity-attacks.ts`
- `apps/ai-service/src/assistant/citation-policy.ts`
- `apps/ai-service/src/assistant/model.ts`
- `apps/ai-service/src/assistant/tool-registry.ts`
- `apps/ai-service/src/assistant/tool-runner.ts`
- `apps/ai-service/src/rag/evaluation-v3.ts`
- `apps/ai-service/src/rag/service.ts`
- `apps/ai-service/src/safety/assessment-guard.ts`
- `apps/ai-service/src/safety/index.ts`
- `apps/ai-service/src/safety/indirect-injection-detector.ts`
- `apps/ai-service/src/safety/jailbreak-detector.ts`
- `apps/ai-service/src/safety/policy-types.ts`
- `apps/api-gateway/src/adaptive-learning-proxy.ts`
- `apps/api-gateway/src/federation-proxy.ts`
- `apps/api-gateway/src/media-delivery-proxy.ts`
- `apps/assessment-service/src/authoring/psychometrics-calculator.ts`
- `apps/assessment-service/src/repository.ts`
- `apps/assessment-service/src/schedule-internal-router.ts`
- `apps/assessment-service/src/server.ts`
- `apps/assessment-service/src/service.ts`
- `apps/identity-service/src/external-auth/repository.ts`
- `apps/identity-service/src/external-auth/router.ts`
- `apps/identity-service/src/federation/repository.ts`
- `apps/identity-service/src/federation/router.ts`
- `apps/identity-service/src/federation/service.ts`
- `apps/identity-service/src/scim/repository.ts`
- `apps/identity-service/src/tenant/fleet-operations-service.ts`
- `apps/identity-service/src/tenant/institution-onboarding-v2-service.ts`
- `apps/identity-service/src/tenant/model.ts`
- `apps/identity-service/src/tenant/repository.ts`
- `apps/identity-service/src/tenant/service.ts`
- `apps/learning-service/src/adaptive/adaptive-path-service.ts`
- `apps/learning-service/src/adaptive/internal-router.ts`
- `apps/learning-service/src/adaptive/mastery-consumer.ts`
- `apps/learning-service/src/adaptive/mastery-ingestion-repository.ts`
- `apps/learning-service/src/adaptive/model.ts`
- `apps/learning-service/src/adaptive/plan-context.ts`
- `apps/learning-service/src/adaptive/recommendation-service.ts`
- `apps/learning-service/src/adaptive/runtime-repository.ts`
- `apps/learning-service/src/adaptive/runtime-router.ts`
- `apps/learning-service/src/adaptive/study-plan-service.ts`
- `apps/learning-service/src/analytics/analytics-service.ts`
- `apps/learning-service/src/analytics/differential-privacy-service.ts`
- `apps/learning-service/src/analytics/learning-intelligence-service.ts`
- `apps/learning-service/src/course-authoring/course-authoring-studio-service.ts`
- `apps/learning-service/src/curriculum/curriculum-intelligence-service.ts`
- `apps/learning-service/src/experimentation/experimentation-service.ts`
- `apps/learning-service/src/experimentation/friction-diagnostic-service.ts`
- `apps/learning-service/src/finance/payment-provider.ts`
- `apps/learning-service/src/finance/payout-provider.ts`
- `apps/learning-service/src/finance/repository.ts`
- `apps/learning-service/src/finance/router.ts`
- `apps/learning-service/src/lessons/service.ts`
- `apps/learning-service/src/lifecycle/service.ts`
- `apps/learning-service/src/mastery/mastery-calibration-v1.ts`
- `apps/learning-service/src/mastery/mastery-calibration-v2.ts`
- `apps/learning-service/src/mastery/mastery-service.ts`
- `apps/learning-service/src/materials/internal-router.ts`
- `apps/learning-service/src/media/captions.ts`
- `apps/learning-service/src/media/router.ts`
- `apps/learning-service/src/media/service.ts`
- `apps/learning-service/src/progress/repository.ts`
- `apps/learning-service/src/search/repository.ts`
- `apps/learning-service/src/search/service.ts`
- `apps/learning-service/src/versioning/versioning-service.ts`
- `apps/media-delivery/package.json`
- `apps/media-delivery/src/router.ts`
- `apps/media-worker/package.json`
- `apps/mobile/app.config.js`
- `apps/mobile/app/admin/commerce/index.tsx`
- `apps/mobile/app/admin/users/index.tsx`
- `apps/mobile/app/assessments/[quizId]/attempt/[attemptId].tsx`
- `apps/mobile/app/assessments/[quizId]/index.tsx`
- `apps/mobile/app/assessments/[quizId]/result/[resultId].tsx`
- `apps/mobile/app/assessments/index.tsx`
- `apps/mobile/app/classes/[classId]/index.tsx`
- `apps/mobile/app/classes/index.tsx`
- `apps/mobile/app/courses/index.tsx`
- `apps/mobile/app/learn/[courseId]/index.tsx`
- `apps/mobile/app/learn/index.tsx`
- `apps/mobile/app/login.tsx`
- `apps/mobile/app/notifications.tsx`
- `apps/mobile/app/result.tsx`
- `apps/mobile/app/settings.tsx`
- `apps/mobile/app/student/index.tsx`
- `apps/mobile/app/student/mastery.tsx`
- `apps/mobile/app/student/study-plan.tsx`
- `apps/mobile/app/teaching/assessments/[quizId]/index.tsx`
- `apps/mobile/app/teaching/assessments/[quizId]/results/index.tsx`
- `apps/mobile/app/teaching/assessments/create.tsx`
- `apps/mobile/app/teaching/classes/[classId]/index.tsx`
- `apps/mobile/app/teaching/classes/[classId]/sessions/[sessionId]/attendance.tsx`
- `apps/mobile/app/teaching/classes/index.tsx`
- `apps/mobile/app/teaching/courses/[courseId]/index.tsx`
- `apps/mobile/app/teaching/courses/[courseId]/reviews.tsx`
- `apps/mobile/app/teaching/schedule.tsx`
- `apps/mobile/docs/phase41/MOBILE-LINT-BASELINE.md`
- `apps/mobile/docs/phase41/mobile-offline-data-policy.json`
- `apps/mobile/docs/phase41/PHASE-41-STATUS.md`
- `apps/mobile/docs/phase41/phase41-cross-platform-error-parity.json`
- `apps/mobile/docs/phase41/phase41-mobile-feature-inventory.json`
- `apps/mobile/docs/phase41/phase41-mobile-runtime-feature-graph.json`
- `apps/mobile/scripts/phase41-audit.mjs`
- `apps/mobile/scripts/phase41-error-parity.ts`
- `apps/mobile/scripts/phase41-lint.mjs`
- `apps/mobile/src/__mocks__/expo-image-picker.ts`
- `apps/mobile/src/__mocks__/expo-video.ts`
- `apps/mobile/src/adaptive.ts`
- `apps/mobile/src/assessment.ts`
- `apps/mobile/src/AuthFeedback.tsx`
- `apps/mobile/src/catalog-preview.ts`
- `apps/mobile/src/grading-store.ts`
- `apps/mobile/src/lesson-sync.ts`
- `apps/mobile/src/media.ts`
- `apps/mobile/src/motion.tsx`
- `apps/mobile/src/offline-store.ts`
- `apps/mobile/src/offline-sync.ts`
- `apps/mobile/src/release-context.ts`
- `apps/mobile/src/runtime.ts`
- `apps/mobile/src/settings.ts`
- `apps/mobile/src/TutorAvatar.tsx`
- `apps/mobile/src/use-student-learning.ts`
- `apps/mobile/tests/catalog-preview.test.ts`
- `apps/mobile/tests/commercial-features.test.ts`
- `apps/mobile/tests/lesson-sync.test.ts`
- `apps/mobile/tests/media.test.ts`
- `apps/mobile/tests/offline-store.test.ts`
- `apps/mobile/tests/phase41-contracts.test.ts`
- `apps/mobile/tests/secure-store.test.ts`
- `apps/notification-worker/src/email/index.ts`
- `apps/notification-worker/src/model.ts`
- `apps/notification-worker/src/push/index.ts`
- `apps/notification-worker/src/sms/index.ts`
- `apps/notification-worker/src/worker.ts`
- `apps/web/scripts/verify-browser.mjs`
- `apps/web/scripts/verify-phase42-media.mjs`
- `apps/web/src/admin/Admin.tsx`
- `apps/web/src/admin/FleetOperationsCenter.tsx`
- `apps/web/src/admin/InstitutionWizard.tsx`
- `apps/web/src/admin/LogsDashboard.tsx`
- `apps/web/src/admin/Moderation.tsx`
- `apps/web/src/admin/SettingsDashboard.tsx`
- `apps/web/src/admin/StatsDashboard.tsx`
- `apps/web/src/components/AnimatedNumber.tsx`
- `apps/web/src/components/LanguageSwitcher.tsx`
- `apps/web/src/components/Layout.tsx`
- `apps/web/src/components/Motion.tsx`
- `apps/web/src/components/ScheduleCalendar.tsx`
- `apps/web/src/lecturer/Assessment.tsx`
- `apps/web/src/lecturer/Comments.tsx`
- `apps/web/src/lecturer/CourseAuthoringStudio.tsx`
- `apps/web/src/lecturer/LecturerReportsDashboard.tsx`
- `apps/web/src/lecturer/MediaUpload.tsx`
- `apps/web/src/lecturer/TeacherCopilot.tsx`
- `apps/web/src/lib/darkMode.ts`
- `apps/web/src/lib/useSSE.ts`
- `apps/web/src/metadata.ts`
- `apps/web/src/pages/LecturerApplication.tsx`
- `apps/web/src/pages/Notifications.tsx`
- `apps/web/src/student/Assessment.tsx`
- `apps/web/src/student/Classes.tsx`
- `apps/web/src/student/Learning.tsx`
- `apps/web/src/student/MediaPlayer.tsx`
- `apps/web/src/student/ProgressDashboard.tsx`
- `apps/web/src/student/StudyPlan.tsx`
- `apps/web/src/student/UnifiedStudentWorkspace.tsx`
- `apps/web/tests/admin-dashboards.test.tsx`
- `apps/web/tests/ai-tutor.test.tsx`
- `apps/web/tests/attendance.test.tsx`
- `apps/web/tests/e2e-browser-journeys.test.tsx`
- `apps/web/tests/i18n.test.tsx`
- `apps/web/tests/student-marketplace.test.tsx`
- `apps/web/tests/student-progress.test.tsx`
- `artifacts/release-evidence/api-authorization-coverage-manifest.json`
- `artifacts/release-evidence/dns-probes-vantage-50.json`
- `artifacts/release-evidence/finops-billing-export-august2026.json`
- `artifacts/release-evidence/phase29-production-cutover-evidence.json`
- `artifacts/release-evidence/phase30-production-operations-evidence.json`
- `artifacts/release-evidence/phase34-external-validation-evidence.json`
- `artifacts/release-evidence/phase35-external-assurance-evidence.json`
- `artifacts/release-evidence/phase36-artifact-infrastructure-assurance.json`
- `artifacts/release-evidence/phase37-crash-durability-external-gates.json`
- `artifacts/release-evidence/phase38-storage-config-rpo-assurance.json`
- `artifacts/release-evidence/phase40-pilot-hardening-evidence.json`
- `artifacts/release-evidence/regional-rpo-sequence-proof.json`
- `artifacts/release-evidence/release620rc1-test-manifest.json`
- `artifacts/release-evidence/release620rc2-test-manifest.json`
- `artifacts/release-evidence/release620rc3-test-manifest.json`
- `artifacts/release-evidence/release620rc4-artifact-manifest.json`
- `artifacts/release-evidence/release620rc4-test-manifest.json`
- `artifacts/release-evidence/test-discovery-manifest.json`
- `contracts/authorizations/pilot-polytech-authorization.json`
- `contracts/mastery-evidence-event.schema.json`
- `docs/PHASE_40_REVISION_F_IMPLEMENTATION.md`
- `docs/PHASE_40_REVISION_G_PROGRESS.md`
- `docs/PHASE_40_REVISION_H_PROGRESS.md`
- `docs/PHASE_40_REVISION_I_PROGRESS.md`
- `docs/PHASE_40_REVISION_J_PROGRESS.md`
- `docs/PHASE_40_REVISION_L_PROGRESS.md`
- `infra/templates/iam-policy-media-api.json`
- `infra/templates/iam-policy-media-delivery.json`
- `infra/templates/iam-policy-media-worker.json`
- `infra/templates/s3-media-bucket-policy.json`
- `lint-baseline.json`
- `ops/observability/grafana/dashboards/platform-overview.json`
- `packages/contracts/src/adaptive-learning-v2.ts`
- `packages/contracts/src/ai-tutor-v2.ts`
- `packages/contracts/src/analytics-events.ts`
- `packages/contracts/src/commercial-gate.ts`
- `packages/contracts/src/critical-durability.ts`
- `packages/contracts/src/data-retention-policy.ts`
- `packages/contracts/src/feature-flags.ts`
- `packages/contracts/src/institution-v2.ts`
- `packages/contracts/src/institutional-pilot.ts`
- `packages/contracts/src/integrations.ts`
- `packages/contracts/src/interoperability.ts`
- `packages/contracts/src/onboarding.ts`
- `packages/contracts/src/oneroster.ts`
- `packages/contracts/src/scim.ts`
- `packages/contracts/src/teacher-copilot.ts`
- `packages/contracts/src/wave2-contracts.ts`
- `packages/logger/src/index.ts`
- `packages/observability/src/index.ts`
- `packages/observability/src/media.ts`
- `packages/observability/src/slo-engine.ts`
- `packages/security/src/index.ts`
- `packages/security/src/oidc.ts`
- `packages/security/src/saml.ts`
- `packages/security/src/scorm.ts`
- `packages/security/src/secret-provider.ts`
- `scripts/acceptance/capture-phase40-durable.mjs`
- `scripts/acceptance/phase-40-revision-l-local-runtime.mjs`
- `scripts/acceptance/phase-42-bounded-load.mjs`
- `scripts/acceptance/phase-42-captions.mjs`
- `scripts/acceptance/phase-42-cross-tenant-security.mjs`
- `scripts/acceptance/phase-42-external-s3-acceptance.mjs`
- `scripts/acceptance/phase-42-native-parity.mjs`
- `scripts/acceptance/phase-42-preview-storefront.mjs`
- `scripts/acceptance/phase-42-quota-http.mjs`
- `scripts/ci/audit-dead-code.mjs`
- `scripts/ci/audit-source-tracking.mjs`
- `scripts/ci/generate-phase40-runtime-feature-graph.mjs`
- `scripts/ci/generate-rc2-manifest.mjs`
- `scripts/ci/generate-sbom.mjs`
- `scripts/ci/inventory-rc5-changes.mjs`
- `scripts/ci/lint-no-regression.mjs`
- `scripts/ci/rc-manifest-builder.mjs`
- `scripts/ci/run-rc5-canonical-tests.mjs`
- `scripts/ci/update-pilot-evidence.mjs`
- `scripts/ci/validate-compose.mjs`
- `scripts/ci/validate-migration-bootstrap-parity.mjs`
- `scripts/ci/validate-staging-config.mjs`
- `scripts/ci/verify-clean-cassandra-bootstrap.mjs`
- `scripts/dev/bootstrap-cassandra.mjs`
- `scripts/dev/provision-rabbitmq.mjs`
- `scripts/operations/finance-projection-backfill.mjs`
- `scripts/ops/staging-health-check.mjs`
- `scripts/ops/staging-smoke-test.mjs`
- `scripts/ops/verify-backup-restore.mjs`
- `tests/security/payment-state-machine-property.test.ts`
- `tests/security/phase22-adversarial-tenancy.test.ts`
- `tests/security/phase31-blackbox-tenant-penetration.test.ts`
- `tests/security/phase32-blackbox-security-v2.test.ts`
- `tests/security/phase33-blackbox-security-v3.test.ts`
- `tests/security/phase34-external-validation-and-payment.test.ts`
- `tests/unit/assistant-catalog-domain-client.test.ts`
- `tests/unit/assistant-domain-client-rag.test.ts`
- `tests/unit/assistant-repository-history.test.ts`
- `tests/unit/federation-runtime.test.ts`
- `tests/unit/identity-social-auth.test.ts`
- `tests/unit/oidc-security-conformance.test.ts`
- `tests/unit/phase18-learner-protection.test.ts`
- `tests/unit/phase18-product-intelligence.test.ts`
- `tests/unit/phase19-adaptive-mastery.test.ts`
- `tests/unit/phase19-course-versioning.test.ts`
- `tests/unit/phase20-credentials-interoperability.test.ts`
- `tests/unit/phase20-multi-tenancy.test.ts`
- `tests/unit/phase20-notification-worker-governance.test.ts`
- `tests/unit/phase21-data-retention.test.ts`
- `tests/unit/phase21-enterprise-analytics.test.ts`
- `tests/unit/phase21-governed-rag.test.ts`
- `tests/unit/phase21-integration-registry.test.ts`
- `tests/unit/phase21-lti-security.test.ts`
- `tests/unit/phase21-scorm-security.test.ts`
- `tests/unit/phase21-w3c-credentials.test.ts`
- `tests/unit/phase22-e2e-journeys.test.ts`
- `tests/unit/phase22-finance-failure-injection.test.ts`
- `tests/unit/phase22-retention-production-safety.test.ts`
- `tests/unit/phase22-search-rag-evaluation.test.ts`
- `tests/unit/phase23-educational-interop.test.ts`
- `tests/unit/phase23-indirect-injection-rag.test.ts`
- `tests/unit/phase23-scim-provisioning.test.ts`
- `tests/unit/phase23-sms-governance.test.ts`
- `tests/unit/phase24-oneroster-csv.test.ts`
- `tests/unit/phase24-rag-evaluation-v3.test.ts`
- `tests/unit/phase24-saml-security.test.ts`
- `tests/unit/phase24-scim-endpoints.test.ts`
- `tests/unit/phase25-ai-safety-redteam.test.ts`
- `tests/unit/phase25-incident-gameday.test.ts`
- `tests/unit/phase25-lti-external-advantage.test.ts`
- `tests/unit/phase25-oneroster-sis-pilot.test.ts`
- `tests/unit/phase25-rag-sliced-benchmark.test.ts`
- `tests/unit/phase25-scim-persistent-provisioning.test.ts`
- `tests/unit/phase26-ai-safety-redteam-v2.test.ts`
- `tests/unit/phase26-backup-restore-and-privacy.test.ts`
- `tests/unit/phase26-capacity-ramp.test.ts`
- `tests/unit/phase26-idp-and-multitenant-scim.test.ts`
- `tests/unit/phase26-saml-shared-replay.test.ts`
- `tests/unit/phase27-pilot-governance-and-telemetry.test.ts`
- `tests/unit/phase27-saml-crossprocess-replay.test.ts`
- `tests/unit/phase27-soak-and-incident-metrics.test.ts`
- `tests/unit/phase28-authoritative-saml-and-idp-rotation.test.ts`
- `tests/unit/phase28-chaos-soak-headroom-and-game-day.test.ts`
- `tests/unit/phase28-lti-reliability-and-data-governance.test.ts`
- `tests/unit/phase28-rag-v4-and-ai-safety.test.ts`
- `tests/unit/phase29-canary-and-release-telemetry.test.ts`
- `tests/unit/phase29-multiaz-and-dr-recovery.test.ts`
- `tests/unit/phase29-tenant-isolation-v2.test.ts`
- `tests/unit/phase30-property-authorization-and-dr.test.ts`
- `tests/unit/phase31-evidence-integrity-and-regional-dr.test.ts`
- `tests/unit/phase34-critical-write-durability.test.ts`
- `tests/unit/phase35-d0-durability-and-finops.test.ts`
- `tests/unit/phase37-crash-durability-and-fencing.test.ts`
- `tests/unit/phase38-d0-reality-and-rpo.test.ts`
- `tests/unit/phase39-adaptive-learning-v2.test.ts`
- `tests/unit/phase39-ai-tutor-copilot.test.ts`
- `tests/unit/phase39-d0-config-correction.test.ts`
- `tests/unit/phase39-institution-intelligence.test.ts`
- `tests/unit/phase40-citation-policy.test.ts`
- `tests/unit/phase40-differential-privacy.test.ts`
- `tests/unit/phase40-pilot-hardening.test.ts`
- `tests/unit/phase40-product-expansion-wave2.test.ts`
- `tests/unit/phase40-wave2-e2e-and-security.test.ts`
- `tests/unit/phase42-media.test.ts`
- `tests/unit/phase42c-staging-config-validation.test.ts`
- `tests/unit/production-secret-guard.test.ts`
- `tests/unit/rc-candidate-freeze.test.ts`
- `tests/unit/sepay-payload-collision.test.ts`
- `tests/unit/sepay.test.ts`

### Đã commit, đang thay đổi cục bộ — 60 file

- `apps/ai-service/src/assistant/domain-client.ts`
- `apps/ai-service/src/assistant/llm-provider.ts`
- `apps/ai-service/src/assistant/repository.ts`
- `apps/ai-service/src/assistant/router.ts`
- `apps/api-gateway/src/learning-commerce-proxy.ts`
- `apps/api-gateway/src/registration-proxy.ts`
- `apps/api-gateway/src/server.ts`
- `apps/identity-service/src/external-auth/service.ts`
- `apps/identity-service/src/public-profile/repository.ts`
- `apps/identity-service/src/public-profile/service.ts`
- `apps/identity-service/src/server.ts`
- `apps/learning-service/src/commerce/repository.ts`
- `apps/learning-service/src/commerce/router.ts`
- `apps/learning-service/src/commerce/service.ts`
- `apps/learning-service/src/finance/finance-service.ts`
- `apps/learning-service/src/finance/ledger.ts`
- `apps/learning-service/src/finance/refund-policy.ts`
- `apps/learning-service/src/server.ts`
- `apps/mobile/app/[screen].tsx`
- `apps/mobile/app/account.tsx`
- `apps/mobile/app/teaching/courses/[courseId]/edit.tsx`
- `apps/mobile/src/CinematicIntro.tsx`
- `apps/mobile/src/learning.ts`
- `apps/mobile/src/MediaPlayer.tsx`
- `apps/mobile/src/ui.tsx`
- `apps/web/scripts/serve.mjs`
- `apps/web/server/admin.mjs`
- `apps/web/server/admin.test.mjs`
- `apps/web/server/lecturer.mjs`
- `apps/web/server/session.mjs`
- `apps/web/server/session.test.mjs`
- `apps/web/src/App.tsx`
- `apps/web/src/auth/session.tsx`
- `apps/web/src/commercial.css`
- `apps/web/src/components/AuthLayout.tsx`
- `apps/web/src/components/CourseCommunity.tsx`
- `apps/web/src/components/Icon.tsx`
- `apps/web/src/components/ScrollStory.tsx`
- `apps/web/src/components/SiteHeader.tsx`
- `apps/web/src/components/Workflow.tsx`
- `apps/web/src/lecturer/Classroom.tsx`
- `apps/web/src/lecturer/GradebookDashboard.tsx`
- `apps/web/src/lecturer/Teaching.tsx`
- `apps/web/src/lib/i18n.tsx`
- `apps/web/src/pages/Courses.tsx`
- `apps/web/src/pages/Platform.tsx`
- `apps/web/src/pages/Support.tsx`
- `apps/web/src/pages/Workspace.tsx`
- `apps/web/src/student/AiTutor.tsx`
- `apps/web/src/student/api.tsx`
- `apps/web/src/student/Commerce.tsx`
- `contracts/openapi/public-v1.yaml`
- `packages/security/src/social.ts`
- `README.md`
- `tests/unit/ai-event-relay.test.ts`
- `tests/unit/assistant-course-advisor.test.ts`
- `tests/unit/identity-public-profile.test.ts`
- `tests/unit/phase18-finance-ledger.test.ts`
- `tests/unit/phase18-production-assurance.test.ts`
- `tests/unit/phase19-payout-reconciliation.test.ts`

### Chưa được Git theo dõi — 22 file

- `apps/identity-service/src/password-reset/router.ts`
- `apps/identity-service/src/password-reset/service.ts`
- `apps/mobile/app/teaching/profile/index.tsx`
- `apps/web/src/admin/admin-ai.css`
- `apps/web/src/admin/AdminAi.tsx`
- `apps/web/src/auth/social.ts`
- `apps/web/src/components/FloatingAiTutor.tsx`
- `apps/web/src/components/PublicLecturer.tsx`
- `apps/web/src/components/RoleAiExperience.tsx`
- `apps/web/src/components/SafeMascot.tsx`
- `apps/web/src/lecturer/lecturer-revenue.css`
- `apps/web/src/lecturer/ProfileEditor.tsx`
- `apps/web/src/lecturer/RevenueDashboard.tsx`
- `apps/web/src/pages/ai-learning.css`
- `apps/web/src/pages/NotFound.tsx`
- `apps/web/src/student/AiTutorArchive.tsx`
- `apps/web/src/student/aiTutorConversation.tsx`
- `apps/web/tests/admin-ai.test.tsx`
- `apps/web/tests/notfound.test.tsx`
- `apps/web/tests/role-ai-experience.test.tsx`
- `MOBILE_DEVELOPMENT_GUIDE.md`
- `tests/unit/finance-commission.test.ts`

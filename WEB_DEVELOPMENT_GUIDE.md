# Hướng dẫn chạy AILSS Web

Tài liệu này dành cho Web desktop/responsive. Phần mobile chưa được cấu hình trong repository hiện tại.

## 1. Chuẩn bị

Cần Node.js 24.x, pnpm 11.x, Docker Desktop/Compose v2 và khoảng 12 GiB RAM khả dụng. Kiểm tra:

```bash
node --version
pnpm --version
docker --version
docker compose version
```

Từ thư mục gốc repository:

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env
pnpm keys:dev
```

Không commit `.env` hoặc private key được sinh cho môi trường local.

## 2. Chạy Web cùng backend đầy đủ

```bash
pnpm env:dev-async
```

Đợi environment báo PASS, rồi kiểm tra Gateway:

```bash
curl http://127.0.0.1:8080/health/ready
```

Mở terminal thứ hai:

```bash
pnpm dev:web
```

Mở URL Vite in ra, thường là `http://127.0.0.1:5173`. Nếu cần cổng 5177 cho browser QA:

```bash
AILSS_WEB_ORIGIN=http://127.0.0.1:5177 pnpm --filter @ailss/web exec vite --host 127.0.0.1 --port 5177
```

Web dùng same-origin session adapter và cookie HttpOnly. Không chép access/refresh token vào localStorage.

## 3. Tài khoản và mật khẩu local

Ba tài khoản dưới đây đã được tạo trong Cassandra local của profile `dev-async` và đã được kiểm tra đăng nhập qua Gateway lẫn Web session adapter:

| Vai trò  | Email                       | Mật khẩu             | Trạng thái            |
| -------- | --------------------------- | -------------------- | --------------------- |
| Student  | `student.demo@ailss.local`  | `AilssDemo!2026`     | `ACTIVE`              |
| Lecturer | `lecturer.demo@ailss.local` | `AilssLecturer!2026` | `ACTIVE`, đã xác minh |
| Admin    | `admin.demo@ailss.local`    | `AilssAdmin!2026`    | `ACTIVE`              |

Đăng nhập tại `http://127.0.0.1:5173/auth/login`. Đây là credential công khai chỉ dành cho môi trường phát triển local; không dùng chúng trong staging hoặc production.

Khi chạy `AILSS_CONFIRM_RESET=YES pnpm env:reset`, volume Cassandra bị xóa nên các tài khoản local trên cũng bị xóa. Clean bootstrap không tự seed credential cố định. Khi đó cần tạo lại Student qua trang đăng ký và cấp quyền Lecturer/Admin theo quy trình quản trị của hệ thống.

Quy trình nghiệp vụ Lecturer đầy đủ vẫn là:

```text
Student đăng nhập
→ nộp Lecturer application
→ Admin APPROVE
→ đăng nhập lại thành LECTURER chưa xác minh
→ Admin thực hiện Lecturer verification
→ đăng nhập lại thành verified LECTURER
```

> Không dùng `CASSANDRA_ADMIN_PASSWORD` hoặc `RABBITMQ_ADMIN_PASSWORD` để đăng nhập Web. Đó là credential hạ tầng, hoàn toàn tách biệt với tài khoản người dùng AILSS.

## 4. Chạy UI-only

Khi chỉnh public page, CSS, responsive, animation hoặc component không cần dữ liệu thật:

```bash
pnpm dev:web
```

Các public route vẫn hoạt động. Workspace cần session/backend; browser test có thể mock `/web-session/**` để kiểm tra UI nhưng mock không thay thế acceptance backend.

Route thường dùng:

```text
/
/courses
/ai-learning
/auth/login
/auth/register
/app
/app/learn
/app/teaching
/app/admin
```

## 5. Production build và preview

```bash
pnpm build:web
pnpm --filter @ailss/web preview
```

Bundle nằm trong `apps/web/dist`. Khi build production, đặt `AILSS_PUBLIC_ORIGIN` thành HTTPS origin chính thức để canonical URL, social metadata và sitemap không dùng giá trị local.

## 6. Kiểm thử Web

```bash
pnpm typecheck:web
pnpm lint:web
pnpm test:web
pnpm build:web
```

Với dev server ở cổng 5177:

```bash
cd apps/web
AILSS_QA_URL=http://127.0.0.1:5177 node scripts/verify-browser.mjs
AILSS_QA_URL=http://127.0.0.1:5177 node scripts/verify-session.mjs
AILSS_QA_URL=http://127.0.0.1:5177 node scripts/verify-student.mjs
AILSS_QA_URL=http://127.0.0.1:5177 node scripts/verify-lecturer.mjs
AILSS_QA_URL=http://127.0.0.1:5177 node scripts/verify-assessment.mjs
AILSS_QA_URL=http://127.0.0.1:5177 node scripts/verify-ai.mjs
BASE_URL=http://127.0.0.1:5177 node scripts/verify-interaction.mjs
AILSS_QA_URL=http://127.0.0.1:5177 node scripts/verify-admin-commerce.mjs
```

Các suite kiểm tra width `375`, `768`, `1440`, `1920`, overflow, axe accessibility, keyboard/focus, browser storage và reduced motion.

## 7. Motion và Three.js

- Public Home lazy-load scene Three.js khi vào viewport.
- Scene dừng ngoài viewport và được bỏ qua với reduced motion/layout mobile phù hợp.
- Workspace chỉ dùng transition nhẹ, không chạy canvas 3D liên tục.
- Scroll effect dùng native scrolling, không chặn wheel/touch.

```bash
cd apps/web
AILSS_QA_URL=http://127.0.0.1:5177 node scripts/verify-motion.mjs
```

## 8. Dừng hoặc làm mới môi trường

Dừng và giữ dữ liệu:

```bash
pnpm env:down
```

Xóa toàn bộ volume local rồi bootstrap lại:

```bash
AILSS_CONFIRM_RESET=YES pnpm env:reset
pnpm env:dev-async
```

## 9. Lỗi thường gặp

### Cổng đã được sử dụng

```bash
pnpm preflight
```

Giải phóng các cổng `8080`, `5173`/`5177`, `9042`, `5672`, `15672`, `9000`, `9001` rồi chạy lại.

### Gateway trả 503 ngay sau startup

```bash
docker compose ps
docker compose logs --tail=100 api-gateway
curl http://127.0.0.1:8080/health/ready
```

Chờ dependency ready và xác định cấu hình lỗi; không tăng timeout tùy ý.

### Worker không xử lý event

```bash
docker compose ps rabbitmq ai-worker document-worker notification-worker
docker exec ailss-rabbitmq rabbitmqctl -p /ailss list_consumers queue_name consumer_tag
```

Worker có cơ chế tự reconnect sau RabbitMQ restart. Nếu consumer không trở lại, kiểm tra log worker và RabbitMQ trước khi restart thủ công.

### Workspace không đăng nhập

- Xác nhận Gateway ready.
- Dùng cùng hostname `127.0.0.1`, tránh trộn với `localhost`.
- Nếu vừa khởi động lại `pnpm dev:web`, hãy đăng nhập lại. Session adapter của môi trường dev lưu phiên trong bộ nhớ tiến trình Vite, nên phiên cũ không còn sau khi tiến trình khởi động lại.
- Nếu vẫn thấy thông báo phiên hết hạn, xóa cookie `ailss` của `127.0.0.1` trong DevTools rồi mở lại `/auth/login`.
- Khi dùng cổng khác 5173, đặt `AILSS_WEB_ORIGIN` đúng bằng origin đang mở; ví dụ cổng 5177 dùng lệnh ở mục 2.
- Kiểm tra origin/CSRF và cookie trong DevTools.
- Không tự thêm token vào browser storage.

## Giao diện web và học liệu minh họa

- Đăng ký giảng viên trực tiếp tại `/auth/register/lecturer`. Không cần tạo tài khoản học viên trước. Quản trị viên vào **Người dùng → Giảng viên → Xem chi tiết → Xác minh giảng viên** để mở quyền giảng dạy.
- Bấm biểu tượng mặt trăng/mặt trời trên thanh đầu trang để đổi sáng/tối; lựa chọn được lưu trên trình duyệt.
- Bấm tên tài khoản → **Hồ sơ và ảnh đại diện** để tải ảnh PNG/JPEG/WebP. Ảnh được cắt vuông và thu nhỏ trước khi lưu trên máy chủ.
- Các trang khóa học và trợ giúp dùng chung phiên đăng nhập, hiển thị tên người dùng cùng đường dẫn quay về không gian cá nhân.

### Tài khoản phát triển

| Vai trò       | Email                     | Mật khẩu mặc định  |
| ------------- | ------------------------- | ------------------ |
| Học viên      | student.demo@ailss.local  | AilssDemo!2026     |
| Giảng viên    | lecturer.demo@ailss.local | AilssLecturer!2026 |
| Quản trị viên | admin.demo@ailss.local    | AilssAdmin!2026    |

Các tài khoản này thuộc dữ liệu phát triển trên máy hiện tại; đặt lại volume cơ sở dữ liệu sẽ xóa chúng. Script nạp học liệu yêu cầu ba tài khoản tồn tại và giảng viên đã được xác minh.

### Nạp khóa học và cộng đồng mẫu

Chạy từ thư mục gốc `ailss` khi `dev-async` đã sẵn sàng:

```sh
pnpm seed:web-demo
node scripts/dev/seed-course-community.mjs
node scripts/dev/seed-featured-instructors.mjs
```

Tạo sáu khóa học (miễn phí và có phí), 12 bài PDF/TXT, sáu bài kiểm tra, hai lớp riêng, một đợt học JavaScript trực tuyến có lịch, bình luận và đánh giá. Hai giảng viên mẫu bổ sung có khóa học Python riêng, dùng video freeCodeCamp qua YouTube. Thanh toán chỉ là mô phỏng. Các đánh giá được ghi rõ `[Dữ liệu mẫu]`, không phải nhận xét khách hàng thật. Nhật ký trong `tmp/` hỗ trợ chạy lại; không xóa nhật ký khi cơ sở dữ liệu vẫn còn.

Tài khoản giảng viên mẫu bổ sung: `linh.english.demo@ailss.local` và `an.python.demo@ailss.local`, mật khẩu `AilssLecturer!2026`. Dùng tài khoản giảng viên chính để quản lý các khóa Python/IELTS của bạn.

### Chuyển bộ Python và IELTS thành khóa học của bạn

```sh
node scripts/dev/index-local-library.mjs "/đường/dẫn/IELTS_Part1" "/đường/dẫn/IELTS_Part2"
node scripts/dev/import-owned-courses.mjs
```

Script tạo **một khóa Python** sử dụng video Google Drive đã cung cấp và **bảy khóa IELTS**: Listening, Reading, Speaking, Writing, Ngữ pháp, Phát âm, Từ vựng. Toàn bộ 501 tệp được gắn thành bài giảng trong các chương; khóa học có chủ sở hữu, trạng thái xuất bản, đợt đăng ký và tiến độ trên API. Mở **Khóa học của tôi** (`/app/learn`) bằng tài khoản học viên hoặc **Giảng dạy** bằng tài khoản giảng viên. Đường dẫn cũ `/app/resources` chuyển về khóa học, không còn thư viện tệp riêng.

Video/PDF/DOCX gốc vẫn ở thư mục Downloads. `tmp/local-library.json`, `tmp/course-media.json` và nhật ký không được đưa lên Git. Luồng đọc tệp cục bộ chỉ bật ở môi trường phát triển, kiểm tra quyền của bài học trước khi truyền dữ liệu và hỗ trợ tua video bằng byte range. Không sao chép nội dung vào thư mục public. Google Drive vẫn yêu cầu quyền chia sẻ của chủ tệp. Khi triển khai lên máy khác, cần cung cấp lại tệp nguồn và chuyển lưu trữ bài giảng sang kho đối tượng; đường dẫn trên máy này không hoạt động ở production.

### Kiểm thử Gemini với đề thi của hệ thống

```sh
pnpm exec tsx scripts/dev/check-gemini-quiz.ts --live
```

Lệnh gửi ba yêu cầu thật bằng `GEMINI_API_KEY` trong `.env`: Python tiếng Việt, IELTS tiếng Anh và nguồn chứa chỉ dẫn gây nhiễu. Dùng đúng provider và bộ kiểm tra `objective-v1` của worker, kiểm tra bốn loại câu hỏi, số lượng và cấu trúc đáp án. Kết quả lưu riêng trong `tmp/gemini-check/`; không ghi khóa API. Kiểm tra cấu trúc không thay thế việc giảng viên đọc và duyệt tính chính xác của đề. Lỗi 503/429 từ nhà cung cấp phải được báo là lỗi, không tính là đạt.

`OBJECT_STORAGE_PUBLIC_URL` mặc định `http://127.0.0.1:9000` dùng cho bài PDF/TXT lưu MinIO. Mật khẩu demo và nội dung chỉ dùng cho môi trường phát triển.

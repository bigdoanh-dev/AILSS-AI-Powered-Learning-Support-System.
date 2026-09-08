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

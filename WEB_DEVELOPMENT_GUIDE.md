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
test -f .env || cp .env.example .env
pnpm keys:dev
```

Chỉ sao chép file mẫu khi `.env` chưa tồn tại. Không chạy lại
`cp .env.example .env` trên môi trường đã cấu hình vì file mẫu có các giá trị
Google/SePay rỗng. Các cấu hình riêng của máy có thể đặt trong `.env.local`;
Vite và các lệnh `pnpm env:*` sẽ nạp file này sau `.env`. Không commit
`.env`, `.env.local` hoặc private key được sinh cho môi trường local.

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

### Mất cấu hình Google Login hoặc cổng thanh toán SePay

- **Nguyên nhân:** .env đã bị ghi đè bởi .env.example, trong đó các biến Google và SePay để trống.
- **Lệnh gây ra tình trạng này là:** `cp .env.example .env` (khi chạy lại trên môi trường đã cấu hình trước đó thay vì dùng `test -f .env || cp .env.example .env`).
- **Cách khắc phục:**
  - Khôi phục lại các giá trị biến môi trường trong `.env` hoặc khai báo vào `.env.local` (file này được hệ thống nạp sau `.env` và không bị ghi đè).
  - Tuyệt đối không chạy lại `cp .env.example .env` khi `.env` đã tồn tại; luôn dùng lệnh an toàn `test -f .env || cp .env.example .env`.

## Giao diện web và học liệu minh họa

### Google báo token không hợp lệ dù Client ID đã đúng

Identity cần truy cập HTTPS tới `www.googleapis.com` để tải khóa công khai xác
thực token Google. Nếu container chỉ nối mạng Docker `internal: true`, bước này
có thể lỗi DNS `EAI_AGAIN`. Đây là lỗi kết nối của backend, không phải bằng chứng
token của người dùng sai.

Compose nối Identity vào `auth_egress_net` bên cạnh hai mạng nội bộ để tải khóa
Google/Apple. Sau khi cập nhật, build và tạo lại riêng Identity bằng cấu hình
`.env` và `.env.local`; không chỉ chạy `docker restart`, vì lệnh đó không áp dụng
cấu hình mạng mới. Lỗi tải khóa được trả dưới mã `SOCIAL_PROVIDER_UNAVAILABLE`
(HTTP 503, có thể thử lại), còn token sai vẫn bị từ chối bằng HTTP 401.

Nếu Google đã xác thực được nhưng API đăng nhập trả HTTP 500 khi tạo tài khoản
mới, kiểm tra câu ghi `users_by_role_status_bucket`: khóa chính gồm `role`,
`status`, `shard`, `updated_at`, `user_id`. Repository social phải ghi đủ các khóa
này, thông tin hiển thị và dùng `identitySearchShard` như luồng đăng ký thông
thường. Test `identity-social-repository.test.ts` đối chiếu với migration để
phát hiện thiếu khóa; test chỉ giả lập repository dịch vụ không bắt được lỗi CQL này.

### Google đăng nhập thành công nhưng quay lại trang đăng nhập

Khi popup Google đóng, trình duyệt phát sự kiện `focus`. Kiểm tra phiên chạy
song song với yêu cầu đăng nhập có thể thay thế kết quả đăng nhập bằng trạng
thái chưa đăng nhập. `SessionProvider` bỏ qua bootstrap trong lúc đăng nhập đang
chờ; kết quả đến muộn sau đăng xuất vẫn bị loại bỏ.

Frontend chuyển trực tiếp theo hồ sơ backend trả về: học viên tới `/app`, giảng
viên đã xác minh tới `/app/teaching`, quản trị viên tới `/app/admin`. Giảng viên
chưa xác minh tới trang tổng quan chờ xác minh. `returnTo` chỉ được giữ nếu là
đường dẫn nội bộ phù hợp với vai trò. Trang đăng nhập cũng tự rời đi khi phiên
đã được khôi phục. Test `login-navigation.test.tsx` kiểm tra điều hướng và giữ
phiên cho cả ba vai trò khi popup đóng.

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

### Khôi phục mật khẩu bằng email OTP

Trang `/auth/forgot-password` (mở từ liên kết **Quên mật khẩu?** trên trang đăng nhập) gọi BFF `/web-session/auth/password-reset/{request,verify,complete}`. BFF chuyển tiếp tới các API cùng tên của Gateway/Identity. Luồng gồm email → OTP 6 chữ số → mật khẩu mới và xác nhận, 12–128 ký tự. OTP hết hạn sau 15 phút; gửi lại sau 60 giây. Phản hồi yêu cầu mã luôn có thông báo trung lập để không tiết lộ email đã đăng ký hay chưa. Chỉ tài khoản có thông tin đăng nhập bằng mật khẩu nhận mã.

Lưu `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` trong `.env.local`, rồi tạo lại container Identity với cả `.env` và `.env.local`. Token khôi phục chỉ ở bộ nhớ của màn hình; không lưu cookie, URL hay localStorage. Khi hoàn tất, người dùng đăng nhập lại bằng mật khẩu mới.

Kiểm tra thủ công với một email đã đăng ký có quyền truy cập hộp thư: yêu cầu mã, nhập OTP nhận qua email, đặt mật khẩu mới rồi đăng nhập. Kiểm tra thêm mã sai/hết hạn, gửi lại mã, hai mật khẩu không khớp và lỗi SMTP. Test giao diện dùng phản hồi API giả lập; kiểm tra trình duyệt với email `example.invalid` xác nhận phản hồi trung lập và lỗi OTP mà không gửi thư thật.

#### Lỗi HTTP 500 khi yêu cầu OTP cho tài khoản đã đăng ký

Identity từng dùng sai thứ tự CQL `USING TTL 900 IF NOT EXISTS` khi ghi `password_reset_by_email`. Cassandra trả SyntaxError 8192 trước bước gửi SMTP; yêu cầu cho email chưa có tài khoản vẫn trả accepted vì không đi tới INSERT. Cú pháp đúng là `IF NOT EXISTS USING TTL 900`.

Kiểm thử hồi quy `tests/unit/identity-password-reset.test.ts` gọi service với repository thật và dùng bộ sinh CQL của driver làm đối chiếu. Kiểm tra local với Cassandra thật đã xác nhận INSERT, đọc, tăng số lần thử và ghi HMAC xác nhận, sau đó dọn dòng thử example.invalid. Image Identity local đã cập nhật module sửa lỗi từ mã nguồn đã qua typecheck; lần dựng toàn bộ image bị hủy do tải dependency quá chậm. Khi dựng lại bằng Dockerfile chuẩn, bản sửa vẫn được biên dịch từ repository.ts.

#### OTP báo không khả dụng dù SMTP đã cấu hình

Log Gateway ghi HTTP 503 ở khoảng 5.004–5.010 giây; Identity ghi gửi mã thành công ngay sau đó. Yêu cầu chờ gửi SMTP đồng bộ nên bị cả middleware circuit breaker và outbound fetch của Gateway cắt ở giới hạn mặc định 5 giây. Chỉ tăng timeout của frontend không giải quyết được lỗi này.

Riêng `POST /api/v1/auth/password-reset/request` dùng ngân sách 45 giây cho middleware Gateway, fetch breaker và kết nối tới Identity. BFF chờ 50 giây, web/mobile chờ 55 giây để nhận kết quả của backend. Các bước verify/complete và đăng nhập vẫn giữ giới hạn hiện có. Khi backend thực sự không trả lời, yêu cầu vẫn bị hủy trong giới hạn này.

Kiểm thử `tests/unit/gateway-password-reset.test.ts` dùng HTTP loopback để xác nhận gửi OTP có thể vượt giới hạn thông thường, các thao tác khác vẫn bị giới hạn và yêu cầu gửi OTP treo vẫn trả lỗi. Kiểm tra image Gateway local dùng backend giả phản hồi sau 6 giây để tái hiện lỗi cũ mà không gửi thư thật. Sau thay đổi cần cập nhật image Gateway và tải lại máy chủ web; chỉ tải lại trang không cập nhật mã backend cũ.

#### Không thấy OTP trong hộp thư

`accepted: true` trên API là phản hồi trung lập, không phải bằng chứng thư đã vào Inbox. Mailer kiểm tra SMTP đã chấp nhận đúng địa chỉ nhận; log `identity.password_reset.request` lưu `smtpAccepted`, `smtpResponseCode` và `messageId` để đối chiếu. Không ghi OTP, nội dung thư hoặc phản hồi SMTP đầy đủ. Nếu SMTP từ chối, service xóa challenge vừa tạo và ghi `PASSWORD_RESET_EMAIL_DELIVERY_FAILED` nhưng giữ phản hồi trung lập.

Ngay cả SMTP 250 vẫn chỉ xác nhận bàn giao cho máy chủ gửi. Kiểm tra đúng hộp thư email đã nhập, mục Spam và thư báo trả lại trong tài khoản `SMTP_USER`. Khi báo lỗi cần thời điểm gửi và trạng thái SMTP; chưa có dữ liệu này thì không kết luận nhà cung cấp trường học đã chặn thư. Các kiểm thử mailer và service dùng transport giả, không gửi thư thật.

Kiểm tra nhận thư thực tế ngày 01/10/2026: tìm `in:anywhere AILSS` trong đúng hộp thư trường không thấy các OTP dạng HTML, Gmail gửi có bản sao đúng người nhận và không tìm thấy thông báo trả lại liên quan. Một thư thử chỉ có văn bản, không OTP, được SMTP chấp nhận và xuất hiện trong Inbox lúc 15:49 (UTC+7). Vì vậy cấu hình SMTP và địa chỉ nhận hoạt động; chưa có nhật ký phía Workspace để kết luận bộ lọc nào đã tác động tới các thư OTP trước đó. Mailer OTP được chuyển sang `text` thuần, bỏ HTML và header `X-AILSS-Message-Type`, giữ tiếng Việt, mã 6 chữ số và thời hạn 15 phút. Sau khi cập nhật Identity, một OTP thật gửi qua API Gateway được SMTP chấp nhận lúc 15:56:59 (UTC+7), rồi được xác nhận trong Inbox lúc 15:57 bằng tìm kiếm đúng Message-ID `50840b3e-4581-3221-2873-e8627a8a56d1@gmail.com`. Kiểm tra này xác nhận gửi và nhận OTP thực tế ở phiên bản văn bản thuần; người dùng tự nhập mã và mật khẩu mới để hoàn tất đặt lại mật khẩu.

Theo yêu cầu hiển thị mã lớn, mẫu hiện tại trong `apps/identity-service/src/password-reset/email-template.ts` gửi cả `text` và HTML đơn giản trong cùng thư. HTML dùng bảng và CSS trực tiếp, giới hạn chiều rộng 600px, không tải ảnh, font hay tài nguyên ngoài; không thêm header tùy chỉnh. Hai định dạng giữ cùng mã và thời hạn, mã được giữ dưới dạng chuỗi để không mất số 0 đầu. Kiểm thử xác nhận nội dung và escape HTML; khả năng nhận thư của phiên bản HTML mới cần được xác nhận bằng một lần gửi OTP thật, không suy ra từ SMTP 250 hoặc từ lần nhận bản văn bản thuần trước đó.

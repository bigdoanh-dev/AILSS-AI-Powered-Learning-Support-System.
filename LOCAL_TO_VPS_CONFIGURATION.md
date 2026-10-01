# AILSS: cấu hình local và chuyển sang VPS

Cập nhật: **01/10/2026**. Chạy các lệnh từ thư mục `ailss`, trừ nơi có ghi khác.

## 1. Cấu hình đang dùng trên local

| Thành phần | Địa chỉ mở từ máy phát triển | Địa chỉ giữa các container           |
| ---------- | ---------------------------- | ------------------------------------ |
| Web        | `http://127.0.0.1:5173`      | Web đang chạy bằng Vite trên máy chủ |
| Gateway    | `http://127.0.0.1:8080`      | `http://api-gateway:8080`            |
| AI service | Qua Web/Gateway              | `http://ai-service:8106`             |
| Prometheus | `http://127.0.0.1:9090`      | `http://prometheus:9090`             |
| Grafana    | `http://127.0.0.1:3001`      | `http://grafana:3000`                |

`127.0.0.1` **bên trong container** trỏ tới chính container đó. Gateway không dùng `127.0.0.1:9090` để gọi Prometheus nằm trong container khác. Trình duyệt trên điện thoại cũng không dùng `127.0.0.1` để truy cập máy tính.

### Những tệp cần biết

- `.env`: cấu hình nền và credential hạ tầng local đã tạo.
- `.env.local`: cấu hình riêng của máy; được Docker Compose đọc **sau** `.env`. Giữ các tích hợp Google, SMTP, SePay và lựa chọn chế độ quản trị ở đây.
- `.env.example`: mẫu không chứa mật khẩu/API key thật. Khóa AI phải được nhà cung cấp cấp; không thể tạo bằng chuỗi ngẫu nhiên.
- `docker-compose.observability.yml`: nối Gateway với Prometheus/Grafana và chỉ mở cổng giám sát trên loopback.
- `secrets/grafana_admin_password`: mật khẩu Grafana local; không đưa lên Git. Công cụ khởi động tạo tệp nếu chưa có và giữ nguyên nếu đã tồn tại.

Trong `.env.local`, cấu hình phần đang sửa như sau; giữ nguyên các giá trị tích hợp khác:

```dotenv
AI_ADMIN_SUPPORT_MODE=local-guide
PROMETHEUS_PUBLIC_URL=http://127.0.0.1:9090
GRAFANA_PUBLIC_URL=http://127.0.0.1:3001
```

`AI_ADMIN_SUPPORT_MODE=local-guide` chỉ áp dụng cho **hướng dẫn quản trị**. Giao diện hiện “Hướng dẫn quản trị local”; phản hồi ghi rõ không gọi mô hình AI trực tuyến. Chế độ này trả hướng dẫn các màn hình có trong ứng dụng, không đọc số liệu quản trị và không tự duyệt hồ sơ, xuất bản khóa học hay thực hiện thanh toán. Các trợ lý học viên/giảng viên và tạo đề vẫn dùng cấu hình nhà cung cấp của chúng.

### Khởi động local đầy đủ

Cần Docker Compose, Node.js 24–26 và pnpm 11 theo `package.json`.

```bash
pnpm env:dev-async
pnpm --filter @ailss/web dev
```

Lệnh môi trường hiện bao gồm cấu hình observability. Tệp `.env.local` được giữ lại khi chạy lại. `dev-core` chỉ chạy một phần dịch vụ; dùng `dev-async` để kiểm tra đủ các dịch vụ trong trang giám sát.

Nếu chỉ cập nhật cấu hình quản trị/giám sát trên stack đã chạy:

```bash
node scripts/dev/bootstrap-observability.mjs

docker compose --env-file .env --env-file .env.local \
  -f docker-compose.yml \
  -f docker-compose.async.yml \
  -f docker-compose.observability.yml \
  --profile dev-async up -d --no-deps --build \
  api-gateway ai-service prometheus grafana alertmanager
```

Cần giữ đủ ba tệp `-f` cho các lần chạy lại. `docker compose restart` không cập nhật biến môi trường của container: sau khi sửa `.env.local`, dùng `up -d` để Compose tạo lại container có cấu hình thay đổi. Nếu sửa phần BFF trong `apps/web/server`, khởi động lại tiến trình Web.

Đăng nhập bằng tài khoản quản trị của bạn rồi mở:

- `http://127.0.0.1:5173/app/admin/ai`: nhãn hướng dẫn local, gửi một câu hỏi về kiểm duyệt.
- `http://127.0.0.1:5173/app/admin/monitoring`: Prometheus và Grafana đều “Đã kết nối”; xem trạng thái từng dịch vụ.
- `http://127.0.0.1:3001/d/ailss-platform`: dashboard Grafana. Tên đăng nhập ban đầu là `admin`; mật khẩu nằm trong tệp secret nêu trên, hoặc mật khẩu bạn đã đổi trong Grafana. Tạo lại container không đặt lại mật khẩu trong database Grafana đã có.

Kiểm tra nhanh không cần đăng nhập:

```bash
curl --fail http://127.0.0.1:8080/health/ready
curl --fail http://127.0.0.1:9090/-/ready
curl --fail http://127.0.0.1:3001/api/health
```

Prometheus thu thập mỗi 15 giây; Web làm mới mỗi 30 giây. Sau khi khởi động cần ít nhất vài lần thu thập để tính tốc độ/độ trễ. Khoảng chưa có lưu lượng có thể chưa có đủ dữ liệu; không thay thế bằng số liệu mẫu.

Gateway và các business service ghi metric HTTP khi phản hồi kết thúc, gồm lưu lượng, mã trạng thái và thời gian xử lý. Health check và lượt thu thập `/metrics` được loại khỏi số liệu lưu lượng ứng dụng. Nhãn dùng mẫu route thay vì ID tài khoản, URL hoặc query của người dùng. Tỷ lệ 5xx chỉ hiển thị 0% khi có dữ liệu lưu lượng hợp lệ và không ghi nhận lỗi 5xx; mất kết nối hoặc chưa đủ mẫu vẫn hiện “Chưa có dữ liệu”.

### Cảnh báo local và kênh nhận trên VPS

Alertmanager local dùng receiver `local`, không gửi cảnh báo ra ngoài. Xem cảnh báo tại `http://127.0.0.1:9093`. Không đặt `${ALERT_WEBHOOK_URL}` trong YAML: Alertmanager không tự thay biến này và sẽ khởi động lỗi `unsupported scheme`.

Khi lên VPS, tạo file cấu hình riêng ngoài Git, thay receiver bằng kênh thật và mount file đó vào `/etc/alertmanager/alertmanager.yml`. Ví dụ cấu trúc receiver (thay URL bằng địa chỉ HTTPS thực tế trong file riêng):

```yaml
route:
  receiver: operations
receivers:
  - name: operations
    webhook_configs:
      - url: https://dia-chi-nhan-canh-bao-cua-ban
        send_resolved: true
```

Giữ lại quy tắc nhóm và khoảng gửi cảnh báo phù hợp từ cấu hình local. Kiểm tra file bằng `amtool check-config` trong image Alertmanager trước khi khởi động; kiểm tra cả một cảnh báo thử và thông báo phục hồi trên kênh nhận. URL chứa token được xem là bí mật, không commit lên GitHub.

## 2. Những giá trị đổi khi lên VPS

| Cấu hình                                  | Local                                    | VPS                                                              |
| ----------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| `NODE_ENV`                                | `development`                            | `production`                                                     |
| `AILSS_PROFILE` trong tiến trình ứng dụng | `dev-async`                              | `production`                                                     |
| `AI_ADMIN_SUPPORT_MODE`                   | `local-guide`                            | `external`                                                       |
| `AI_ASSISTANT_PROVIDER_MODE`              | Nhà cung cấp đã chọn                     | `external`                                                       |
| `AI_ASSISTANT_INTEGRATION_ENABLED`        | `false`                                  | `false`                                                          |
| `AILSS_WEB_ORIGIN`                        | `http://127.0.0.1:5173`                  | `https://learn.ten-mien-cua-ban`                                 |
| `AILSS_GATEWAY_URL` cho BFF               | `http://127.0.0.1:8080`                  | Địa chỉ HTTPS Gateway mà tiến trình BFF truy cập được            |
| `PROMETHEUS_SERVICE_URL`                  | `http://prometheus:9090` khi chạy Docker | Giữ địa chỉ nội bộ nếu cùng mạng Docker                          |
| `GRAFANA_SERVICE_URL`                     | `http://grafana:3000` khi chạy Docker    | Giữ địa chỉ nội bộ nếu cùng mạng Docker                          |
| URL mở Prometheus/Grafana                 | Loopback của máy local                   | Loopback qua SSH tunnel, hoặc tên miền riêng được bảo vệ         |
| `OBJECT_STORAGE_PUBLIC_URL`               | `http://127.0.0.1:9000`                  | HTTPS của object storage mà trình duyệt/điện thoại truy cập được |
| Google OAuth, SMTP, SePay                 | Giá trị local trong `.env.local`         | Giá trị production được cấp riêng và khai báo trên VPS           |

Các URL `*_SERVICE_URL` phục vụ giao tiếp backend; URL `*_PUBLIC_URL` phục vụ nút mở trong trình duyệt. Đổi tên miền ngoài không có nghĩa phải thay tên container nội bộ.

## 3. Chuẩn bị cấu hình production riêng

**Chưa triển khai VPS trong lần sửa này.** `config/production.env.example` là hợp đồng cấu hình đã che bí mật, chưa phải một tệp có thể chạy ngay. Repo hiện có các Compose profile `dev-core`, `dev-async`, `research`, `demo`; không có lệnh `pnpm env:production` hoặc Compose profile `production` dùng ngay.

Trên VPS, chuẩn bị `.env.production` riêng, quyền `0600`, từ mẫu production và đầy đủ biến theo từng dịch vụ. Không chép `.env.local` lên VPS rồi coi đó là production; các credential local, tài khoản demo và khóa ký local cần được thay bằng cấu hình production. Không chạy các script seed tài khoản demo trên dữ liệu production.

Các giá trị cho quản trị AI:

```dotenv
NODE_ENV=production
AILSS_PROFILE=production
AI_ADMIN_SUPPORT_MODE=external
AI_ASSISTANT_PROVIDER_MODE=external
AI_ASSISTANT_INTEGRATION_ENABLED=false
AI_PROVIDER_MODE=production
AI_PROVIDER_API_KEY=<API_KEY_THAT_CUA_NHA_CUNG_CAP>
AI_PROVIDER_ENDPOINT=<HTTPS_ENDPOINT_DUNG_VOI_NHA_CUNG_CAP>
AI_PROVIDER_MODEL=<MODEL_DUOC_TAI_KHOAN_CHO_PHEP>
AI_PROVIDER_TIMEOUT_MS=45000
```

Đây là mẫu; thay toàn bộ phần trong dấu `<...>`. Khóa OpenAI phải đi với endpoint OpenAI tương thích; khóa Gemini phải đi với endpoint Gemini `.../models/<model>:generateContent` và model tương ứng. HTTP 401 là lỗi credential/nhà cung cấp, không được khắc phục bằng cách tăng timeout. Chế độ local bị ứng dụng chặn khi chạy production.

Cũng cần khai báo đầy đủ:

- Cassandra: TLS, CA/cert đúng hostname, keyspace và credential riêng của từng dịch vụ.
- RabbitMQ: kết nối TLS và quyền riêng của từng publisher/consumer. Các overlay local đang dùng `amqp://rabbitmq:5672`; production cần thay bằng kết nối TLS thực tế, không chỉ đổi một cờ boolean.
- Object storage: TLS endpoint, quyền bucket, URL tải lên/tải xuống truy cập được từ khách hàng.
- Các khóa JWT, Actor Context, Service Token, HMAC và đường dẫn mount tương ứng.
- SMTP dùng để gửi OTP; Google/Apple client ID, origin/callback HTTPS; SePay account, webhook API key và URL mới.

Google cần đăng ký origin HTTPS của Web và redirect URI tương ứng. Webhook SePay trên VPS là `https://api.ten-mien-cua-ban/api/v1/payments/sepay/webhook`; dùng API key khớp cấu hình backend. Khi đổi URL tunnel local sang VPS, cập nhật URL nhận webhook trong SePay.

Kiểm tra tệp cấu hình mà không in bí mật:

```bash
node scripts/ci/validate-production-config.mjs \
  --mode runtime --env-file .env.production
```

Lệnh này kiểm tra hợp đồng production tổng quát; không thay thế kiểm tra Compose đã merge, kết nối TLS, cấu hình từng process và thử đăng nhập thực tế.

## 4. Triển khai Web và Gateway trên VPS

Chuẩn bị bản build từ commit đã kiểm thử và chạy process bằng trình quản lý dịch vụ trên VPS. Không dùng Vite dev server làm Web production.

Ví dụ chạy BFF sau khi build Web, từ thư mục repo:

```bash
pnpm --filter @ailss/web build
cd apps/web
node --env-file=../../.env.production scripts/serve.mjs
```

BFF phục vụ mặc định trên `127.0.0.1:4174`, hoặc cổng `PORT` trong cấu hình. File env phải khai báo `AILSS_WEB_ORIGIN` đúng HTTPS ngoài và `AILSS_GATEWAY_URL` đúng Gateway mà BFF gọi được. BFF kiểm tra origin và quản lý cookie phiên; không chỉ đưa thư mục `dist` lên một static host rồi bỏ qua BFF.

Dùng reverse proxy HTTPS phía trước BFF. Ví dụ phần Nginx dưới đây chỉ dùng sau khi đã cấp chứng chỉ cho tên miền; thay hostname và đường dẫn cert thực tế:

```nginx
# Đặt map ở cấp http, ngoài server.
map $http_upgrade $ailss_connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 443 ssl;
    server_name learn.ten-mien-cua-ban;
    ssl_certificate /duong-dan/cert/fullchain.pem;
    ssl_certificate_key /duong-dan/cert/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4174;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $ailss_connection_upgrade;
        proxy_read_timeout 120s;
    }
}
```

Cần chuyển tiếp các header Upgrade/Connection để luồng realtime hoạt động qua Nginx. Tham khảo [tài liệu WebSocket chính thức của Nginx](https://nginx.org/en/docs/http/websocket.html).

Gateway dùng tên miền HTTPS riêng cho mobile/webhook. Hợp đồng production hiện yêu cầu `HTTPS_CERT_PATH` và `HTTPS_KEY_PATH`; cấu hình chứng chỉ/mount trên Gateway và CA cho BFF phù hợp với cách chấm dứt TLS đã chọn. Không bỏ xác minh chứng chỉ để kết nối. Backend Compose production cần overlay riêng cho TLS, secret, volume và mạng; kiểm tra cấu hình đã merge trước khi đưa lưu lượng vào. `TRUST_PROXY_HOPS` chỉ đặt theo đúng số proxy tin cậy thực tế.

## 5. Giám sát khi lên VPS

Giữ Prometheus, Grafana và Alertmanager trên mạng nội bộ. Có thể dùng lại tệp scrape/provisioning trong `ops/observability/`, với tên dịch vụ đúng mạng triển khai. Trên VPS cần volume bền vững cho `/prometheus` và `/var/lib/grafana`, sao lưu trước khi chuyển dữ liệu. Compose observability local hiện không có volume database bền vững; đừng coi dữ liệu lịch sử local là đã được sao lưu.

### Cách dùng trước: SSH tunnel cho người vận hành

Giữ cổng chỉ bind `127.0.0.1` trên VPS và URL nút mở như local. Từ máy của người quản trị:

```bash
ssh -N -L 9090:127.0.0.1:9090 -L 3001:127.0.0.1:3001 user@dia-chi-vps
```

Sau đó mở `http://127.0.0.1:9090` và `http://127.0.0.1:3001` trên máy đó. Nếu các cổng local đã được sử dụng, dừng stack giám sát local hoặc chọn cổng tunnel khác và cập nhật URL nút mở cho đúng. Gateway trên VPS vẫn gọi collector qua tên container; chỉ trình duyệt dùng tunnel.

### Khi cần tên miền giám sát riêng

Dùng HTTPS và xác thực cho các tên miền giám sát. Đổi `PROMETHEUS_PUBLIC_URL`, `GRAFANA_PUBLIC_URL`; với Grafana đặt `GF_SERVER_ROOT_URL` theo URL ngoài. Nếu reverse proxy chạy ngoài Docker, upstream của nó là loopback host; nếu trong Docker, upstream là tên container. Không đổi `GRAFANA_SERVICE_URL` thành URL giao diện có đăng nhập, vì Gateway dùng `/api/health` nội bộ.

Prometheus không nên đưa các endpoint giám sát ra Internet không có biện pháp bảo vệ; xem [mô hình bảo mật Prometheus](https://prometheus.io/docs/operating/security/). Các biến cấu hình/root URL của Grafana được mô tả trong [tài liệu Grafana](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/).

## 6. Kiểm tra trước và sau khi chuyển

1. Sao lưu dữ liệu và secret hiện có; xác nhận khả năng phục hồi. Không chạy `env:reset`, `down --volumes` hay seed demo để chuyển môi trường.
2. Kiểm tra hợp đồng `.env.production` và cấu hình Compose production đã merge bằng `config --quiet`; không xuất toàn bộ env ra log.
3. Xác nhận Web/BFF/Gateway, TLS và health/ready hoạt động qua đúng địa chỉ.
4. Kiểm tra đăng nhập theo từng vai trò, đăng xuất, Google OAuth và OTP email.
5. Kiểm tra AI quản trị hiển thị “AI trực tuyến”, nhận phản hồi từ provider thật; local guide không được bật.
6. Kiểm tra Prometheus/Grafana “Đã kết nối”, các target hoạt động, metric/history và dashboard đúng nguồn dữ liệu.
7. Kiểm tra webhook SePay có xác thực bằng luồng thanh toán kiểm thử được phép; đối chiếu trạng thái đơn và đối soát.
8. Khởi động lại riêng Web/Gateway/AI/collector, xác nhận cấu hình và quyền vẫn đúng. Chỉ chuyển DNS/lưu lượng sau khi các kiểm tra đạt.

## 7. Chẩn đoán nhanh

| Triệu chứng                                             | Kiểm tra và xử lý                                                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prometheus và Grafana chạy nhưng Web báo không kết nối  | Gateway phải nhận `http://prometheus:9090`, `http://grafana:3000`; khởi động lại bằng Compose có overlay observability.                                            |
| Nút mở giám sát trỏ sai máy                             | Kiểm tra `*_PUBLIC_URL`; loopback trên điện thoại/VPS không phải máy local của bạn.                                                                                |
| Collector vừa lên, metric còn trống                     | Chờ các lần scrape, mở trang có lưu lượng thật; xem `/targets`. Không thêm số liệu mẫu.                                                                            |
| AI trả 401/503                                          | Local: xác nhận `AI_ADMIN_SUPPORT_MODE=local-guide` trong ai-service. External: kiểm tra credential, endpoint và model cùng nhà cung cấp; đừng in API key vào log. |
| Sửa env nhưng chạy lại vẫn mất                          | Dùng `.env` rồi `.env.local`, đủ overlay; `up -d` tạo lại container. BFF cũng cần khởi động lại khi sửa env/phần server.                                           |
| Không thấy nhãn hướng dẫn local                         | Kiểm tra API `GET /web-session/admin/assistant/admin-status` khi đã đăng nhập quản trị; nó phải trả `mode: local-guide`.                                           |
| Grafana không nhận mật khẩu trong secret sau khi chuyển | Database hiện có giữ mật khẩu đã đổi; thay env không tự đặt lại mật khẩu. Dùng tài khoản hiện tại hoặc quy trình khôi phục của Grafana.                            |

## 8. Google đăng nhập trên local

Nếu nút Google đã hiện nhưng trình duyệt báo `The given origin is not allowed for the given client ID`, Gateway đã đọc Client ID, còn Google Cloud chưa cho phép địa chỉ Web hiện tại. Đây là cấu hình ở Google Cloud, không tự thay đổi khi sửa `.env.local`.

1. Mở Google Cloud → Google Auth Platform → Clients; chọn **Web client** khớp `GOOGLE_WEB_CLIENT_ID` đang dùng.
2. Trong **Authorized JavaScript origins**, thêm `http://localhost`, `http://localhost:5173`, và `http://127.0.0.1:5173` nếu mở Web bằng địa chỉ này. Origin gồm giao thức, tên máy và cổng, không thêm `/auth/login` hay đường dẫn khác.
3. Lưu cấu hình, tải lại trang đăng nhập và thử lại. Khi đổi cổng Web hoặc chuyển sang HTTPS trên VPS, đăng ký origin tương ứng.
4. Luồng dùng redirect phải đăng ký thêm URI callback chính xác trong **Authorized redirect URIs**; luồng nút Google trả credential qua callback JavaScript không yêu cầu thêm đường dẫn đăng nhập vào origins.

Xem [hướng dẫn thiết lập Google Identity Services](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid). Client ID Web không thay thế iOS/Android Client ID của ứng dụng native. Với Expo Go, dùng luồng trình duyệt được ứng dụng hỗ trợ; đăng nhập Google native cần development build có module `RNGoogleSignin`.

## Khóa học và các luồng mobile sau khi cập nhật

- Chạy bootstrap Cassandra từ mã mới trước khi khởi động Learning: migration `097` thêm danh mục tự nhập, `098` lưu ảnh lớp, `099` lưu mô tả và ảnh bìa khóa học. Các migration thêm cột, không xóa dữ liệu. Không chỉnh lại migration đã áp dụng.
- Ảnh bìa khóa học được nén JPEG (tối đa 960 px chiều ngang), gửi và lưu cùng khóa học; không còn phụ thuộc localStorage hay URI chỉ có trên điện thoại. Giới hạn data URL là 350.000 ký tự, mô tả là 2.000 ký tự.
- Mobile: giảng viên tạo khóa → gửi duyệt → quản trị nhập mã khóa, xác nhận bằng mật khẩu và xuất bản → giảng viên tạo và xuất bản đợt mở bán. Quyền sở hữu và trạng thái được backend kiểm tra ở từng bước.
- AI soạn đề mobile có chọn khóa/lớp và tải PDF, DOCX hoặc TXT tối đa 25 MiB. Đợi tài liệu được trích xuất trước khi tạo đề; khi tải thất bại có thể tiếp tục với cùng mã thao tác. Bản development client cần build lại khi thêm thư viện native `expo-document-picker`; Expo Go SDK 57 đã cung cấp thư viện này.
- Với điện thoại thật, `OBJECT_STORAGE_PUBLIC_URL` phải là địa chỉ kho tệp điện thoại truy cập được (IP LAN trên local; HTTPS trên VPS). Không thay hostname trong URL ký sẵn; sửa cấu hình kho tệp, khởi động lại backend rồi tạo lượt tải mới.
- Thanh toán hiện hỗ trợ QR/chuyển khoản SePay. Chỉ dùng mô phỏng khi backend công bố `paymentMode=simulation`; các phương thức MoMo, thẻ và VNPAY chưa có tích hợp provider. Khi dùng SePay, nút kiểm tra thanh toán chỉ đọc trạng thái đơn, quyền học được cấp sau khi máy chủ nhận và xác thực giao dịch.
- Bài kiểm tra hỗ trợ một/nhiều đáp án, đúng/sai và trả lời ngắn, chấm tự động theo hợp đồng backend; hạn đóng bài được lưu trên máy chủ. Chưa có nghiệp vụ nộp file/tự luận riêng.

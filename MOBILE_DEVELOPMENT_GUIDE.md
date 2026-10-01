# Hướng dẫn chạy AILSS trên mobile

Tài liệu này hướng dẫn chạy ứng dụng Expo/React Native trên iOS Simulator, Android Emulator hoặc điện thoại thật, kết nối tới Gateway đang chạy trên máy phát triển.

## 1. Chuẩn bị môi trường

Ở thư mục gốc repo, cài Node.js `24.x`, bật Corepack và cài dependency:

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
```

Để chạy native cần cài thêm:

- **iOS:** macOS, Xcode `26.4+` và iOS Simulator runtime.
- **Android:** Android Studio, Android SDK API 36, Java và một emulator đã tạo; có thể dùng điện thoại Android với USB debugging.

## 2. Khởi động API Gateway và backend

Mobile gọi API qua Gateway, vì vậy cần bật backend trước. Nếu đây là lần đầu chạy repo:

```bash
cp .env.example .env
pnpm keys:dev
pnpm env:dev-async
```

Lệnh cuối khởi động các dịch vụ local và Gateway. Chờ tới khi lệnh báo `environment-up` thành công. Gateway mặc định kiểm tra tại `http://127.0.0.1:8080/health/ready`.

Nếu backend đã chạy, bỏ qua bước này. Không dùng `pnpm env:reset` để khắc phục lỗi kết nối thông thường vì lệnh đó xóa dữ liệu Docker local.

## 3. Cấu hình địa chỉ Gateway cho mobile

Tạo file cấu hình riêng cho ứng dụng:

```bash
cp apps/mobile/.env.example apps/mobile/.env.local
```

Mở `apps/mobile/.env.local` và đặt `EXPO_PUBLIC_AILSS_API_BASE_URL` theo thiết bị chạy app:

| Nơi chạy app     | Giá trị                              |
| ---------------- | ------------------------------------ |
| iOS Simulator    | `http://127.0.0.1:8080`              |
| Android Emulator | `http://10.0.2.2:8080`               |
| Điện thoại thật  | `http://<IP-LAN-của-máy-tính>:18080` |

Ví dụ cho iOS Simulator:

```dotenv
EXPO_PUBLIC_AILSS_ENV=development
EXPO_PUBLIC_AILSS_API_BASE_URL=http://127.0.0.1:8080
```

Android Emulator dùng `http://10.0.2.2:8080`. Điện thoại thật cần có đường mạng tới máy tính và dùng địa chỉ IPv4 LAN của máy tính, ví dụ `http://192.168.1.20:18080`. Trên macOS có thể xem địa chỉ Wi-Fi bằng `ipconfig getifaddr en0` (nếu không có kết quả, kiểm tra interface mạng đang dùng trong Network Settings).

**Lưu ý khi dùng điện thoại thật:** cấu hình Docker mặc định chỉ bind Gateway vào `127.0.0.1`, nên thiết bị khác không truy cập được. Trong `.env` ở gốc repo, đặt `AILSS_MOBILE_GATEWAY_BIND_ADDRESS` bằng địa chỉ IPv4 LAN của máy tính (cùng địa chỉ dùng trong `EXPO_PUBLIC_AILSS_API_BASE_URL` của mobile), ví dụ:

```dotenv
AILSS_MOBILE_GATEWAY_BIND_ADDRESS=192.168.1.20
```

Sau đó chạy `pnpm env:dev-async` để tạo lại Gateway với port mapping mới. Cổng `127.0.0.1:8080` vẫn phục vụ Web và kiểm tra local; cổng `18080` chỉ mở trên IP đã chọn. Kiểm tra `http://192.168.1.20:18080/health/ready` trên điện thoại; kết quả cần có `ready: true`. Nếu máy tính nối qua Personal Hotspot, dùng IP mà hotspot cấp cho máy tính và kiểm tra điện thoại có truy cập được IP đó. Điện thoại dùng 4G riêng, không có đường mạng tới máy tính, sẽ cần Gateway HTTPS có thể truy cập từ Internet; chỉ đổi IP LAN không đủ. Chỉ bind vào IP của mạng phát triển đáng tin cậy, không dùng `0.0.0.0` hoặc đưa Gateway HTTP này ra Internet. Khi chỉ chạy simulator/emulator, giữ nguyên cấu hình bind mặc định.

## 4. Chạy app

### Đăng nhập Google trên mobile

Ứng dụng dùng Google Sign-In native để lấy **ID token**, sau đó gửi token tới
`/api/v1/auth/social/google`; AILSS tự tạo phiên và lưu refresh token bằng SecureStore.
Mobile tự lấy Web Client ID đang dùng cho bản web từ Gateway tại
`GET /api/v1/auth/social/config`; không cần chép ID này vào cấu hình Expo.
Để hoàn tất đăng nhập native:

1. Gateway cần nhận cùng `GOOGLE_WEB_CLIENT_ID` đã cấu hình cho bản web. Với Docker
   Compose, biến này được chuyển tự động từ `.env` gốc vào Gateway; khởi động lại Gateway
   sau khi cập nhật mã. Identity service tiếp tục dùng `GOOGLE_CLIENT_IDS` như bản web.
2. Trong cùng Google Cloud project, tạo OAuth **iOS client ID** với Bundle ID
   `dev.ailss.mobile` và OAuth **Android client** với package `dev.ailss.mobile`
   cùng SHA-1 của từng khóa ký debug/release.
   - Lấy mã SHA-1 của debug keystore trên máy phát triển:
     ```bash
     keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android | grep "SHA1:"
     ```
3. Riêng iOS, điền `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` vào `apps/mobile/.env.local`
   (xem `apps/mobile/.env.example`). Đây là Client ID công khai; không đưa Client Secret
   vào ứng dụng. Android không cần biến Client ID riêng trong mobile.
4. Với iOS, chạy `pnpm --filter @ailss/mobile exec expo prebuild --platform ios` sau khi
   đặt Client ID để cập nhật URL scheme trong dự án native đang có. Build và cài lại
   development client bằng lệnh `ios` hoặc `android` bên dưới. Chỉ tải lại Metro sẽ
   không thêm được thư viện native hay URL scheme.

**Thử nghiệm nhanh trên thiết bị khi chưa cấu hình Google Cloud:**
Màn hình đăng nhập di động tích hợp sẵn các nút **"Đăng nhập nhanh thử nghiệm trên thiết bị"**
(Học viên, Giảng viên, Admin). Khi bấm vào, ứng dụng tự động xác thực trực tiếp qua Gateway mà
không phụ thuộc vào Client ID iOS hay SHA-1 Android, cho phép kiểm thử toàn bộ chức năng ứng
dụng trên thiết bị thật ngay lập tức. Nếu nhấn nút Google khi chưa cấu hình, ứng dụng sẽ hiện
thông báo chẩn đoán và cho phép chọn tiếp tục bằng tài khoản thử nghiệm.

Chọn một trong hai cách sau.

### Cài và chạy native lần đầu

Từ thư mục gốc repo, chạy lệnh cho nền tảng tương ứng:

```bash
pnpm --filter @ailss/mobile ios
```

```bash
pnpm --filter @ailss/mobile android
```

Lệnh này build và mở development client trên simulator/emulator đang chọn. Trên Android, mở emulator trước khi chạy lệnh. Trên iOS, chọn simulator trong Xcode nếu máy có nhiều thiết bị.

### Khởi động Metro cho development client đã cài

```bash
pnpm --filter @ailss/mobile start
```

Mở ứng dụng AILSS development client trên thiết bị và kết nối tới Metro theo hướng dẫn hiển thị trong terminal. Điện thoại thật và máy tính cần truy cập được nhau để tải JavaScript bundle. Nếu vừa sửa cấu hình native, cài lại development client bằng lệnh `ios` hoặc `android` ở trên.

## 5. Kiểm tra kết nối

1. Mở Gateway readiness URL trên máy tính: `http://127.0.0.1:8080/health/ready`.
2. Mở app và thử tìm khóa học hoặc đăng nhập bằng tài khoản dev đã có.
3. Nếu app báo lỗi mạng, kiểm tra URL trong `.env.local`, backend đang chạy, rồi khởi động lại Metro để nạp cấu hình mới.

Nếu chưa có tài khoản, có thể thử luồng đăng ký Student trong app. Quyền và dữ liệu truy cập do server quyết định; không dùng tài khoản dịch vụ hay credential backend trong app.

## Khắc phục nhanh

- **Không kết nối được từ Android Emulator:** dùng `10.0.2.2`, không dùng `127.0.0.1`.
- **Không kết nối được từ điện thoại:** kiểm tra IP LAN, cùng Wi-Fi, firewall của máy tính và port mapping Gateway; `127.0.0.1` trên điện thoại là chính điện thoại.
- **Cấu hình URL vừa đổi nhưng app vẫn dùng URL cũ:** tải lại toàn bộ ứng dụng trong development client để nạp giá trị `EXPO_PUBLIC_` mới; nếu đổi native config, build lại development client.
- **Lỗi thiếu iOS/Android toolchain:** cài phiên bản yêu cầu ở mục 1, sau đó chạy lại lệnh `ios` hoặc `android`.

## Phạm vi mobile hiện tại

Bảng Feature Inventory mô tả phạm vi của toàn hệ thống. App mobile hiện có các luồng đăng ký/đăng nhập, tìm khóa học, xem khóa đã đăng ký, xem lớp/thông báo và quy trình media dành cho giảng viên; chưa có đầy đủ các tính năng Web. Chi tiết API, bảo mật session, giới hạn từng luồng và các tính năng chưa hỗ trợ nằm trong [apps/mobile/README.md](apps/mobile/README.md). Hướng dẫn phát triển Web nằm trong [WEB_DEVELOPMENT_GUIDE.md](WEB_DEVELOPMENT_GUIDE.md).

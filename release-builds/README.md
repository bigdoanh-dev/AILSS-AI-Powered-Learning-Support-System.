# Hướng dẫn Xuất Gói Cài Đặt Ứng Dụng Di Động AILSS (APK & IPA)

Thư mục này chứa cấu hình và các tập lệnh tự động để xuất file cài đặt ứng dụng độc lập cho Android (`.apk`) và iOS (`.ipa`), cũng như toàn bộ bundle tài nguyên production.

---

## 📁 Cấu Trúc Thư Mục

- `release-builds/android/`: Chứa file cài đặt Android (`.apk`).
- `release-builds/ios/`: Chứa file cài đặt iOS (`.ipa` / `.xcarchive`).
- `release-builds/dist/`: Chứa toàn bộ bytecode Hermes và tài nguyên tĩnh độc lập cho Android và iOS.
- `release-builds/build-apk.sh`: Script tự động biên dịch và sao chép APK vào `android/`.
- `release-builds/build-ipa.sh`: Script tự động đóng gói IPA vào `ios/`.
- `release-builds/export-bundle.sh`: Script xuất bundle production của Expo vào `dist/`.
- `release-builds/export-all.sh`: Script thực thi tất cả các bước xuất gói cài đặt trên.

---

## 🚀 Hướng Dẫn Sử Dụng

### 1. Xuất Bundle Tài Nguyên Độc Lập (Android & iOS)

Chạy lệnh từ thư mục gốc của dự án:

```bash
./release-builds/export-bundle.sh
```

Kết quả sẽ xuất ra thư mục `release-builds/dist/`:

- `_expo/static/js/android/...hbc` (Hermes bytecode cho Android)
- `_expo/static/js/ios/...hbc` (Hermes bytecode cho iOS)
- Tất cả tài nguyên ảnh, video, âm thanh và font chữ.

### 2. Xuất File APK Android

Chạy script:

```bash
./release-builds/build-apk.sh
```

Hoặc xuất trực tiếp thông qua Expo Application Services (EAS):

```bash
cd apps/mobile
npx eas-cli build -p android --profile preview --local --output=../../release-builds/android/AILSS.apk
```

_Ghi chú_: Cấu hình `preview` trong `apps/mobile/eas.json` đã được cài đặt sẵn `"buildType": "apk"` để tạo trực tiếp file `.apk` cài đặt độc lập thay vì `.aab`.

### 3. Xuất File IPA iOS

Chạy script:

```bash
./release-builds/build-ipa.sh
```

Hoặc mở Xcode Workspace trên macOS:

```bash
open apps/mobile/ios/AILSS.xcworkspace
```

Chọn **Product > Archive** rồi chọn **Distribute App** để xuất file `.ipa`.

Hoặc build qua EAS:

```bash
cd apps/mobile
npx eas-cli build -p ios --profile preview --local --output=../../release-builds/ios/AILSS.ipa
```

### 4. Xuất Tất Cả Cùng Lúc

```bash
./release-builds/export-all.sh
```

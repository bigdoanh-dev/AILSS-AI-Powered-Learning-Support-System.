#!/usr/bin/env bash
set -euo pipefail

# Script xuất file APK Android độc lập vào thư mục release-builds/android
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${ROOT_DIR}/release-builds/android"
mkdir -p "${OUTPUT_DIR}"

echo "=========================================================="
echo "🚀 ĐANG XUẤT FILE APK ANDROID CHO AILSS..."
echo "Thư mục đầu ra: ${OUTPUT_DIR}"
echo "=========================================================="

export EXPO_PUBLIC_AILSS_ENV="${EXPO_PUBLIC_AILSS_ENV:-production}"
export EXPO_PUBLIC_AILSS_API_BASE_URL="${EXPO_PUBLIC_AILSS_API_BASE_URL:-https://ailss.edu.vn}"

cd "${ROOT_DIR}/apps/mobile"

# 1. Kiểm tra build cục bộ bằng Gradle nếu Android SDK sẵn sàng
if [ -d "android" ] && command -v java >/dev/null 2>&1; then
  echo "📦 Đang biên dịch qua Android Gradle wrapper..."
  cd android
  if [ -f "./gradlew" ]; then
    chmod +x ./gradlew
    if ./gradlew assembleRelease --no-daemon 2>/dev/null; then
      APK_PATH=$(find app/build/outputs/apk/release -name "*.apk" 2>/dev/null | head -n 1)
      if [ -n "${APK_PATH}" ] && [ -f "${APK_PATH}" ]; then
        cp "${APK_PATH}" "${OUTPUT_DIR}/AILSS-release.apk"
        echo "✓ Xuất APK thành công: ${OUTPUT_DIR}/AILSS-release.apk"
        exit 0
      fi
    fi
    # Thử assembleDebug nếu chưa có release keystore ký số
    if ./gradlew assembleDebug --no-daemon 2>/dev/null; then
      APK_PATH=$(find app/build/outputs/apk/debug -name "*.apk" 2>/dev/null | head -n 1)
      if [ -n "${APK_PATH}" ] && [ -f "${APK_PATH}" ]; then
        cp "${APK_PATH}" "${OUTPUT_DIR}/AILSS-debug.apk"
        echo "✓ Xuất APK (Debug/Preview) thành công: ${OUTPUT_DIR}/AILSS-debug.apk"
        exit 0
      fi
    fi
  fi
  cd "${ROOT_DIR}/apps/mobile"
fi

# 2. Xuất qua EAS CLI nếu có
if command -v eas >/dev/null 2>&1; then
  echo "📦 Đang biên dịch APK qua EAS Build..."
  eas build --platform android --profile preview --local --output="${OUTPUT_DIR}/AILSS-preview.apk"
  echo "✓ Xuất APK qua EAS thành công: ${OUTPUT_DIR}/AILSS-preview.apk"
  exit 0
fi

# 3. Xuất qua Expo Export Bundle
echo "📦 Đang xuất bundle tài nguyên độc lập cho Android..."
pnpm exec expo export --platform android --output-dir "${ROOT_DIR}/release-builds/dist"
echo "✓ Đã xuất gói bundle Android tại: ${ROOT_DIR}/release-builds/dist"
echo "💡 Để tạo file .apk đầy đủ máy khách, chạy: 'npx eas-cli build -p android --profile preview --local' hoặc cài đặt Android SDK."

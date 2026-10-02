#!/usr/bin/env bash
set -euo pipefail

# Script xuất file IPA iOS độc lập vào thư mục release-builds/ios
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${ROOT_DIR}/release-builds/ios"
mkdir -p "${OUTPUT_DIR}"

echo "=========================================================="
echo "🚀 ĐANG XUẤT FILE IPA IOS CHO AILSS..."
echo "Thư mục đầu ra: ${OUTPUT_DIR}"
echo "=========================================================="

export EXPO_PUBLIC_AILSS_ENV="${EXPO_PUBLIC_AILSS_ENV:-production}"
export EXPO_PUBLIC_AILSS_API_BASE_URL="${EXPO_PUBLIC_AILSS_API_BASE_URL:-https://ailss.edu.vn}"

cd "${ROOT_DIR}/apps/mobile"

# 1. Kiểm tra build cục bộ bằng Xcode nếu trên macOS
if command -v xcodebuild >/dev/null 2>&1 && [ -d "ios" ]; then
  echo "📦 Đang kiểm tra workspace iOS..."
  if [ -d "ios/AILSS.xcworkspace" ]; then
    ARCHIVE_PATH="${OUTPUT_DIR}/AILSS.xcarchive"
    echo "📦 Đang đóng gói xcarchive (Generic iOS Device)..."
    if xcodebuild -workspace ios/AILSS.xcworkspace \
      -scheme AILSS \
      -configuration Release \
      -destination 'generic/platform=iOS' \
      -archivePath "${ARCHIVE_PATH}" \
      clean archive \
      CODE_SIGNING_ALLOWED=NO \
      CODE_SIGNING_REQUIRED=NO 2>/dev/null; then
      
      echo "✓ Đã tạo Archive: ${ARCHIVE_PATH}"
      
      # Tạo payload IPA thủ công nếu chưa ký số doanh nghiệp
      PAYLOAD_DIR="${OUTPUT_DIR}/Payload"
      rm -rf "${PAYLOAD_DIR}"
      mkdir -p "${PAYLOAD_DIR}"
      APP_BUNDLE=$(find "${ARCHIVE_PATH}/Products/Applications" -name "*.app" | head -n 1)
      if [ -n "${APP_BUNDLE}" ]; then
        cp -R "${APP_BUNDLE}" "${PAYLOAD_DIR}/"
        cd "${OUTPUT_DIR}"
        zip -qr "AILSS-unsigned.ipa" Payload
        rm -rf Payload
        echo "✓ Xuất IPA thành công: ${OUTPUT_DIR}/AILSS-unsigned.ipa"
        exit 0
      fi
    fi
  fi
  cd "${ROOT_DIR}/apps/mobile"
fi

# 2. Xuất qua EAS CLI nếu có
if command -v eas >/dev/null 2>&1; then
  echo "📦 Đang biên dịch IPA qua EAS Build..."
  eas build --platform ios --profile preview --local --output="${OUTPUT_DIR}/AILSS-preview.ipa"
  echo "✓ Xuất IPA qua EAS thành công: ${OUTPUT_DIR}/AILSS-preview.ipa"
  exit 0
fi

# 3. Xuất qua Expo Export Bundle
echo "📦 Đang xuất bundle tài nguyên độc lập cho iOS..."
pnpm exec expo export --platform ios --output-dir "${ROOT_DIR}/release-builds/dist"
echo "✓ Đã xuất gói bundle iOS tại: ${ROOT_DIR}/release-builds/dist"
echo "💡 Để tạo file .ipa có chữ ký, chạy: 'npx eas-cli build -p ios --profile preview' hoặc mở ios/AILSS.xcworkspace trong Xcode."

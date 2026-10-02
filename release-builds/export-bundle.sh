#!/usr/bin/env bash
set -euo pipefail

# Script xuất toàn bộ bundle sản phẩm độc lập (Android + iOS) vào release-builds/dist
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${ROOT_DIR}/release-builds/dist"
mkdir -p "${OUTPUT_DIR}"

echo "=========================================================="
echo "🚀 ĐANG XUẤT PRODUCTION BUNDLE (ANDROID & IOS)..."
echo "Thư mục đầu ra: ${OUTPUT_DIR}"
echo "=========================================================="

cd "${ROOT_DIR}/apps/mobile"
node node_modules/expo/bin/cli export --platform android --platform ios --output-dir "${OUTPUT_DIR}"

echo ""
echo "✓ Đã xuất thành công gói ứng dụng di động vào: ${OUTPUT_DIR}"
ls -lh "${OUTPUT_DIR}"

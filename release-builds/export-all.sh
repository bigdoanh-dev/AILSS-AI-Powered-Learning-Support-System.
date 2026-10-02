#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================================="
echo "🚀 TIẾN HÀNH XUẤT TẤT CẢ GÓI CÀI ĐẶT VÀ BUNDLE CHO AILSS MOBILE"
echo "=========================================================="

"${DIR}/export-bundle.sh"
"${DIR}/build-apk.sh" || true
"${DIR}/build-ipa.sh" || true

echo ""
echo "=========================================================="
echo "✓ HOÀN TẤT! CÁC TẬP TIN ĐÃ ĐƯỢC LƯU TRONG THƯ MỤC release-builds:"
ls -la "${DIR}"
echo "=========================================================="

#!/usr/bin/env bash
# 將 src/ 的分割檔合併成單一可執行檔 index.html
# 用法：./build.sh
set -euo pipefail
cd "$(dirname "$0")"

OUT=index.html
cat src/part-head.html \
    src/part-screens.html \
    src/part-js-a.js \
    src/part-js-b.js \
    src/part-js-c.js > "$OUT"

echo "built $OUT ($(wc -l < "$OUT") lines, $(wc -c < "$OUT") bytes)"

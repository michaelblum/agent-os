#!/bin/bash
# run_all.sh — Run all dogfood tests
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Base64 Pipeline ==="
bash "$DIR/test_base64_pipeline.sh"

echo ""
echo "=== Chat Rendering ==="
python3 "$DIR/test_chat_rendering.py"

echo ""
echo "=== Ask Timeout ==="
bash "$DIR/test_ask_timeout.sh"

echo ""
echo "All test suites complete."

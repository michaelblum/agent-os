#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Compiling aos..."
# Collect all Swift source files from src/ tree
SOURCES=$(find src -name '*.swift' -type f)

swiftc -parse-as-library -O -o aos $SOURCES

echo "Done: ./aos ($(du -h aos | cut -f1 | xargs))"

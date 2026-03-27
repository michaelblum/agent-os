#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Compiling heads-up..."
swiftc -parse-as-library -O -o heads-up main.swift

echo "Done: ./heads-up ($(du -h heads-up | cut -f1 | xargs))"

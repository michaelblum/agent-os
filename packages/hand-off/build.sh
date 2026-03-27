#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Compiling hand-off..."
swiftc -parse-as-library -O -o hand-off main.swift

echo "Done: ./hand-off ($(du -h hand-off | cut -f1 | xargs))"

#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Compiling aos..."
# Collect all Swift source files from src/ tree and shared IPC library
SOURCES=$(find src -name '*.swift' -type f)
SHARED_IPC=$(find shared/swift/ipc -name '*.swift' -type f 2>/dev/null)

swiftc -parse-as-library -O -o aos $SOURCES $SHARED_IPC

echo "Done: ./aos ($(du -h aos | cut -f1 | xargs))"

# Restart daemon if it's running as a service
if ./aos service status --json 2>/dev/null | grep -q '"running"' ; then
    ./aos service restart 2>/dev/null && echo "Daemon restarted" || true
fi

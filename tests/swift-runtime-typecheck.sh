#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SOURCES=()
while IFS= read -r source; do
    SOURCES+=("$source")
done < <(/usr/bin/find src -type f -name '*.swift' | /usr/bin/sort)

if [[ -d shared/swift/ipc ]]; then
    while IFS= read -r source; do
        SOURCES+=("$source")
    done < <(/usr/bin/find shared/swift/ipc -type f -name '*.swift' | /usr/bin/sort)
fi

if [[ ${#SOURCES[@]} -eq 0 ]]; then
    printf 'No Swift runtime sources found.\n' >&2
    exit 1
fi

CACHE_ROOT="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/aos-swift-typecheck.XXXXXX")"
/bin/chmod 700 "$CACHE_ROOT"
cleanup() {
    /bin/rm -rf "$CACHE_ROOT"
}
trap cleanup EXIT INT TERM

CLANG_MODULE_CACHE_PATH="$CACHE_ROOT/clang" \
SWIFT_MODULECACHE_PATH="$CACHE_ROOT/swift" \
/usr/bin/xcrun swiftc \
    -parse-as-library \
    -typecheck \
    -lsqlite3 \
    "${SOURCES[@]}"

printf 'Swift runtime typecheck passed without creating or executing ./aos.\n'

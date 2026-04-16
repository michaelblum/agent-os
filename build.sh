#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

REPO_ROOT="$PWD"
OUTPUT_PATH="$REPO_ROOT/aos"
BUILD_DIR="$REPO_ROOT/.build"
MODULE_CACHE_DIR="$BUILD_DIR/clang-module-cache"
MODE_FILE="$BUILD_DIR/aos-build-mode"

BUILD_MODE="dev"
FORCE_BUILD=0
RESTART_DAEMON=1

usage() {
    cat <<'EOF'
Usage: bash build.sh [--release] [--force] [--no-restart]

Default mode is a faster development build (`-Onone`).
Use `--release` for optimized artifacts such as packaged app builds.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --release)
            BUILD_MODE="release"
            ;;
        --force)
            FORCE_BUILD=1
            ;;
        --no-restart)
            RESTART_DAEMON=0
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
    shift
done

SOURCES=()
while IFS= read -r file; do
    SOURCES+=("$file")
done < <(find src -type f -name '*.swift' | sort)

SHARED_IPC=()
if [[ -d shared/swift/ipc ]]; then
    while IFS= read -r file; do
        SHARED_IPC+=("$file")
    done < <(find shared/swift/ipc -type f -name '*.swift' | sort)
fi

if [[ ${#SOURCES[@]} -eq 0 ]]; then
    echo "No Swift sources found under src/" >&2
    exit 1
fi

mkdir -p "$BUILD_DIR" "$MODULE_CACHE_DIR"
export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-$MODULE_CACHE_DIR}"
export SWIFT_MODULECACHE_PATH="${SWIFT_MODULECACHE_PATH:-$MODULE_CACHE_DIR}"

SWIFTC_FLAGS=(-parse-as-library -o "$OUTPUT_PATH" -lsqlite3)
if [[ "$BUILD_MODE" == "release" ]]; then
    SWIFTC_FLAGS=(-parse-as-library -O -o "$OUTPUT_PATH" -lsqlite3)
else
    SWIFTC_FLAGS=(-parse-as-library -Onone -o "$OUTPUT_PATH" -lsqlite3)
fi

INPUTS=("$REPO_ROOT/build.sh" "${SOURCES[@]}" "${SHARED_IPC[@]}")
NEEDS_BUILD=1

if [[ $FORCE_BUILD -eq 0 && -f "$OUTPUT_PATH" && -f "$MODE_FILE" ]]; then
    LAST_MODE="$(cat "$MODE_FILE")"
    if [[ "$LAST_MODE" == "$BUILD_MODE" ]]; then
        NEEDS_BUILD=0
        for input in "${INPUTS[@]}"; do
            if [[ "$input" -nt "$OUTPUT_PATH" ]]; then
                NEEDS_BUILD=1
                break
            fi
        done
    fi
fi

if [[ $NEEDS_BUILD -eq 0 ]]; then
    echo "Up to date: ./aos ($BUILD_MODE, $(du -h "$OUTPUT_PATH" | cut -f1 | xargs))"
    exit 0
fi

echo "Compiling aos ($BUILD_MODE)..."
swiftc "${SWIFTC_FLAGS[@]}" "${SOURCES[@]}" "${SHARED_IPC[@]}"
printf '%s\n' "$BUILD_MODE" > "$MODE_FILE"

echo "Done: ./aos ($(du -h "$OUTPUT_PATH" | cut -f1 | xargs))"

# Restart daemon if it's running as a service
if [[ $RESTART_DAEMON -eq 1 ]] && "$OUTPUT_PATH" service status --json 2>/dev/null | grep -q '"running"'; then
    "$OUTPUT_PATH" service restart 2>/dev/null && echo "Daemon restarted" || true
fi

#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

REPO_ROOT="$PWD"
OUTPUT_PATH="$REPO_ROOT/aos"
BUILD_DIR="$REPO_ROOT/.build"
MODULE_CACHE_DIR="$BUILD_DIR/clang-module-cache"
MODE_FILE="$BUILD_DIR/aos-build-mode"
FINGERPRINT_FILE="$BUILD_DIR/aos-build-fingerprint"
LOCK_PATH="${AOS_BUILD_LOCK_PATH:-$BUILD_DIR/aos-build.lock}"
REPO_RUNTIME_LINK_INFO="$REPO_ROOT/packaging/RepoRuntimeLinkInfo.plist"
# ADR 0023: keep the raw repo artifact as one direct swiftc link. Link-time
# privacy metadata is permitted; post-link mutation is not.

BUILD_MODE="dev"
FORCE_BUILD=0

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
            # Retained as the explicit safe workflow spelling. Repo builds no
            # longer execute the newly linked artifact automatically.
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
exec 9> "$LOCK_PATH"
python3 - <<'PY'
import fcntl
import sys

fd = 9
fcntl.flock(fd, fcntl.LOCK_EX)
PY

LINK_INFO_FLAGS=(-Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$REPO_RUNTIME_LINK_INFO")
SWIFTC_FLAGS=(-parse-as-library -o "$OUTPUT_PATH" -lsqlite3 "${LINK_INFO_FLAGS[@]}")
if [[ "$BUILD_MODE" == "release" ]]; then
    SWIFTC_FLAGS=(-parse-as-library -O -o "$OUTPUT_PATH" -lsqlite3 "${LINK_INFO_FLAGS[@]}")
else
    SWIFTC_FLAGS=(-parse-as-library -Onone -o "$OUTPUT_PATH" -lsqlite3 "${LINK_INFO_FLAGS[@]}")
fi

play_rebuild_alert() {
    if [[ "${AOS_BUILD_REBUILD_ALERT:-1}" == "0" ]]; then
        return 0
    fi

    echo "Alert: repo-mode ./aos binary rebuilt; the first post-build command must be ./aos help --json. Do not inspect or transform ./aos before that launch."
    echo "If help succeeds, stop immediately for the human TCC checkpoint. Do not inspect ./aos or run readiness until the user replies finished."

    if [[ -n "${AOS_BUILD_REBUILD_ALERT_COMMAND:-}" ]]; then
        "$AOS_BUILD_REBUILD_ALERT_COMMAND" >/dev/null 2>&1 || true
        return 0
    fi

    local sound="${AOS_BUILD_REBUILD_ALERT_SOUND:-/System/Library/Sounds/Sosumi.aiff}"
    local repeat="${AOS_BUILD_REBUILD_ALERT_REPEAT:-3}"
    local volume="${AOS_BUILD_REBUILD_ALERT_VOLUME:-2}"
    case "$repeat" in
        ''|*[!0-9]*) repeat=3 ;;
    esac

    if [[ -x /usr/bin/afplay && -f "$sound" ]]; then
        local i=0
        while [[ $i -lt $repeat ]]; do
            /usr/bin/afplay -v "$volume" "$sound" >/dev/null 2>&1 || break
            i=$((i + 1))
        done
        return 0
    fi

    if command -v osascript >/dev/null 2>&1; then
        osascript -e "beep $repeat" >/dev/null 2>&1 || true
    fi
}

runtime_inputs_newer_than_output() {
    for input in "${INPUTS[@]}"; do
        if [[ "$input" -nt "$OUTPUT_PATH" ]]; then
            return 0
        fi
    done
    return 1
}

INPUTS=("${SOURCES[@]}")
SWIFT_INPUTS=("${SOURCES[@]}")
INPUTS+=("$REPO_RUNTIME_LINK_INFO")
if [[ ${#SHARED_IPC[@]} -gt 0 ]]; then
    INPUTS+=("${SHARED_IPC[@]}")
    SWIFT_INPUTS+=("${SHARED_IPC[@]}")
fi
CURRENT_FINGERPRINT="$(/usr/bin/env node scripts/aos-build-fingerprint.mjs --mode "$BUILD_MODE")"
NEEDS_BUILD=1
BINARY_REBUILT=0

if [[ $FORCE_BUILD -eq 0 && -f "$OUTPUT_PATH" && -f "$MODE_FILE" ]]; then
    LAST_MODE="$(cat "$MODE_FILE")"
    if [[ "$LAST_MODE" == "$BUILD_MODE" ]]; then
        if [[ -f "$FINGERPRINT_FILE" && "$(cat "$FINGERPRINT_FILE")" == "$CURRENT_FINGERPRINT" ]]; then
            NEEDS_BUILD=0
        elif [[ ! -f "$FINGERPRINT_FILE" ]] && ! runtime_inputs_newer_than_output; then
            # Migration path for existing binaries: do not rebuild only to create
            # the content fingerprint stamp.
            NEEDS_BUILD=0
        fi
    fi
fi

if [[ $NEEDS_BUILD -eq 0 ]]; then
    printf '%s\n' "$CURRENT_FINGERPRINT" > "$FINGERPRINT_FILE"
    echo "Up to date: ./aos ($BUILD_MODE)"
    exit 0
fi

if [[ $NEEDS_BUILD -eq 1 ]]; then
    echo "Compiling aos ($BUILD_MODE)..."
    # Repo-mode builds intentionally do not run codesign after swiftc.
    # The local managed-machine development path depends on preserving this
    # compile-only shape; packaged app signing belongs in scripts/sign-aos-runtime.
    swiftc "${SWIFTC_FLAGS[@]}" "${SWIFT_INPUTS[@]}"
    BINARY_REBUILT=1
    echo "Rebuilt: ./aos"
fi
printf '%s\n' "$BUILD_MODE" > "$MODE_FILE"
printf '%s\n' "$CURRENT_FINGERPRINT" > "$FINGERPRINT_FILE"

echo "Done: ./aos"
if [[ $BINARY_REBUILT -eq 1 ]]; then
    play_rebuild_alert
fi

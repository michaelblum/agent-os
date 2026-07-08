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
exec 9> "$LOCK_PATH"
python3 - <<'PY'
import fcntl
import sys

fd = 9
fcntl.flock(fd, fcntl.LOCK_EX)
PY

SWIFTC_FLAGS=(-parse-as-library -o "$OUTPUT_PATH" -lsqlite3)
if [[ "$BUILD_MODE" == "release" ]]; then
    SWIFTC_FLAGS=(-parse-as-library -O -o "$OUTPUT_PATH" -lsqlite3)
else
    SWIFTC_FLAGS=(-parse-as-library -Onone -o "$OUTPUT_PATH" -lsqlite3)
fi

codesign_available() {
    command -v codesign >/dev/null 2>&1
}

signature_valid() {
    if ! codesign_available; then
        return 0
    fi
    codesign --verify "$OUTPUT_PATH" >/dev/null 2>&1
}

sign_output() {
    if codesign_available; then
        if ! CODESIGN_OUTPUT="$(codesign --force --sign - --identifier com.agentos.repo-aos "$1" 2>&1)"; then
            printf '%s\n' "$CODESIGN_OUTPUT" >&2
            exit 1
        fi
    fi
}

play_rebuild_alert() {
    if [[ "${AOS_BUILD_REBUILD_ALERT:-1}" == "0" ]]; then
        return 0
    fi

    echo "Alert: repo-mode ./aos binary rebuilt; user must manually reset/regrant needed macOS TCC permissions before TCC-backed proof."

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

build_fingerprint() {
    {
        printf 'mode %s\n' "$BUILD_MODE"
        for input in "${INPUTS[@]}"; do
            printf 'file %s\n' "$input"
            shasum -a 256 "$input"
        done
    } | shasum -a 256 | awk '{print $1}'
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
if [[ ${#SHARED_IPC[@]} -gt 0 ]]; then
    INPUTS+=("${SHARED_IPC[@]}")
    SWIFT_INPUTS+=("${SHARED_IPC[@]}")
fi
CURRENT_FINGERPRINT="$(build_fingerprint)"
NEEDS_BUILD=1
NEEDS_SIGN=0
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
        if [[ $NEEDS_BUILD -eq 0 ]] && ! signature_valid; then
            NEEDS_SIGN=1
        fi
    fi
fi

if [[ $NEEDS_BUILD -eq 0 && $NEEDS_SIGN -eq 0 ]]; then
    printf '%s\n' "$CURRENT_FINGERPRINT" > "$FINGERPRINT_FILE"
    echo "Up to date: ./aos ($BUILD_MODE, $(du -h "$OUTPUT_PATH" | cut -f1 | xargs))"
    exit 0
fi

if [[ $NEEDS_BUILD -eq 1 ]]; then
    echo "Compiling aos ($BUILD_MODE)..."
    TMP_OUTPUT="$(mktemp "$BUILD_DIR/aos.tmp.XXXXXX")"
    cleanup_tmp_output() {
        rm -f "$TMP_OUTPUT"
    }
    trap cleanup_tmp_output EXIT
    TMP_SWIFTC_FLAGS=("${SWIFTC_FLAGS[@]}")
    for i in "${!TMP_SWIFTC_FLAGS[@]}"; do
        if [[ "${TMP_SWIFTC_FLAGS[$i]}" == "$OUTPUT_PATH" ]]; then
            TMP_SWIFTC_FLAGS[$i]="$TMP_OUTPUT"
        fi
    done
    swiftc "${TMP_SWIFTC_FLAGS[@]}" "${SWIFT_INPUTS[@]}"
    sign_output "$TMP_OUTPUT"
    "$TMP_OUTPUT" help --json >/dev/null
    cp "$TMP_OUTPUT" "$OUTPUT_PATH"
    sign_output "$OUTPUT_PATH"
    rm -f "$TMP_OUTPUT"
    trap - EXIT
    BINARY_REBUILT=1
    echo "Rebuilt: ./aos"
else
    echo "Signing aos ($BUILD_MODE)..."
    sign_output "$OUTPUT_PATH"
    "$OUTPUT_PATH" help --json >/dev/null
fi
printf '%s\n' "$BUILD_MODE" > "$MODE_FILE"
printf '%s\n' "$CURRENT_FINGERPRINT" > "$FINGERPRINT_FILE"

echo "Done: ./aos ($(du -h "$OUTPUT_PATH" | cut -f1 | xargs))"
if [[ $BINARY_REBUILT -eq 1 ]]; then
    play_rebuild_alert
fi

# Restart daemon if it's running as a service
if [[ $RESTART_DAEMON -eq 1 ]] && "$OUTPUT_PATH" service status --json 2>/dev/null | python3 -c 'import json,sys; raise SystemExit(0 if json.load(sys.stdin).get("running") is True else 1)'; then
    if "$OUTPUT_PATH" service restart >/dev/null 2>&1; then
        echo "Daemon restarted"
    else
        echo "Build succeeded, but daemon readiness is degraded:" >&2
        "$OUTPUT_PATH" status || true
        echo "Next: ./aos ready --repair" >&2
    fi
fi

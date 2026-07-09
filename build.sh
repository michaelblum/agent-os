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
PACKAGE_RUNTIME=0
CODE_SIGN_IDENTIFIER="com.agentos.repo-aos"
CODE_SIGN_IDENTITY="${AOS_CODESIGN_IDENTITY:--}"
PACKAGING_DIR="$REPO_ROOT/packaging"
PACKAGED_INFO_PLIST="$PACKAGING_DIR/Info.plist"
PACKAGED_ENTITLEMENTS="$PACKAGING_DIR/aos.entitlements"

usage() {
    cat <<'EOF'
Usage: bash build.sh [--release] [--package] [--force] [--no-restart]

Default mode is a faster development build (`-Onone`).
Use `--release` for optimized artifacts such as packaged app builds.
Use `--package` to embed packaging/Info.plist and sign with packaging/aos.entitlements.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --release)
            BUILD_MODE="release"
            ;;
        --package)
            PACKAGE_RUNTIME=1
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

BUILD_VARIANT="$BUILD_MODE"
if [[ $PACKAGE_RUNTIME -eq 1 ]]; then
    BUILD_VARIANT="$BUILD_MODE+package"
    if [[ ! -f "$PACKAGED_INFO_PLIST" ]]; then
        echo "Missing packaged runtime Info.plist: $PACKAGED_INFO_PLIST" >&2
        exit 1
    fi
    if [[ ! -f "$PACKAGED_ENTITLEMENTS" ]]; then
        echo "Missing packaged runtime entitlements: $PACKAGED_ENTITLEMENTS" >&2
        exit 1
    fi
fi

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
if [[ $PACKAGE_RUNTIME -eq 1 ]]; then
    SWIFTC_FLAGS=(
        "${SWIFTC_FLAGS[@]}"
        -Xlinker -sectcreate
        -Xlinker __TEXT
        -Xlinker __info_plist
        -Xlinker "$PACKAGED_INFO_PLIST"
    )
fi

codesign_available() {
    command -v codesign >/dev/null 2>&1
}

signature_valid() {
    if ! codesign_available; then
        return 0
    fi
    if [[ $PACKAGE_RUNTIME -eq 1 ]]; then
        codesign --verify --strict "$OUTPUT_PATH" >/dev/null 2>&1
    else
        codesign --verify "$OUTPUT_PATH" >/dev/null 2>&1
    fi
}

sign_output() {
    if codesign_available; then
        CODESIGN_ARGS=(--force --sign "$CODE_SIGN_IDENTITY" --identifier "$CODE_SIGN_IDENTIFIER")
        if [[ $PACKAGE_RUNTIME -eq 1 ]]; then
            CODESIGN_ARGS=("${CODESIGN_ARGS[@]}" --entitlements "$PACKAGED_ENTITLEMENTS")
        fi
        if ! CODESIGN_OUTPUT="$(codesign "${CODESIGN_ARGS[@]}" "$1" 2>&1)"; then
            printf '%s\n' "$CODESIGN_OUTPUT" >&2
            exit 1
        fi
    fi
}

build_fingerprint() {
    {
        printf 'mode %s\n' "$BUILD_VARIANT"
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
if [[ $PACKAGE_RUNTIME -eq 1 ]]; then
    INPUTS+=("$PACKAGED_INFO_PLIST" "$PACKAGED_ENTITLEMENTS")
fi
CURRENT_FINGERPRINT="$(build_fingerprint)"
NEEDS_BUILD=1
NEEDS_SIGN=0
BINARY_REBUILT=0

if [[ $FORCE_BUILD -eq 0 && -f "$OUTPUT_PATH" && -f "$MODE_FILE" ]]; then
    LAST_MODE="$(cat "$MODE_FILE")"
    if [[ "$LAST_MODE" == "$BUILD_VARIANT" ]]; then
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
    echo "Up to date: ./aos ($BUILD_VARIANT, $(du -h "$OUTPUT_PATH" | cut -f1 | xargs))"
    exit 0
fi

if [[ $NEEDS_BUILD -eq 1 ]]; then
    echo "Compiling aos ($BUILD_VARIANT)..."
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
    echo "Signing aos ($BUILD_VARIANT)..."
    sign_output "$OUTPUT_PATH"
    "$OUTPUT_PATH" help --json >/dev/null
fi
printf '%s\n' "$BUILD_VARIANT" > "$MODE_FILE"
printf '%s\n' "$CURRENT_FINGERPRINT" > "$FINGERPRINT_FILE"

echo "Done: ./aos ($(du -h "$OUTPUT_PATH" | cut -f1 | xargs))"
if [[ $BINARY_REBUILT -eq 1 ]]; then
    echo "Note: TCC handoff alert is deferred until a live readiness check reports post-rebuild stale TCC."
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

#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

REPO_ROOT="$PWD"
OUTPUT_PATH="$REPO_ROOT/aos"
BUILD_DIR="$REPO_ROOT/.build"
MODULE_CACHE_DIR="$BUILD_DIR/clang-module-cache"
MODE_FILE="$BUILD_DIR/aos-build-mode"
LOCK_PATH="${AOS_BUILD_LOCK_PATH:-$BUILD_DIR/aos-build.lock}"

BUILD_MODE="dev"
FORCE_BUILD=0
RESTART_DAEMON=1
BUILD_SIGN="${AOS_BUILD_SIGN:-auto}"
BUILD_SIGN_IDENTITY="${AOS_BUILD_SIGN_IDENTITY:-auto}"
BUILD_SIGN_STRICT="${AOS_BUILD_SIGN_STRICT:-false}"

usage() {
    cat <<'EOF'
Usage: bash build.sh [--release] [--force] [--no-restart] [--no-sign]

Default mode is a faster development build (`-Onone`).
Use `--release` for optimized artifacts such as packaged app builds.
By default, local builds codesign ./aos with an available stable identity when
one exists. Use --no-sign or AOS_BUILD_SIGN=false to skip that step.
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
        --no-sign)
            BUILD_SIGN="false"
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

find_signing_identity() {
    local requested="${1:-auto}"
    local identities

    if [[ "$requested" != "auto" ]]; then
        printf '%s|%s\n' "$requested" "$requested"
        return 0
    fi

    identities="$(security find-identity -v -p codesigning 2>/dev/null || true)"
    python3 - <<'PY' "$identities"
import re
import sys

lines = sys.argv[1].splitlines()
matches = []
for line in lines:
    m = re.search(r'\)\s*([0-9A-F]{40})\s+"([^"]+)"', line)
    if m:
        matches.append((m.group(1), m.group(2)))

preferred = None
for needle in ("Apple Development", "Developer ID Application"):
    for digest, name in matches:
        if name.startswith(needle):
            preferred = (digest, name)
            break
    if preferred:
        break

if preferred is None and matches:
    preferred = matches[0]

if preferred is None:
    print("|")
else:
    print(f"{preferred[0]}|{preferred[1]}")
PY
}

sign_aos_binary() {
    if [[ "$BUILD_SIGN" == "false" || "$BUILD_SIGN" == "0" || "$BUILD_SIGN" == "no" ]]; then
        echo "Signing skipped: ./aos"
        return 0
    fi

    local identity_record identity identity_label
    identity_record="$(find_signing_identity "$BUILD_SIGN_IDENTITY")"
    identity="${identity_record%%|*}"
    identity_label="${identity_record#*|}"

    if [[ -z "$identity" ]]; then
        if [[ "$BUILD_SIGN_STRICT" == "true" ]]; then
            echo "No codesigning identity found for ./aos" >&2
            exit 1
        fi
        echo "Signing skipped: no codesigning identity found for ./aos" >&2
        return 0
    fi

    if codesign --force --sign "$identity" --timestamp=none "$OUTPUT_PATH" >/dev/null 2>&1; then
        echo "Signed: ./aos ($identity_label)"
        return 0
    fi

    if [[ "$BUILD_SIGN_STRICT" == "true" ]]; then
        echo "Signing failed for ./aos with identity: $identity_label" >&2
        exit 1
    fi
    echo "Warning: signing failed for ./aos with identity '$identity_label'; leaving build unsigned." >&2
}

sign_aos_binary
printf '%s\n' "$BUILD_MODE" > "$MODE_FILE"

echo "Done: ./aos ($(du -h "$OUTPUT_PATH" | cut -f1 | xargs))"

# Restart daemon if it's running as a service
if [[ $RESTART_DAEMON -eq 1 ]] && "$OUTPUT_PATH" service status --json 2>/dev/null | grep -q '"running"'; then
    if "$OUTPUT_PATH" service restart >/dev/null 2>&1; then
        echo "Daemon restarted"
    else
        echo "Build succeeded, but daemon readiness is degraded:" >&2
        "$OUTPUT_PATH" status || true
        echo "Next: ./aos ready --repair" >&2
    fi
fi

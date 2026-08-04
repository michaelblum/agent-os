#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TMP_ROOT="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/aos-see-image-compare.XXXXXX")"
/bin/chmod 700 "$TMP_ROOT"
cleanup() {
  /bin/rm -rf "$TMP_ROOT"
}
trap cleanup EXIT INT TERM

FAILURES=0
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; FAILURES=$((FAILURES + 1)); }

FIXTURES="$TMP_ROOT/fixtures"
/bin/mkdir -p "$FIXTURES"

python3 - "$FIXTURES" <<'PY'
import binascii
import os
import struct
import sys
import zlib

root = sys.argv[1]
signature = b"\x89PNG\r\n\x1a\n"

def chunk(kind, payload):
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", binascii.crc32(kind + payload) & 0xffffffff)

def png(width, height, color_type, rows, *, compression=6, extras=(), tagged=True):
    channels = {0: 1, 2: 3, 6: 4}[color_type]
    assert len(rows) == height
    raw = b"".join(b"\x00" + bytes(row) for row in rows)
    assert all(len(row) == width * channels for row in rows)
    return (
        signature
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0))
        + (chunk(b"sRGB", b"\x00") if tagged else b"")
        + b"".join(chunk(kind, payload) for kind, payload in extras)
        + chunk(b"IDAT", zlib.compress(raw, compression))
        + chunk(b"IEND", b"")
    )

base_rows = [
    [10, 20, 30, 255, 40, 50, 60, 255],
    [70, 80, 90, 255, 100, 110, 120, 255],
]
changed_rows = [
    [10, 20, 30, 255, 45, 50, 60, 255],
    [70, 80, 90, 255, 100, 110, 120, 255],
]

files = {
    "base.png": png(2, 2, 6, base_rows, compression=1),
    "base-metadata.png": png(2, 2, 6, base_rows, compression=9, extras=((b"tEXt", b"note\x00different encoding"),)),
    "changed.png": png(2, 2, 6, changed_rows),
    "alpha-before.png": png(1, 1, 6, [[0, 0, 0, 200]]),
    "alpha-after.png": png(1, 1, 6, [[0, 0, 0, 199]]),
    "transparent-rgb.png": png(1, 1, 6, [[123, 45, 67, 0]]),
    "transparent-zero.png": png(1, 1, 6, [[0, 0, 0, 0]]),
    "rgb.png": png(1, 1, 2, [[20, 40, 60]]),
    "rgba.png": png(1, 1, 6, [[20, 40, 60, 255]]),
    "untagged-rgb.png": png(1, 1, 2, [[20, 40, 60]], tagged=False),
    "gray.png": png(2, 1, 0, [[0, 255]]),
    "geometry.png": png(1, 1, 6, [[10, 20, 30, 255]]),
    "round-before.png": png(3, 1, 6, [[0, 0, 0, 255] * 3]),
    "round-after.png": png(3, 1, 6, [[1, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]]),
}

# TIFF IFD with orientation=3, stored in a PNG eXIf chunk.
exif = b"II\x2a\x00\x08\x00\x00\x00\x01\x00\x12\x01\x03\x00\x01\x00\x00\x00\x03\x00\x00\x00\x00\x00\x00\x00"
files["oriented.png"] = png(1, 1, 6, [[10, 20, 30, 255]], extras=((b"eXIf", exif),))

first = zlib.compress(b"\x00\x01\x02\x03\xff")
second = zlib.compress(b"\x00\x04\x05\x06\xff")
files["animated.png"] = (
    signature
    + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
    + chunk(b"acTL", struct.pack(">II", 2, 0))
    + chunk(b"fcTL", struct.pack(">IIIIIHHBB", 0, 1, 1, 0, 0, 1, 10, 0, 0))
    + chunk(b"IDAT", first)
    + chunk(b"fcTL", struct.pack(">IIIIIHHBB", 1, 1, 1, 0, 0, 1, 10, 0, 0))
    + chunk(b"fdAT", struct.pack(">I", 2) + second)
    + chunk(b"IEND", b"")
)

for name, data in files.items():
    with open(os.path.join(root, name), "wb") as handle:
        handle.write(data)

with open(os.path.join(root, "not-png.gif"), "wb") as handle:
    handle.write(b"GIF89a")
with open(os.path.join(root, "malformed.png"), "wb") as handle:
    handle.write(signature + b"broken")

# A valid, highly-compressible image whose decoded geometry is one pixel above the cap.
width, height = 8192, 4097
compressor = zlib.compressobj(9)
compressed = bytearray()
row = b"\x00" * (1 + width * 4)
for _ in range(height):
    compressed.extend(compressor.compress(row))
compressed.extend(compressor.flush())
oversize_decoded = (
    signature
    + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    + chunk(b"sRGB", b"\x00")
    + chunk(b"IDAT", bytes(compressed))
    + chunk(b"IEND", b"")
)
with open(os.path.join(root, "oversize-decoded.png"), "wb") as handle:
    handle.write(oversize_decoded)

with open(os.path.join(root, "oversize-encoded.png"), "wb") as handle:
    handle.seek(128 * 1024 * 1024)
    handle.write(b"\x00")
PY

/usr/bin/mkfifo "$FIXTURES/input.fifo"
/bin/ln -s input.fifo "$FIXTURES/input-fifo-link"
/bin/ln -s base.png "$FIXTURES/base-link.png"
/bin/mkdir "$FIXTURES/input-directory"

HARNESS_MAIN="$TMP_ROOT/main.swift"
cat >"$HARNESS_MAIN" <<'SWIFT'
imageFileCompareCommand(args: Array(CommandLine.arguments.dropFirst()))
SWIFT

COMPARE_HARNESS="$TMP_ROOT/aos-image-compare-harness"
/usr/bin/xcrun swiftc \
  src/perceive/image-file-compare.swift \
  "$HARNESS_MAIN" \
  -o "$COMPARE_HARNESS"

WATCHDOG="$TMP_ROOT/run-with-watchdog.py"
cat >"$WATCHDOG" <<'PY'
import os
import signal
import subprocess
import sys

timeout_seconds = float(sys.argv[1])
stdout_path, stderr_path = sys.argv[2:4]
command = sys.argv[4:]

with open(stdout_path, "wb") as stdout_handle, open(stderr_path, "wb") as stderr_handle:
    process = subprocess.Popen(
        command,
        stdout=stdout_handle,
        stderr=stderr_handle,
        start_new_session=True,
    )
    try:
        return_code = process.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
        sys.exit(124)

sys.exit(return_code if return_code >= 0 else 128 - return_code)
PY

run_success() {
  local label="$1"
  shift
  local stdout_file="$TMP_ROOT/${label}.out"
  local stderr_file="$TMP_ROOT/${label}.err"
  if "$COMPARE_HARNESS" "$@" >"$stdout_file" 2>"$stderr_file" \
      && [[ -s "$stdout_file" ]] \
      && [[ ! -s "$stderr_file" ]]; then
    pass "$label exits zero with JSON stdout only"
  else
    fail "$label output contract (stdout=$(cat "$stdout_file" 2>/dev/null), stderr=$(cat "$stderr_file" 2>/dev/null))"
  fi
}

run_failure() {
  local label="$1"
  local code="$2"
  shift 2
  local stdout_file="$TMP_ROOT/${label}.out"
  local stderr_file="$TMP_ROOT/${label}.err"
  if "$COMPARE_HARNESS" "$@" >"$stdout_file" 2>"$stderr_file"; then
    fail "$label unexpectedly exited zero"
    return
  fi
  if [[ -s "$stdout_file" ]]; then
    fail "$label wrote stdout: $(cat "$stdout_file")"
    return
  fi
  if python3 - "$stderr_file" "$code" <<'PY'
import json
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["code"] == sys.argv[2], payload
assert isinstance(payload["error"], str) and payload["error"], payload
assert list(payload) == sorted(payload), payload
PY
  then
    pass "$label returns $code on JSON stderr only"
  else
    fail "$label error payload drifted: $(cat "$stderr_file" 2>/dev/null)"
  fi
}

run_failure_bounded() {
  local label="$1"
  local code="$2"
  shift 2
  local stdout_file="$TMP_ROOT/${label}.out"
  local stderr_file="$TMP_ROOT/${label}.err"
  local status
  if python3 "$WATCHDOG" 3 "$stdout_file" "$stderr_file" "$COMPARE_HARNESS" "$@"; then
    status=0
  else
    status=$?
  fi
  if [[ "$status" -eq 124 ]]; then
    fail "$label exceeded the 3-second nonblocking input watchdog"
    return
  fi
  if [[ "$status" -eq 0 ]]; then
    fail "$label unexpectedly exited zero"
    return
  fi
  if [[ -s "$stdout_file" ]]; then
    fail "$label wrote stdout: $(cat "$stdout_file")"
    return
  fi
  if python3 - "$stderr_file" "$code" <<'PY'
import json
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["code"] == sys.argv[2], payload
assert isinstance(payload["error"], str) and payload["error"], payload
assert list(payload) == sorted(payload), payload
PY
  then
    pass "$label returns $code within the nonblocking input watchdog"
  else
    fail "$label error payload drifted: $(cat "$stderr_file" 2>/dev/null)"
  fi
}

run_success identical "$FIXTURES/base.png" "$FIXTURES/base-metadata.png"
python3 - "$TMP_ROOT/identical.out" "$FIXTURES/base.png" <<'PY'
import hashlib
import json
import os
import struct
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
pixels = bytes([
    10, 20, 30, 255, 40, 50, 60, 255,
    70, 80, 90, 255, 100, 110, 120, 255,
])
expected_hash = hashlib.sha256(b"AOS_RGBA8_V1\0" + struct.pack(">QQ", 2, 2) + pixels).hexdigest()
assert list(payload) == sorted(payload), payload
assert payload["status"] == "success", payload
assert payload["schema_version"] == "aos.image-compare.v1", payload
assert payload["expectation"] is None, payload
assert payload["before"]["path"] == os.path.normpath(os.path.abspath(sys.argv[2])), payload
assert payload["before"]["width"] == 2 and payload["before"]["height"] == 2, payload
assert payload["before"]["canonical_pixel_sha256"] == expected_hash, payload
assert payload["after"]["canonical_pixel_sha256"] == expected_hash, payload
comparison = payload["comparison"]
assert comparison == {
    "changed_bounds": None,
    "changed_pixels": 0,
    "changed_ratio": 0,
    "max_channel_delta": 0,
    "mean_channel_delta": 0,
    "pixel_tolerance": 0,
    "sum_channel_delta": 0,
    "total_pixels": 4,
}, comparison
PY
pass "different PNG encodings and metadata canonicalize to the authoritative pixel hash"

run_success one-pixel "$FIXTURES/base.png" "$FIXTURES/changed.png" --expect change
python3 - "$TMP_ROOT/one-pixel.out" <<'PY'
import hashlib
import json
import struct
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
comparison = payload["comparison"]
assert comparison["changed_pixels"] == 1, comparison
assert comparison["changed_ratio"] == 0.25, comparison
assert comparison["changed_bounds"] == {"x": 1, "y": 0, "width": 1, "height": 1}, comparison
assert comparison["sum_channel_delta"] == 5, comparison
assert comparison["mean_channel_delta"] == 0.3125, comparison
assert comparison["max_channel_delta"] == 5, comparison
changed_pixels = bytes([
    10, 20, 30, 255, 45, 50, 60, 255,
    70, 80, 90, 255, 100, 110, 120, 255,
])
expected_after_hash = hashlib.sha256(b"AOS_RGBA8_V1\0" + struct.pack(">QQ", 2, 2) + changed_pixels).hexdigest()
assert payload["after"]["canonical_pixel_sha256"] == expected_after_hash, payload
assert payload["before"]["canonical_pixel_sha256"] != payload["after"]["canonical_pixel_sha256"], payload
assert payload["expectation"] == {"requested": "change", "actual": "change", "met": True}, payload
PY
pass "one-pixel RGB change reports exact top-left bounds, counts, deltas, digest, and expectation"

run_success tolerance-boundary "$FIXTURES/base.png" "$FIXTURES/changed.png" --pixel-tolerance 5 --expect no-change
python3 - "$TMP_ROOT/tolerance-boundary.out" <<'PY'
import json
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
comparison = payload["comparison"]
assert comparison["changed_pixels"] == 0 and comparison["changed_bounds"] is None, comparison
assert comparison["sum_channel_delta"] == 5 and comparison["max_channel_delta"] == 5, comparison
assert payload["expectation"] == {"requested": "no-change", "actual": "no-change", "met": True}, payload
PY
pass "delta equal to tolerance is unchanged while raw delta metrics remain authoritative"

run_success tolerance-plus-one "$FIXTURES/base.png" "$FIXTURES/changed.png" --pixel-tolerance 4
python3 - "$TMP_ROOT/tolerance-plus-one.out" <<'PY'
import json
import sys
assert json.load(open(sys.argv[1], encoding="utf-8"))["comparison"]["changed_pixels"] == 1
PY
pass "delta above tolerance changes the pixel"

run_success rounded-floats "$FIXTURES/round-before.png" "$FIXTURES/round-after.png"
python3 - "$TMP_ROOT/rounded-floats.out" <<'PY'
import json
import sys
comparison = json.load(open(sys.argv[1], encoding="utf-8"))["comparison"]
assert comparison["changed_ratio"] == 0.333333333333, comparison
assert comparison["mean_channel_delta"] == 0.083333333333, comparison
PY
pass "convenience floating values round deterministically to 12 decimal places"

run_success alpha-only "$FIXTURES/alpha-before.png" "$FIXTURES/alpha-after.png"
python3 - "$TMP_ROOT/alpha-only.out" <<'PY'
import json
import sys
comparison = json.load(open(sys.argv[1], encoding="utf-8"))["comparison"]
assert comparison["changed_pixels"] == 1, comparison
assert comparison["sum_channel_delta"] == 1, comparison
assert comparison["max_channel_delta"] == 1, comparison
PY
pass "alpha participates in comparison and raw delta metrics"

run_success transparent-rgb "$FIXTURES/transparent-rgb.png" "$FIXTURES/transparent-zero.png" --expect no-change
python3 - "$TMP_ROOT/transparent-rgb.out" <<'PY'
import json
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["comparison"]["changed_pixels"] == 0, payload
assert payload["before"]["canonical_pixel_sha256"] == payload["after"]["canonical_pixel_sha256"], payload
PY
pass "premultiplication canonicalizes invisible transparent RGB"

run_success rgb-conversion "$FIXTURES/rgb.png" "$FIXTURES/rgba.png" --expect no-change
run_success untagged-srgb "$FIXTURES/untagged-rgb.png" "$FIXTURES/rgba.png" --expect no-change
run_success grayscale-conversion "$FIXTURES/gray.png" "$FIXTURES/gray.png" --expect no-change
run_success regular-file-symlink "$FIXTURES/base-link.png" "$FIXTURES/base.png" --expect no-change
pass "RGB, RGBA, untagged RGB, and grayscale PNG inputs decode through canonical sRGB RGBA"

if "$COMPARE_HARNESS" "$FIXTURES/base.png" "$FIXTURES/base-metadata.png" --expect change >"$TMP_ROOT/expect-fail.out" 2>"$TMP_ROOT/expect-fail.err"; then
  fail "expectation failure unexpectedly exited zero"
elif [[ -s "$TMP_ROOT/expect-fail.out" ]]; then
  fail "expectation failure wrote stdout"
elif python3 - "$TMP_ROOT/expect-fail.err" <<'PY'
import json
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["status"] == "expectation_failed", payload
assert payload["code"] == "IMAGE_COMPARISON_EXPECTATION_FAILED", payload
assert payload["expectation"] == {"requested": "change", "actual": "no-change", "met": False}, payload
assert payload["comparison"]["changed_pixels"] == 0, payload
assert payload["before"]["canonical_pixel_sha256"] == payload["after"]["canonical_pixel_sha256"], payload
assert list(payload) == sorted(payload), payload
PY
then
  pass "expectation failure returns the full result on stderr and leaves stdout empty"
else
  fail "expectation failure payload drifted: $(cat "$TMP_ROOT/expect-fail.err")"
fi

run_failure missing-before MISSING_ARG
run_failure missing-after MISSING_ARG "$FIXTURES/base.png"
run_failure unknown-option UNKNOWN_OPTION "$FIXTURES/base.png" "$FIXTURES/base.png" --json
run_failure tolerance-missing MISSING_ARG "$FIXTURES/base.png" "$FIXTURES/base.png" --pixel-tolerance
run_failure tolerance-negative INVALID_ARG "$FIXTURES/base.png" "$FIXTURES/base.png" --pixel-tolerance -1
run_failure tolerance-large INVALID_ARG "$FIXTURES/base.png" "$FIXTURES/base.png" --pixel-tolerance 256
run_failure tolerance-text INVALID_ARG "$FIXTURES/base.png" "$FIXTURES/base.png" --pixel-tolerance x
run_failure duplicate-tolerance INVALID_ARG "$FIXTURES/base.png" "$FIXTURES/base.png" --pixel-tolerance 1 --pixel-tolerance 1
run_failure expectation-missing MISSING_ARG "$FIXTURES/base.png" "$FIXTURES/base.png" --expect
run_failure expectation-invalid INVALID_ARG "$FIXTURES/base.png" "$FIXTURES/base.png" --expect changed
run_failure duplicate-expect INVALID_ARG "$FIXTURES/base.png" "$FIXTURES/base.png" --expect change --expect change
run_failure extra-path INVALID_ARG "$FIXTURES/base.png" "$FIXTURES/base.png" "$FIXTURES/base.png"
run_failure missing-file IMAGE_READ_FAILED "$FIXTURES/missing.png" "$FIXTURES/base.png"
run_failure non-png UNSUPPORTED_IMAGE_FORMAT "$FIXTURES/not-png.gif" "$FIXTURES/base.png"
run_failure malformed-png IMAGE_DECODE_FAILED "$FIXTURES/malformed.png" "$FIXTURES/base.png"
run_failure animated-png UNSUPPORTED_IMAGE_FORMAT "$FIXTURES/animated.png" "$FIXTURES/base.png"
run_failure orientation UNSUPPORTED_IMAGE_ORIENTATION "$FIXTURES/oriented.png" "$FIXTURES/geometry.png"
run_failure encoded-cap IMAGE_TOO_LARGE "$FIXTURES/oversize-encoded.png" "$FIXTURES/geometry.png"
run_failure decoded-cap IMAGE_TOO_LARGE "$FIXTURES/oversize-decoded.png" "$FIXTURES/geometry.png"
run_failure geometry IMAGE_GEOMETRY_MISMATCH "$FIXTURES/base.png" "$FIXTURES/geometry.png"
run_failure_bounded fifo-input IMAGE_READ_FAILED "$FIXTURES/input.fifo" "$FIXTURES/base.png"
run_failure_bounded fifo-symlink-input IMAGE_READ_FAILED "$FIXTURES/input-fifo-link" "$FIXTURES/base.png"
run_failure_bounded directory-input IMAGE_READ_FAILED "$FIXTURES/input-directory" "$FIXTURES/base.png"
run_failure_bounded device-input IMAGE_READ_FAILED /dev/null "$FIXTURES/base.png"

DISPATCH_STUBS="$TMP_ROOT/dispatch-stubs.swift"
cat >"$DISPATCH_STUBS" <<'SWIFT'
import Foundation

struct ProcessOutput {
    let exitCode: Int32
    let stdout: String
    let stderr: String
}

enum FakeRuntimeMode: String { case repo }

func aosCurrentRepoRoot(executablePath: String = "") -> String? {
    ProcessInfo.processInfo.environment["AOS_TEST_REPO_ROOT"]
}
func aosCurrentRuntimeMode() -> FakeRuntimeMode { .repo }
func aosStateRoot() -> String { "/tmp/aos-image-compare-state" }
func aosCurrentSessionKey() -> String { "image-compare-test" }
func aosCurrentSessionHarness() -> String { "test" }
func aosInvocationDisplayName() -> String { "aos" }
func exitError(_ message: String, code: String) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: ["code": code, "error": message], options: [.sortedKeys])
    FileHandle.standardError.write(data)
    FileHandle.standardError.write(Data("\n".utf8))
    exit(1)
}
SWIFT

cat >"$HARNESS_MAIN" <<'SWIFT'
import Foundation

let args = Array(CommandLine.arguments.dropFirst())
if args.starts(with: ["__see", "compare"]) {
    imageFileCompareCommand(args: Array(args.dropFirst(2)))
}
if runExternalCommandIfMatched(args: args) {
    exit(0)
}
exitError("No route", code: "NO_ROUTE")
SWIFT

DISPATCH_HARNESS="$TMP_ROOT/aos-fake-dispatch"
/usr/bin/xcrun swiftc \
  "$DISPATCH_STUBS" \
  src/shared/external-command-dispatch.swift \
  src/perceive/image-file-compare.swift \
  "$HARNESS_MAIN" \
  -o "$DISPATCH_HARNESS"

DISPATCH_ROOT="$TMP_ROOT/dispatch-work"
DISPATCH_BIN="$DISPATCH_ROOT/bin"
DISPATCH_CWD="$DISPATCH_ROOT/nested-caller"
/bin/mkdir -p "$DISPATCH_BIN" "$DISPATCH_CWD"
/bin/cp "$DISPATCH_HARNESS" "$DISPATCH_BIN/aos"
/bin/cp "$FIXTURES/base.png" "$DISPATCH_CWD/before.png"
/bin/cp "$FIXTURES/changed.png" "$DISPATCH_CWD/after.png"

run_dispatch_probe() {
  local label="$1"
  local invocation="$2"
  local stdout_file="$TMP_ROOT/${label}.out"
  local stderr_file="$TMP_ROOT/${label}.err"
  if (cd "$DISPATCH_CWD" && PATH="$DISPATCH_BIN:/usr/bin:/bin" AOS_TEST_REPO_ROOT="$ROOT" "$invocation" see compare before.png after.png --expect change) >"$stdout_file" 2>"$stderr_file" \
      && [[ ! -s "$stderr_file" ]] \
      && python3 - "$stdout_file" "$DISPATCH_CWD" <<'PY'
import json
import os
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
caller = os.path.normpath(os.path.abspath(sys.argv[2]))
assert payload["status"] == "success", payload
assert payload["before"]["path"] == os.path.join(caller, "before.png"), payload
assert payload["after"]["path"] == os.path.join(caller, "after.png"), payload
assert payload["comparison"]["changed_pixels"] == 1, payload
assert payload["expectation"] == {"requested": "change", "actual": "change", "met": True}, payload
PY
  then
    pass "$label preserves caller cwd and executes the real comparator with JSON stdout only"
  else
    fail "$label production dispatch drifted: $(cat "$stderr_file" "$stdout_file" 2>/dev/null)"
  fi
}

run_dispatch_probe dispatch-path aos
run_dispatch_probe dispatch-relative ../bin/aos

python3 - <<'PY'
import json
import re
from pathlib import Path

source = json.loads(Path("manifests/commands/source/aos/03-see-05-compare.json").read_text(encoding="utf-8"))
form = source["commands"][0]["forms"][0]
assert source["id"] == "see-05-compare", source
assert source["commands"][0]["path"] == ["see", "compare"], source
assert form["id"] == "see-compare", form
assert form["output"] == {"default_mode": "json", "error_mode": "json_stderr", "streaming": False, "supports_json_flag": False}, form
assert form["execution"] == {"auto_starts_daemon": False, "interactive": False, "mutates_state": False, "read_only": True, "requires_permissions": False, "streaming": False, "supports_dry_run": False}, form

external = json.loads(Path("manifests/commands/aos-external-commands.json").read_text(encoding="utf-8"))
routes = [item for item in external["commands"] if item["path"] == ["see", "compare"]]
assert len(routes) == 1, routes
route = routes[0]
assert route["executable"] == "/usr/bin/env", route
assert route["argv_prefix"] == ["$AOS_PATH", "__see", "compare"], route
assert "cwd" not in route and "env" not in route and "stdio" not in route, route
assert not any("aos-see-native" in str(value) for value in route.values()), route

fallbacks = [item for item in external["commands"] if item["path"] == ["see"] and item["argv_prefix"] == ["node", "scripts/aos-see-native.mjs", "capture"]]
assert len(fallbacks) == 1 and "compare" in fallbacks[0]["when"]["excluded_values"], fallbacks

main = Path("src/main.swift").read_text(encoding="utf-8")
body = re.search(r'case "compare":(?P<body>.*?)case "cursor":', main, re.S)
assert body, main
assert "imageFileCompareCommand" in body.group("body"), body.group("body")
assert "ensureInteractivePreflight" not in body.group("body"), body.group("body")

public_text = "\n".join([
    Path("src/perceive/image-file-compare.swift").read_text(encoding="utf-8"),
    Path("manifests/commands/source/aos/03-see-05-compare.json").read_text(encoding="utf-8"),
])
assert ("si" + "gil").lower() not in public_text.lower(), public_text

comparator = Path("src/perceive/image-file-compare.swift").read_text(encoding="utf-8")
imports = set(re.findall(r"^import ([A-Za-z0-9_]+)$", comparator, re.M))
assert imports == {"CoreGraphics", "CryptoKit", "Darwin", "Foundation", "ImageIO"}, imports
for forbidden in (
    "ScreenCaptureKit",
    "SCStream",
    "SCScreenshotManager",
    "CGPreflightScreenCaptureAccess",
    "CGRequestScreenCaptureAccess",
    "AXIsProcessTrusted",
    "ensureInteractivePreflight",
    "AOS_STATE_ROOT",
    "AOS_RUNTIME_MODE",
    "daemonBrokerCommand",
):
    assert forbidden not in comparator, forbidden
assert not re.search(r"\b(?:poll|select|sleep|usleep)\s*\(", comparator), comparator
PY
pass "source dependencies keep comparison direct, stateless, permission-free, capture-free, daemon-free, polling-free, and product-neutral"

if [[ "$FAILURES" -ne 0 ]]; then
  printf 'see image compare: %s failure(s)\n' "$FAILURES" >&2
  exit 1
fi

printf 'see image compare: all hermetic checks passed\n'

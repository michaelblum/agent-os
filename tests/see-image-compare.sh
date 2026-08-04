#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TMP_ROOT="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/aos-see-image-compare.XXXXXX")"
/bin/chmod 700 "$TMP_ROOT"
RUNTIME_PATH_SPECIAL_ROOT=""
cleanup() {
  /bin/rm -rf "$TMP_ROOT"
  if [[ -n "$RUNTIME_PATH_SPECIAL_ROOT" ]]; then
    /bin/rm -rf "$RUNTIME_PATH_SPECIAL_ROOT"
  fi
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

def solid_rgba_png(width, height, pixel, *, changed_pixel=None):
    assert len(pixel) == 4
    compressor = zlib.compressobj(9)
    compressed = bytearray()
    base_row = bytes(pixel) * width
    for y in range(height):
        row = base_row
        if changed_pixel is not None and y == changed_pixel[1]:
            x, _, changed_rgba = changed_pixel
            assert 0 <= x < width and len(changed_rgba) == 4
            offset = x * 4
            row = base_row[:offset] + bytes(changed_rgba) + base_row[offset + 4:]
        compressed.extend(compressor.compress(b"\x00" + row))
    compressed.extend(compressor.flush())
    return (
        signature
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"sRGB", b"\x00")
        + chunk(b"IDAT", bytes(compressed))
        + chunk(b"IEND", b"")
    )

def patterned_gray_png(width, height, *, patterned):
    compressor = zlib.compressobj(6)
    compressed = bytearray()
    state = 0x13579BDF
    zero_row = bytes(width)
    for _ in range(height):
        if patterned:
            row = bytearray(width)
            for x in range(width):
                state = (1664525 * state + 1013904223) & 0xffffffff
                row[x] = state >> 24
        else:
            row = zero_row
        compressed.extend(compressor.compress(b"\x00" + row))
    compressed.extend(compressor.flush())
    return (
        signature
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
        + chunk(b"sRGB", b"\x00")
        + chunk(b"IDAT", bytes(compressed))
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

four_k_width, four_k_height = 3840, 2160
four_k_pixel = [10, 20, 30, 255]
four_k_files = {
    "four-k-before.png": solid_rgba_png(four_k_width, four_k_height, four_k_pixel),
    "four-k-identical.png": solid_rgba_png(four_k_width, four_k_height, four_k_pixel),
    "four-k-sparse.png": solid_rgba_png(
        four_k_width,
        four_k_height,
        four_k_pixel,
        changed_pixel=(3839, 2159, [15, 20, 30, 255]),
    ),
    "four-k-dense.png": solid_rgba_png(four_k_width, four_k_height, [11, 21, 31, 255]),
}
for name, data in four_k_files.items():
    with open(os.path.join(root, name), "wb") as handle:
        handle.write(data)

race_width, race_height = 1536, 1536
with open(os.path.join(root, "race-before.png"), "wb") as handle:
    handle.write(patterned_gray_png(race_width, race_height, patterned=False))
with open(os.path.join(root, "race-after.png"), "wb") as handle:
    handle.write(patterned_gray_png(race_width, race_height, patterned=True))

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
  -Onone \
  src/perceive/image-file-compare.swift \
  "$HARNESS_MAIN" \
  -o "$COMPARE_HARNESS"

WATCHDOG="$TMP_ROOT/run-with-watchdog.py"
cat >"$WATCHDOG" <<'PY'
import os
import signal
import subprocess
import sys
import time

timeout_seconds = float(sys.argv[1])
stdout_path, stderr_path = sys.argv[2:4]
command = sys.argv[4:]

with open(stdout_path, "wb") as stdout_handle, open(stderr_path, "wb") as stderr_handle:
    started = time.perf_counter()
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

elapsed = time.perf_counter() - started
timing_path = os.environ.get("AOS_WATCHDOG_TIMING_PATH")
if timing_path:
    with open(timing_path, "w", encoding="utf-8") as timing_handle:
        timing_handle.write(f"{elapsed:.3f}")

sys.exit(return_code if return_code >= 0 else 128 - return_code)
PY

ARTIFACT_RACE_RUNNER="$TMP_ROOT/run-artifact-race.py"
cat >"$ARTIFACT_RACE_RUNNER" <<'PY'
import os
import select
import signal
import subprocess
import sys
import time

mode, parent, target, stdout_path, stderr_path, status_path = sys.argv[1:7]
command = sys.argv[7:]
watch_descriptor = os.open(parent, os.O_RDONLY)
kqueue = select.kqueue()
kqueue.control([
    select.kevent(
        watch_descriptor,
        filter=select.KQ_FILTER_VNODE,
        flags=select.KQ_EV_ADD | select.KQ_EV_CLEAR,
        fflags=select.KQ_NOTE_WRITE | select.KQ_NOTE_RENAME,
    )
], 0, 0)
process = None
changed = False
try:
    with open(stdout_path, "wb") as stdout_handle, open(stderr_path, "wb") as stderr_handle:
        process = subprocess.Popen(
            command,
            stdout=stdout_handle,
            stderr=stderr_handle,
            start_new_session=True,
        )
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline and process.poll() is None:
            events = kqueue.control(None, 1, 0.25)
            if not events:
                continue
            if mode == "parent-drift":
                moved_parent = parent + ".moved"
                os.rename(parent, moved_parent)
                os.mkdir(parent, 0o700)
                with open(os.path.join(parent, "unrelated.txt"), "w", encoding="utf-8") as handle:
                    handle.write("preserve replacement parent\n")
                changed = True
                break
            if mode == "cleanup-failure" and os.path.lexists(target):
                os.chmod(parent, 0o500)
                changed = True
                break
        if not changed:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            raise RuntimeError(f"did not establish deterministic {mode} checkpoint")
        try:
            return_code = process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise
    with open(status_path, "w", encoding="utf-8") as status_handle:
        status_handle.write(str(return_code))
finally:
    if mode == "cleanup-failure" and changed:
        os.chmod(parent, 0o700)
    kqueue.close()
    os.close(watch_descriptor)
PY

GRAY_PNG_INSPECTOR="$TMP_ROOT/inspect-gray-png.py"
cat >"$GRAY_PNG_INSPECTOR" <<'PY'
import binascii
import hashlib
import json
import struct
import sys
import zlib

data = open(sys.argv[1], "rb").read()
assert data.startswith(b"\x89PNG\r\n\x1a\n"), sys.argv[1]
offset = 8
idat = bytearray()
width = height = bit_depth = color_type = None
while offset < len(data):
    length = struct.unpack(">I", data[offset:offset + 4])[0]
    kind = data[offset + 4:offset + 8]
    payload = data[offset + 8:offset + 8 + length]
    crc = struct.unpack(">I", data[offset + 8 + length:offset + 12 + length])[0]
    assert binascii.crc32(kind + payload) & 0xffffffff == crc
    offset += 12 + length
    if kind == b"IHDR":
        width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(">IIBBBBB", payload)
        assert compression == 0 and filtering == 0 and interlace == 0
    elif kind == b"IDAT":
        idat.extend(payload)
    elif kind == b"IEND":
        break

assert bit_depth == 8 and color_type == 0, (bit_depth, color_type)
raw = zlib.decompress(bytes(idat))
stride = width
assert len(raw) == height * (stride + 1), (len(raw), width, height)
samples = bytearray()
prior = bytearray(stride)
cursor = 0
for _ in range(height):
    filter_type = raw[cursor]
    encoded = raw[cursor + 1:cursor + 1 + stride]
    cursor += stride + 1
    row = bytearray(stride)
    for x, value in enumerate(encoded):
        left = row[x - 1] if x else 0
        up = prior[x]
        up_left = prior[x - 1] if x else 0
        if filter_type == 0:
            predictor = 0
        elif filter_type == 1:
            predictor = left
        elif filter_type == 2:
            predictor = up
        elif filter_type == 3:
            predictor = (left + up) // 2
        elif filter_type == 4:
            estimate = left + up - up_left
            pa, pb, pc = abs(estimate - left), abs(estimate - up), abs(estimate - up_left)
            predictor = left if pa <= pb and pa <= pc else up if pb <= pc else up_left
        else:
            raise AssertionError(filter_type)
        row[x] = (value + predictor) & 0xff
    samples.extend(row)
    prior = row

print(json.dumps({
    "width": width,
    "height": height,
    "bit_depth": bit_depth,
    "color_type": color_type,
    "sample_count": len(samples),
    "sample_sha256": hashlib.sha256(samples).hexdigest(),
    "nonzero_samples": sum(value != 0 for value in samples),
    "first_samples": list(samples[:16]),
    "last_sample": samples[-1],
}, sort_keys=True))
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

run_four_k_success() {
  local label="$1"
  local expected_case="$2"
  shift 2
  local stdout_file="$TMP_ROOT/${label}.out"
  local stderr_file="$TMP_ROOT/${label}.err"
  local timing_file="$TMP_ROOT/${label}.seconds"
  local status
  if AOS_WATCHDOG_TIMING_PATH="$timing_file" python3 "$WATCHDOG" 4 "$stdout_file" "$stderr_file" "$COMPARE_HARNESS" "$@"; then
    status=0
  else
    status=$?
  fi
  if [[ "$status" -eq 124 ]]; then
    fail "$label exceeded the 4-second 4K comparison watchdog"
    return
  fi
  if [[ "$status" -ne 0 || ! -s "$stdout_file" || -s "$stderr_file" ]]; then
    fail "$label output contract (status=$status, stdout=$(cat "$stdout_file" 2>/dev/null), stderr=$(cat "$stderr_file" 2>/dev/null))"
    return
  fi
  if python3 - "$stdout_file" "$expected_case" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
comparison = payload["comparison"]
expected = {
    "identical": {
        "changed_bounds": None,
        "changed_pixels": 0,
        "changed_ratio": 0,
        "max_channel_delta": 0,
        "mean_channel_delta": 0,
        "pixel_tolerance": 0,
        "sum_channel_delta": 0,
        "total_pixels": 8_294_400,
    },
    "sparse": {
        "changed_bounds": {"x": 3839, "y": 2159, "width": 1, "height": 1},
        "changed_pixels": 1,
        "changed_ratio": 0.000000120563,
        "max_channel_delta": 5,
        "mean_channel_delta": 0.000000150704,
        "pixel_tolerance": 0,
        "sum_channel_delta": 5,
        "total_pixels": 8_294_400,
    },
    "dense": {
        "changed_bounds": {"x": 0, "y": 0, "width": 3840, "height": 2160},
        "changed_pixels": 8_294_400,
        "changed_ratio": 1,
        "max_channel_delta": 1,
        "mean_channel_delta": 0.75,
        "pixel_tolerance": 0,
        "sum_channel_delta": 24_883_200,
        "total_pixels": 8_294_400,
    },
}[sys.argv[2]]
assert payload["status"] == "success", payload
assert payload["expectation"] is None, payload
assert comparison == expected, comparison
PY
  then
    pass "$label reports exact 4K metrics and bounds in $(cat "$timing_file")s"
  else
    fail "$label metrics drifted: $(cat "$stdout_file")"
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
python3 - "$TMP_ROOT/identical.out" "$FIXTURES/base.png" "$FIXTURES/base-metadata.png" <<'PY'
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
assert "artifacts" not in payload, payload
assert payload["expectation"] is None, payload
assert os.path.samefile(payload["before"]["path"], sys.argv[2]), payload
assert os.path.samefile(payload["after"]["path"], sys.argv[3]), payload
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
expected = {
    "status": "success",
    "schema_version": "aos.image-compare.v1",
    "before": {
        "path": payload["before"]["path"],
        "width": 2,
        "height": 2,
        "canonical_pixel_sha256": expected_hash,
    },
    "after": {
        "path": payload["after"]["path"],
        "width": 2,
        "height": 2,
        "canonical_pixel_sha256": expected_hash,
    },
    "comparison": comparison,
    "expectation": None,
}
expected_text = json.dumps(expected, sort_keys=True, separators=(",", ":")).replace("/", "\\/")
expected_bytes = (expected_text + "\n").encode()
actual_bytes = open(sys.argv[1], "rb").read()
assert actual_bytes == expected_bytes, (actual_bytes, expected_bytes)
PY
pass "no-output comparison remains byte-exact v1 with no artifact members or writes"

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

/bin/mkdir "$TMP_ROOT/artifacts"
ARTIFACT_ROOT="$(cd "$TMP_ROOT/artifacts" && pwd -P)"
/bin/mkdir -p "$ARTIFACT_ROOT/valid" "$ARTIFACT_ROOT/invalid/real-parent"

CHANGE_MAP="$ARTIFACT_ROOT/valid/change-map.png"
MASK="$ARTIFACT_ROOT/valid/mask.png"
run_success artifact-both \
  "$FIXTURES/base.png" "$FIXTURES/changed.png" \
  --pixel-tolerance 4 --change-map-out "$CHANGE_MAP" --mask-out "$MASK" --expect change
python3 "$GRAY_PNG_INSPECTOR" "$CHANGE_MAP" >"$TMP_ROOT/change-map-inspection.json"
python3 "$GRAY_PNG_INSPECTOR" "$MASK" >"$TMP_ROOT/mask-inspection.json"
python3 - \
  "$TMP_ROOT/artifact-both.out" "$CHANGE_MAP" "$MASK" \
  "$TMP_ROOT/change-map-inspection.json" "$TMP_ROOT/mask-inspection.json" <<'PY'
import hashlib
import json
import os
import stat
import struct
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
change_path, mask_path = sys.argv[2:4]
change_inspection = json.load(open(sys.argv[4], encoding="utf-8"))
mask_inspection = json.load(open(sys.argv[5], encoding="utf-8"))
assert payload["schema_version"] == "aos.image-compare.v2", payload
assert payload["comparison"]["changed_pixels"] == 1, payload
assert payload["expectation"] == {"requested": "change", "actual": "change", "met": True}, payload
expected_planes = {
    "change_map": (
        change_path,
        bytes([0, 5, 0, 0]),
        "aos.image-compare.change-map.gray8.v1",
        b"AOS_IMAGE_COMPARE_CHANGE_MAP_U8_V1\0",
        change_inspection,
    ),
    "mask": (
        mask_path,
        bytes([0, 255, 0, 0]),
        "aos.image-compare.mask.gray8.v1",
        b"AOS_IMAGE_COMPARE_MASK_U8_V1\0",
        mask_inspection,
    ),
}
for key, (path, samples, encoding, domain, inspection) in expected_planes.items():
    descriptor = payload["artifacts"][key]
    assert descriptor == {
        "path": os.path.normpath(os.path.abspath(path)),
        "width": 2,
        "height": 2,
        "encoding_version": encoding,
        "canonical_sample_sha256": hashlib.sha256(domain + struct.pack(">QQ", 2, 2) + samples).hexdigest(),
        "png_file_sha256": hashlib.sha256(open(path, "rb").read()).hexdigest(),
        "selected_pixels": 1,
    }, descriptor
    assert stat.S_IMODE(os.lstat(path).st_mode) == 0o600
    assert inspection["width"] == 2 and inspection["height"] == 2
    assert inspection["bit_depth"] == 8 and inspection["color_type"] == 0
    assert inspection["sample_count"] == 4
    assert inspection["first_samples"] == list(samples)
    assert inspection["sample_sha256"] == hashlib.sha256(samples).hexdigest()
PY
pass "artifact v2 returns exact descriptors, domain-separated sample hashes, PNG hashes, mode 0600, and grayscale samples"

SINGLE_CHANGE="$ARTIFACT_ROOT/valid/single-change.png"
run_success artifact-change-only \
  "$FIXTURES/base.png" "$FIXTURES/changed.png" \
  --pixel-tolerance 5 --change-map-out "$SINGLE_CHANGE"
SINGLE_MASK="$ARTIFACT_ROOT/valid/single-mask.png"
run_success artifact-mask-only \
  "$FIXTURES/base.png" "$FIXTURES/changed.png" \
  --pixel-tolerance 5 --mask-out "$SINGLE_MASK"
python3 "$GRAY_PNG_INSPECTOR" "$SINGLE_CHANGE" >"$TMP_ROOT/single-change-inspection.json"
python3 "$GRAY_PNG_INSPECTOR" "$SINGLE_MASK" >"$TMP_ROOT/single-mask-inspection.json"
python3 - \
  "$TMP_ROOT/artifact-change-only.out" "$TMP_ROOT/artifact-mask-only.out" \
  "$TMP_ROOT/single-change-inspection.json" "$TMP_ROOT/single-mask-inspection.json" <<'PY'
import json
import sys
change_payload = json.load(open(sys.argv[1], encoding="utf-8"))
mask_payload = json.load(open(sys.argv[2], encoding="utf-8"))
change_inspection = json.load(open(sys.argv[3], encoding="utf-8"))
mask_inspection = json.load(open(sys.argv[4], encoding="utf-8"))
assert change_payload["schema_version"] == "aos.image-compare.v2", change_payload
assert change_payload["artifacts"]["change_map"]["selected_pixels"] == 1, change_payload
assert change_payload["artifacts"]["mask"] is None, change_payload
assert change_inspection["first_samples"] == [0, 5, 0, 0], change_inspection
assert mask_payload["schema_version"] == "aos.image-compare.v2", mask_payload
assert mask_payload["artifacts"]["change_map"] is None, mask_payload
assert mask_payload["artifacts"]["mask"]["selected_pixels"] == 0, mask_payload
assert mask_inspection["first_samples"] == [0, 0, 0, 0], mask_inspection
PY
pass "change map and tolerance mask are independently optional one-byte outputs with null unrequested descriptors"

/bin/ln -s real-parent "$ARTIFACT_ROOT/invalid/parent-link"
/usr/bin/touch "$ARTIFACT_ROOT/invalid/existing.png"
/bin/mkdir "$ARTIFACT_ROOT/invalid/directory.png"
/usr/bin/mkfifo "$ARTIFACT_ROOT/invalid/fifo.png"
/bin/ln -s existing.png "$ARTIFACT_ROOT/invalid/symlink.png"
/usr/bin/touch "$ARTIFACT_ROOT/invalid/not-directory"

run_failure change-map-missing MISSING_ARG "$FIXTURES/base.png" "$FIXTURES/base.png" --change-map-out
run_failure mask-missing MISSING_ARG "$FIXTURES/base.png" "$FIXTURES/base.png" --mask-out
run_failure duplicate-change-map INVALID_ARG \
  "$FIXTURES/base.png" "$FIXTURES/base.png" \
  --change-map-out "$ARTIFACT_ROOT/valid/duplicate-a.png" --change-map-out "$ARTIFACT_ROOT/valid/duplicate-b.png"
run_failure duplicate-mask INVALID_ARG \
  "$FIXTURES/base.png" "$FIXTURES/base.png" \
  --mask-out "$ARTIFACT_ROOT/valid/duplicate-a.png" --mask-out "$ARTIFACT_ROOT/valid/duplicate-b.png"
run_failure artifact-dash IMAGE_ARTIFACT_PATH_INVALID \
  "$FIXTURES/base.png" "$FIXTURES/base.png" --mask-out -
run_failure artifact-extension IMAGE_ARTIFACT_PATH_INVALID \
  "$FIXTURES/base.png" "$FIXTURES/base.png" --mask-out "$ARTIFACT_ROOT/valid/output.jpg"
run_failure artifact-uppercase-extension IMAGE_ARTIFACT_PATH_INVALID \
  "$FIXTURES/base.png" "$FIXTURES/base.png" --mask-out "$ARTIFACT_ROOT/valid/output.PNG"
run_failure artifact-trailing-slash IMAGE_ARTIFACT_PATH_INVALID \
  "$FIXTURES/base.png" "$FIXTURES/base.png" --mask-out "$ARTIFACT_ROOT/valid/output.png/"
run_failure artifact-standardized-collision IMAGE_ARTIFACT_PATH_INVALID \
  "$FIXTURES/base.png" "$FIXTURES/base.png" \
  --change-map-out "$ARTIFACT_ROOT/valid/collision.png" \
  --mask-out "$ARTIFACT_ROOT/valid/unused/../collision.png"
run_failure artifact-missing-parent IMAGE_ARTIFACT_PARENT_INVALID \
  "$FIXTURES/base.png" "$FIXTURES/base.png" --mask-out "$ARTIFACT_ROOT/missing/output.png"
run_failure artifact-symlink-parent IMAGE_ARTIFACT_PARENT_INVALID \
  "$FIXTURES/base.png" "$FIXTURES/base.png" --mask-out "$ARTIFACT_ROOT/invalid/parent-link/output.png"
run_failure artifact-nondirectory-parent IMAGE_ARTIFACT_PARENT_INVALID \
  "$FIXTURES/base.png" "$FIXTURES/base.png" --mask-out "$ARTIFACT_ROOT/invalid/not-directory/output.png"
for special in existing directory fifo symlink; do
  run_failure "artifact-existing-$special" IMAGE_ARTIFACT_TARGET_EXISTS \
    "$FIXTURES/base.png" "$FIXTURES/base.png" --mask-out "$ARTIFACT_ROOT/invalid/$special.png"
done
pass "artifact validation rejects duplicate flags, invalid paths, standardized collisions, symlink parents, and existing regular or special targets"

RETAIN_CHANGE="$ARTIFACT_ROOT/valid/retain-change.png"
RETAIN_MASK="$ARTIFACT_ROOT/valid/retain-mask.png"
if "$COMPARE_HARNESS" \
    "$FIXTURES/base.png" "$FIXTURES/base-metadata.png" \
    --change-map-out "$RETAIN_CHANGE" --mask-out "$RETAIN_MASK" --expect change \
    >"$TMP_ROOT/artifact-expect-fail.out" 2>"$TMP_ROOT/artifact-expect-fail.err"; then
  fail "artifact expectation failure unexpectedly exited zero"
elif [[ -s "$TMP_ROOT/artifact-expect-fail.out" ]]; then
  fail "artifact expectation failure wrote stdout"
elif python3 - "$TMP_ROOT/artifact-expect-fail.err" "$RETAIN_CHANGE" "$RETAIN_MASK" <<'PY'
import json
import os
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["schema_version"] == "aos.image-compare.v2", payload
assert payload["status"] == "expectation_failed", payload
assert payload["code"] == "IMAGE_COMPARISON_EXPECTATION_FAILED", payload
assert payload["expectation"] == {"requested": "change", "actual": "no-change", "met": False}, payload
for key, path in zip(("change_map", "mask"), sys.argv[2:]):
    assert os.path.isfile(path), path
    assert payload["artifacts"][key]["path"] == path, payload
    assert payload["artifacts"][key]["selected_pixels"] == 0, payload
PY
then
  pass "expectation failure returns full v2 JSON on stderr and retains both published artifacts"
else
  fail "artifact expectation failure contract drifted: $(cat "$TMP_ROOT/artifact-expect-fail.err")"
fi

/bin/mkdir "$ARTIFACT_ROOT/rollback-change" "$ARTIFACT_ROOT/rollback-mask"
/bin/chmod 500 "$ARTIFACT_ROOT/rollback-mask"
ROLLBACK_CHANGE="$ARTIFACT_ROOT/rollback-change/change.png"
ROLLBACK_MASK="$ARTIFACT_ROOT/rollback-mask/mask.png"
if "$COMPARE_HARNESS" \
    "$FIXTURES/base.png" "$FIXTURES/changed.png" \
    --change-map-out "$ROLLBACK_CHANGE" --mask-out "$ROLLBACK_MASK" \
    >"$TMP_ROOT/artifact-rollback.out" 2>"$TMP_ROOT/artifact-rollback.err"; then
  rollback_status=0
else
  rollback_status=$?
fi
/bin/chmod 700 "$ARTIFACT_ROOT/rollback-mask"
if [[ "$rollback_status" -eq 0 || -s "$TMP_ROOT/artifact-rollback.out" ]]; then
  fail "handled artifact write failure did not fail on JSON stderr only"
elif python3 - "$TMP_ROOT/artifact-rollback.err" "$ROLLBACK_CHANGE" "$ROLLBACK_MASK" "$ARTIFACT_ROOT" <<'PY'
import json
import os
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["code"] == "IMAGE_ARTIFACT_WRITE_FAILED", payload
assert not os.path.lexists(sys.argv[2]), sys.argv[2]
assert not os.path.lexists(sys.argv[3]), sys.argv[3]
stages = []
for root, directories, files in os.walk(sys.argv[4]):
    stages.extend(os.path.join(root, name) for name in files + directories if name.startswith(".aos-image-compare-"))
assert stages == [], stages
PY
then
  pass "handled second-output failure removes the first published output and every private stage"
else
  fail "handled artifact rollback drifted: $(cat "$TMP_ROOT/artifact-rollback.err")"
fi

/bin/mkdir "$ARTIFACT_ROOT/receipt-rollback"
RECEIPT_ROLLBACK="$ARTIFACT_ROOT/receipt-rollback/change.png"
/usr/bin/touch "$ARTIFACT_ROOT/receipt-rollback/unrelated.txt"
if "$COMPARE_HARNESS" \
    "$FIXTURES/base.png" "$FIXTURES/changed.png" \
    --change-map-out "$RECEIPT_ROLLBACK" \
    1>&- 2>"$TMP_ROOT/artifact-receipt-closed.err"; then
  receipt_closed_status=0
else
  receipt_closed_status=$?
fi
if [[ "$receipt_closed_status" -eq 0 ]]; then
  fail "closed artifact receipt stdout unexpectedly exited zero"
elif python3 - "$TMP_ROOT/artifact-receipt-closed.err" "$RECEIPT_ROLLBACK" "$ARTIFACT_ROOT/receipt-rollback" <<'PY'
import json
import os
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert payload["code"] == "IMAGE_ARTIFACT_RECEIPT_WRITE_FAILED", payload
assert not os.path.lexists(sys.argv[2]), sys.argv[2]
assert os.path.isfile(os.path.join(sys.argv[3], "unrelated.txt")), sys.argv[3]
assert not any(name.startswith(".aos-image-compare-") for name in os.listdir(sys.argv[3])), os.listdir(sys.argv[3])
PY
then
  pass "closed v2 receipt stdout fails nonzero and rolls back only the owned artifact"
else
  fail "closed artifact receipt rollback drifted: $(cat "$TMP_ROOT/artifact-receipt-closed.err")"
fi

/bin/mkdir "$ARTIFACT_ROOT/parent-drift"
PARENT_DRIFT_TARGET="$ARTIFACT_ROOT/parent-drift/change.png"
if python3 "$ARTIFACT_RACE_RUNNER" \
    parent-drift "$ARTIFACT_ROOT/parent-drift" "$PARENT_DRIFT_TARGET" \
    "$TMP_ROOT/artifact-parent-drift.out" "$TMP_ROOT/artifact-parent-drift.err" "$TMP_ROOT/artifact-parent-drift.status" \
    "$COMPARE_HARNESS" "$FIXTURES/race-before.png" "$FIXTURES/race-after.png" \
    --change-map-out "$PARENT_DRIFT_TARGET"; then
  parent_drift_runner_status=0
else
  parent_drift_runner_status=$?
fi
if [[ "$parent_drift_runner_status" -ne 0 ]]; then
  fail "parent-drift checkpoint runner failed"
elif python3 - \
    "$TMP_ROOT/artifact-parent-drift.status" "$TMP_ROOT/artifact-parent-drift.out" "$TMP_ROOT/artifact-parent-drift.err" \
    "$ARTIFACT_ROOT/parent-drift" "$ARTIFACT_ROOT/parent-drift.moved" <<'PY'
import json
import os
import sys
return_code = int(open(sys.argv[1], encoding="utf-8").read())
assert return_code != 0, return_code
assert os.path.getsize(sys.argv[2]) == 0, sys.argv[2]
payload = json.load(open(sys.argv[3], encoding="utf-8"))
assert payload["code"] == "IMAGE_ARTIFACT_PARENT_CHANGED", payload
replacement, moved = sys.argv[4:6]
assert open(os.path.join(replacement, "unrelated.txt"), encoding="utf-8").read() == "preserve replacement parent\n"
assert not os.path.lexists(os.path.join(replacement, "change.png")), replacement
assert not os.path.lexists(os.path.join(moved, "change.png")), moved
for parent in (replacement, moved):
    assert not any(name.startswith(".aos-image-compare-") for name in os.listdir(parent)), os.listdir(parent)
PY
then
  pass "parent rename after private staging fails closed, removes the pinned stage, and preserves the replacement parent"
else
  fail "parent-drift artifact contract drifted: $(cat "$TMP_ROOT/artifact-parent-drift.err" 2>/dev/null)"
fi

/bin/mkdir "$ARTIFACT_ROOT/cleanup-failure" "$ARTIFACT_ROOT/cleanup-trigger"
/usr/bin/touch "$ARTIFACT_ROOT/cleanup-failure/unrelated.txt"
/bin/chmod 500 "$ARTIFACT_ROOT/cleanup-trigger"
CLEANUP_FAILURE_CHANGE="$ARTIFACT_ROOT/cleanup-failure/change.png"
CLEANUP_FAILURE_MASK="$ARTIFACT_ROOT/cleanup-trigger/mask.png"
if python3 "$ARTIFACT_RACE_RUNNER" \
    cleanup-failure "$ARTIFACT_ROOT/cleanup-failure" "$CLEANUP_FAILURE_CHANGE" \
    "$TMP_ROOT/artifact-cleanup-failure.out" "$TMP_ROOT/artifact-cleanup-failure.err" "$TMP_ROOT/artifact-cleanup-failure.status" \
    "$COMPARE_HARNESS" "$FIXTURES/race-before.png" "$FIXTURES/race-after.png" \
    --change-map-out "$CLEANUP_FAILURE_CHANGE" --mask-out "$CLEANUP_FAILURE_MASK"; then
  cleanup_failure_runner_status=0
else
  cleanup_failure_runner_status=$?
fi
/bin/chmod 700 "$ARTIFACT_ROOT/cleanup-trigger"
if [[ "$cleanup_failure_runner_status" -ne 0 ]]; then
  fail "cleanup-failure checkpoint runner failed"
elif python3 - \
    "$TMP_ROOT/artifact-cleanup-failure.status" "$TMP_ROOT/artifact-cleanup-failure.out" "$TMP_ROOT/artifact-cleanup-failure.err" \
    "$CLEANUP_FAILURE_CHANGE" "$CLEANUP_FAILURE_MASK" "$ARTIFACT_ROOT/cleanup-failure/unrelated.txt" <<'PY'
import json
import os
import sys
return_code = int(open(sys.argv[1], encoding="utf-8").read())
assert return_code != 0, return_code
assert os.path.getsize(sys.argv[2]) == 0, sys.argv[2]
payload = json.load(open(sys.argv[3], encoding="utf-8"))
assert payload["code"] == "IMAGE_ARTIFACT_CLEANUP_FAILED", payload
assert os.path.isfile(sys.argv[4]), sys.argv[4]
assert not os.path.lexists(sys.argv[5]), sys.argv[5]
assert os.path.isfile(sys.argv[6]), sys.argv[6]
PY
then
  pass "rollback unlink denial surfaces IMAGE_ARTIFACT_CLEANUP_FAILED and preserves unrelated files"
else
  fail "cleanup-failure artifact contract drifted: $(cat "$TMP_ROOT/artifact-cleanup-failure.err" 2>/dev/null)"
fi

run_four_k_success four-k-identical identical "$FIXTURES/four-k-before.png" "$FIXTURES/four-k-identical.png"
run_four_k_success four-k-sparse sparse "$FIXTURES/four-k-before.png" "$FIXTURES/four-k-sparse.png"
run_four_k_success four-k-dense dense "$FIXTURES/four-k-before.png" "$FIXTURES/four-k-dense.png"

FOUR_K_CHANGE="$ARTIFACT_ROOT/valid/four-k-change.png"
FOUR_K_MASK="$ARTIFACT_ROOT/valid/four-k-mask.png"
if AOS_WATCHDOG_TIMING_PATH="$TMP_ROOT/four-k-artifacts.seconds" python3 "$WATCHDOG" 4 \
    "$TMP_ROOT/four-k-artifacts.out" "$TMP_ROOT/four-k-artifacts.err" \
    "$COMPARE_HARNESS" "$FIXTURES/four-k-before.png" "$FIXTURES/four-k-sparse.png" \
    --change-map-out "$FOUR_K_CHANGE" --mask-out "$FOUR_K_MASK"; then
  four_k_artifact_status=0
else
  four_k_artifact_status=$?
fi
if [[ "$four_k_artifact_status" -eq 124 ]]; then
  fail "4K spatial artifact output exceeded the 4-second watchdog"
elif [[ "$four_k_artifact_status" -ne 0 || -s "$TMP_ROOT/four-k-artifacts.err" ]]; then
  fail "4K spatial artifact output contract failed: $(cat "$TMP_ROOT/four-k-artifacts.err" "$TMP_ROOT/four-k-artifacts.out")"
else
  python3 "$GRAY_PNG_INSPECTOR" "$FOUR_K_CHANGE" >"$TMP_ROOT/four-k-change-inspection.json"
  python3 "$GRAY_PNG_INSPECTOR" "$FOUR_K_MASK" >"$TMP_ROOT/four-k-mask-inspection.json"
  if python3 - \
      "$TMP_ROOT/four-k-artifacts.out" "$FOUR_K_CHANGE" "$FOUR_K_MASK" \
      "$TMP_ROOT/four-k-change-inspection.json" "$TMP_ROOT/four-k-mask-inspection.json" <<'PY'
import hashlib
import json
import os
import struct
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
width, height = 3840, 2160
sample_count = width * height
assert payload["schema_version"] == "aos.image-compare.v2", payload
assert payload["comparison"]["changed_pixels"] == 1, payload
for key, path, inspection_path, value, domain in (
    ("change_map", sys.argv[2], sys.argv[4], 5, b"AOS_IMAGE_COMPARE_CHANGE_MAP_U8_V1\0"),
    ("mask", sys.argv[3], sys.argv[5], 255, b"AOS_IMAGE_COMPARE_MASK_U8_V1\0"),
):
    inspection = json.load(open(inspection_path, encoding="utf-8"))
    samples = bytes(sample_count - 1) + bytes([value])
    descriptor = payload["artifacts"][key]
    assert descriptor["selected_pixels"] == 1, descriptor
    assert descriptor["canonical_sample_sha256"] == hashlib.sha256(
        domain + struct.pack(">QQ", width, height) + samples
    ).hexdigest(), descriptor
    assert descriptor["png_file_sha256"] == hashlib.sha256(open(path, "rb").read()).hexdigest(), descriptor
    assert inspection["sample_count"] == sample_count, inspection
    assert inspection["nonzero_samples"] == 1 and inspection["last_sample"] == value, inspection
    assert os.path.getsize(path) < 128 * 1024 * 1024, os.path.getsize(path)
PY
  then
    pass "two 4K one-byte artifact planes publish with exact sparse samples and hashes in $(cat "$TMP_ROOT/four-k-artifacts.seconds")s"
  else
    fail "4K spatial artifact samples or descriptors drifted"
  fi
fi

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

DISPATCH_SUPPORT="$TMP_ROOT/dispatch-support.swift"
cat >"$DISPATCH_SUPPORT" <<'SWIFT'
import Foundation

struct ProcessOutput {
    let exitCode: Int32
    let stdout: String
    let stderr: String
}

func aosInvocationDisplayName() -> String { CommandLine.arguments.first ?? "aos" }
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
if runExternalCommandIfMatched(args: args) {
    exit(0)
}
if args.starts(with: ["__see", "compare"]) {
    imageFileCompareCommand(args: Array(args.dropFirst(2)))
}
exitError("No route", code: "NO_ROUTE")
SWIFT

DISPATCH_HARNESS="$TMP_ROOT/aos-production-dispatch"
/usr/bin/xcrun swiftc \
  -Onone \
  "$DISPATCH_SUPPORT" \
  shared/swift/ipc/runtime-paths.swift \
  src/shared/external-command-dispatch.swift \
  src/perceive/image-file-compare.swift \
  "$HARNESS_MAIN" \
  -o "$DISPATCH_HARNESS"

DISPATCH_REPO="$TMP_ROOT/fake-aos-repo"
DISPATCH_BIN="$DISPATCH_REPO/bin"
DISPATCH_SENTINEL="$DISPATCH_REPO/packages/toolkit/components/inspector-panel/index.html"
DISPATCH_MANIFEST="$DISPATCH_REPO/manifests/commands/aos-external-commands.json"
DISPATCH_CWD="$TMP_ROOT/external-caller/nested"
/bin/mkdir -p "$DISPATCH_BIN" "$(dirname "$DISPATCH_SENTINEL")" "$(dirname "$DISPATCH_MANIFEST")" "$DISPATCH_CWD"
/usr/bin/touch "$DISPATCH_SENTINEL"
/bin/cp manifests/commands/aos-external-commands.json "$DISPATCH_MANIFEST"
/bin/cp "$DISPATCH_HARNESS" "$DISPATCH_BIN/aos"
/bin/cp "$FIXTURES/base.png" "$DISPATCH_CWD/before.png"
/bin/cp "$FIXTURES/changed.png" "$DISPATCH_CWD/after.png"

RUNTIME_PATH_HARNESS_ROOT="$TMP_ROOT/runtime-path-harness"
/bin/mkdir -p "$RUNTIME_PATH_HARNESS_ROOT"
RUNTIME_PATH_MAIN="$RUNTIME_PATH_HARNESS_ROOT/main.swift"
cat >"$RUNTIME_PATH_MAIN" <<'SWIFT'
import Foundation

guard CommandLine.arguments.count == 4 else {
    FileHandle.standardError.write(Data("usage: resolver <argv> <cwd> <path-or-nil>\n".utf8))
    exit(2)
}

let pathEnvironment = CommandLine.arguments[3] == "__AOS_NIL_PATH__"
    ? nil
    : CommandLine.arguments[3]
print(aosResolveExecutablePathFallback(
    argvPath: CommandLine.arguments[1],
    callerCurrentDirectory: CommandLine.arguments[2],
    pathEnvironment: pathEnvironment
))
SWIFT

RUNTIME_PATH_HARNESS="$TMP_ROOT/runtime-path-resolver"
/usr/bin/xcrun swiftc \
  -Onone \
  shared/swift/ipc/runtime-paths.swift \
  "$RUNTIME_PATH_MAIN" \
  -o "$RUNTIME_PATH_HARNESS"

RUNTIME_PATH_ROOT="${TMP_ROOT//\/\//\/}/runtime-path-fixtures"
RUNTIME_PATH_SPECIAL_ROOT="$(/usr/bin/mktemp -d /tmp/aos-runtime-path.XXXXXX)"
/bin/chmod 700 "$RUNTIME_PATH_SPECIAL_ROOT"
RUNTIME_PATH_CWD="$RUNTIME_PATH_ROOT/caller"
RUNTIME_PATH_FIRST="$RUNTIME_PATH_ROOT/first-bin"
RUNTIME_PATH_SECOND="$RUNTIME_PATH_ROOT/second-bin"
/bin/mkdir -p "$RUNTIME_PATH_CWD" "$RUNTIME_PATH_FIRST" "$RUNTIME_PATH_SECOND" \
  "$RUNTIME_PATH_CWD/relative-bin" "$RUNTIME_PATH_ROOT/relative-target" \
  "$RUNTIME_PATH_ROOT/directory-bin/skip-me" "$RUNTIME_PATH_ROOT/nonexec-bin" \
  "$RUNTIME_PATH_ROOT/executable-bin" "$RUNTIME_PATH_ROOT/symlink-bin" \
  "$RUNTIME_PATH_ROOT/symlink-target" "$RUNTIME_PATH_SPECIAL_ROOT/fifo-bin" \
  "$RUNTIME_PATH_SPECIAL_ROOT/socket-bin" "$RUNTIME_PATH_SPECIAL_ROOT/regular-bin"
/usr/bin/touch \
  "$RUNTIME_PATH_FIRST/path-order" \
  "$RUNTIME_PATH_SECOND/path-order" \
  "$RUNTIME_PATH_CWD/empty-entry" \
  "$RUNTIME_PATH_CWD/relative-bin/relative-entry" \
  "$RUNTIME_PATH_ROOT/relative-target/relative-command" \
  "$RUNTIME_PATH_ROOT/nonexec-bin/skip-me" \
  "$RUNTIME_PATH_ROOT/executable-bin/skip-me" \
  "$RUNTIME_PATH_ROOT/symlink-target/real-command" \
  "$RUNTIME_PATH_SPECIAL_ROOT/regular-bin/special-command"
/usr/bin/mkfifo "$RUNTIME_PATH_SPECIAL_ROOT/fifo-bin/special-command"
python3 - "$RUNTIME_PATH_SPECIAL_ROOT/socket-bin/special-command" <<'PY'
import socket
import sys

socket_path = sys.argv[1]
with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
    listener.bind(socket_path)
PY
/bin/chmod 700 \
  "$RUNTIME_PATH_FIRST/path-order" \
  "$RUNTIME_PATH_SECOND/path-order" \
  "$RUNTIME_PATH_CWD/empty-entry" \
  "$RUNTIME_PATH_CWD/relative-bin/relative-entry" \
  "$RUNTIME_PATH_ROOT/relative-target/relative-command" \
  "$RUNTIME_PATH_ROOT/executable-bin/skip-me" \
  "$RUNTIME_PATH_ROOT/symlink-target/real-command" \
  "$RUNTIME_PATH_SPECIAL_ROOT/fifo-bin/special-command" \
  "$RUNTIME_PATH_SPECIAL_ROOT/socket-bin/special-command" \
  "$RUNTIME_PATH_SPECIAL_ROOT/regular-bin/special-command"
/bin/chmod 600 "$RUNTIME_PATH_ROOT/nonexec-bin/skip-me"
/bin/ln -s ../symlink-target/real-command "$RUNTIME_PATH_ROOT/symlink-bin/symlink-command"

resolve_runtime_path() {
  "$RUNTIME_PATH_HARNESS" "$1" "$RUNTIME_PATH_CWD" "$2"
}

assert_runtime_path() {
  local label="$1"
  local argv_path="$2"
  local path_environment="$3"
  local expected="$4"
  local actual
  if actual="$(resolve_runtime_path "$argv_path" "$path_environment")" \
      && [[ "$actual" == "$expected" ]]; then
    pass "$label"
  else
    fail "$label (expected=$expected, actual=$actual)"
  fi
}

assert_runtime_path \
  "runtime fallback normalizes absolute argv" \
  "$RUNTIME_PATH_ROOT/relative-target/../relative-target/relative-command" \
  "__AOS_NIL_PATH__" \
  "$RUNTIME_PATH_ROOT/relative-target/relative-command"
assert_runtime_path \
  "runtime fallback normalizes caller-relative slash argv" \
  "../relative-target/relative-command" \
  "__AOS_NIL_PATH__" \
  "$RUNTIME_PATH_ROOT/relative-target/relative-command"
assert_runtime_path \
  "runtime fallback selects the first executable PATH match" \
  "path-order" \
  "$RUNTIME_PATH_FIRST:$RUNTIME_PATH_SECOND" \
  "$RUNTIME_PATH_FIRST/path-order"

empty_entry_actual="$(resolve_runtime_path "empty-entry" ":relative-bin")"
relative_entry_actual="$(resolve_runtime_path "relative-entry" ":relative-bin")"
if [[ "$empty_entry_actual" == "$RUNTIME_PATH_CWD/empty-entry" \
    && "$relative_entry_actual" == "$RUNTIME_PATH_CWD/relative-bin/relative-entry" ]]; then
  pass "runtime fallback treats empty PATH entries as caller cwd and resolves relative entries from it"
else
  fail "runtime fallback empty/relative PATH resolution (empty=$empty_entry_actual, relative=$relative_entry_actual)"
fi

assert_runtime_path \
  "runtime fallback resolves an executable symlink to its target" \
  "symlink-command" \
  "$RUNTIME_PATH_ROOT/symlink-bin" \
  "$RUNTIME_PATH_ROOT/symlink-target/real-command"
assert_runtime_path \
  "runtime fallback skips directory and non-executable PATH candidates" \
  "skip-me" \
  "$RUNTIME_PATH_ROOT/directory-bin:$RUNTIME_PATH_ROOT/nonexec-bin:$RUNTIME_PATH_ROOT/executable-bin" \
  "$RUNTIME_PATH_ROOT/executable-bin/skip-me"
assert_runtime_path \
  "runtime fallback skips executable FIFO and socket PATH candidates" \
  "special-command" \
  "$RUNTIME_PATH_SPECIAL_ROOT/fifo-bin:$RUNTIME_PATH_SPECIAL_ROOT/socket-bin:$RUNTIME_PATH_SPECIAL_ROOT/regular-bin" \
  "$RUNTIME_PATH_SPECIAL_ROOT/regular-bin/special-command"
assert_runtime_path \
  "runtime fallback retains an absolute caller-relative diagnostic path on PATH miss" \
  "missing-command" \
  "$RUNTIME_PATH_FIRST:$RUNTIME_PATH_SECOND" \
  "$RUNTIME_PATH_CWD/missing-command"

run_dispatch_probe() {
  local label="$1"
  local invocation="$2"
  local stdout_file="$TMP_ROOT/${label}.out"
  local stderr_file="$TMP_ROOT/${label}.err"
  local status
  if (cd "$DISPATCH_CWD" && /usr/bin/env \
      -u AOS_REPO_ROOT \
      -u AOS_TEST_REPO_ROOT \
      -u AOS_RUNTIME_MODE \
      PATH="$DISPATCH_BIN:/usr/bin:/bin" \
      /usr/bin/python3 "$WATCHDOG" 4 "$stdout_file" "$stderr_file" \
      "$invocation" see compare before.png after.png --expect change); then
    status=0
  else
    status=$?
  fi
  if [[ "$status" -eq 124 ]]; then
    fail "$label did not terminate within the dispatch recursion watchdog"
    return
  fi
  if [[ "$status" -eq 0 && ! -s "$stderr_file" ]] \
      && python3 - "$stdout_file" "$DISPATCH_CWD" <<'PY'
import json
import os
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
caller = os.path.normpath(os.path.abspath(sys.argv[2]))
assert list(payload) == sorted(payload), payload
assert payload["status"] == "success", payload
assert payload["schema_version"] == "aos.image-compare.v1", payload
assert payload["before"]["path"] == os.path.join(caller, "before.png"), payload
assert payload["after"]["path"] == os.path.join(caller, "after.png"), payload
assert payload["comparison"] == {
    "changed_bounds": {"x": 1, "y": 0, "width": 1, "height": 1},
    "changed_pixels": 1,
    "changed_ratio": 0.25,
    "max_channel_delta": 5,
    "mean_channel_delta": 0.3125,
    "pixel_tolerance": 0,
    "sum_channel_delta": 5,
    "total_pixels": 4,
}, payload
assert payload["expectation"] == {"requested": "change", "actual": "change", "met": True}, payload
PY
  then
    pass "$label resolves the production repo route, preserves caller cwd, and terminates with exact JSON metrics"
  else
    fail "$label production dispatch drifted (status=$status): $(cat "$stderr_file" "$stdout_file" 2>/dev/null)"
  fi
}

run_dispatch_probe dispatch-absolute "$DISPATCH_BIN/aos"
run_dispatch_probe dispatch-path aos
run_dispatch_probe dispatch-relative ../../fake-aos-repo/bin/aos

if SEE_COMPARE_HELP="$(node scripts/aos-help-proxy.mjs see compare 2>"$TMP_ROOT/see-compare-help.err")"; then
  if /usr/bin/grep -Fq "requires one artifact output path: --change-map-out OR --mask-out" <<<"$SEE_COMPARE_HELP"; then
    pass "direct text help renders the canonical artifact-output alternative group"
  else
    fail "direct text help omitted the artifact-output alternative group"
  fi
else
  fail "direct text help crashed: $(cat "$TMP_ROOT/see-compare-help.err")"
fi

python3 - <<'PY'
import json
import re
from pathlib import Path

source = json.loads(Path("manifests/commands/source/aos/03-see-05-compare.json").read_text(encoding="utf-8"))
form = source["commands"][0]["forms"][0]
artifact_form = source["commands"][0]["forms"][1]
assert source["id"] == "see-05-compare", source
assert source["commands"][0]["path"] == ["see", "compare"], source
assert form["id"] == "see-compare", form
assert form["output"] == {"default_mode": "json", "error_mode": "json_stderr", "streaming": False, "supports_json_flag": False}, form
assert form["execution"] == {"auto_starts_daemon": False, "interactive": False, "mutates_state": False, "read_only": True, "requires_permissions": False, "streaming": False, "supports_dry_run": False}, form
assert {arg.get("token") for arg in form["args"] if arg["kind"] == "flag"} == {"--pixel-tolerance", "--expect"}, form
assert artifact_form["id"] == "see-compare-artifacts", artifact_form
assert artifact_form["output"] == form["output"], artifact_form
assert artifact_form["execution"] == {"auto_starts_daemon": False, "interactive": False, "mutates_state": True, "mutation_scope": "explicit_output_paths_only", "read_only": False, "requires_permissions": False, "streaming": False, "supports_dry_run": False}, artifact_form
assert artifact_form["constraints"]["required_groups"] == [{
    "one_of": [["change-map-out"], ["mask-out"]],
    "summary": "artifact output path",
}], artifact_form
assert {arg.get("token") for arg in artifact_form["args"] if arg["kind"] == "flag"} == {
    "--change-map-out", "--mask-out", "--pixel-tolerance", "--expect"
}, artifact_form

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

generated = json.loads(Path("manifests/commands/aos-commands.json").read_text(encoding="utf-8"))
generated_routes = [item for item in generated["commands"] if item["path"] == ["see", "compare"]]
assert len(generated_routes) == 1, generated_routes
generated_artifact_forms = [form for form in generated_routes[0]["forms"] if form["id"] == "see-compare-artifacts"]
assert len(generated_artifact_forms) == 1, generated_artifact_forms
generated_artifact_form = generated_artifact_forms[0]
assert generated_artifact_form["constraints"]["required_groups"] == artifact_form["constraints"]["required_groups"], generated_artifact_form
assert generated_artifact_form["execution"]["mutation_scope"] == "explicit_output_paths_only", generated_artifact_form

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
compare_body_match = re.search(
    r"private func compareCanonicalImages\(.*?\n\}\n\nprivate func scanCanonicalImageDelta",
    comparator,
    re.S,
)
assert compare_body_match, comparator
compare_body = compare_body_match.group(0)
assert "before.pixels.count == canonicalByteCount && after.pixels.count == canonicalByteCount" in compare_body, compare_body
assert compare_body.count("Data(count: Int(totalPixels))") == 2, compare_body
assert "changeMapSamples = options.changeMapPath.map" in compare_body, compare_body
assert "maskSamples = options.maskPath.map" in compare_body, compare_body
assert re.search(r"else \{\s*metrics = scanCanonicalImageDelta\(.*?changeMapBytes: nil,\s*maskBytes: nil", compare_body, re.S), compare_body

scan_body_match = re.search(
    r"private func scanCanonicalImageDelta\(.*?\n\}\n\nprivate func writeImageCompareArtifacts",
    comparator,
    re.S,
)
assert scan_body_match, comparator
scan_body = scan_body_match.group(0)
assert scan_body.count("Darwin.memcmp(") == 2, scan_body
assert re.search(r"guard Darwin\.memcmp\([^\n]+canonicalByteCount\) != 0 else \{ return \}", scan_body), scan_body
assert re.search(
    r"while y < before\.height.*?Darwin\.memcmp\([^\n]+bytesPerRow\) != 0.*?while x < before\.width",
    scan_body,
    re.S,
), scan_body
assert scan_body.count("assumingMemoryBound(to: UInt8.self)") == 2, scan_body
assert "bindMemory(to: UInt8.self)" not in scan_body, scan_body
assert "pixelIndex % before.width" not in scan_body, scan_body
assert "pixelIndex / before.width" not in scan_body, scan_body
assert "before.sha256 == after.sha256" not in scan_body, scan_body
assert "changeMapBytes?[planeIndex] = UInt8(pixelMaximumDelta)" in scan_body, scan_body
assert "maskBytes?[planeIndex] = pixelMaximumDelta > tolerance ? 255 : 0" in scan_body, scan_body
assert "O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC" in comparator, comparator
assert "mode_t(0o600)" in comparator and "Darwin.fchmod" in comparator, comparator
assert "Darwin.fsync(descriptor)" in comparator, comparator
assert "Darwin.openat(descriptor, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)" in comparator, comparator
assert "Darwin.fstatat(directoryDescriptor, fileName, &existing, AT_SYMLINK_NOFOLLOW)" in comparator, comparator
assert "Darwin.renameatx_np(" in comparator and "UInt32(RENAME_EXCL)" in comparator, comparator
assert "Darwin.unlinkat(artifact.directoryDescriptor, artifact.fileName, 0)" in comparator, comparator
assert "cleanupImageCompareArtifacts(staged: staged, published: published)" in comparator, comparator
assert "IMAGE_ARTIFACT_PARENT_CHANGED" in comparator, comparator
assert "parentDevice: parentStatus.st_dev" in comparator and "parentInode: parentStatus.st_ino" in comparator, comparator
assert "try revalidateImageCompareArtifactParent(target)" in comparator, comparator
assert "try verifyImageCompareArtifactPublication(targets: artifactTargets, published: publication.published)" in comparator, comparator
assert "IMAGE_ARTIFACT_CLEANUP_FAILED" in comparator, comparator
assert "try unlinkImageCompareArtifactIfOwned(artifact)" in comparator, comparator
assert "Darwin.fsync(artifact.directoryDescriptor)" in comparator, comparator
assert "IMAGE_ARTIFACT_RECEIPT_WRITE_FAILED" in comparator, comparator
assert "try writeImageCompareJSONChecked(result, to: .standardOutput)" in comparator, comparator
assert "try writeImageCompareJSONChecked(failure, to: .standardError)" in comparator, comparator
assert comparator.index("writeImageCompareArtifacts(") < comparator.index('expectation["met"] as? Bool == false'), comparator
assert "@_optimize" not in comparator, comparator
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

runtime_paths = Path("shared/swift/ipc/runtime-paths.swift").read_text(encoding="utf-8")
assert re.search(r"^import MachO$", runtime_paths, re.M), runtime_paths
executable_path_body = re.search(
    r"func aosExecutablePath\(\) -> String \{(?P<body>.*?)\n\}",
    runtime_paths,
    re.S,
)
assert executable_path_body, runtime_paths
assert "_NSGetExecutablePath" in executable_path_body.group("body"), executable_path_body.group("body")
assert "CommandLine.arguments.first" in executable_path_body.group("body"), executable_path_body.group("body")
assert "currentDirectoryPath" in executable_path_body.group("body"), executable_path_body.group("body")
assert "aosResolveExecutablePathFallback" in executable_path_body.group("body"), executable_path_body.group("body")
normalize_body = re.search(
    r"private func aosNormalizeExecutablePath\(.*?\n\}",
    runtime_paths,
    re.S,
)
assert normalize_body, runtime_paths
assert "resolvingSymlinksInPath" in normalize_body.group(0), normalize_body.group(0)
assert "Process()" not in executable_path_body.group("body"), executable_path_body.group("body")
fallback_body = re.search(
    r"func aosResolveExecutablePathFallback\(.*?\n\}\n\nfunc aosExecutablePath",
    runtime_paths,
    re.S,
)
assert fallback_body, runtime_paths
assert "Process()" not in fallback_body.group(0), fallback_body.group(0)

api_doc = " ".join(Path("docs/api/aos.md").read_text(encoding="utf-8").split())
assert all(fragment in api_doc for fragment in (
    "| `aos see` | Perception and artifact verification:",
    "| `compare` | compare canonical pixels from two existing same-size PNG files |",
    "This compares compact saved-ref structure, not artifact pixels.",
    "`aos see compare <before.png> <after.png>`",
    "does not capture, poll, wait, resize, crop, or align its inputs",
    "Calls without output flags remain the byte-stable, write-free `aos.image-compare.v1` form.",
    "The opened parent identity is pinned and the requested symlink-free path must still resolve to it immediately before publication and receipt",
    "Artifact success requires the complete v2 JSON receipt.",
    "`IMAGE_ARTIFACT_CLEANUP_FAILED`",
    "Each file is atomic, but two requested files are not claimed to be mutually crash-atomic.",
)), api_doc

capabilities_doc = " ".join(Path("docs/api/aos-capabilities.md").read_text(encoding="utf-8").split())
assert all(fragment in capabilities_doc for fragment in (
    "| Artifact comparison | Exact canonical pixel verification and optional grayscale spatial evidence over existing same-size PNG paths; no capture, wait, or alignment |",
    "When matching before/after PNG artifact paths already exist, use `./aos see compare <before.png> <after.png>` as the exact pixel alternative",
    "The opened parent identity must still match the requested symlink-free path before publication and receipt",
    "Artifact success requires the complete v2 JSON receipt.",
    "`IMAGE_ARTIFACT_CLEANUP_FAILED`",
    "Files are individually atomic, not mutually crash-atomic.",
)), capabilities_doc

workflow_rules = Path("docs/dev/workflow-rules.json").read_text(encoding="utf-8")
proof_registry = Path("docs/dev/test-proof-registry.d/command-surface.json").read_text(encoding="utf-8")
assert "v1 no-write compatibility, optional grayscale artifacts, canonical text help, target and parent-identity safety, checked receipts, normal and failed rollback, expectation retention" in workflow_rules, workflow_rules
assert "preserves byte-stable v1 no-write comparison, emits exact optional grayscale v2 artifacts through parent-identity-safe atomic publication plus a checked receipt" in proof_registry, proof_registry
PY
pass "source, split manifest forms, DOX/API, and workflow proof text preserve the bounded artifact contract"

if [[ "$FAILURES" -ne 0 ]]; then
  printf 'see image compare: %s failure(s)\n' "$FAILURES" >&2
  exit 1
fi

printf 'see image compare: all hermetic checks passed\n'

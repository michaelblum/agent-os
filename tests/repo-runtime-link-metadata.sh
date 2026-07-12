#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/aos-repo-runtime-link-metadata.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

/usr/bin/plutil -lint "$ROOT/packaging/RepoRuntimeLinkInfo.plist" >/dev/null
if /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$ROOT/packaging/RepoRuntimeLinkInfo.plist" >/dev/null 2>&1; then
  echo "FAIL: raw-runtime link metadata must not set a bundle identifier" >&2
  exit 1
fi

cat > "$TMP/main.swift" <<'SWIFT'
@main
struct Main {
    static func main() {}
}
SWIFT

swiftc -parse-as-library "$TMP/main.swift" \
  -Xlinker -sectcreate \
  -Xlinker __TEXT \
  -Xlinker __info_plist \
  -Xlinker "$ROOT/packaging/RepoRuntimeLinkInfo.plist" \
  -o "$TMP/aos"

LINKED_SECTIONS="$(/usr/bin/otool -l "$TMP/aos")"
grep -q 'sectname __info_plist' <<<"$LINKED_SECTIONS"
/usr/bin/otool -X -s __TEXT __info_plist "$TMP/aos" > "$TMP/embedded-info.hex"
python3 - "$TMP/embedded-info.hex" "$TMP/embedded-info.plist" <<'PY'
from pathlib import Path
import sys

raw = bytearray()
for line in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    for word in line.split()[1:]:
        raw.extend(bytes.fromhex(word)[::-1])
Path(sys.argv[2]).write_bytes(bytes(raw).rstrip(b"\0"))
PY
/usr/bin/plutil -lint "$TMP/embedded-info.plist" >/dev/null
[[ "$(/usr/libexec/PlistBuddy -c 'Print :NSMicrophoneUsageDescription' "$TMP/embedded-info.plist")" == \
  "AOS uses microphone input only when you explicitly start voice capture." ]]

SIGNATURE="$(/usr/bin/codesign -dv --verbose=4 "$TMP/aos" 2>&1)"
grep -q '^Identifier=aos$' <<<"$SIGNATURE"
grep -q 'flags=.*adhoc,linker-signed' <<<"$SIGNATURE"
grep -q '^Signature=adhoc$' <<<"$SIGNATURE"
grep -q '^TeamIdentifier=not set$' <<<"$SIGNATURE"

echo "repo runtime link metadata passed"

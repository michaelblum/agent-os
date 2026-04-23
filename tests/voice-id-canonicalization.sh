#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# Each ./aos voice _internal-* call is wrapped in `|| true` so that a
# non-zero exit (including "unknown subcommand" during the red phase)
# does NOT abort the script before the assertion below it can fire.
# Without this, `set -euo pipefail` short-circuits the assignment and
# the script exits 1 with no diagnostic - defeating the whole point
# of having a FAIL message per assertion.

# Round-trip make/parse via voice-id-roundtrip helper baked into ./aos for tests.
out=$(./aos voice _internal-id-roundtrip --provider system --suffix com.apple.voice.premium.en-US.Ava 2>&1 || true)
expected="voice://system/com.apple.voice.premium.en-US.Ava|system|com.apple.voice.premium.en-US.Ava"
if [[ "$out" != "$expected" ]]; then
  echo "FAIL: round-trip mismatch: got=$out want=$expected" >&2
  exit 1
fi

# Different providers, same suffix → distinct URIs.
a=$( { ./aos voice _internal-id-roundtrip --provider system --suffix shared-id 2>&1 || true; } | cut -d'|' -f1)
b=$( { ./aos voice _internal-id-roundtrip --provider elevenlabs --suffix shared-id 2>&1 || true; } | cut -d'|' -f1)
[[ "$a" != "$b" ]] || { echo "FAIL: collision across providers (a=$a b=$b)" >&2; exit 1; }

# Bare id → canonicalize upgrades to system URI.
got=$(./aos voice _internal-canonicalize --id com.apple.voice.premium.en-US.Ava 2>&1 || true)
want="voice://system/com.apple.voice.premium.en-US.Ava"
[[ "$got" == "$want" ]] || { echo "FAIL: canonicalize bare id: got=$got want=$want" >&2; exit 1; }

# Already-canonical → unchanged.
got=$(./aos voice _internal-canonicalize --id voice://elevenlabs/abc 2>&1 || true)
[[ "$got" == "voice://elevenlabs/abc" ]] || { echo "FAIL: canonicalize URI passthrough: got=$got" >&2; exit 1; }

# Suffix containing slash survives round-trip.
out=$(./aos voice _internal-id-roundtrip --provider system --suffix "with/slash" 2>&1 || true)
expected="voice://system/with/slash|system|with/slash"
[[ "$out" == "$expected" ]] || { echo "FAIL: suffix-with-slash: got=$out want=$expected" >&2; exit 1; }

# Invalid forms → exit code 2 with VOICE_ID_INVALID.
for bad in "voice://" "voice://foo" "voice:foo/bar" ""; do
  if ./aos voice _internal-id-roundtrip --raw "$bad" 2>/dev/null; then
    echo "FAIL: expected rejection for '$bad'" >&2
    exit 1
  fi
done

echo "ok"

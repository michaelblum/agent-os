#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d -t aos-gate-records-runtime-mode)"
trap 'rm -rf "$TMP"' EXIT

APP_BIN="$TMP/AOS.app/Contents/MacOS/aos"
mkdir -p "$(dirname "$APP_BIN")"
cp "$ROOT/aos" "$APP_BIN"
chmod +x "$APP_BIN"

OUT="$(
  cd "$ROOT"
  env -u AOS_RUNTIME_MODE AOS_STATE_ROOT="$TMP/state" "$APP_BIN" gate records --json
)"

node - "$OUT" "$TMP/state" <<'NODE'
const payload = JSON.parse(process.argv[2]);
const stateRoot = process.argv[3];
const expected = `${stateRoot}/installed/gate/records.jsonl`;
if (payload.path !== expected) {
  console.error(`expected installed gate record path ${expected}, got ${payload.path}`);
  process.exit(1);
}
NODE

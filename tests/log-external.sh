#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PREFIX="aos-log-external"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

log_pid=""
cleanup() {
  if [[ -n "$log_pid" ]]; then
    kill "$log_pid" >/dev/null 2>&1 || true
    pkill -P "$log_pid" >/dev/null 2>&1 || true
  fi
  ./aos clean >/dev/null 2>&1 || true
  rm -rf "$ROOT"
}
trap cleanup EXIT

if ./aos log push --bogus 2>"$ROOT/log-push-bogus.err"; then
  echo "FAIL: log push accepted unknown flag" >&2
  exit 1
fi
grep -q '"code":"UNKNOWN_FLAG"' "$ROOT/log-push-bogus.err" || {
  echo "FAIL: log push unknown flag did not use UNKNOWN_FLAG" >&2
  cat "$ROOT/log-push-bogus.err" >&2
  exit 1
}

if ./aos log clear --bogus 2>"$ROOT/log-clear-bogus.err"; then
  echo "FAIL: log clear accepted unknown flag" >&2
  exit 1
fi
grep -q '"code":"UNKNOWN_FLAG"' "$ROOT/log-clear-bogus.err" || {
  echo "FAIL: log clear unknown flag did not use UNKNOWN_FLAG" >&2
  cat "$ROOT/log-clear-bogus.err" >&2
  exit 1
}

if ./aos log push message --level --bogus 2>"$ROOT/log-push-level-missing.err"; then
  echo "FAIL: log push accepted missing --level value" >&2
  exit 1
fi
grep -q '"code":"MISSING_ARG"' "$ROOT/log-push-level-missing.err" || {
  echo "FAIL: log push missing --level value did not use MISSING_ARG" >&2
  cat "$ROOT/log-push-level-missing.err" >&2
  exit 1
}

if ./aos log --at --level info 2>"$ROOT/log-stream-at-missing.err"; then
  echo "FAIL: log stream accepted missing --at value" >&2
  exit 1
fi
grep -q '"code":"MISSING_ARG"' "$ROOT/log-stream-at-missing.err" || {
  echo "FAIL: log stream missing --at value did not use MISSING_ARG" >&2
  cat "$ROOT/log-stream-at-missing.err" >&2
  exit 1
}

./aos set content.roots.toolkit packages/toolkit >/dev/null

printf 'first line\n{"message":"json line","level":"warn"}\n' \
  | ./aos log --at -10000,-10000,450,300 >/tmp/aos-log-external-stream.out 2>/tmp/aos-log-external-stream.err

grep -q 'Log console active' /tmp/aos-log-external-stream.err || {
  echo "FAIL: log stream did not mount console" >&2
  cat /tmp/aos-log-external-stream.err >&2
  exit 1
}

tail -f /dev/null | ./aos log --at -10000,-10000,450,300 >/tmp/aos-log-external-active.out 2>/tmp/aos-log-external-active.err &
log_pid=$!

mounted=0
for _ in {1..80}; do
  if ./aos show exists --id __log__ --json \
      | python3 -c 'import json,sys; raise SystemExit(0 if json.load(sys.stdin).get("exists") else 1)' 2>/dev/null; then
    mounted=1
    break
  fi
  sleep 0.1
done
[[ "$mounted" == "1" ]] || {
  echo "FAIL: active log console did not appear" >&2
  cat /tmp/aos-log-external-active.err >&2 || true
  exit 1
}

push_out="$(./aos log push pushed --level warn)"
[[ "$push_out" == '{"status":"ok"}' ]] || {
  echo "FAIL: log push output mismatch: $push_out" >&2
  exit 1
}

clear_out="$(./aos log clear)"
[[ "$clear_out" == '{"status":"ok"}' ]] || {
  echo "FAIL: log clear output mismatch: $clear_out" >&2
  exit 1
}

echo "PASS"

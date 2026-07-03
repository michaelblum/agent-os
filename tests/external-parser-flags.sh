#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-external-parser-flags.XXXXXX")"
trap 'rm -rf "$STATE_ROOT"' EXIT

export AOS_STATE_ROOT="$STATE_ROOT"
export AOS_DISABLE_DAEMON_AUTOSTART=1
export AOS_BYPASS_PERMISSIONS_SETUP=1

check_unknown_flag() {
  local label="$1"
  shift
  local err="$STATE_ROOT/${label}.err"
  if "$@" 2>"$err"; then
    echo "FAIL: $label accepted unknown flag" >&2
    exit 1
  fi
  if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"UNKNOWN_FLAG"' "$err"; then
    echo "FAIL: $label did not use UNKNOWN_FLAG" >&2
    cat "$err" >&2
    exit 1
  fi
}

check_unknown_arg() {
  local label="$1"
  shift
  local err="$STATE_ROOT/${label}.err"
  if "$@" 2>"$err"; then
    echo "FAIL: $label accepted unknown argument" >&2
    exit 1
  fi
  if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"UNKNOWN_ARG"' "$err"; then
    echo "FAIL: $label did not use UNKNOWN_ARG" >&2
    cat "$err" >&2
    exit 1
  fi
}

check_missing_arg() {
  local label="$1"
  shift
  local err="$STATE_ROOT/${label}.err"
  if "$@" 2>"$err"; then
    echo "FAIL: $label accepted missing argument" >&2
    exit 1
  fi
  if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
    echo "FAIL: $label did not use MISSING_ARG" >&2
    cat "$err" >&2
    exit 1
  fi
}

check_invalid_arg() {
  local label="$1"
  shift
  local err="$STATE_ROOT/${label}.err"
  if "$@" 2>"$err"; then
    echo "FAIL: $label accepted invalid argument" >&2
    exit 1
  fi
  if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"INVALID_ARG"' "$err"; then
    echo "FAIL: $label did not use INVALID_ARG" >&2
    cat "$err" >&2
    exit 1
  fi
}

check_code() {
  local label="$1"
  local code="$2"
  shift 2
  local err="$STATE_ROOT/${label}.err"
  if "$@" 2>"$err"; then
    echo "FAIL: $label unexpectedly succeeded" >&2
    exit 1
  fi
  if ! grep -Eq "\"code\"[[:space:]]*:[[:space:]]*\"$code\"" "$err"; then
    echo "FAIL: $label did not use $code" >&2
    cat "$err" >&2
    exit 1
  fi
}

check_unknown_flag inspect ./aos inspect --bogus
check_unknown_flag status ./aos status --bogus
check_unknown_flag doctor ./aos doctor --bogus
check_unknown_flag permissions-check ./aos permissions check --bogus
check_unknown_flag permissions-preflight ./aos permissions preflight --bogus
check_unknown_flag permissions-setup ./aos permissions setup --bogus
check_unknown_flag permissions-reset-runtime ./aos permissions reset-runtime --bogus

err="$STATE_ROOT/permissions-reset-mode-missing.err"
if ./aos permissions reset-runtime --mode 2>"$err"; then
  echo "FAIL: permissions reset-runtime accepted missing --mode value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"INVALID_ARG"' "$err"; then
  echo "FAIL: permissions reset-runtime missing --mode value did not use INVALID_ARG" >&2
  cat "$err" >&2
  exit 1
fi

err="$STATE_ROOT/permissions-reset-emergency-ack-missing.err"
if ./aos permissions reset-runtime --mode repo --allow-service-reset --dry-run --json 2>"$err"; then
  echo "FAIL: permissions reset-runtime accepted service reset without emergency ack" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"EMERGENCY_ACK_REQUIRED"' "$err"; then
  echo "FAIL: permissions reset-runtime missing emergency ack did not use EMERGENCY_ACK_REQUIRED" >&2
  cat "$err" >&2
  exit 1
fi

err="$STATE_ROOT/permissions-reset-emergency-ack-alone.err"
if ./aos permissions reset-runtime --mode repo --emergency-ack-other-apps --dry-run --json 2>"$err"; then
  echo "FAIL: permissions reset-runtime accepted emergency ack without service reset" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"INVALID_ARG"' "$err"; then
  echo "FAIL: permissions reset-runtime emergency ack alone did not use INVALID_ARG" >&2
  cat "$err" >&2
  exit 1
fi
err="$STATE_ROOT/inspect-at-missing.err"
if ./aos inspect --at --size 10,10 2>"$err"; then
  echo "FAIL: inspect accepted missing --at value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: inspect missing --at value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi

err="$STATE_ROOT/inspect-size-missing.err"
if ./aos inspect --size --at 0,0 2>"$err"; then
  echo "FAIL: inspect accepted missing --size value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: inspect missing --size value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi

check_unknown_flag show-exists ./aos show exists --id parser-test --bogus
check_unknown_flag show-get ./aos show get --id parser-test --bogus
check_unknown_flag do-profiles-root ./aos do profiles --bogus
check_unknown_flag do-profiles ./aos do profiles natural --bogus
check_unknown_arg do-profiles-list-extra ./aos do profiles list unexpected
check_unknown_flag do-native-click ./aos do click 10,10 --bogus
check_unknown_arg do-native-click-extra ./aos do click 10,10 unexpected --dry-run
err="$STATE_ROOT/do-native-scroll-dx-missing.err"
if ./aos do scroll 10,10 --dx --dy 1 --dry-run 2>"$err"; then
  echo "FAIL: do native scroll accepted missing --dx value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: do native scroll missing --dx value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi
check_unknown_arg do-native-drag-extra ./aos do drag 10,10 20,20 unexpected --dry-run
check_unknown_flag do-native-drag-by-flag ./aos do drag 10,10 20,20 --by 1,1 --dry-run
check_unknown_flag do-native-drag-to-value-flag ./aos do drag 10,10 20,20 --to-value 0.7 --dry-run
check_unknown_arg do-native-scroll-extra ./aos do scroll 10,10 unexpected --dx 0 --dy 1 --dry-run
check_unknown_arg do-native-type-extra ./aos do type hello unexpected --dry-run
check_unknown_arg do-native-key-extra ./aos do key Enter unexpected --dry-run
err="$STATE_ROOT/do-native-click-dwell-invalid.err"
if ./aos do click 10,10 --dwell nope --dry-run 2>"$err"; then
  echo "FAIL: do native click accepted invalid --dwell value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"INVALID_ARG"' "$err"; then
  echo "FAIL: do native click invalid --dwell value did not use INVALID_ARG" >&2
  cat "$err" >&2
  exit 1
fi
err="$STATE_ROOT/do-native-drag-speed-invalid.err"
if ./aos do drag 10,10 20,20 --speed fast --dry-run 2>"$err"; then
  echo "FAIL: do native drag accepted invalid --speed value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"INVALID_ARG"' "$err"; then
  echo "FAIL: do native drag invalid --speed value did not use INVALID_ARG" >&2
  cat "$err" >&2
  exit 1
fi
check_missing_arg do-canvas-drag-mode-missing ./aos do drag canvas:fixture/drag-handle --dry-run
check_invalid_arg do-canvas-drag-both-modes ./aos do drag canvas:fixture/drag-handle --by 1,1 --to-value 0.7 --dry-run
check_unknown_flag do-canvas-drag-speed ./aos do drag canvas:fixture/drag-handle --by 1,1 --speed 600 --dry-run
check_code do-canvas-drag-playback-invalid INVALID_PLAYBACK ./aos do drag canvas:fixture/drag-handle --by 1,1 --playback robot --dry-run
err="$STATE_ROOT/do-native-scroll-dy-invalid.err"
if ./aos do scroll 10,10 --dy nope --dry-run 2>"$err"; then
  echo "FAIL: do native scroll accepted invalid --dy value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"INVALID_ARG"' "$err"; then
  echo "FAIL: do native scroll invalid --dy value did not use INVALID_ARG" >&2
  cat "$err" >&2
  exit 1
fi
err="$STATE_ROOT/do-native-type-delay-invalid.err"
if ./aos do type hello --delay slow --dry-run 2>"$err"; then
  echo "FAIL: do native type accepted invalid --delay value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"INVALID_ARG"' "$err"; then
  echo "FAIL: do native type invalid --delay value did not use INVALID_ARG" >&2
  cat "$err" >&2
  exit 1
fi
check_missing_arg do-native-press-pid-missing ./aos do press --dry-run
check_missing_arg do-native-press-pid-invalid ./aos do press --pid nope --dry-run
check_missing_arg do-native-press-role-missing ./aos do press --pid 123 --dry-run
check_unknown_arg do-native-press-extra-positional ./aos do press stray --pid 123 --role AXButton --dry-run
check_missing_arg do-native-set-value-pid-missing ./aos do set-value --role AXTextField --value hello --dry-run
check_missing_arg do-native-set-value-pid-invalid ./aos do set-value --pid nope --role AXTextField --value hello --dry-run
check_missing_arg do-native-set-value-role-missing ./aos do set-value --pid 123 --value hello --dry-run
check_missing_arg do-native-set-value-value-missing ./aos do set-value --pid 123 --role AXTextField --dry-run
check_invalid_arg do-native-set-value-both-value-sources ./aos do set-value --pid 123 --role AXTextField hello --value world --dry-run
check_invalid_arg do-native-set-value-canvas-both-value-sources ./aos do set-value canvas:fixture/slider hello --value world --dry-run
check_invalid_arg do-native-set-value-canvas-both-target-sources ./aos do set-value canvas:fixture/slider --pid 123 --role AXTextField --value hello --dry-run
check_missing_arg do-native-focus-role-missing ./aos do focus --pid 123 --dry-run
check_missing_arg do-native-focus-pid-invalid ./aos do focus --pid nope --role AXTextField --dry-run
check_unknown_arg do-native-focus-extra-positional ./aos do focus stray --pid 123 --role AXTextField --dry-run
check_missing_arg do-native-raise-pid-missing ./aos do raise --dry-run
check_missing_arg do-native-raise-pid-invalid ./aos do raise --pid nope --dry-run
check_unknown_arg do-native-raise-extra-positional ./aos do raise stray --pid 123 --dry-run
err="$STATE_ROOT/do-native-raise-window-invalid.err"
if ./aos do raise --pid 123 --window nope --dry-run 2>"$err"; then
  echo "FAIL: do native raise accepted invalid --window value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"INVALID_ARG"' "$err"; then
  echo "FAIL: do native raise invalid --window value did not use INVALID_ARG" >&2
  cat "$err" >&2
  exit 1
fi
check_missing_arg do-native-move-to-missing ./aos do move --pid 123 --dry-run
check_missing_arg do-native-move-pid-invalid ./aos do move --pid nope --to 1,2 --dry-run
check_unknown_arg do-native-move-extra-positional ./aos do move stray --pid 123 --to 1,2 --dry-run
err="$STATE_ROOT/do-native-move-to-invalid.err"
if ./aos do move --pid 123 --to 1x2 --dry-run 2>"$err"; then
  echo "FAIL: do native move accepted invalid --to value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"INVALID_ARG"' "$err"; then
  echo "FAIL: do native move invalid --to value did not use INVALID_ARG" >&2
  cat "$err" >&2
  exit 1
fi
check_missing_arg do-native-resize-to-missing ./aos do resize --pid 123 --dry-run
check_missing_arg do-native-resize-pid-invalid ./aos do resize --pid nope --to 300,200 --dry-run
check_unknown_arg do-native-resize-extra-positional ./aos do resize stray --pid 123 --to 300,200 --dry-run
check_missing_arg do-native-tell-script-missing ./aos do tell Finder --dry-run
check_unknown_flag see-observe ./aos see observe --bogus
check_unknown_arg see-observe-extra ./aos see observe unexpected
check_unknown_flag see-cursor-unknown-flag ./aos see cursor --bogus
check_unknown_arg see-cursor-extra ./aos see cursor unexpected
check_unknown_flag see-list-unknown-flag ./aos see list --bogus
check_unknown_arg see-list-extra ./aos see list unexpected
check_unknown_flag see-selection-unknown-flag ./aos see selection --bogus
check_unknown_arg see-selection-extra ./aos see selection unexpected
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { parseCaptureArgs } from './scripts/lib/agent-workspace/capture.mjs';

const parsed = parseCaptureArgs(['main', '--format', 'jpeg']);
assert.deepEqual(parsed.errors, [], 'workspace capture parser must delegate primitive --format jpeg grammar to Swift');
assert.deepEqual(parsed.passthrough, ['main', '--format', 'jpeg']);
assert.equal(parsed.target, 'main');

const { readFileSync } = await import('node:fs');
const help = JSON.parse(readFileSync('./manifests/commands/aos-commands.json', 'utf8'));
const see = help.commands.find((command) => command.path.join(' ') === 'see');
const capture = see.forms.find((form) => form.id === 'see-capture');
const format = capture.args.find((arg) => arg.token === '--format');
assert.deepEqual(
  new Set(format.value_type.enum.map((item) => item.value)),
  new Set(['png', 'jpg', 'jpeg', 'heic']),
  'see capture help must document the primitive jpeg format alias'
);
JS
check_code see-capture-unknown-flag UNKNOWN_OPTION ./aos see capture main --bogus
check_code see-capture-extra UNKNOWN_OPTION ./aos see capture main unexpected
check_missing_arg see-capture-out-missing ./aos see capture main --out
check_missing_arg see-capture-region-missing ./aos see capture main --region
check_missing_arg see-capture-draw-rect-color-missing ./aos see capture main --draw-rect 1,2,3,4
err="$STATE_ROOT/see-capture-radius-invalid.err"
if ./aos see capture mouse --radius nope 2>"$err"; then
  echo "FAIL: see capture accepted invalid --radius value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"INVALID_ARG"' "$err"; then
  echo "FAIL: see capture invalid --radius value did not use INVALID_ARG" >&2
  cat "$err" >&2
  exit 1
fi
err="$STATE_ROOT/see-capture-grid-invalid.err"
if ./aos see capture main --grid 4by3 2>"$err"; then
  echo "FAIL: see capture accepted invalid --grid value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"INVALID_ARG"' "$err"; then
  echo "FAIL: see capture invalid --grid value did not use INVALID_ARG" >&2
  cat "$err" >&2
  exit 1
fi
err="$STATE_ROOT/see-capture-format-invalid.err"
if ./aos see capture main --format gif 2>"$err"; then
  echo "FAIL: see capture accepted invalid --format value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"INVALID_FORMAT"' "$err"; then
  echo "FAIL: see capture invalid --format value did not use INVALID_FORMAT" >&2
  cat "$err" >&2
  exit 1
fi
if ! python3 - "$err" <<'PY'
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
if "Use png, jpg/jpeg, or heic." not in data.get("error", ""):
    raise SystemExit(1)
PY
then
  echo "FAIL: see capture invalid --format value did not document jpeg alias" >&2
  cat "$err" >&2
  exit 1
fi
err="$STATE_ROOT/see-capture-quality-invalid.err"
if ./aos see capture main --quality ultra 2>"$err"; then
  echo "FAIL: see capture accepted invalid --quality value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"INVALID_QUALITY"' "$err"; then
  echo "FAIL: see capture invalid --quality value did not use INVALID_QUALITY" >&2
  cat "$err" >&2
  exit 1
fi
err="$STATE_ROOT/see-capture-region-canvas-conflict.err"
if ./aos see capture --region 0,0,10,10 --canvas parser-canvas 2>"$err"; then
  echo "FAIL: see capture accepted conflicting --region and --canvas" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"INVALID_ARG"' "$err"; then
  echo "FAIL: see capture conflicting selectors did not use INVALID_ARG" >&2
  cat "$err" >&2
  exit 1
fi
check_unknown_flag focus-list ./aos focus list --bogus
check_unknown_arg focus-list-extra ./aos focus list unexpected
check_unknown_flag focus-create ./aos focus create --id parser-focus --window 1 --bogus
check_unknown_arg focus-create-extra ./aos focus create --id parser-focus --window 1 unexpected
check_unknown_flag graph-displays ./aos graph displays --bogus
check_unknown_arg graph-displays-extra ./aos graph displays unexpected
check_unknown_flag graph-windows ./aos graph windows --bogus
check_unknown_arg graph-windows-extra ./aos graph windows unexpected
check_unknown_flag graph-deepen ./aos graph deepen --id parser-node --bogus
check_unknown_flag graph-collapse-subtree ./aos graph collapse --id parser-node --subtree-role button
check_unknown_arg service-status-extra ./aos service status unexpected
check_unknown_arg service-verify-extra ./aos service _verify-readiness unexpected
err="$STATE_ROOT/service-status-mode-invalid.err"
if ./aos service status --mode current 2>"$err"; then
  echo "FAIL: service status accepted invalid --mode value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"INVALID_ARG"' "$err"; then
  echo "FAIL: service status invalid --mode value did not use INVALID_ARG" >&2
  cat "$err" >&2
  exit 1
fi
check_unknown_arg reset-extra ./aos reset unexpected
err="$STATE_ROOT/reset-mode-invalid.err"
if ./aos reset --mode temporary 2>"$err"; then
  echo "FAIL: reset accepted invalid --mode value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"INVALID_ARG"' "$err"; then
  echo "FAIL: reset invalid --mode value did not use INVALID_ARG" >&2
  cat "$err" >&2
  exit 1
fi
check_unknown_arg ops-list-extra ./aos ops list unexpected
check_unknown_arg ops-explain-extra ./aos ops explain runtime/status-snapshot unexpected
check_unknown_flag tell-unknown-flag ./aos tell channel --bogus hello
check_unknown_arg tell-who-extra ./aos tell --who unexpected
err="$STATE_ROOT/tell-json-missing.err"
if ./aos tell channel --json --from tester 2>"$err"; then
  echo "FAIL: tell accepted missing --json value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: tell missing --json value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi
err="$STATE_ROOT/tell-from-missing.err"
if ./aos tell channel --from --json '{"ok":true}' 2>"$err"; then
  echo "FAIL: tell accepted missing --from value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: tell missing --from value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi
check_unknown_flag listen-unknown-flag ./aos listen channel --bogus
check_unknown_arg listen-extra ./aos listen channel unexpected
check_unknown_arg listen-channels-extra ./aos listen --channels unexpected
err="$STATE_ROOT/tell-register-role-invalid.err"
if ./aos tell --register --session-id parser-test --role admin 2>"$err"; then
  echo "FAIL: tell register accepted invalid --role value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"INVALID_ARG"' "$err"; then
  echo "FAIL: tell register invalid --role value did not use INVALID_ARG" >&2
  cat "$err" >&2
  exit 1
fi
err="$STATE_ROOT/listen-limit-missing.err"
if ./aos listen channel --limit --since 1 2>"$err"; then
  echo "FAIL: listen accepted missing --limit value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: listen missing --limit value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi
err="$STATE_ROOT/listen-session-missing.err"
if ./aos listen --session-id --limit 1 2>"$err"; then
  echo "FAIL: listen accepted missing --session-id value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: listen missing --session-id value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi

err="$STATE_ROOT/see-observe-depth-missing.err"
if ./aos see observe --depth --rate on-settle 2>"$err"; then
  echo "FAIL: see observe accepted missing --depth value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: see observe missing --depth value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi

err="$STATE_ROOT/see-observe-rate-missing.err"
if ./aos see observe --rate --depth 2 2>"$err"; then
  echo "FAIL: see observe accepted missing --rate value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"MISSING_ARG"' "$err"; then
  echo "FAIL: see observe missing --rate value did not use MISSING_ARG" >&2
  cat "$err" >&2
  exit 1
fi

err="$STATE_ROOT/see-observe-rate-invalid.err"
if ./aos see observe --rate instant 2>"$err"; then
  echo "FAIL: see observe accepted invalid --rate value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"INVALID_ARG"' "$err"; then
  echo "FAIL: see observe invalid --rate value did not use INVALID_ARG" >&2
  cat "$err" >&2
  exit 1
fi

err="$STATE_ROOT/wiki-add-type-invalid.err"
if ./aos wiki add page parser-test 2>"$err"; then
  echo "FAIL: wiki add accepted invalid type value" >&2
  exit 1
fi
if ! grep -Eq '"code"[[:space:]]*:[[:space:]]*"WIKI_INVALID_TYPE"' "$err"; then
  echo "FAIL: wiki add invalid type value did not use WIKI_INVALID_TYPE" >&2
  cat "$err" >&2
  exit 1
fi

echo "external-parser-flags: all checks passed"

#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.1.15"
export FAKE_PWCLI_MODE="new"
export AOS_STATE_ROOT="$(mktemp -d)"
trap 'rm -rf "$AOS_STATE_ROOT"' EXIT
PW_PACKAGE="$AOS_STATE_ROOT/node_modules/@playwright/cli"
mkdir -p "$PW_PACKAGE"
cp "$FIX/playwright-cli" "$PW_PACKAGE/playwright-cli"
printf '%s\n' '{"name":"@playwright/cli","version":"0.1.15"}' > "$PW_PACKAGE/package.json"
export AOS_PLAYWRIGHT_CLI="$PW_PACKAGE/playwright-cli"
node --input-type=module - <<'NODE'
import { recordBrowserCaptureGeneration } from './scripts/lib/target-handle-runtime.mjs'
import { resolveReviewedObservationRuntime } from './scripts/lib/playwright-cli-runtime.mjs'
const runtime = resolveReviewedObservationRuntime()
if (runtime.status !== 'ok') throw new Error(runtime.error)
recordBrowserCaptureGeneration(
  'todo',
  { state_id: 'see_fill123', elements: [{ ref: 'e21' }] },
  process.env,
  runtime.observation_identity,
)
NODE

# Non-browser target errors
if out=$(node scripts/aos-do-browser.mjs fill 500,300 "hello" 2>&1); then
    echo "FAIL non-browser: expected error, got: $out" >&2; exit 1
fi
echo "$out" | grep -q "BROWSER_ONLY" || { echo "FAIL non-browser code: $out" >&2; exit 1; }

# Browser Observation Refs require their original state.
if out=$(node scripts/aos-do-browser.mjs fill "browser:todo/e21" "hello world" 2>&1); then
    echo "FAIL missing state: expected error, got: $out" >&2; exit 1
fi
echo "$out" | grep -q "TARGET_STATE_REQUIRED" || { echo "FAIL missing state code: $out" >&2; exit 1; }

# The current Playwright CLI cannot atomically bind ref resolution to the
# captured generation, so validated Observation Ref effects stay fail-closed.
if out=$(node scripts/aos-do-browser.mjs fill "browser:todo/e21" "hello world" --state-id see_fill123 2>&1); then
    echo "FAIL browser identity blocker: expected error, got: $out" >&2; exit 1
fi
echo "$out" | grep -q "TARGET_ACTION_UNSUPPORTED" \
    || { echo "FAIL browser identity blocker code: $out" >&2; exit 1; }
echo "$out" | grep -q "browser_observation_identity_unproven" \
    || { echo "FAIL browser identity blocker reason: $out" >&2; exit 1; }

# Missing text errors
if out=$(node scripts/aos-do-browser.mjs fill "browser:todo/e21" 2>&1); then
    if echo "$out" | grep -q '"status":"success"'; then
        echo "FAIL missing text: expected error" >&2; exit 1
    fi
fi

if out=$(node scripts/aos-do-browser.mjs fill "browser:todo/e21" "hello" unexpected 2>&1); then
    echo "FAIL extra positional: expected error, got: $out" >&2; exit 1
fi
echo "$out" | grep -Eq '"code"[[:space:]]*:[[:space:]]*"UNKNOWN_ARG"' \
    || { echo "FAIL extra positional code: $out" >&2; exit 1; }

# Missing ref errors cleanly (fill requires a ref to know which element)
if out=$(node scripts/aos-do-browser.mjs fill "browser:todo" "hello" 2>&1); then
    if echo "$out" | grep -q '"status":"success"'; then
        echo "FAIL missing ref: expected error" >&2; exit 1
    fi
fi

echo "PASS"

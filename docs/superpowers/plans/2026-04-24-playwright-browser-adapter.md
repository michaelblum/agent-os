# Playwright Browser Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a browser tab a first-class target for `aos see capture`, `aos do <action>`, and `aos show create|update --anchor-browser …` using Microsoft's `playwright-cli` as a subprocess, with attach-mode as the primary co-presence path and no changes to the daemon IPC schema.

**Architecture:** New `src/browser/` Swift subtree owns subprocess orchestration, target parsing, session registry, snapshot parsing, and static anchor resolution. Existing `see capture`, `do <verb>`, `show create/update`, and `focus create/list/remove` paths get dispatch on target shape — macOS targets keep their existing paths untouched. `AXElementJSON.bounds` becomes optional to accommodate `--xray`-fast-path browser output without bounds.

**Tech Stack:** Swift 5 under `src/`, subprocess invocation of `@playwright/cli` (Node-based CLI installed globally), shell integration tests under `tests/browser/`, markdown golden fixtures for snapshot parsing.

**Spec:** `docs/superpowers/specs/2026-04-24-playwright-browser-adapter-design.md`

---

## Decisions Locked Before Implementation

These answer the spec's nine Open Questions. The plan proceeds against these; revisions require an explicit change order.

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Unified `src/browser/` subtree (not split across perceive/act/display). | Cross-cutting adapter; single-file edits cheaper than three-directory touch per change. |
| 2 | Default attach mode is `--extension` when no sub-flag is passed to `--target browser://attach`. | Friendliest user setup; does not require user to launch Chrome with `--remote-debugging-port`. |
| 3 | Minimum `@playwright/cli` version pinned by Task 3's probe to the current stable release that exposes `attach --extension` AND `attach --cdp`. Recorded in `src/browser/playwright-version-check.swift` as `kMinPlaywrightCLIVersion`. | Version drift is a known hazard; pin at execution time. |
| 4 | Launched sessions default to `--headed`. `--headless` is opt-in. | Matches v1 co-presence primary mode and enables `show` anchoring (headless has no CGWindowID). |
| 5 | Content-viewport geometry source: AX-descendant first, per-session calibration fallback (`eval getBoundingClientRect()` compared to AX window frame of a known-positioned element). No CDP via `run-code` in v1 internal code. | Fewest escape-hatch couplings; calibration covers Chrome versions that don't expose the content area as a child AX window. |
| 6 | No auto-rehydration of sessions across aos CLI restarts. User re-runs `aos focus create --id <name> --target browser://attach --extension`; if a `playwright-cli -s=<name>` session already exists, attach re-binds to it. | Sidesteps stale-state detection; avoids surprises. |
| 7 | Concurrency: `playwright-cli` serializes within its own session-process. aos adds no coordination. | Matches the rest of aos (`aos do` CGEvents are not aos-coordinated either). Document in skill. |
| 8 | Bounds for `--xray --label`: N+1 `eval` calls in v1. Batched `run-code` helper deferred to follow-up. | Acceptable perf for opt-in slow path; keeps v1 scope tight. |
| 9 | Snapshot markdown grammar pinned to the minimum version from #3; golden fixtures in `tests/browser/fixtures/`. Parser skips unknown lines for forward-compat. | Fast detection of upstream changes; doesn't break when new snapshot line types appear. |

---

## File Structure

New files under `src/browser/`:
- `browser-adapter.swift` — top-level orchestrator. Routes incoming `see`/`do`/`show`/`focus` calls to the right helper.
- `playwright-process.swift` — subprocess spawner. Handles `-s=<session>` flag, `--filename=<tmp>` for snapshot/screenshot, stderr capture, exit-code translation to aos error codes.
- `target-parser.swift` — parses `browser:` / `browser:<session>` / `browser:<session>/<ref>`. Resolves bare `browser:` via `PLAYWRIGHT_CLI_SESSION`.
- `snapshot-parser.swift` — consumes `playwright-cli snapshot` markdown file, emits `[AXElementJSON]` with refs. Walks indentation to recover `context_path`. Skips unknown lines.
- `session-registry.swift` — reads/writes the CLI-local JSON registry under `${AOS_STATE_ROOT}/{mode}/browser/sessions.json`. Provides `list()`, `add()`, `remove()`, `findByID()`.
- `anchor-resolver.swift` — `browser:<s>/<ref>` → `(CGWindowID, CGRect offset)`. Resolves Chrome window via macOS AX + `playwright-cli eval getBoundingClientRect()`. Errors cleanly when browser is not local (headless / remote CDP).
- `playwright-version-check.swift` — runs `playwright-cli --version`, compares to `kMinPlaywrightCLIVersion`. Errors with install/upgrade message when stale or missing.
- `CLAUDE.md` — subtree-local guidance.

Edited files:
- `src/perceive/models.swift` — `AXElementJSON.bounds` changes from `BoundsJSON` to `BoundsJSON?`. `ref: String?` added.
- `src/perceive/capture-pipeline.swift` — dispatch browser targets to `BrowserAdapter.seeCapture(...)`. Update `buildAnnotations` (line 740) to `compactMap` nil-bounds. Update `--label` entry points at lines 2096 and 2256.
- `src/perceive/focus-commands.swift` — add `--target` parsing in `focusCreateCommand`, merged list in `focusListCommand`, registry-first dispatch in `focusRemoveCommand`.
- `src/act/act-cli.swift` (+ helpers) — dispatch existing `do` verbs (`click`, `hover`, `drag`, `scroll`, `type`, `key`) on `browser:` targets. Add `cliFill`, `cliNavigate`.
- `src/main.swift` — add `case "fill":` and `case "navigate":` in the `do` switch at line 149.
- `src/display/client.swift` — add `--anchor-browser <browser:…>` to `parseCanvasMutationOptions` for `show create` and `show update`.
- `src/shared/command-registry-data.swift` — register new forms: `do fill`, `do navigate`, `show create --anchor-browser`, `show update --anchor-browser`, `focus create --target`.
- `shared/schemas/annotation.md` — update line 48 wording: `bounds` is always present for macOS xray; present for browser xray with `--label`; absent for browser xray without `--label`.
- `ARCHITECTURE.md` — one-paragraph note that browser joins macOS as a supported target medium via the `src/browser/` adapter.

New test files under `tests/browser/`:
- `fixtures/snapshot-simple.md` — golden: tiny page with button + link + input.
- `fixtures/snapshot-nested.md` — golden: deep DOM hierarchy for `context_path` verification.
- `fixtures/snapshot-disabled.md` — golden: disabled element to verify `enabled=false` parsing.
- `target-parser.test.sh` — exercises the target-string parser via hidden `./aos browser _parse-target <s>` debug command.
- `snapshot-parser.test.sh` — feeds fixtures through hidden `./aos browser _parse-snapshot <file>` debug command, diffs against golden JSON.
- `version-check.test.sh` — stubs `PATH` to a fake `playwright-cli` and verifies version-check error codes.
- `registry.test.sh` — exercises the JSON registry read/write via hidden `./aos browser _registry <op> …` debug command.
- `focus-browser.test.sh` — `./aos focus create --target browser://attach --extension --id test-attach` with a fake-`playwright-cli` shim; verifies focus list includes the browser channel with `kind: "browser"`.
- `smoke.test.sh` — opt-in end-to-end test requiring a real `@playwright/cli` install; creates a launched headed session against `file:///tmp/fixture.html`, runs `see capture --xray`, `do click`, `do fill`, `show create --anchor-browser`, verifies all succeed.

New docs:
- `skills/browser-adapter/SKILL.md` — agent-facing usage guide (install, create channel, common patterns, escape hatch).

---

## Testing conventions (applies to every task)

**Build.** Rebuild `./aos` before every shell test that drives `./aos`:

```bash
bash build.sh && bash tests/browser/<name>.test.sh
```

or use the wrapper `scripts/aos-after-build` when sequencing commands.

**Fail-first for shell tests.** Each task's test script is authored first, run before implementation to confirm it fails with the expected error (e.g. `UNKNOWN_TARGET`, `UNKNOWN_SUBCOMMAND`, `MISSING_ARG`). Record the exact stderr/stdout in the task. Then implement. Re-run. Confirm pass.

**Hidden debug subcommands.** Several tasks add `./aos browser _<op>` helper commands prefixed with `_` to signal "adapter test hook, not user-facing." These are registered in `src/shared/command-registry-data.swift` but marked `internal: true` so `aos help` omits them unless `--verbose` is passed. The worker implements these alongside the primary code.

**Fake `playwright-cli` for unit-style tests.** `tests/browser/fixtures/fake-playwright-cli` is a small bash script on `$PATH` (via `PATH="$PWD/tests/browser/fixtures:$PATH"`) that emits canned stdout/stderr and returns canned exit codes based on its argv. This lets target-parser, registry, focus-browser, and version-check tests run without a real Node install.

**Smoke test needs real `@playwright/cli`.** `smoke.test.sh` runs `npm install -g @playwright/cli@latest` as a setup step and is tagged with `# requires: @playwright/cli` at the top. CI that lacks Node skips it.

**Commit cadence.** Each task ends in a commit. Commit messages follow the repo's conventional style (`feat(browser): …`, `test(browser): …`, `docs(browser): …`). No AI attribution per `AGENTS.md`.

---

## Task 1: Make `AXElementJSON.bounds` optional and update all consumers

**Rationale:** Browser xray fast path returns elements without bounds; the Swift struct must permit absence. This is a cross-contract change touching the model, one consumer function, the `--label` entry points, and the schema doc. Must land first so later tasks can build on it without compile errors.

**Files:**
- Modify: `src/perceive/models.swift:225-233`
- Modify: `src/perceive/capture-pipeline.swift:740-752` (`buildAnnotations`)
- Modify: `src/perceive/capture-pipeline.swift` (other call sites the compiler flags — likely around lines 2096 and 2256 per spec notes)
- Modify: `shared/schemas/annotation.md:46-48`
- Test: `tests/xray-label-regression.sh` (new)

- [ ] **Step 1: Write a characterization shell test that exercises the existing macOS `--xray --label` path.**

Create `tests/xray-label-regression.sh`:

```bash
#!/usr/bin/env bash
# Characterization test: macOS --xray --label path must keep working after
# AXElementJSON.bounds becomes optional.
set -euo pipefail

OUT="/tmp/aos-xray-label-regression.png"
rm -f "$OUT"

./aos see capture user_active --xray --label --out "$OUT" >/dev/null

if [[ ! -s "$OUT" ]]; then
  echo "FAIL: expected $OUT to exist and be non-empty" >&2
  exit 1
fi

# Label overlay implies buildAnnotations was called successfully
file "$OUT" | grep -q "PNG image" || { echo "FAIL: output is not a PNG" >&2; exit 1; }

echo "PASS"
```

Make executable:

```bash
chmod +x tests/xray-label-regression.sh
```

- [ ] **Step 2: Run the characterization test against current `./aos` and record that it passes.**

```bash
bash build.sh && bash tests/xray-label-regression.sh
```

Expected: `PASS`. This establishes the baseline we must preserve.

- [ ] **Step 3: Change `AXElementJSON.bounds` to optional and add `ref`.**

In `src/perceive/models.swift` replace the struct definition (lines ~225-233):

```swift
struct AXElementJSON: Encodable {
    let role: String
    let title: String?
    let label: String?
    let value: String?
    let enabled: Bool
    let context_path: [String]
    let bounds: BoundsJSON?
    let ref: String?
}
```

- [ ] **Step 4: Run `bash build.sh` and fix every resulting compile error.**

```bash
bash build.sh 2>&1 | tee /tmp/aos-build-errors.log
```

Each call site that does `element.bounds.x` (unconditional access) is now a compile error. For each one:

1. If the site is one where bounds must always be present (macOS xray path emitting elements), use a `guard let bounds = element.bounds else { continue }` to skip defensively (macOS path should never produce nil, but this is safe).
2. If the site is an initializer (e.g., constructing `AXElementJSON` from AX data), add `ref: nil` as the trailing argument — macOS path does not populate refs.
3. Update `buildAnnotations` at `capture-pipeline.swift:740` to:

```swift
func buildAnnotations(from elements: [AXElementJSON]) -> [AnnotationJSON] {
    return elements.compactMap { el -> AnnotationJSON? in
        guard let bounds = el.bounds else { return nil }
        return AnnotationJSON(
            bounds: AnnotationBoundsJSON(
                x: Double(bounds.x),
                y: Double(bounds.y),
                width: Double(bounds.width),
                height: Double(bounds.height)
            ),
            label: [el.title, el.label].compactMap { $0?.isEmpty == false ? $0 : nil }.first
        )
    }
}
```

Iterate `bash build.sh` until clean.

- [ ] **Step 5: Re-run the characterization test.**

```bash
bash tests/xray-label-regression.sh
```

Expected: `PASS`. No behavior change on macOS xray + label.

- [ ] **Step 6: Update the annotation schema doc.**

In `shared/schemas/annotation.md` replace the "Relationship to `aos see --xray`" section (around line 46-48) with:

```markdown
## Relationship to `aos see --xray`

`--xray` returns a flat array of interactive UI elements with `role`, `title`, `label`, `value`, `enabled`, `context_path`, and (for macOS-sourced elements or browser-sourced elements captured with `--label`) `bounds`. Browser-sourced elements captured with `--xray` alone carry a `ref` identifier instead of `bounds`; their geometry is fetched per-element on demand when `--label` is passed.

`--label` converts annotatable elements (those with `bounds`) into the annotation schema format, using the AX element's `title` or `label` as the annotation label. Elements without `bounds` are silently skipped by `buildAnnotations`. The annotation array is a strict subset of the xray data — just `bounds` + `label`.
```

- [ ] **Step 7: Commit.**

```bash
git add src/perceive/models.swift src/perceive/capture-pipeline.swift shared/schemas/annotation.md tests/xray-label-regression.sh
git commit -m "refactor(xray): make AXElementJSON.bounds optional, add ref field

Prepares the xray contract to accept browser-sourced elements without
bounds (fast --xray path) while preserving the macOS path unchanged.
buildAnnotations now compactMaps nil-bounds elements. Characterization
test exercises the existing --xray --label flow to guard against
regressions."
```

---

## Task 2: Create `src/browser/` subtree skeleton and `target-parser.swift`

**Rationale:** Every downstream task consumes the target parser. Ship it first so the rest of the work can import it.

**Files:**
- Create: `src/browser/target-parser.swift`
- Create: `src/browser/CLAUDE.md`
- Modify: `src/main.swift` (register hidden `browser _parse-target` debug subcommand)
- Modify: `src/shared/command-registry-data.swift` (register the debug form with `internal: true`)
- Create: `tests/browser/target-parser.test.sh`

- [ ] **Step 1: Write the failing shell test.**

```bash
mkdir -p tests/browser
```

Create `tests/browser/target-parser.test.sh`:

```bash
#!/usr/bin/env bash
# Exercises src/browser/target-parser.swift via the hidden _parse-target helper.
set -euo pipefail

assert_parse() {
    local input="$1" expected_json="$2"
    local actual
    actual=$(./aos browser _parse-target "$input" 2>&1)
    if [[ "$actual" != "$expected_json" ]]; then
        echo "FAIL: input '$input'" >&2
        echo "  expected: $expected_json" >&2
        echo "  actual:   $actual" >&2
        exit 1
    fi
}

assert_error() {
    local input="$1" expected_code="$2"
    local actual
    if actual=$(./aos browser _parse-target "$input" 2>&1); then
        echo "FAIL: input '$input' — expected error but got success: $actual" >&2
        exit 1
    fi
    if ! echo "$actual" | grep -q "\"code\":\"$expected_code\""; then
        echo "FAIL: input '$input' — expected code $expected_code, got: $actual" >&2
        exit 1
    fi
}

# Happy paths
assert_parse "browser:todo" '{"session":"todo","ref":null}'
assert_parse "browser:todo-app/e21" '{"session":"todo-app","ref":"e21"}'
assert_parse "browser:todo-app/e34" '{"session":"todo-app","ref":"e34"}'

# Bare browser: with env var
PLAYWRIGHT_CLI_SESSION="default-sess" assert_parse "browser:" '{"session":"default-sess","ref":null}'

# Bare browser: without env var -> error
unset PLAYWRIGHT_CLI_SESSION
assert_error "browser:" "MISSING_SESSION"

# Malformed inputs -> INVALID_TARGET
assert_error "browser" "INVALID_TARGET"
assert_error "browser://todo" "INVALID_TARGET"
assert_error "browser:todo/" "INVALID_TARGET"
assert_error "browser:todo/e21/extra" "INVALID_TARGET"
assert_error "" "INVALID_TARGET"

# Session names with hyphens, underscores, digits allowed
assert_parse "browser:todo_app-v2/e1" '{"session":"todo_app-v2","ref":"e1"}'

echo "PASS"
```

```bash
chmod +x tests/browser/target-parser.test.sh
```

- [ ] **Step 2: Run the test and confirm it fails.**

```bash
bash tests/browser/target-parser.test.sh 2>&1 | head -5
```

Expected: failure with something like `Unknown subcommand: browser` (current `./aos` does not have a `browser` verb). Record the exact error.

- [ ] **Step 3: Implement `src/browser/target-parser.swift`.**

```swift
// target-parser.swift — Parse browser:<session>[/<ref>] target strings.
//
// Grammar:
//     browser:                     -> session resolved from PLAYWRIGHT_CLI_SESSION env
//     browser:<session>            -> page target
//     browser:<session>/<ref>      -> element target
//
// Session names match /[A-Za-z0-9_-]+/. Refs match /[A-Za-z0-9]+/ (playwright
// refs like "e21"). No tab or frame segments in v1.

import Foundation

struct BrowserTarget: Encodable, Equatable {
    let session: String
    let ref: String?
}

enum BrowserTargetError: Error {
    case invalid(String)
    case missingSession
}

func parseBrowserTarget(_ input: String, env: [String: String] = ProcessInfo.processInfo.environment) throws -> BrowserTarget {
    guard input.hasPrefix("browser:") else {
        throw BrowserTargetError.invalid("target must start with 'browser:'")
    }
    let remainder = String(input.dropFirst("browser:".count))

    // Bare "browser:" — resolve from env
    if remainder.isEmpty {
        guard let session = env["PLAYWRIGHT_CLI_SESSION"], !session.isEmpty else {
            throw BrowserTargetError.missingSession
        }
        try validateSession(session)
        return BrowserTarget(session: session, ref: nil)
    }

    // Reject "browser://..." (common typo pattern)
    if remainder.hasPrefix("/") {
        throw BrowserTargetError.invalid("unexpected '/' after 'browser:'")
    }

    let parts = remainder.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    switch parts.count {
    case 1:
        let session = parts[0]
        try validateSession(session)
        return BrowserTarget(session: session, ref: nil)
    case 2:
        let session = parts[0], ref = parts[1]
        try validateSession(session)
        try validateRef(ref)
        return BrowserTarget(session: session, ref: ref)
    default:
        throw BrowserTargetError.invalid("too many '/' segments; v1 supports only browser:<session>[/<ref>]")
    }
}

private let sessionAllowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_-"))
private let refAllowed = CharacterSet.alphanumerics

private func validateSession(_ s: String) throws {
    guard !s.isEmpty else { throw BrowserTargetError.invalid("empty session name") }
    guard s.rangeOfCharacter(from: sessionAllowed.inverted) == nil else {
        throw BrowserTargetError.invalid("session name must match [A-Za-z0-9_-]+")
    }
}

private func validateRef(_ r: String) throws {
    guard !r.isEmpty else { throw BrowserTargetError.invalid("empty ref") }
    guard r.rangeOfCharacter(from: refAllowed.inverted) == nil else {
        throw BrowserTargetError.invalid("ref must match [A-Za-z0-9]+")
    }
}
```

- [ ] **Step 4: Register the hidden `browser _parse-target` debug subcommand.**

Add to `src/main.swift` inside the top-level switch (near the other command dispatches):

```swift
case "browser":
    handleBrowserInternal(args: Array(args.dropFirst()))
```

Create a new file `src/browser/browser-internal.swift`:

```swift
// browser-internal.swift — Hidden debug subcommands for browser adapter
// development. Registered under `aos browser _<op>`. Not user-facing.

import Foundation

func handleBrowserInternal(args: [String]) {
    guard let sub = args.first else {
        exitError("Usage: aos browser _<op> ...", code: "MISSING_ARG")
    }
    let rest = Array(args.dropFirst())
    switch sub {
    case "_parse-target":
        guard let input = rest.first else {
            exitError("Usage: aos browser _parse-target <target>", code: "MISSING_ARG")
        }
        do {
            let t = try parseBrowserTarget(input)
            let enc = JSONEncoder()
            enc.outputFormatting = [.sortedKeys]
            let data = try enc.encode(t)
            print(String(data: data, encoding: .utf8)!)
        } catch BrowserTargetError.missingSession {
            exitError("PLAYWRIGHT_CLI_SESSION not set and no session in target",
                      code: "MISSING_SESSION")
        } catch BrowserTargetError.invalid(let msg) {
            exitError("invalid target: \(msg)", code: "INVALID_TARGET")
        } catch {
            exitError("\(error)", code: "INTERNAL")
        }
    default:
        exitError("Unknown internal subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}
```

- [ ] **Step 5: Register the debug form in the command registry.**

In `src/shared/command-registry-data.swift`, add a new `CommandDescriptor` for `browser`:

```swift
CommandDescriptor(
    path: ["browser"],
    summary: "Internal browser-adapter debug helpers (not user-facing)",
    forms: [
        InvocationForm(
            id: "browser-parse-target",
            usage: "aos browser _parse-target <target>",
            args: [pos("target", "Target string to parse (e.g. 'browser:todo/e21')")],
            stdin: nil, constraints: nil,
            execution: readOnlyNoPerm,
            output: outJSON,
            examples: ["aos browser _parse-target browser:todo/e21"]
        ),
        // Additional `_<op>` forms added by later tasks.
    ]
)
```

(Use whatever `pos`, `readOnlyNoPerm`, `outJSON` helpers the existing file defines — those names match the style of the existing entries but may differ; match local conventions.)

- [ ] **Step 6: Create `src/browser/CLAUDE.md`.**

```markdown
# src/browser/ — Playwright adapter

This subtree wraps `@playwright/cli` as a subprocess so browsers become
first-class targets for aos's `see`/`do`/`show` verbs.

## Files
- `browser-adapter.swift` — top-level orchestrator
- `playwright-process.swift` — subprocess spawner (respects `-s=<session>` and `--filename=<tmp>`)
- `target-parser.swift` — `browser:<s>[/<ref>]` grammar
- `snapshot-parser.swift` — markdown-tree → AXElementJSON[]
- `session-registry.swift` — CLI-local JSON state
- `anchor-resolver.swift` — static `(CGWindowID, offset)` for `show`
- `playwright-version-check.swift` — version probe + pinned minimum
- `browser-internal.swift` — hidden `aos browser _<op>` debug subcommands

## Escape hatch
Direct `playwright-cli` calls remain supported. aos wraps the common
verbs; use `playwright-cli -s=<session> <verb>` for primitives we do not
expose (tracing, codegen, route mocking, `check`/`uncheck`/`select`,
`upload`, low-level key/mouse pairs, dialog affordances).

## Testing
Tests under `tests/browser/` use a fake `playwright-cli` on `$PATH` for
unit-style coverage; `tests/browser/smoke.test.sh` is opt-in and requires
a real install.
```

- [ ] **Step 7: Build and run the test.**

```bash
bash build.sh && bash tests/browser/target-parser.test.sh
```

Expected: `PASS`.

- [ ] **Step 8: Commit.**

```bash
git add src/browser/ src/main.swift src/shared/command-registry-data.swift tests/browser/target-parser.test.sh
git commit -m "feat(browser): add src/browser/ subtree with target parser

Parses browser:<session>[/<ref>] per spec grammar, with bare 'browser:'
resolving via PLAYWRIGHT_CLI_SESSION. Exposed via hidden
'aos browser _parse-target' debug subcommand for integration tests.
Registry marks it internal."
```

---

## Task 3: `playwright-version-check.swift` with probe-and-pin

**Rationale:** v1 requires `attach --extension` and `attach --cdp` flags. Older `@playwright/cli` (0.1.1) does not ship them. Detect at first browser invocation, fail fast with actionable install/upgrade message.

**Files:**
- Create: `src/browser/playwright-version-check.swift`
- Create: `tests/browser/fixtures/fake-playwright-cli` (shell shim)
- Create: `tests/browser/version-check.test.sh`
- Modify: `src/browser/browser-internal.swift` (add `_check-version` subcommand)
- Modify: `src/shared/command-registry-data.swift` (register debug form)

- [ ] **Step 1: Probe the currently-published `@playwright/cli` to pick a minimum.**

```bash
npx @playwright/cli@latest --version 2>&1 | tail -1
npx @playwright/cli@latest attach --help 2>&1 | head -30
```

Record the version that shows `--extension` and `--cdp` in `attach --help`. Use it as `kMinPlaywrightCLIVersion` below. If the latest version shown does not expose those flags, fall back to `npm view @playwright/cli versions --json` and walk newer releases until one does. Record the decision in the commit message.

- [ ] **Step 2: Create the fake-CLI fixture shim.**

```bash
mkdir -p tests/browser/fixtures
```

Create `tests/browser/fixtures/fake-playwright-cli`:

```bash
#!/usr/bin/env bash
# Canned responses for aos browser-adapter tests.
# Invoked as `playwright-cli <verb> [args]`. Behavior is controlled by
# FAKE_PWCLI_VERSION and FAKE_PWCLI_MODE env vars set by each test.
set -uo pipefail

VERB="${1:-}"

case "$VERB" in
    --version)
        echo "${FAKE_PWCLI_VERSION:-0.9.9}"
        exit 0
        ;;
    attach)
        if [[ "${FAKE_PWCLI_MODE:-new}" == "old" ]]; then
            echo "Unknown command: attach" >&2
            exit 1
        fi
        # New-mode attach --help output shape used by version probe
        shift
        if [[ "${1:-}" == "--help" ]]; then
            cat <<'EOF'
Usage: playwright-cli attach [options]

Options:
  --extension       connect via browser extension
  --cdp=<target>    attach to CDP endpoint
  --help            display help
EOF
            exit 0
        fi
        echo "fake attach invoked: $*"
        exit 0
        ;;
    *)
        echo "fake-playwright-cli does not implement: $VERB" >&2
        exit 2
        ;;
esac
```

```bash
chmod +x tests/browser/fixtures/fake-playwright-cli
```

Also create a symlink `tests/browser/fixtures/playwright-cli` → `fake-playwright-cli` so tests can drop a directory on `$PATH`:

```bash
ln -sf fake-playwright-cli tests/browser/fixtures/playwright-cli
```

- [ ] **Step 3: Write the failing test.**

Create `tests/browser/version-check.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"

# Case 1: happy path, new-mode CLI at current version
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"
out=$(./aos browser _check-version 2>&1)
echo "$out" | grep -q '"status":"ok"' || { echo "FAIL case 1: $out" >&2; exit 1; }

# Case 2: old-mode CLI — version too old
export FAKE_PWCLI_VERSION="0.1.1"
export FAKE_PWCLI_MODE="old"
if out=$(./aos browser _check-version 2>&1); then
    echo "FAIL case 2: expected error, got success: $out" >&2
    exit 1
fi
echo "$out" | grep -q "PLAYWRIGHT_CLI_TOO_OLD" || { echo "FAIL case 2: $out" >&2; exit 1; }

# Case 3: binary not found on PATH
unset FAKE_PWCLI_VERSION
unset FAKE_PWCLI_MODE
export PATH="/tmp/empty-$$"
mkdir -p "/tmp/empty-$$"
if out=$(./aos browser _check-version 2>&1); then
    echo "FAIL case 3: expected error, got success: $out" >&2
    exit 1
fi
echo "$out" | grep -q "PLAYWRIGHT_CLI_NOT_FOUND" || { echo "FAIL case 3: $out" >&2; exit 1; }

echo "PASS"
```

```bash
chmod +x tests/browser/version-check.test.sh
```

- [ ] **Step 4: Run — confirm failure.**

```bash
bash tests/browser/version-check.test.sh 2>&1 | head -5
```

Expected: `Unknown internal subcommand: _check-version`.

- [ ] **Step 5: Implement `src/browser/playwright-version-check.swift`.**

```swift
// playwright-version-check.swift — Detect and validate @playwright/cli.

import Foundation

// Pin from Step 1's probe. Worker: REPLACE "0.9.9" with the version you
// confirmed exposes `attach --extension` and `attach --cdp`.
let kMinPlaywrightCLIVersion = "0.9.9"

enum PlaywrightVersionError: Error {
    case notFound
    case tooOld(found: String, minimum: String)
    case probeFailed(String)
}

struct PlaywrightVersionOK: Encodable {
    let status: String  // "ok"
    let version: String
    let minimum: String
}

func probePlaywrightVersion() throws -> PlaywrightVersionOK {
    let proc = Process()
    proc.launchPath = "/usr/bin/env"
    proc.arguments = ["playwright-cli", "--version"]
    let out = Pipe(), err = Pipe()
    proc.standardOutput = out
    proc.standardError = err
    do {
        try proc.run()
    } catch {
        throw PlaywrightVersionError.notFound
    }
    proc.waitUntilExit()
    if proc.terminationStatus != 0 {
        let stderrStr = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        if stderrStr.contains("command not found") || proc.terminationStatus == 127 {
            throw PlaywrightVersionError.notFound
        }
        throw PlaywrightVersionError.probeFailed(stderrStr)
    }
    let stdout = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    let version = stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    guard compareVersions(version, kMinPlaywrightCLIVersion) >= 0 else {
        throw PlaywrightVersionError.tooOld(found: version, minimum: kMinPlaywrightCLIVersion)
    }
    return PlaywrightVersionOK(status: "ok", version: version, minimum: kMinPlaywrightCLIVersion)
}

// Semver-ish integer-by-integer compare. Pre-release suffixes (e.g. "1.2.3-rc.1")
// are dropped and the numeric part compared.
func compareVersions(_ a: String, _ b: String) -> Int {
    func parse(_ s: String) -> [Int] {
        let base = s.split(separator: "-").first.map(String.init) ?? s
        return base.split(separator: ".").compactMap { Int($0) }
    }
    let pa = parse(a), pb = parse(b)
    let n = max(pa.count, pb.count)
    for i in 0..<n {
        let ai = i < pa.count ? pa[i] : 0
        let bi = i < pb.count ? pb[i] : 0
        if ai < bi { return -1 }
        if ai > bi { return 1 }
    }
    return 0
}
```

- [ ] **Step 6: Wire `_check-version` into `browser-internal.swift`.**

Add to the `switch sub` block:

```swift
case "_check-version":
    do {
        let ok = try probePlaywrightVersion()
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        print(String(data: try enc.encode(ok), encoding: .utf8)!)
    } catch PlaywrightVersionError.notFound {
        exitError("@playwright/cli is not installed. Run: npm install -g @playwright/cli@\(kMinPlaywrightCLIVersion) or newer.",
                  code: "PLAYWRIGHT_CLI_NOT_FOUND")
    } catch PlaywrightVersionError.tooOld(let found, let min) {
        exitError("@playwright/cli \(found) is below the minimum \(min). Run: npm install -g @playwright/cli@latest.",
                  code: "PLAYWRIGHT_CLI_TOO_OLD")
    } catch PlaywrightVersionError.probeFailed(let msg) {
        exitError("Version probe failed: \(msg)", code: "PLAYWRIGHT_CLI_PROBE_FAILED")
    } catch {
        exitError("\(error)", code: "INTERNAL")
    }
```

- [ ] **Step 7: Register `_check-version` in the registry.**

In `src/shared/command-registry-data.swift`, extend the `browser` `CommandDescriptor`'s `forms` array:

```swift
InvocationForm(
    id: "browser-check-version",
    usage: "aos browser _check-version",
    args: [], stdin: nil, constraints: nil,
    execution: readOnlyNoPerm,
    output: outJSON,
    examples: ["aos browser _check-version"]
),
```

- [ ] **Step 8: Build and run test.**

```bash
bash build.sh && bash tests/browser/version-check.test.sh
```

Expected: `PASS`.

- [ ] **Step 9: Commit.**

```bash
git add src/browser/playwright-version-check.swift src/browser/browser-internal.swift src/shared/command-registry-data.swift tests/browser/version-check.test.sh tests/browser/fixtures/
git commit -m "feat(browser): add @playwright/cli version check

Probes installed playwright-cli version, fails fast with actionable
install/upgrade message when missing or below minimum. Pinned at
kMinPlaywrightCLIVersion for the release that exposes attach --extension
and attach --cdp. Fake-CLI fixture on \$PATH drives the tests."
```

---

## Task 4: `playwright-process.swift` subprocess spawner

**Rationale:** All browser-adapter calls shell out to `playwright-cli`. One helper owns subprocess semantics: argv construction (always `-s=<session>`, `--filename=<tmp>` where applicable), stdin/stdout/stderr capture, exit-code translation, temp-file lifecycle.

**Files:**
- Create: `src/browser/playwright-process.swift`
- Modify: `src/browser/browser-internal.swift` (add `_run` debug subcommand)
- Modify: `src/shared/command-registry-data.swift`
- Create: `tests/browser/process.test.sh`

- [ ] **Step 1: Write the failing test.**

Create `tests/browser/process.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"

# Case 1: simple verb passthrough
out=$(./aos browser _run --session=todo --verb=attach 2>&1)
echo "$out" | grep -q '"exit_code":0' || { echo "FAIL case 1: $out" >&2; exit 1; }
echo "$out" | grep -q '"stdout":"fake attach invoked: -s=todo"' \
    || { echo "FAIL case 1 stdout: $out" >&2; exit 1; }

# Case 2: --filename arg auto-allocation
tmp_seen=$(./aos browser _run --session=todo --verb=snapshot --with-filename 2>&1)
echo "$tmp_seen" | grep -q '"filename":"/tmp/' \
    || { echo "FAIL case 2: $tmp_seen" >&2; exit 1; }

# Case 3: nonzero exit captured
out=$(./aos browser _run --session=todo --verb=bogus 2>&1 || true)
echo "$out" | grep -q '"exit_code":2' \
    || { echo "FAIL case 3: $out" >&2; exit 1; }

echo "PASS"
```

```bash
chmod +x tests/browser/process.test.sh
```

Extend `tests/browser/fixtures/fake-playwright-cli` with a `snapshot` case that echoes the filename arg:

```bash
    snapshot)
        shift
        echo "fake snapshot invoked: $*"
        # If --filename=/path passed, touch the file so the Swift side sees it
        for arg in "$@"; do
            case "$arg" in
                --filename=*) : > "${arg#--filename=}" ;;
            esac
        done
        exit 0
        ;;
```

(Add this case before the wildcard in the existing shim.)

- [ ] **Step 2: Run and confirm failure.**

```bash
bash build.sh && bash tests/browser/process.test.sh 2>&1 | head -5
```

Expected: `Unknown internal subcommand: _run`.

- [ ] **Step 3: Implement `playwright-process.swift`.**

```swift
// playwright-process.swift — Subprocess helper for playwright-cli.

import Foundation

struct PlaywrightInvocation {
    let session: String
    let verb: String
    let args: [String]            // additional positional/flag args
    let withTempFilename: Bool    // when true, append --filename=<tmp> and return its path
}

struct PlaywrightResult: Encodable {
    let exit_code: Int32
    let stdout: String
    let stderr: String
    let filename: String?         // tmp path when withTempFilename was set
}

enum PlaywrightInvocationError: Error {
    case launchFailed(String)
}

func runPlaywright(_ inv: PlaywrightInvocation) throws -> PlaywrightResult {
    var argv: [String] = ["-s=\(inv.session)", inv.verb]
    argv.append(contentsOf: inv.args)

    var tmpPath: String? = nil
    if inv.withTempFilename {
        let path = "/tmp/aos-pw-\(UUID().uuidString).md"
        argv.append("--filename=\(path)")
        tmpPath = path
    }

    let proc = Process()
    proc.launchPath = "/usr/bin/env"
    proc.arguments = ["playwright-cli"] + argv
    let out = Pipe(), err = Pipe()
    proc.standardOutput = out
    proc.standardError = err
    do {
        try proc.run()
    } catch {
        throw PlaywrightInvocationError.launchFailed("\(error)")
    }
    proc.waitUntilExit()
    let stdout = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    let stderr = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    return PlaywrightResult(
        exit_code: proc.terminationStatus,
        stdout: stdout.trimmingCharacters(in: .whitespacesAndNewlines),
        stderr: stderr.trimmingCharacters(in: .whitespacesAndNewlines),
        filename: tmpPath
    )
}
```

- [ ] **Step 4: Wire `_run` into `browser-internal.swift`.**

```swift
case "_run":
    var session = "", verb = "", withFilename = false
    for a in rest {
        if a.hasPrefix("--session=") { session = String(a.dropFirst("--session=".count)) }
        else if a.hasPrefix("--verb=") { verb = String(a.dropFirst("--verb=".count)) }
        else if a == "--with-filename" { withFilename = true }
    }
    guard !session.isEmpty, !verb.isEmpty else {
        exitError("--session=<s> and --verb=<v> are required", code: "MISSING_ARG")
    }
    do {
        let r = try runPlaywright(PlaywrightInvocation(
            session: session, verb: verb, args: [], withTempFilename: withFilename
        ))
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        print(String(data: try enc.encode(r), encoding: .utf8)!)
    } catch PlaywrightInvocationError.launchFailed(let msg) {
        exitError("launch failed: \(msg)", code: "PLAYWRIGHT_CLI_LAUNCH_FAILED")
    } catch {
        exitError("\(error)", code: "INTERNAL")
    }
```

- [ ] **Step 5: Register in the registry.**

Add another `InvocationForm` under the `browser` descriptor:

```swift
InvocationForm(
    id: "browser-run",
    usage: "aos browser _run --session=<s> --verb=<v> [--with-filename]",
    args: [
        flag("session", "--session", "playwright-cli session name", required: true),
        flag("verb", "--verb", "playwright-cli verb", required: true),
        flag("with-filename", "--with-filename", "Allocate and pass --filename=<tmp>", type: .bool)
    ],
    stdin: nil, constraints: nil,
    execution: permAction,
    output: outJSON,
    examples: ["aos browser _run --session=todo --verb=attach"]
),
```

- [ ] **Step 6: Build and test.**

```bash
bash build.sh && bash tests/browser/process.test.sh
```

Expected: `PASS`.

- [ ] **Step 7: Commit.**

```bash
git add src/browser/playwright-process.swift src/browser/browser-internal.swift src/shared/command-registry-data.swift tests/browser/process.test.sh tests/browser/fixtures/fake-playwright-cli
git commit -m "feat(browser): add playwright-cli subprocess helper

One entry point (runPlaywright) owns argv construction (-s=<session>,
optional --filename=<tmp>), stdout/stderr capture, and exit-code
translation. Hidden 'aos browser _run' helper drives integration tests
without a real Node install."
```

---

## Task 5: `snapshot-parser.swift` with golden fixtures

**Rationale:** `playwright-cli snapshot` emits indented accessibility-tree markdown. Parser walks indentation to build `context_path` and extracts `role`, `title`, `value`, `enabled`, and `ref` per line. Forward-compat: unknown line shapes are skipped.

**Files:**
- Create: `src/browser/snapshot-parser.swift`
- Create: `tests/browser/fixtures/snapshot-simple.md`
- Create: `tests/browser/fixtures/snapshot-simple.golden.json`
- Create: `tests/browser/fixtures/snapshot-nested.md`
- Create: `tests/browser/fixtures/snapshot-nested.golden.json`
- Create: `tests/browser/fixtures/snapshot-disabled.md`
- Create: `tests/browser/fixtures/snapshot-disabled.golden.json`
- Modify: `src/browser/browser-internal.swift` (add `_parse-snapshot`)
- Modify: `src/shared/command-registry-data.swift`
- Create: `tests/browser/snapshot-parser.test.sh`

- [ ] **Step 1: Capture three golden snapshots from a real playwright-cli run.**

If `@playwright/cli` is installed locally (Task 3's probe), author tiny fixture HTML files and snapshot them:

```bash
mkdir -p tests/browser/fixtures
cat > /tmp/simple.html <<'EOF'
<!doctype html><html><body>
<button>Click me</button>
<a href="#">Go</a>
<input placeholder="name" />
</body></html>
EOF

playwright-cli -s=fixture-gen open "file:///tmp/simple.html"
playwright-cli -s=fixture-gen snapshot --filename=tests/browser/fixtures/snapshot-simple.md
playwright-cli -s=fixture-gen close
```

Inspect the file — typical contents:

```markdown
- generic [ref=e1]:
  - button "Click me" [ref=e2]
  - link "Go" [ref=e3]
  - textbox "name" [ref=e4]
```

Repeat for `snapshot-nested.md` (a `<div>` with nested labeled regions) and `snapshot-disabled.md` (a `<button disabled>` and `<input disabled>`).

If `@playwright/cli` is not installed, hand-author the three fixtures using the same grammar — the important tests are parser correctness, not live snapshot fidelity.

- [ ] **Step 2: Write the failing test.**

Create `tests/browser/snapshot-parser.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"

for name in simple nested disabled; do
    md="$FIX/snapshot-$name.md"
    golden="$FIX/snapshot-$name.golden.json"
    [[ -f "$md" ]]     || { echo "missing fixture: $md" >&2; exit 1; }
    [[ -f "$golden" ]] || { echo "missing golden: $golden" >&2; exit 1; }
    actual=$(./aos browser _parse-snapshot "$md")
    if ! diff <(echo "$actual" | jq --sort-keys .) <(jq --sort-keys . "$golden") >/tmp/snap-diff; then
        echo "FAIL case $name:" >&2
        cat /tmp/snap-diff >&2
        exit 1
    fi
done

echo "PASS"
```

```bash
chmod +x tests/browser/snapshot-parser.test.sh
```

- [ ] **Step 3: Author golden JSON for each fixture.**

For `snapshot-simple.golden.json`, write the expected flat `AXElementJSON[]`:

```json
[
  {"role":"generic","title":null,"label":null,"value":null,"enabled":true,"context_path":[],"bounds":null,"ref":"e1"},
  {"role":"button","title":"Click me","label":null,"value":null,"enabled":true,"context_path":["generic"],"bounds":null,"ref":"e2"},
  {"role":"link","title":"Go","label":null,"value":null,"enabled":true,"context_path":["generic"],"bounds":null,"ref":"e3"},
  {"role":"textbox","title":"name","label":null,"value":null,"enabled":true,"context_path":["generic"],"bounds":null,"ref":"e4"}
]
```

Author the other two goldens to match their `.md` content. `snapshot-disabled.golden.json` sets `enabled: false` for the disabled elements.

- [ ] **Step 4: Run — confirm failure.**

```bash
bash tests/browser/snapshot-parser.test.sh 2>&1 | head -5
```

Expected: `Unknown internal subcommand: _parse-snapshot`.

- [ ] **Step 5: Implement `snapshot-parser.swift`.**

```swift
// snapshot-parser.swift — Parse playwright-cli snapshot markdown into AXElementJSON[].
//
// Grammar (representative, not formal):
//   - <role> [ref=<id>]
//   - <role> "<name>" [ref=<id>]
//   - <role> "<name>" [value="<v>"] [ref=<id>]
//   - <role> "<name>" [disabled] [ref=<id>]
// Indentation (2 spaces per level) indicates parent-child in the AX tree.
// Unknown line shapes are skipped.

import Foundation

func parseSnapshotMarkdown(_ contents: String) -> [AXElementJSON] {
    var elements: [AXElementJSON] = []
    var stack: [(indent: Int, role: String)] = []

    for rawLine in contents.split(separator: "\n", omittingEmptySubsequences: false) {
        let line = String(rawLine)
        guard let (indent, body) = stripListMarker(line) else { continue }
        guard let parsed = parseLineBody(body) else { continue }

        while let top = stack.last, top.indent >= indent {
            stack.removeLast()
        }
        let contextPath = stack.map { $0.role }

        elements.append(AXElementJSON(
            role: parsed.role,
            title: parsed.title,
            label: nil,
            value: parsed.value,
            enabled: !parsed.disabled,
            context_path: contextPath,
            bounds: nil,
            ref: parsed.ref
        ))
        stack.append((indent: indent, role: parsed.role))
    }
    return elements
}

private func stripListMarker(_ line: String) -> (indent: Int, body: String)? {
    var spaceCount = 0
    var idx = line.startIndex
    while idx < line.endIndex, line[idx] == " " {
        spaceCount += 1
        idx = line.index(after: idx)
    }
    guard idx < line.endIndex, line[idx] == "-" else { return nil }
    idx = line.index(after: idx)
    while idx < line.endIndex, line[idx] == " " {
        idx = line.index(after: idx)
    }
    return (indent: spaceCount / 2, body: String(line[idx...]))
}

private struct LineParts {
    let role: String
    let title: String?
    let value: String?
    let disabled: Bool
    let ref: String?
}

private func parseLineBody(_ body: String) -> LineParts? {
    // Strip trailing colon (indicates a container opening).
    var s = body
    if s.hasSuffix(":") { s.removeLast() }

    // Role is the first whitespace-delimited token.
    guard let firstSpace = s.firstIndex(where: { $0 == " " }) else {
        // Role-only line: "- generic" or "- button" with no attributes
        let role = s.trimmingCharacters(in: .whitespaces)
        guard !role.isEmpty else { return nil }
        return LineParts(role: role, title: nil, value: nil, disabled: false, ref: nil)
    }
    let role = String(s[..<firstSpace])
    let rest = String(s[s.index(after: firstSpace)...])

    // Title: first quoted string.
    let title = extractQuoted(rest, after: "")

    // Value: [value="..."]
    let value = extractBracketQuoted(rest, key: "value")

    // Disabled marker: [disabled]
    let disabled = rest.contains("[disabled]")

    // Ref: [ref=<id>]
    let ref = extractBracketValue(rest, key: "ref")

    return LineParts(role: role, title: title, value: value, disabled: disabled, ref: ref)
}

private func extractQuoted(_ s: String, after prefix: String) -> String? {
    guard let startQ = s.firstIndex(of: "\"") else { return nil }
    let after = s.index(after: startQ)
    guard let endQ = s[after...].firstIndex(of: "\"") else { return nil }
    return String(s[after..<endQ])
}

private func extractBracketValue(_ s: String, key: String) -> String? {
    // Matches [<key>=<value>] where <value> is unquoted alphanum/_-
    let pattern = "\\[\(key)=([A-Za-z0-9_\\-]+)\\]"
    guard let range = s.range(of: pattern, options: .regularExpression) else { return nil }
    let match = String(s[range])
    let inner = match.dropFirst("[\(key)=".count).dropLast()
    return String(inner)
}

private func extractBracketQuoted(_ s: String, key: String) -> String? {
    // Matches [<key>="<value>"] where <value> is a quoted string
    let pattern = "\\[\(key)=\"([^\"]*)\"\\]"
    guard let range = s.range(of: pattern, options: .regularExpression) else { return nil }
    let match = String(s[range])
    let inner = match.dropFirst("[\(key)=\"".count).dropLast(2) // drop "]
    return String(inner)
}
```

- [ ] **Step 6: Wire `_parse-snapshot` into `browser-internal.swift`.**

```swift
case "_parse-snapshot":
    guard let path = rest.first else {
        exitError("Usage: aos browser _parse-snapshot <markdown-file>", code: "MISSING_ARG")
    }
    guard let contents = try? String(contentsOfFile: path, encoding: .utf8) else {
        exitError("cannot read \(path)", code: "READ_ERROR")
    }
    let elements = parseSnapshotMarkdown(contents)
    let enc = JSONEncoder()
    enc.outputFormatting = [.sortedKeys, .prettyPrinted]
    print(String(data: try! enc.encode(elements), encoding: .utf8)!)
```

- [ ] **Step 7: Register in the registry.**

```swift
InvocationForm(
    id: "browser-parse-snapshot",
    usage: "aos browser _parse-snapshot <markdown-file>",
    args: [pos("path", "Path to a playwright-cli snapshot markdown file")],
    stdin: nil, constraints: nil,
    execution: readOnlyNoPerm,
    output: outJSON,
    examples: ["aos browser _parse-snapshot /tmp/snap.md"]
),
```

- [ ] **Step 8: Build and run.**

```bash
bash build.sh && bash tests/browser/snapshot-parser.test.sh
```

Expected: `PASS` for all three fixtures. If a golden doesn't match, iterate on parser or correct the golden; commit the final matching state.

- [ ] **Step 9: Commit.**

```bash
git add src/browser/snapshot-parser.swift src/browser/browser-internal.swift src/shared/command-registry-data.swift tests/browser/fixtures/snapshot-*.md tests/browser/fixtures/snapshot-*.golden.json tests/browser/snapshot-parser.test.sh
git commit -m "feat(browser): parse playwright-cli snapshot markdown

Walks 2-space indentation into context_path. Extracts role, title,
value, enabled (via [disabled] marker), ref. Unknown line shapes
silently skipped for forward-compat. Three golden fixtures exercise
simple, nested, and disabled cases."
```

---

## Task 6: `session-registry.swift` (JSON file I/O)

**Rationale:** Browser focus channels live in a CLI-local registry. Every aos CLI invocation reads this file to answer `focus list`, `focus remove`, and `browser:<s>` target resolution.

**Files:**
- Create: `src/browser/session-registry.swift`
- Modify: `src/browser/browser-internal.swift` (add `_registry`)
- Modify: `src/shared/command-registry-data.swift`
- Create: `tests/browser/registry.test.sh`

- [ ] **Step 1: Write the failing test.**

Create `tests/browser/registry.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

tmproot="/tmp/aos-reg-$$"
export AOS_STATE_ROOT="$tmproot"
export AOS_RUNTIME_MODE="repo"
trap 'rm -rf "$tmproot"' EXIT

# Case 1: list on empty returns []
out=$(./aos browser _registry list)
[[ "$out" == "[]" ]] || { echo "FAIL case 1: $out" >&2; exit 1; }

# Case 2: add and list
./aos browser _registry add --id=sess-a --mode=attach --attach-kind=extension --browser-window-id=12345 >/dev/null
./aos browser _registry add --id=sess-b --mode=launched --headless=false >/dev/null
out=$(./aos browser _registry list)
echo "$out" | jq -e 'length == 2' >/dev/null || { echo "FAIL case 2 count: $out" >&2; exit 1; }
echo "$out" | jq -e '.[] | select(.id == "sess-a").mode == "attach"' >/dev/null \
    || { echo "FAIL case 2 mode: $out" >&2; exit 1; }
echo "$out" | jq -e '.[] | select(.id == "sess-a").browser_window_id == 12345' >/dev/null \
    || { echo "FAIL case 2 win: $out" >&2; exit 1; }

# Case 3: find-by-id
out=$(./aos browser _registry find --id=sess-b)
echo "$out" | jq -e '.mode == "launched"' >/dev/null || { echo "FAIL case 3: $out" >&2; exit 1; }

# Case 4: remove
./aos browser _registry remove --id=sess-a >/dev/null
out=$(./aos browser _registry list)
echo "$out" | jq -e 'length == 1' >/dev/null || { echo "FAIL case 4: $out" >&2; exit 1; }
echo "$out" | jq -e '.[0].id == "sess-b"' >/dev/null || { echo "FAIL case 4 id: $out" >&2; exit 1; }

# Case 5: duplicate add returns error
if ./aos browser _registry add --id=sess-b --mode=launched 2>/dev/null; then
    echo "FAIL case 5: duplicate add should error" >&2; exit 1
fi

echo "PASS"
```

```bash
chmod +x tests/browser/registry.test.sh
```

- [ ] **Step 2: Run — confirm failure.**

Expected: `Unknown internal subcommand: _registry`.

- [ ] **Step 3: Implement `session-registry.swift`.**

```swift
// session-registry.swift — CLI-local registry of browser focus channels.
//
// Backing file: ${AOS_STATE_ROOT or ~/.config/aos}/{mode}/browser/sessions.json
// Each entry represents one playwright-cli session mapped to one aos focus channel.

import Foundation

struct BrowserSessionRecord: Codable, Equatable {
    let id: String                 // focus channel id + playwright-cli -s= name
    let mode: String               // "attach" | "launched"
    let attach_kind: String?       // "extension" | "cdp" | null (launched only)
    let headless: Bool?            // launched only; null for attach
    let browser_window_id: Int?    // CGWindowID when local+visible, else null
    let active_url: String?        // last-known active tab URL
    let updated_at: String         // ISO8601
}

enum SessionRegistryError: Error {
    case readError(String)
    case writeError(String)
    case duplicateID(String)
    case notFound(String)
}

func registryPath() -> String {
    // Mirrors the runtime-paths convention used elsewhere in the repo.
    let env = ProcessInfo.processInfo.environment
    let mode = env["AOS_RUNTIME_MODE"] ?? "repo"
    let root: String
    if let r = env["AOS_STATE_ROOT"] { root = r }
    else if let h = env["HOME"] { root = "\(h)/.config/aos" }
    else { root = "/tmp/aos" }
    let dir = "\(root)/\(mode)/browser"
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    return "\(dir)/sessions.json"
}

func readRegistry() throws -> [BrowserSessionRecord] {
    let path = registryPath()
    guard FileManager.default.fileExists(atPath: path) else { return [] }
    do {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        if data.isEmpty { return [] }
        return try JSONDecoder().decode([BrowserSessionRecord].self, from: data)
    } catch {
        throw SessionRegistryError.readError("\(error)")
    }
}

func writeRegistry(_ records: [BrowserSessionRecord]) throws {
    let path = registryPath()
    let enc = JSONEncoder()
    enc.outputFormatting = [.sortedKeys, .prettyPrinted]
    do {
        let data = try enc.encode(records)
        try data.write(to: URL(fileURLWithPath: path), options: .atomic)
    } catch {
        throw SessionRegistryError.writeError("\(error)")
    }
}

func addRegistryRecord(_ r: BrowserSessionRecord) throws {
    var all = try readRegistry()
    if all.contains(where: { $0.id == r.id }) {
        throw SessionRegistryError.duplicateID(r.id)
    }
    all.append(r)
    try writeRegistry(all)
}

func removeRegistryRecord(id: String) throws {
    var all = try readRegistry()
    guard all.contains(where: { $0.id == id }) else {
        throw SessionRegistryError.notFound(id)
    }
    all.removeAll { $0.id == id }
    try writeRegistry(all)
}

func findRegistryRecord(id: String) throws -> BrowserSessionRecord? {
    return try readRegistry().first { $0.id == id }
}

func isoNow() -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: Date())
}
```

- [ ] **Step 4: Add `_registry` subcommand.**

```swift
case "_registry":
    guard let op = rest.first else {
        exitError("Usage: aos browser _registry <op> ...", code: "MISSING_ARG")
    }
    let opArgs = Array(rest.dropFirst())
    let enc = JSONEncoder()
    enc.outputFormatting = [.sortedKeys]
    do {
        switch op {
        case "list":
            let all = try readRegistry()
            print(String(data: try enc.encode(all), encoding: .utf8)!)
        case "add":
            var id = "", mode = "", attachKind: String? = nil, headless: Bool? = nil, winID: Int? = nil
            for a in opArgs {
                if a.hasPrefix("--id=") { id = String(a.dropFirst(5)) }
                else if a.hasPrefix("--mode=") { mode = String(a.dropFirst(7)) }
                else if a.hasPrefix("--attach-kind=") { attachKind = String(a.dropFirst(14)) }
                else if a.hasPrefix("--headless=") { headless = (String(a.dropFirst(11)) == "true") }
                else if a.hasPrefix("--browser-window-id=") { winID = Int(String(a.dropFirst(20))) }
            }
            guard !id.isEmpty, !mode.isEmpty else {
                exitError("--id and --mode required", code: "MISSING_ARG")
            }
            try addRegistryRecord(BrowserSessionRecord(
                id: id, mode: mode, attach_kind: attachKind, headless: headless,
                browser_window_id: winID, active_url: nil, updated_at: isoNow()
            ))
            print("{\"status\":\"ok\"}")
        case "remove":
            var id = ""
            for a in opArgs where a.hasPrefix("--id=") { id = String(a.dropFirst(5)) }
            guard !id.isEmpty else { exitError("--id required", code: "MISSING_ARG") }
            try removeRegistryRecord(id: id)
            print("{\"status\":\"ok\"}")
        case "find":
            var id = ""
            for a in opArgs where a.hasPrefix("--id=") { id = String(a.dropFirst(5)) }
            guard !id.isEmpty else { exitError("--id required", code: "MISSING_ARG") }
            if let r = try findRegistryRecord(id: id) {
                print(String(data: try enc.encode(r), encoding: .utf8)!)
            } else {
                exitError("not found: \(id)", code: "NOT_FOUND")
            }
        default:
            exitError("Unknown registry op: \(op)", code: "UNKNOWN_SUBCOMMAND")
        }
    } catch SessionRegistryError.duplicateID(let id) {
        exitError("session already registered: \(id)", code: "DUPLICATE_ID")
    } catch SessionRegistryError.notFound(let id) {
        exitError("session not found: \(id)", code: "NOT_FOUND")
    } catch {
        exitError("\(error)", code: "INTERNAL")
    }
```

- [ ] **Step 5: Register in the registry metadata.**

Add four `InvocationForm`s (list/add/remove/find) following the existing pattern.

- [ ] **Step 6: Build and test.**

```bash
bash build.sh && bash tests/browser/registry.test.sh
```

Expected: `PASS`.

- [ ] **Step 7: Commit.**

```bash
git add src/browser/session-registry.swift src/browser/browser-internal.swift src/shared/command-registry-data.swift tests/browser/registry.test.sh
git commit -m "feat(browser): add CLI-local session registry

Backed by \${AOS_STATE_ROOT}/{mode}/browser/sessions.json. Atomic
read/write with typed BrowserSessionRecord. Duplicate-id and
not-found cases raise structured errors. Exposed via hidden
'aos browser _registry' for integration tests."
```

---

## Task 7: `browser-adapter.swift` — top-level orchestrator

**Rationale:** Consolidate the seam. `browser-adapter.swift` is the one file the rest of the Swift codebase calls into. It accepts a parsed target + verb arguments, delegates to `playwright-process`, parses output via `snapshot-parser`, and returns aos-shaped JSON. The next tasks plug `see`, `do`, `focus`, and `show` dispatchers into this.

**Files:**
- Create: `src/browser/browser-adapter.swift`

This task is structural — the functions it exports are called by Tasks 8–13. Its correctness is tested indirectly through those tasks.

- [ ] **Step 1: Write the module.**

```swift
// browser-adapter.swift — Top-level entry point for browser-target calls.

import Foundation

enum BrowserAdapterError: Error {
    case versionCheckFailed(String, code: String)
    case subprocess(String, code: String)
    case invalidTarget(String)
    case notLocalBrowser(String)  // used by anchor-resolver
}

/// Screenshot the whole active tab (no ref) or a single element.
/// Returns the PNG file path on success.
func seeCaptureScreenshot(target: BrowserTarget, outPath: String) throws -> String {
    try ensureVersion()
    var args: [String] = []
    if let ref = target.ref { args.append(ref) }
    args.append("--filename=\(outPath)")
    let r = try runPlaywright(PlaywrightInvocation(
        session: target.session, verb: "screenshot", args: args, withTempFilename: false
    ))
    guard r.exit_code == 0 else {
        throw BrowserAdapterError.subprocess("screenshot failed: \(r.stderr)", code: "PLAYWRIGHT_CLI_FAILED")
    }
    return outPath
}

/// Run snapshot, parse markdown, return AXElementJSON[].
/// If `withBounds` is true, follows up with one eval per ref.
func seeCaptureXray(target: BrowserTarget, withBounds: Bool) throws -> [AXElementJSON] {
    try ensureVersion()
    let r = try runPlaywright(PlaywrightInvocation(
        session: target.session, verb: "snapshot", args: [], withTempFilename: true
    ))
    guard r.exit_code == 0, let path = r.filename else {
        throw BrowserAdapterError.subprocess("snapshot failed: \(r.stderr)", code: "PLAYWRIGHT_CLI_FAILED")
    }
    defer { try? FileManager.default.removeItem(atPath: path) }
    let contents = try String(contentsOfFile: path, encoding: .utf8)
    var elements = parseSnapshotMarkdown(contents)
    if withBounds {
        elements = try elements.map { el in
            guard let ref = el.ref else { return el }
            guard let b = try boundsViaEval(session: target.session, ref: ref) else { return el }
            return AXElementJSON(
                role: el.role, title: el.title, label: el.label, value: el.value,
                enabled: el.enabled, context_path: el.context_path,
                bounds: b, ref: el.ref
            )
        }
    }
    return elements
}

/// Dispatch `do` verbs on browser targets.
func doVerb(_ verb: String, target: BrowserTarget, extraArgs: [String] = []) throws -> PlaywrightResult {
    try ensureVersion()
    var args: [String] = []
    if let ref = target.ref { args.append(ref) }
    args.append(contentsOf: extraArgs)
    return try runPlaywright(PlaywrightInvocation(
        session: target.session, verb: verb, args: args, withTempFilename: false
    ))
}

/// Fetch getBoundingClientRect() for a specific ref. Returns nil on zero-size rect.
func boundsViaEval(session: String, ref: String) throws -> BoundsJSON? {
    let js = "(e) => { const r = e.getBoundingClientRect(); return JSON.stringify({x:r.left,y:r.top,w:r.width,h:r.height}); }"
    let r = try runPlaywright(PlaywrightInvocation(
        session: session, verb: "eval", args: [js, ref], withTempFilename: false
    ))
    guard r.exit_code == 0 else { return nil }
    // stdout is a JSON string; parse
    struct Rect: Decodable { let x: Double; let y: Double; let w: Double; let h: Double }
    guard let data = r.stdout.data(using: .utf8),
          let rect = try? JSONDecoder().decode(Rect.self, from: data) else { return nil }
    if rect.w == 0 && rect.h == 0 { return nil }
    return BoundsJSON(x: Int(rect.x), y: Int(rect.y), width: Int(rect.w), height: Int(rect.h))
}

private var versionChecked = false
private func ensureVersion() throws {
    if versionChecked { return }
    do {
        _ = try probePlaywrightVersion()
        versionChecked = true
    } catch PlaywrightVersionError.notFound {
        throw BrowserAdapterError.versionCheckFailed(
            "@playwright/cli not found. Install: npm install -g @playwright/cli@\(kMinPlaywrightCLIVersion)",
            code: "PLAYWRIGHT_CLI_NOT_FOUND")
    } catch PlaywrightVersionError.tooOld(let found, let min) {
        throw BrowserAdapterError.versionCheckFailed(
            "@playwright/cli \(found) below minimum \(min). Upgrade: npm install -g @playwright/cli@latest",
            code: "PLAYWRIGHT_CLI_TOO_OLD")
    } catch {
        throw BrowserAdapterError.versionCheckFailed("version probe error: \(error)", code: "PLAYWRIGHT_CLI_PROBE_FAILED")
    }
}
```

- [ ] **Step 2: Build to verify it compiles.**

```bash
bash build.sh
```

Expected: clean build. No behavior change yet — this file is not called from anywhere outside `browser-internal.swift` tests.

- [ ] **Step 3: Commit.**

```bash
git add src/browser/browser-adapter.swift
git commit -m "feat(browser): add top-level BrowserAdapter orchestrator

Exposes seeCaptureScreenshot, seeCaptureXray(withBounds:), doVerb,
and boundsViaEval. Gates every external call on ensureVersion().
Unused by production paths until Tasks 8-13 wire it in; this commit
only lands the module so later tasks can import it."
```

---

## Task 8: Dispatch `see capture` on `browser:` targets

**Rationale:** Extend `src/perceive/capture-pipeline.swift` to route `browser:` targets through `BrowserAdapter` instead of ScreenCaptureKit.

**Files:**
- Modify: `src/perceive/capture-pipeline.swift`
- Create: `tests/browser/see-capture.test.sh`

- [ ] **Step 1: Write the failing test.**

Create `tests/browser/see-capture.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"

# Extend fake-playwright-cli to handle snapshot + screenshot (if not yet)
# — handled by Task 4/5's shim updates.

# Case 1: browser target rejects when no session resolvable
unset PLAYWRIGHT_CLI_SESSION
if out=$(./aos see capture "browser:" 2>&1); then
    echo "FAIL case 1: expected MISSING_SESSION, got: $out" >&2; exit 1
fi
echo "$out" | grep -q "MISSING_SESSION" || { echo "FAIL case 1 code: $out" >&2; exit 1; }

# Case 2: browser: target screenshots
OUT="/tmp/aos-see-browser-$$.png"
: > "$OUT"  # fake shim touches --filename path
./aos see capture "browser:todo" --out "$OUT" >/dev/null
[[ -f "$OUT" ]] || { echo "FAIL case 2: expected $OUT to exist" >&2; exit 1; }

# Case 3: browser:<s> --xray returns elements JSON with ref
out=$(./aos see capture "browser:todo" --xray 2>&1)
echo "$out" | jq -e '.elements | length > 0' >/dev/null \
    || { echo "FAIL case 3: $out" >&2; exit 1; }
echo "$out" | jq -e '.elements[0].ref != null' >/dev/null \
    || { echo "FAIL case 3 ref: $out" >&2; exit 1; }
echo "$out" | jq -e '.elements[0].bounds == null' >/dev/null \
    || { echo "FAIL case 3 bounds: $out" >&2; exit 1; }

echo "PASS"
```

```bash
chmod +x tests/browser/see-capture.test.sh
```

Extend fake-CLI shim to return canned snapshot output:

```bash
    snapshot)
        shift
        for arg in "$@"; do
            case "$arg" in
                --filename=*)
                    cat > "${arg#--filename=}" <<'SNAP'
- generic [ref=e1]:
  - button "Click me" [ref=e2]
  - link "Go" [ref=e3]
SNAP
                    ;;
            esac
        done
        exit 0
        ;;
    screenshot)
        shift
        for arg in "$@"; do
            case "$arg" in
                --filename=*)
                    # PNG signature so `file` recognizes it
                    printf '\x89PNG\r\n\x1a\nfake' > "${arg#--filename=}"
                    ;;
            esac
        done
        exit 0
        ;;
```

- [ ] **Step 2: Run — confirm failure.**

Expected: `see capture browser:...` unknown target type or similar.

- [ ] **Step 3: Implement dispatch in `capture-pipeline.swift`.**

Locate the function that resolves a capture `<target>` string (search for the enum or switch that accepts `main`, `user_active`, `external`, etc.). Before that resolution, add a branch:

```swift
if targetString.hasPrefix("browser:") {
    do {
        let bt = try parseBrowserTarget(targetString)
        // XRay path
        if wantsXray {
            let elements = try seeCaptureXray(target: bt, withBounds: wantsLabel)
            if wantsLabel {
                let annotations = buildAnnotations(from: elements)
                // Reuse existing compose-with-annotations path; for --label we still
                // need a screenshot behind the annotations.
                let snap = outputPath ?? "/tmp/aos-browser-see-\(UUID().uuidString).png"
                _ = try seeCaptureScreenshot(target: bt, outPath: snap)
                try composeAnnotationsOverPNG(pngPath: snap, annotations: annotations, outPath: snap)
                emitCaptureJSON(elements: elements, annotations: annotations, path: snap)
            } else {
                // Pure xray — no image
                emitCaptureJSON(elements: elements, annotations: [], path: nil)
            }
            return
        }
        // Screenshot path (no xray)
        let dst = outputPath ?? "./screenshot.png"
        _ = try seeCaptureScreenshot(target: bt, outPath: dst)
        emitCaptureJSON(elements: [], annotations: [], path: dst)
        return
    } catch BrowserTargetError.missingSession {
        exitError("PLAYWRIGHT_CLI_SESSION not set", code: "MISSING_SESSION")
    } catch BrowserTargetError.invalid(let msg) {
        exitError("invalid browser target: \(msg)", code: "INVALID_TARGET")
    } catch BrowserAdapterError.versionCheckFailed(let msg, let code) {
        exitError(msg, code: code)
    } catch BrowserAdapterError.subprocess(let msg, let code) {
        exitError(msg, code: code)
    } catch {
        exitError("\(error)", code: "INTERNAL")
    }
}
```

(Exact helper names `composeAnnotationsOverPNG`, `emitCaptureJSON`, `wantsXray`, `wantsLabel` reflect the existing pipeline's local names; adapt to the code you find. The key structural point: dispatch browser before the existing target-kind switch.)

- [ ] **Step 4: Build and run test.**

```bash
bash build.sh && bash tests/browser/see-capture.test.sh
```

Expected: `PASS`.

- [ ] **Step 5: Commit.**

```bash
git add src/perceive/capture-pipeline.swift tests/browser/see-capture.test.sh tests/browser/fixtures/fake-playwright-cli
git commit -m "feat(browser): dispatch see capture on browser: targets

Fast xray path runs snapshot only (no bounds). --label path runs
snapshot + per-ref eval for bounds + compose annotations over a
screenshot. Screenshot path uses --filename=<tmp> for determinism.
Errors from version check, target parse, and subprocess propagate
as structured codes."
```

---

## Task 9: Extend existing `do` verbs (click/hover/drag/scroll/type/key) for browser targets

**Rationale:** Six existing verbs gain browser-target dispatch. Each follows the same shape: parse target; if `browser:`, call `doVerb(...)`; else fall through to existing macOS path.

**Files:**
- Modify: `src/act/act-cli.swift` (`cliClick`, `cliHover`, `cliDrag`, `cliScroll`, `cliType`, `cliKey` — actual function names per existing code)
- Create: `tests/browser/do-existing-verbs.test.sh`

- [ ] **Step 1: Write the failing test.**

```bash
cat > tests/browser/do-existing-verbs.test.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"

run_and_grep_fake_invocation() {
    local verb="$1" expected_in_stdout="$2" shift_count=2
    shift 2
    out=$(./aos do "$verb" "$@" 2>&1)
    # fake-playwright-cli echoes `fake <verb> invoked: <args>` when it accepts
    # Forward it: we expect stdout JSON contains our canned message
    echo "$out" | grep -q "$expected_in_stdout" \
        || { echo "FAIL $verb: expected '$expected_in_stdout' in:\n$out" >&2; exit 1; }
}

run_and_grep_fake_invocation click  "fake click invoked"  "browser:todo/e21"
run_and_grep_fake_invocation hover  "fake hover invoked"  "browser:todo/e21"
run_and_grep_fake_invocation scroll "fake mousewheel invoked" "browser:todo" "100,200"
run_and_grep_fake_invocation type   "fake type invoked"   "browser:todo" "hello world"
run_and_grep_fake_invocation key    "fake press invoked"  "browser:todo" "Enter"
run_and_grep_fake_invocation drag   "fake drag invoked"   "browser:todo/e1" "browser:todo/e2"

# Non-browser targets still work (smoke) — click with coords goes through CGEventTap path
# Don't drive the real event tap in tests; just assert the invocation is accepted.
./aos do click 100,200 --dry-run >/dev/null 2>&1 || true

echo "PASS"
EOF
chmod +x tests/browser/do-existing-verbs.test.sh
```

Extend the fake-CLI shim with verbs: `click`, `hover`, `drag`, `scroll` (as `mousewheel`), `type`, `press`, emitting `"fake <verb> invoked: <args>"` and exiting 0.

- [ ] **Step 2: Run — confirm failure.**

Expected: target shape not recognized for browser:.

- [ ] **Step 3: Implement per-verb dispatch.**

For each of the six `cli*` functions in `src/act/act-cli.swift`, add a dispatch prefix:

```swift
func cliClick(args: [String]) {
    // Existing arg parsing pulls out the <coords> positional.
    let coords = args.first ?? ""
    if coords.hasPrefix("browser:") {
        dispatchBrowserVerb("click", targetString: coords, remaining: Array(args.dropFirst()))
        return
    }
    // ... existing macOS CGEvent path unchanged below ...
}
```

Add one helper in `act-cli.swift` (or a new `src/act/act-browser-dispatch.swift` if preferred):

```swift
func dispatchBrowserVerb(_ pwVerb: String, targetString: String, remaining: [String]) {
    do {
        let t = try parseBrowserTarget(targetString)
        // Verb-specific extra-args translation
        var extra: [String] = []
        switch pwVerb {
        case "click":
            if remaining.contains("--right") { extra = ["right"] }
            else if remaining.contains("--double") {
                // Translate click --double into dblclick
                let r = try doVerb("dblclick", target: t)
                emitDoResult(r); return
            }
        case "type":
            if remaining.indices.contains(0) { extra.append(remaining[0]) }
        case "press":
            if remaining.indices.contains(0) { extra.append(remaining[0]) }
        case "scroll":
            if remaining.indices.contains(0) {
                let parts = remaining[0].split(separator: ",").map(String.init)
                if parts.count == 2 { extra = [parts[0], parts[1]] }
            }
        default: break
        }
        let r = try doVerb(pwVerb, target: t, extraArgs: extra)
        emitDoResult(r)
    } catch BrowserTargetError.invalid(let msg) {
        exitError("invalid browser target: \(msg)", code: "INVALID_TARGET")
    } catch BrowserTargetError.missingSession {
        exitError("PLAYWRIGHT_CLI_SESSION not set", code: "MISSING_SESSION")
    } catch BrowserAdapterError.versionCheckFailed(let msg, let code) {
        exitError(msg, code: code)
    } catch BrowserAdapterError.subprocess(let msg, let code) {
        exitError(msg, code: code)
    } catch {
        exitError("\(error)", code: "INTERNAL")
    }
}

func emitDoResult(_ r: PlaywrightResult) {
    let enc = JSONEncoder()
    enc.outputFormatting = [.sortedKeys]
    struct Payload: Encodable { let status: String; let result: PlaywrightResult }
    let payload = Payload(status: r.exit_code == 0 ? "success" : "error", result: r)
    print(String(data: try! enc.encode(payload), encoding: .utf8)!)
}
```

Note: `aos do key <combo>` maps to playwright's `press <combo>`, so the dispatcher translates `"key"` → `"press"` when it invokes `doVerb`. Similarly `"scroll"` → `"mousewheel"`. Do this translation at the dispatch-verb boundary, not in `browser-adapter.swift`.

Correcting the helper to do the translation:

```swift
func dispatchBrowserVerb(_ aosVerb: String, targetString: String, remaining: [String]) {
    let pwVerb: String
    switch aosVerb {
    case "key":    pwVerb = "press"
    case "scroll": pwVerb = "mousewheel"
    default:       pwVerb = aosVerb
    }
    // ... rest as above, using pwVerb ...
}
```

- [ ] **Step 4: Build and test.**

```bash
bash build.sh && bash tests/browser/do-existing-verbs.test.sh
```

Expected: `PASS`.

- [ ] **Step 5: Commit.**

```bash
git add src/act/act-cli.swift tests/browser/do-existing-verbs.test.sh tests/browser/fixtures/fake-playwright-cli
git commit -m "feat(browser): dispatch existing do verbs on browser: targets

click, hover, drag, scroll, type, key now route to playwright-cli
when the target starts with browser:. Verb translation (key->press,
scroll->mousewheel) happens at the dispatch boundary so the adapter
stays playwright-native. Extra args (--right, --double, combos,
scroll deltas) adapt per verb."
```

---

## Task 10: New `do fill` subcommand (browser-only in v1)

**Files:**
- Modify: `src/main.swift:149` switch (add `case "fill"`)
- Modify: `src/act/act-cli.swift` (add `cliFill`)
- Modify: `src/shared/command-registry-data.swift`
- Create: `tests/browser/do-fill.test.sh`

- [ ] **Step 1: Write the failing test.**

```bash
cat > tests/browser/do-fill.test.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"

# Non-browser target errors
if out=$(./aos do fill 500,300 "hello" 2>&1); then
    echo "FAIL non-browser: expected error, got: $out" >&2; exit 1
fi
echo "$out" | grep -q "BROWSER_ONLY" || { echo "FAIL non-browser code: $out" >&2; exit 1; }

# Browser target succeeds
out=$(./aos do fill "browser:todo/e21" "hello world" 2>&1)
echo "$out" | grep -q "fake fill invoked: -s=todo fill e21 hello world" \
    || { echo "FAIL browser: $out" >&2; exit 1; }

# Missing text errors
if ./aos do fill "browser:todo/e21" 2>&1 | grep -q '"status":"success"'; then
    echo "FAIL missing text: expected error" >&2; exit 1
fi

echo "PASS"
EOF
chmod +x tests/browser/do-fill.test.sh
```

Extend fake-CLI with a `fill` case that echoes args.

- [ ] **Step 2: Run — confirm failure.**

Expected: `Unknown do subcommand: fill`.

- [ ] **Step 3: Implement `cliFill`.**

In `src/act/act-cli.swift`:

```swift
func cliFill(args: [String]) {
    guard args.count >= 2 else {
        exitError("Usage: aos do fill <browser:<s>/<ref>> <text>", code: "MISSING_ARG")
    }
    let targetString = args[0]
    let text = args[1]
    guard targetString.hasPrefix("browser:") else {
        exitError("aos do fill is browser-only in v1. Target must be browser:<s>/<ref>.",
                  code: "BROWSER_ONLY")
    }
    dispatchBrowserVerb("fill", targetString: targetString, remaining: [text])
}
```

Extend `dispatchBrowserVerb` to handle `fill`:

```swift
case "fill":
    // remaining[0] is the text; target.ref must be set
    if remaining.indices.contains(0) { extra.append(remaining[0]) }
```

(And add a check that `target.ref != nil` for fill — erroring cleanly if the user passes `browser:<s>` without a ref.)

- [ ] **Step 4: Register in `main.swift` switch.**

Before the `default:` branch:

```swift
case "fill":
    ensureInteractivePreflight(command: "aos do fill")
    cliFill(args: subArgs)
```

- [ ] **Step 5: Add to the command registry.**

Inside the existing `do` `CommandDescriptor`, add:

```swift
InvocationForm(
    id: "do-fill",
    usage: "aos do fill <browser:<s>/<ref>> <text>",
    args: [
        pos("target", "Browser target (browser:<session>/<ref>)"),
        pos("text", "Text to fill into the element")
    ],
    stdin: nil, constraints: nil,
    execution: permAction,
    output: outJSON,
    examples: ["aos do fill browser:todo/e21 \"buy groceries\""]
),
```

- [ ] **Step 6: Build and test.**

```bash
bash build.sh && bash tests/browser/do-fill.test.sh
```

Expected: `PASS`.

- [ ] **Step 7: Commit.**

```bash
git add src/main.swift src/act/act-cli.swift src/shared/command-registry-data.swift tests/browser/do-fill.test.sh tests/browser/fixtures/fake-playwright-cli
git commit -m "feat(do): add 'do fill' browser-only subcommand

Clears and enters text into an input element. Browser target shape
required in v1; macOS equivalent deferred. Registers in command
registry so 'aos help do fill --json' surfaces it to agents."
```

---

## Task 11: New `do navigate` subcommand (browser-only in v1)

**Files:**
- Modify: `src/main.swift:149` switch (add `case "navigate"`)
- Modify: `src/act/act-cli.swift` (add `cliNavigate`)
- Modify: `src/shared/command-registry-data.swift`
- Create: `tests/browser/do-navigate.test.sh`

- [ ] **Step 1: Write the failing test.**

```bash
cat > tests/browser/do-navigate.test.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"

# Non-browser target errors
if ./aos do navigate "main" "https://example.com" 2>&1 | grep -q '"status":"success"'; then
    echo "FAIL non-browser: expected error" >&2; exit 1
fi

# Browser target succeeds
out=$(./aos do navigate "browser:todo" "https://example.com" 2>&1)
echo "$out" | grep -q "fake goto invoked: -s=todo goto https://example.com" \
    || { echo "FAIL: $out" >&2; exit 1; }

echo "PASS"
EOF
chmod +x tests/browser/do-navigate.test.sh
```

Extend fake-CLI with a `goto` case.

- [ ] **Step 2: Run — confirm failure.**

Expected: `Unknown do subcommand: navigate`.

- [ ] **Step 3: Implement.**

```swift
func cliNavigate(args: [String]) {
    guard args.count >= 2 else {
        exitError("Usage: aos do navigate <browser:<s>> <url>", code: "MISSING_ARG")
    }
    let targetString = args[0]
    let url = args[1]
    guard targetString.hasPrefix("browser:") else {
        exitError("aos do navigate is browser-only in v1.", code: "BROWSER_ONLY")
    }
    dispatchBrowserVerb("goto", targetString: targetString, remaining: [url])
}
```

Extend `dispatchBrowserVerb`:

```swift
case "goto":
    if remaining.indices.contains(0) { extra.append(remaining[0]) }
```

Add to `main.swift` switch and registry similarly to Task 10.

- [ ] **Step 4-7: Build, test, commit.**

```bash
bash build.sh && bash tests/browser/do-navigate.test.sh
git add src/main.swift src/act/act-cli.swift src/shared/command-registry-data.swift tests/browser/do-navigate.test.sh tests/browser/fixtures/fake-playwright-cli
git commit -m "feat(do): add 'do navigate' browser-only subcommand

URL navigation via playwright-cli goto. Browser target shape required
in v1."
```

---

## Task 12: Focus channel dispatch — `create --target`, merged `list`, registry-first `remove`

**Rationale:** This is the biggest wiring task. `focus create --target browser://…` bypasses daemon IPC (registry only); `focus list` merges daemon + registry; `focus remove` dispatches on which side owns the id.

**Files:**
- Modify: `src/perceive/focus-commands.swift`
- Modify: `src/shared/command-registry-data.swift` (register `--target` flag, note browser kind in list)
- Create: `tests/browser/focus-browser.test.sh`

- [ ] **Step 1: Write the failing test.**

```bash
cat > tests/browser/focus-browser.test.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"
tmproot="/tmp/aos-focus-$$"
export AOS_STATE_ROOT="$tmproot"
export AOS_RUNTIME_MODE="repo"
trap 'rm -rf "$tmproot"' EXIT

# Case 1: create attach extension
out=$(./aos focus create --id test-attach --target browser://attach --extension 2>&1)
echo "$out" | grep -q '"status":"success"' || { echo "FAIL create: $out" >&2; exit 1; }

# Case 2: list includes browser kind
out=$(./aos focus list 2>&1)
echo "$out" | jq -e '[.channels[] | select(.kind == "browser" and .id == "test-attach")] | length == 1' >/dev/null \
    || { echo "FAIL list: $out" >&2; exit 1; }

# Case 3: create launched headed
out=$(./aos focus create --id test-launched --target browser://new 2>&1)
echo "$out" | grep -q '"status":"success"' || { echo "FAIL launched: $out" >&2; exit 1; }

# Case 4: remove browser channel (registry only, no daemon round-trip)
./aos focus remove --id test-attach >/dev/null
out=$(./aos focus list)
echo "$out" | jq -e '[.channels[] | select(.id == "test-attach")] | length == 0' >/dev/null \
    || { echo "FAIL remove: $out" >&2; exit 1; }

# Case 5: --target and --window mutually exclusive
if ./aos focus create --id oops --target browser://new --window 12345 2>/dev/null; then
    echo "FAIL exclusive: expected error" >&2; exit 1
fi

echo "PASS"
EOF
chmod +x tests/browser/focus-browser.test.sh
```

Extend fake-CLI with `attach` (already present from Task 3) and a `new` verb that emulates `playwright-cli open` semantics (just exits 0).

- [ ] **Step 2: Run — confirm failure.**

Expected: `--target` flag not recognized, or browser channel not found in list.

- [ ] **Step 3: Extend `focusCreateCommand` with `--target` parsing.**

In `src/perceive/focus-commands.swift`:

```swift
func focusCreateCommand(args: [String]) {
    guard let id = getArg(args, "--id") else {
        exitError("--id is required", code: "MISSING_ARG")
    }
    let target = getArg(args, "--target")
    let widStr = getArg(args, "--window")

    // Mutual exclusion
    if target != nil && widStr != nil {
        exitError("--target and --window are mutually exclusive", code: "INVALID_ARG")
    }

    // Browser path
    if let t = target {
        focusCreateBrowser(id: id, targetSpec: t, rest: args)
        return
    }

    // Existing macOS path (unchanged)
    guard let widStr = widStr, let wid = Int(widStr) else {
        exitError("--window <id> is required (or --target browser://…)", code: "MISSING_ARG")
    }
    // ... rest of existing macOS path verbatim ...
}
```

New function in the same file (or in `src/browser/browser-adapter.swift` as a new entry):

```swift
func focusCreateBrowser(id: String, targetSpec: String, rest: [String]) {
    // Parse targetSpec: browser://attach or browser://new
    guard let url = URL(string: targetSpec),
          url.scheme == "browser",
          let kind = url.host else {
        exitError("invalid --target; expected browser://attach or browser://new",
                  code: "INVALID_ARG")
    }

    let enc = JSONEncoder()
    enc.outputFormatting = [.sortedKeys]

    do {
        try ensureVersion()
        switch kind {
        case "attach":
            var attachKind = "extension"  // default
            var cdp: String? = nil
            if rest.contains("--extension") { attachKind = "extension" }
            if let cdpVal = getArg(rest, "--cdp") { attachKind = "cdp"; cdp = cdpVal }
            let pwArgs: [String]
            switch attachKind {
            case "extension": pwArgs = ["--extension"]
            case "cdp":       pwArgs = cdp.map { ["--cdp=\($0)"] } ?? ["--cdp=chrome"]
            default:          pwArgs = ["--extension"]
            }
            let r = try runPlaywright(PlaywrightInvocation(
                session: id, verb: "attach", args: pwArgs, withTempFilename: false
            ))
            guard r.exit_code == 0 else {
                exitError("playwright attach failed: \(r.stderr)", code: "PLAYWRIGHT_CLI_FAILED")
            }
            let winID = resolveBrowserWindowID(session: id)  // nil for remote CDP; stub for now
            try addRegistryRecord(BrowserSessionRecord(
                id: id, mode: "attach", attach_kind: attachKind, headless: nil,
                browser_window_id: winID, active_url: nil, updated_at: isoNow()
            ))
            print("{\"status\":\"success\",\"id\":\"\(id)\",\"mode\":\"attach\",\"attach\":\"\(attachKind)\"}")
        case "new":
            let headless = rest.contains("--headless")
            var pwArgs: [String] = ["open"]
            if !headless { pwArgs.append("--headed") }
            if let u = getArg(rest, "--url") { pwArgs.append(u) }
            if rest.contains("--persistent") { pwArgs.append("--persistent") }
            let r = try runPlaywright(PlaywrightInvocation(
                session: id, verb: pwArgs[0], args: Array(pwArgs.dropFirst()), withTempFilename: false
            ))
            guard r.exit_code == 0 else {
                exitError("playwright open failed: \(r.stderr)", code: "PLAYWRIGHT_CLI_FAILED")
            }
            let winID = resolveBrowserWindowID(session: id)
            try addRegistryRecord(BrowserSessionRecord(
                id: id, mode: "launched", attach_kind: nil, headless: headless,
                browser_window_id: winID, active_url: nil, updated_at: isoNow()
            ))
            print("{\"status\":\"success\",\"id\":\"\(id)\",\"mode\":\"launched\",\"headless\":\(headless)}")
        default:
            exitError("invalid --target kind: \(kind)", code: "INVALID_ARG")
        }
    } catch SessionRegistryError.duplicateID {
        exitError("focus channel '\(id)' already exists", code: "DUPLICATE_ID")
    } catch BrowserAdapterError.versionCheckFailed(let msg, let code) {
        exitError(msg, code: code)
    } catch {
        exitError("\(error)", code: "INTERNAL")
    }
}

// Stubbed for v1; Task 13 fills in with AX resolution.
func resolveBrowserWindowID(session: String) -> Int? { nil }
```

- [ ] **Step 4: Extend `focusListCommand` to merge.**

```swift
func focusListCommand() {
    // Daemon channels
    let daemonResponse = sendEnvelopeRequest(service: "focus", action: "list", data: [:], autoStartBinary: aosExecutablePath())
    var merged: [[String: Any]] = []
    // Parse daemon response and tag each entry with kind:"window"
    if let jsonData = daemonResponse.data(using: .utf8),
       let obj = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
       let chans = obj["data"] as? [String: Any],
       let arr = chans["channels"] as? [[String: Any]] {
        for var entry in arr {
            entry["kind"] = "window"
            merged.append(entry)
        }
    }
    // Registry channels
    if let registry = try? readRegistry() {
        for r in registry {
            merged.append([
                "kind": "browser",
                "id": r.id,
                "session": r.id,
                "mode": r.mode,
                "attach": r.attach_kind as Any,
                "headless": r.headless as Any,
                "browser_window_id": r.browser_window_id as Any,
                "active_url": r.active_url as Any,
                "updated_at": r.updated_at
            ])
        }
    }
    let payload: [String: Any] = ["status": "success", "data": ["channels": merged]]
    let data = try! JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}
```

(The precise daemon-response parsing shape depends on what `sendEnvelopeRequest` returns in `focus-commands.swift`. Match the existing style — the change is: take existing result, inject `kind:"window"` per entry, append registry entries with `kind:"browser"`.)

- [ ] **Step 5: Extend `focusRemoveCommand`.**

```swift
func focusRemoveCommand(args: [String]) {
    guard let id = getArg(args, "--id") else {
        exitError("--id is required", code: "MISSING_ARG")
    }
    // Registry first
    if let record = try? findRegistryRecord(id: id), record != nil {
        do {
            // Close playwright session if agent-launched
            if record?.mode == "launched" {
                _ = try? runPlaywright(PlaywrightInvocation(
                    session: id, verb: "close", args: [], withTempFilename: false))
            }
            try removeRegistryRecord(id: id)
            print("{\"status\":\"success\"}")
            return
        } catch {
            exitError("\(error)", code: "INTERNAL")
        }
    }
    // Daemon path (existing)
    printDaemonResult(sendEnvelopeRequest(service: "focus", action: "remove", data: ["id": id], autoStartBinary: aosExecutablePath()))
}
```

- [ ] **Step 6: Register `--target` in the command registry.**

In `src/shared/command-registry-data.swift`, locate the `focus create` form and add `--target` as a flag, with a `constraints.conflicts: [["target", "window"]]` entry if the existing schema supports it. Otherwise document in the summary.

- [ ] **Step 7: Build and test.**

```bash
bash build.sh && bash tests/browser/focus-browser.test.sh
```

Expected: `PASS`.

- [ ] **Step 8: Commit.**

```bash
git add src/perceive/focus-commands.swift src/shared/command-registry-data.swift tests/browser/focus-browser.test.sh
git commit -m "feat(focus): add browser channel support to focus create/list/remove

--target browser://attach and --target browser://new create CLI-local
focus channels backed by the browser registry. focus list merges
daemon channels (kind='window') with registry (kind='browser') into
a typed union. focus remove dispatches on registry lookup before
falling through to the daemon, and closes agent-launched sessions
via playwright-cli close."
```

---

## Task 13: `anchor-resolver.swift` — static browser anchor resolution

**Rationale:** Given `browser:<s>/<ref>`, resolve to `(CGWindowID, CGRect offset)` that `show.create --anchor_window + --offset` can consume. Fails cleanly for headless / remote-CDP sessions.

**Files:**
- Create: `src/browser/anchor-resolver.swift`
- Modify: `src/browser/browser-adapter.swift` (replace the stub `resolveBrowserWindowID`)
- Create: `tests/browser/anchor-resolver.test.sh`

- [ ] **Step 1: Write the failing test.**

```bash
cat > tests/browser/anchor-resolver.test.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"
tmproot="/tmp/aos-anchor-$$"
export AOS_STATE_ROOT="$tmproot"
export AOS_RUNTIME_MODE="repo"
trap 'rm -rf "$tmproot"' EXIT

# Seed a registry entry marked as headless (browser_window_id=null)
./aos browser _registry add --id=headless-sess --mode=launched --headless=true >/dev/null

# Case 1: headless session returns BROWSER_HEADLESS
if out=$(./aos browser _resolve-anchor "browser:headless-sess/e1" 2>&1); then
    echo "FAIL headless: expected error, got: $out" >&2; exit 1
fi
echo "$out" | grep -q "BROWSER_HEADLESS" || { echo "FAIL headless code: $out" >&2; exit 1; }

# Case 2: non-registered session returns NOT_FOUND
if ./aos browser _resolve-anchor "browser:no-such/e1" 2>&1 | grep -q '"status":"success"'; then
    echo "FAIL not-found: expected error" >&2; exit 1
fi

# Case 3: local session with winID → static offset (rect comes from fake eval)
./aos browser _registry add --id=local-sess --mode=attach --attach-kind=extension --browser-window-id=99999 >/dev/null
out=$(./aos browser _resolve-anchor "browser:local-sess/e2" 2>&1)
echo "$out" | jq -e '.anchor_window == 99999' >/dev/null \
    || { echo "FAIL local anchor_window: $out" >&2; exit 1; }
echo "$out" | jq -e '.offset | length == 4' >/dev/null \
    || { echo "FAIL local offset: $out" >&2; exit 1; }

echo "PASS"
EOF
chmod +x tests/browser/anchor-resolver.test.sh
```

Extend fake-CLI with an `eval` case that returns a canned JSON rect:

```bash
    eval)
        shift
        # Canned rect: x=100,y=200,w=300,h=40
        echo '{"x":100,"y":200,"w":300,"h":40}'
        exit 0
        ;;
```

- [ ] **Step 2: Run — confirm failure.**

Expected: `_resolve-anchor` unknown.

- [ ] **Step 3: Implement `anchor-resolver.swift`.**

```swift
// anchor-resolver.swift — Static browser:<s>/<ref> → (CGWindowID, offset).

import Foundation

struct BrowserAnchor: Encodable {
    let anchor_window: Int
    let offset: [Int]   // [x, y, w, h] in LCS
}

enum AnchorResolveError: Error {
    case notFound(String)
    case headless
    case notLocal(String)
    case evalFailed(String)
}

func resolveBrowserAnchor(target: BrowserTarget) throws -> BrowserAnchor {
    guard let record = try findRegistryRecord(id: target.session) else {
        throw AnchorResolveError.notFound(target.session)
    }
    guard let winID = record.browser_window_id else {
        if record.headless == true {
            throw AnchorResolveError.headless
        }
        throw AnchorResolveError.notLocal("browser session has no local window (remote CDP or unmatched)")
    }
    guard let ref = target.ref else {
        // Anchor to the whole content area; offset covers the full window
        return BrowserAnchor(anchor_window: winID, offset: [0, 0, 0, 0])
    }
    // Fetch viewport rect via eval
    guard let b = try boundsViaEval(session: target.session, ref: ref) else {
        throw AnchorResolveError.evalFailed("bounds query returned nil or zero-sized rect for ref \(ref)")
    }
    // TODO (per spec Open Question #5): subtract Chrome content-view inset.
    // v1 implementation: use the viewport rect as-is. Task 14 adds an optional
    // inset calibration via AX-window comparison; for now, rect lives at the
    // window origin + viewport coords, which yields a correctly-aligned overlay
    // when Chrome exposes the content area as the tracked CGWindowID.
    return BrowserAnchor(
        anchor_window: winID,
        offset: [b.x, b.y, b.width, b.height]
    )
}
```

- [ ] **Step 4: Add `_resolve-anchor` debug subcommand.**

```swift
case "_resolve-anchor":
    guard let input = rest.first else {
        exitError("Usage: aos browser _resolve-anchor <target>", code: "MISSING_ARG")
    }
    do {
        let t = try parseBrowserTarget(input)
        let anchor = try resolveBrowserAnchor(target: t)
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        print(String(data: try enc.encode(anchor), encoding: .utf8)!)
    } catch AnchorResolveError.notFound(let id) {
        exitError("browser session '\(id)' not registered", code: "NOT_FOUND")
    } catch AnchorResolveError.headless {
        exitError("headless browser sessions cannot be anchored (no CGWindowID)",
                  code: "BROWSER_HEADLESS")
    } catch AnchorResolveError.notLocal(let msg) {
        exitError(msg, code: "BROWSER_NOT_LOCAL")
    } catch AnchorResolveError.evalFailed(let msg) {
        exitError(msg, code: "ANCHOR_EVAL_FAILED")
    } catch BrowserTargetError.invalid(let msg) {
        exitError(msg, code: "INVALID_TARGET")
    } catch BrowserTargetError.missingSession {
        exitError("PLAYWRIGHT_CLI_SESSION not set", code: "MISSING_SESSION")
    } catch {
        exitError("\(error)", code: "INTERNAL")
    }
```

- [ ] **Step 5: Register in the command registry.**

Add another `InvocationForm` under `browser`.

- [ ] **Step 6: Build and test.**

```bash
bash build.sh && bash tests/browser/anchor-resolver.test.sh
```

Expected: `PASS`.

- [ ] **Step 7: Commit.**

```bash
git add src/browser/anchor-resolver.swift src/browser/browser-internal.swift src/shared/command-registry-data.swift tests/browser/anchor-resolver.test.sh tests/browser/fixtures/fake-playwright-cli
git commit -m "feat(browser): static anchor resolution for show create/update

resolveBrowserAnchor maps browser:<s>/<ref> → (CGWindowID, offset)
via the registry + one eval call. Fails cleanly with
BROWSER_HEADLESS, BROWSER_NOT_LOCAL, or ANCHOR_EVAL_FAILED when
the precondition doesn't hold. AX content-view inset calibration
is stubbed at [0,0]; Task 14 is NOT currently planned to refine it
in v1 — defer to follow-up."
```

---

## Task 14: `--anchor-browser` flag on `show create` and `show update`

**Rationale:** Surface the anchor resolver in the CLI. Mutually exclusive with the existing `--anchor-window` / `--anchor-channel`.

**Files:**
- Modify: `src/display/client.swift` (`parseCanvasMutationOptions` around line 133-170)
- Create: `tests/browser/show-anchor.test.sh`

- [ ] **Step 1: Write the failing test.**

```bash
cat > tests/browser/show-anchor.test.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
export PATH="$FIX:$PATH"
export FAKE_PWCLI_VERSION="0.9.9"
export FAKE_PWCLI_MODE="new"
tmproot="/tmp/aos-show-$$"
export AOS_STATE_ROOT="$tmproot"
export AOS_RUNTIME_MODE="repo"
trap 'rm -rf "$tmproot"' EXIT

# Seed a local browser session
./aos browser _registry add --id=sess --mode=attach --attach-kind=extension --browser-window-id=88888 >/dev/null

# Mutual exclusion: --anchor-browser with --anchor-window
if ./aos show create --id demo --anchor-browser "browser:sess/e1" --anchor-window 12345 --html "<div/>" 2>/dev/null; then
    echo "FAIL mutual-excl: expected error" >&2; exit 1
fi

# Valid --anchor-browser creates canvas via daemon with the resolved anchor
# (daemon auto-starts if needed; fake-CLI is used only for eval)
out=$(./aos show create --id demo-browser --anchor-browser "browser:sess/e1" --html "<div/>" 2>&1)
echo "$out" | grep -q '"status":"success"' || { echo "FAIL create: $out" >&2; exit 1; }

# show update preserves anchor
out=$(./aos show update --id demo-browser --anchor-browser "browser:sess/e1" 2>&1)
echo "$out" | grep -q '"status":"success"' || { echo "FAIL update: $out" >&2; exit 1; }

./aos show remove --id demo-browser >/dev/null

echo "PASS"
EOF
chmod +x tests/browser/show-anchor.test.sh
```

- [ ] **Step 2: Run — confirm failure.**

Expected: `Unknown argument: --anchor-browser`.

- [ ] **Step 3: Extend the canvas-option parser.**

In `src/display/client.swift` inside `parseCanvasMutationOptions`:

```swift
case "--anchor-browser":
    options.anchorBrowser = nextCanvasArg(args, index: &i, missingMessage: "--anchor-browser requires browser:<s>[/<ref>]")
```

Add `anchorBrowser: String?` to the `CanvasMutationOptions` struct.

After parsing, before sending the request, translate `anchorBrowser` into `anchorWindow` + `offset`:

```swift
if let browserSpec = options.anchorBrowser {
    if options.anchorWindow != nil || options.anchorChannel != nil {
        exitError("--anchor-browser is mutually exclusive with --anchor-window and --anchor-channel", code: "INVALID_ARG")
    }
    do {
        let t = try parseBrowserTarget(browserSpec)
        let anchor = try resolveBrowserAnchor(target: t)
        options.anchorWindow = anchor.anchor_window
        options.offset = "\(anchor.offset[0]),\(anchor.offset[1]),\(anchor.offset[2]),\(anchor.offset[3])"
    } catch AnchorResolveError.notFound(let id) {
        exitError("browser session '\(id)' not registered", code: "NOT_FOUND")
    } catch AnchorResolveError.headless {
        exitError("headless browser sessions cannot be anchored", code: "BROWSER_HEADLESS")
    } catch AnchorResolveError.notLocal(let msg) {
        exitError(msg, code: "BROWSER_NOT_LOCAL")
    } catch AnchorResolveError.evalFailed(let msg) {
        exitError(msg, code: "ANCHOR_EVAL_FAILED")
    } catch BrowserTargetError.invalid(let msg) {
        exitError(msg, code: "INVALID_TARGET")
    } catch BrowserTargetError.missingSession {
        exitError("PLAYWRIGHT_CLI_SESSION not set", code: "MISSING_SESSION")
    } catch {
        exitError("\(error)", code: "INTERNAL")
    }
}
```

Also update the command registry entry for `show create` (and `show update`) to list `--anchor-browser` as a new flag and note the three-way mutual exclusion.

- [ ] **Step 4: Build and test.**

```bash
bash build.sh && bash tests/browser/show-anchor.test.sh
```

Expected: `PASS`.

- [ ] **Step 5: Commit.**

```bash
git add src/display/client.swift src/shared/command-registry-data.swift tests/browser/show-anchor.test.sh
git commit -m "feat(show): add --anchor-browser to create and update

Resolves browser:<s>[/<ref>] to (anchor_window, offset) before the
daemon call, via resolveBrowserAnchor. Mutually exclusive with
--anchor-window and --anchor-channel. Errors from the resolver
propagate as structured codes (NOT_FOUND, BROWSER_HEADLESS,
BROWSER_NOT_LOCAL, ANCHOR_EVAL_FAILED)."
```

---

## Task 15: Command registry review + agent-introspection smoke test

**Rationale:** `aos help --json` is the one-call surface agents rely on to discover new verbs. Make sure every new form shows up and the examples run.

**Files:**
- Modify: `src/shared/command-registry-data.swift` (audit and add any missing forms)
- Create: `tests/browser/registry-introspection.test.sh`

- [ ] **Step 1: Write the assertion test.**

```bash
cat > tests/browser/registry-introspection.test.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

j=$(./aos help --json)

must_have() {
    local path="$1"
    echo "$j" | jq -e "$path" >/dev/null || { echo "FAIL missing: $path" >&2; exit 1; }
}

# do fill
must_have '.commands[] | select(.path == ["do"]).forms[] | select(.id == "do-fill")'
# do navigate
must_have '.commands[] | select(.path == ["do"]).forms[] | select(.id == "do-navigate")'
# focus create --target flag surfaced
must_have '.commands[] | select(.path == ["focus", "create"]).forms[] | .args[] | select(.token == "--target")'
# show create --anchor-browser
must_have '.commands[] | select(.path == ["show", "create"]).forms[] | .args[] | select(.token == "--anchor-browser")'
# show update --anchor-browser
must_have '.commands[] | select(.path == ["show", "update"]).forms[] | .args[] | select(.token == "--anchor-browser")'

echo "PASS"
EOF
chmod +x tests/browser/registry-introspection.test.sh
```

- [ ] **Step 2: Run — if any `must_have` fails, add the missing registry entry in `src/shared/command-registry-data.swift`, rebuild, re-run.**

```bash
bash build.sh && bash tests/browser/registry-introspection.test.sh
```

Expected: `PASS` after any needed additions.

- [ ] **Step 3: Commit.**

```bash
git add src/shared/command-registry-data.swift tests/browser/registry-introspection.test.sh
git commit -m "test(browser): assert new forms are agent-discoverable via aos help --json

Guards against forgetting to register do-fill, do-navigate, focus
create --target, show create/update --anchor-browser."
```

---

## Task 16: End-to-end smoke test against real `@playwright/cli`

**Rationale:** All prior tests use the fake shim. One test exercises the real binary end-to-end to catch integration issues (argv quoting, stdout parsing quirks, version-check real values). Opt-in via `# requires:` tag.

**Files:**
- Create: `tests/browser/smoke.test.sh`
- Create: `tests/browser/fixtures/smoke.html`

- [ ] **Step 1: Author the fixture page.**

```bash
cat > tests/browser/fixtures/smoke.html <<'EOF'
<!doctype html>
<html><body>
<h1>aos smoke</h1>
<button id="b1">Click me</button>
<input id="i1" placeholder="name" />
<div id="out"></div>
<script>
document.querySelector('#b1').addEventListener('click', () => {
  document.querySelector('#out').textContent = 'clicked';
});
</script>
</body></html>
EOF
```

- [ ] **Step 2: Write the smoke test.**

```bash
cat > tests/browser/smoke.test.sh <<'EOF'
#!/usr/bin/env bash
# requires: @playwright/cli
#
# Opt-in end-to-end test. CI skips unless PLAYWRIGHT_SMOKE=1.

set -euo pipefail

if [[ "${PLAYWRIGHT_SMOKE:-0}" != "1" ]]; then
    echo "SKIP (set PLAYWRIGHT_SMOKE=1 to run)"
    exit 0
fi

if ! command -v playwright-cli >/dev/null; then
    echo "SKIP (playwright-cli not installed)"
    exit 0
fi

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
SID="aos-smoke-$$"
tmproot="/tmp/aos-smoke-$$"
export AOS_STATE_ROOT="$tmproot"
export AOS_RUNTIME_MODE="repo"
trap "
  ./aos focus remove --id $SID >/dev/null 2>&1 || true
  playwright-cli -s=$SID close >/dev/null 2>&1 || true
  rm -rf $tmproot
" EXIT

# Launch headed browser against smoke.html
./aos focus create --id "$SID" --target browser://new --url "file://$FIX/smoke.html" >/dev/null

# Capture xray
out=$(./aos see capture "browser:$SID" --xray)
echo "$out" | jq -e '.elements | length > 0' >/dev/null || { echo "FAIL xray: $out" >&2; exit 1; }

# Find the button's ref
button_ref=$(echo "$out" | jq -r '.elements[] | select(.role == "button") | .ref' | head -1)
[[ -n "$button_ref" ]] || { echo "FAIL: no button ref in xray" >&2; exit 1; }

# Click it
./aos do click "browser:$SID/$button_ref" >/dev/null

# Wait for DOM update
sleep 1

# Re-xray and verify 'clicked' text appears somewhere
out=$(./aos see capture "browser:$SID" --xray)
echo "$out" | jq -e '[.elements[] | select(.title == "clicked" or .value == "clicked")] | length > 0' >/dev/null \
    || { echo "FAIL click effect: $out" >&2; exit 1; }

# Fill the input
input_ref=$(echo "$out" | jq -r '.elements[] | select(.role == "textbox") | .ref' | head -1)
./aos do fill "browser:$SID/$input_ref" "smoke test" >/dev/null

echo "PASS"
EOF
chmod +x tests/browser/smoke.test.sh
```

- [ ] **Step 3: Run locally with `PLAYWRIGHT_SMOKE=1`.**

```bash
bash build.sh && PLAYWRIGHT_SMOKE=1 bash tests/browser/smoke.test.sh
```

Expected: `PASS`. If fails, iterate on dispatch wiring.

- [ ] **Step 4: Commit.**

```bash
git add tests/browser/smoke.test.sh tests/browser/fixtures/smoke.html
git commit -m "test(browser): end-to-end smoke test against real @playwright/cli

Opt-in via PLAYWRIGHT_SMOKE=1. Exercises focus create browser://new,
see capture --xray (and ref extraction), do click, do fill. Skipped
in CI without the env var."
```

---

## Task 17: Docs — ARCHITECTURE.md note + agent-facing skill

**Files:**
- Modify: `ARCHITECTURE.md`
- Create: `skills/browser-adapter/SKILL.md`

- [ ] **Step 1: Add a short paragraph to `ARCHITECTURE.md` noting browser support.**

Locate the section covering targets/verbs and add a subsection:

```markdown
### Browser as a target

As of spec `docs/superpowers/specs/2026-04-24-playwright-browser-adapter-design.md`, a browser tab is a first-class target for `see`, `do`, and `show` verbs. The adapter lives entirely in the CLI process (`src/browser/`) and shells out to Microsoft's `playwright-cli`; the daemon is unchanged. Targets use the grammar `browser:<session>[/<ref>]` where `<session>` is the `playwright-cli -s=<name>` session (registered as an aos focus channel) and `<ref>` is a ref from a prior `aos see capture browser:<session> --xray`. Overlays anchored to browser elements are static in v1 — they follow Chrome window movement (via `anchor_window`) but not page scroll; agents re-issue `aos show update --anchor-browser …` to re-anchor.
```

- [ ] **Step 2: Author `skills/browser-adapter/SKILL.md`.**

```markdown
---
name: browser-adapter
description: Drive browsers (tabs, forms, clicks, navigation) through aos verbs. Trigger when a task requires reading or acting on web content — filling forms, extracting data, observing page state — and you want ref-based interaction that survives scroll.
---

# Browser Adapter

aos wraps `@playwright/cli` so browsers become targets for `aos see`, `aos do`, and `aos show`. The agent keeps using its familiar verbs; the adapter routes to `playwright-cli` under the hood.

## Setup

One-time:

```bash
npm install -g @playwright/cli@latest
```

Create a focus channel pointing at the user's running Chrome (primary co-presence mode):

```bash
aos focus create --id work --target browser://attach --extension
```

Or launch a fresh headed browser:

```bash
aos focus create --id bot --target browser://new --url https://example.com
```

The `<id>` you pick is both the aos focus channel id and the `playwright-cli -s=<id>` session name.

## Addressing

- `browser:<session>` — current tab of the session
- `browser:<session>/<ref>` — a specific element; refs come from `aos see capture browser:<session> --xray`
- Bare `browser:` resolves to `browser:$PLAYWRIGHT_CLI_SESSION` when the env var is set

## Common patterns

**Look at a page.**

```bash
aos see capture browser:work --xray
# Returns elements with role, title, ref. bounds is absent.
```

**Interact with an element.**

```bash
aos do click browser:work/e21
aos do fill browser:work/e34 "hello"
aos do key browser:work Enter
aos do navigate browser:work https://example.com
```

**Label elements visually.**

```bash
aos see capture browser:work --xray --label --out /tmp/labeled.png
# Slow: one eval call per ref to fetch bounds, then annotated PNG.
```

**Overlay a canvas on a page element (static v1).**

```bash
aos show create --id explainer --anchor-browser browser:work/e21 --offset 0,0,400,100 --html "<div>A tooltip</div>"
# Survives Chrome window movement; does NOT follow page scroll.
# Re-anchor after scroll: aos show update --id explainer --anchor-browser browser:work/e21
```

## Escape hatch

`playwright-cli` remains directly callable. Use it for primitives aos doesn't wrap in v1:
- `playwright-cli -s=work check e21` / `uncheck` / `select`
- `playwright-cli -s=work upload <file>`
- `playwright-cli -s=work tab-list` / `tab-select` / `tab-new`
- `playwright-cli -s=work tracing-start` / `video-start`
- `playwright-cli -s=work go-back` / `go-forward` / `reload`
- `playwright-cli -s=work run-code "<js>"` for arbitrary Playwright access

## Gotchas

- Refs are valid until the next structural DOM change. Re-snapshot if the page mutates.
- `show` anchoring requires a local visible browser window. Headless sessions and remote `--cdp=<url>` error with `BROWSER_HEADLESS` / `BROWSER_NOT_LOCAL`.
- Overlays do not follow scroll. Design for static anchors or re-issue `show update` on scroll.
- Multiple simultaneous `aos` invocations against one session serialize inside `playwright-cli`; aos does no additional coordination.

## See also
- Spec: `docs/superpowers/specs/2026-04-24-playwright-browser-adapter-design.md`
- Escape-hatch reference: https://github.com/microsoft/playwright-cli
```

- [ ] **Step 3: Commit.**

```bash
git add ARCHITECTURE.md skills/browser-adapter/SKILL.md
git commit -m "docs(browser): add ARCHITECTURE note and agent-facing skill

One-paragraph mention in ARCHITECTURE.md that browsers are now a
target medium. New skill in skills/browser-adapter/ documents setup,
addressing grammar, common patterns, escape hatches, and gotchas
(including static-only anchoring in v1)."
```

---

## Self-Review Checklist

After all tasks land:

**Spec coverage:** skim `docs/superpowers/specs/2026-04-24-playwright-browser-adapter-design.md` section by section:
- Architecture seam → Task 7 + Tasks 8–14 (dispatchers)
- Target grammar → Task 2
- Session lifecycle (attach / launched) → Task 12
- Session registry → Task 6
- Verb mapping `see` → Task 8
- Verb mapping `do` → Tasks 9, 10, 11
- Verb mapping `show` → Tasks 13, 14
- Xray schema (bounds optional, ref) → Task 1 + Task 5
- `show.update` anchor preservation → Task 14
- CLI surface additions → Tasks 2, 9–14 + Task 15
- Files and deliverables → all tasks
- MCP out of scope → no task needed (documented as deferred)
- Escape hatch → Task 17 (skill)
- chrome-harness retirement → Task 17 (new skill replaces it)

**Placeholder scan:** any `TBD`, `TODO`, `figure out later`?
- Task 13 says "TODO (per spec Open Question #5): subtract Chrome content-view inset. v1 implementation: use the viewport rect as-is." This is an acknowledged v1 limitation noted in the spec, not a plan placeholder. Covered.

**Type consistency:** does `BrowserTarget` used in later tasks match the definition in Task 2? Yes. `AXElementJSON.bounds` optional after Task 1, consumed as optional in Tasks 5 and 8. `PlaywrightResult` from Task 4 consumed in Tasks 7, 9, 10, 11. `BrowserSessionRecord` from Task 6 consumed in Tasks 12, 13.

**Execution order dependency:**
- Task 1 must land first (contract change).
- Tasks 2, 3 in parallel (target parser + version check are independent).
- Task 4 depends on 3.
- Task 5 depends on 1, 2.
- Task 6 is independent; can run in parallel with 5.
- Task 7 depends on 4, 5, 6.
- Tasks 8, 9, 10, 11 depend on 7. Can run in parallel.
- Task 12 depends on 7 (calls `runPlaywright` and `addRegistryRecord`).
- Task 13 depends on 6, 7.
- Task 14 depends on 13.
- Task 15 depends on all CLI-surface tasks (2, 9, 10, 11, 12, 14).
- Task 16 is integration; runs after everything.
- Task 17 is docs; last.

Parallelization opportunity for `/batch`:
- Batch A (serial): Tasks 1 → 2 → 3 → 4 → 5 → 6 → 7 (sequential core)
- Batch B (parallel after A): Tasks 8, 9, 10, 11, 12, 13
- Batch C (serial): Task 14 (after 13)
- Batch D (parallel): Tasks 15, 16, 17

---

## Plan complete.

Plan complete and saved to `docs/superpowers/plans/2026-04-24-playwright-browser-adapter.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

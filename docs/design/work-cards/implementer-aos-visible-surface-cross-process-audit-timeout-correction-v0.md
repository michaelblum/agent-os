# Implementer Work Card: AOS Visible Surface Cross-Process Audit Timeout Correction V0

## Recipient

Implementer correction round.

## Branch / Base

- `branch_from`: `implementer/aos-visible-surface-cross-process-audit-v0`
- `minimum_code_start_ref`: `57c3b79611d28a263b154e434751d92cb0e9c057`
- `required_start_ref`: the Foreman correction-routing checkpoint containing
  this work card, descendant of `57c3b79611d28a263b154e434751d92cb0e9c057`.
- `expected_output_branch`: `implementer/aos-visible-surface-cross-process-audit-v0`

Do not restart from `origin/main`. This is a bounded correction for the pushed
cross-process audit implementation.

## Source Artifact

Implementer reported completion at:

```text
57c3b79611d28a263b154e434751d92cb0e9c057 fix(show): audit external AOS native windows
```

Foreman review repaired branch-scoped Sigil content-root drift with:

```bash
./aos experience activate sigil --json
```

After that, runtime health was clean:

- one repo daemon;
- one active input tap;
- no stale daemons;
- no stale canvases;
- `./aos clean --dry-run --json` returned `status: clean`.

But the new audit command failed live:

```bash
./aos show audit --json
```

returned:

```json
{
  "code": "INTERNAL",
  "error": "IPC failure while waiting for show.audit response: {}"
}
```

This is an acceptance blocker. The current implementation appears to perform
process metadata shell-outs inside the daemon audit path:

- `visibleSurfaceAudit()` calls `externalAOSNativeWindows(...)`;
- `externalAOSNativeWindows(...)` calls `externalAOSProcessIdentity(pid:)` for
  every visible non-current native window before cheap AOS-candidate filtering;
- `externalAOSProcessIdentity(pid:)` shells out through `ps` and may run `git`;
- the show client waits only a bounded IPC interval before failing.

Human-visible evidence during the same review:

- macOS Accessibility settings showed two `aos` entries, one disabled and one
  enabled;
- mouse input was noticeably laggy, which historically correlated with
  multiple input taps;
- AOS status did not prove multiple active taps: it reported one active tap and
  no stale daemons after content-root repair.

Foreman stopped the repo service after review to remove the active repo tap
while this correction is pending:

```bash
./aos service stop --mode repo --json
```

Do not treat the duplicate TCC row as permission staleness by default. It is
evidence that AOS needs better duplicate runtime/TCC observability, but this
correction round is primarily about making `show audit` live-safe and
acceptance-testable.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make `./aos show audit --json` return promptly and reliably on the live desktop
while preserving the accepted current-daemon audit contract and the new
external AOS native window section.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `docs/design/work-cards/implementer-aos-visible-surface-cross-process-audit-v0.md`
- `src/display/canvas.swift`
- `scripts/aos-show-client.mjs`
- `tests/canvas-visible-surface-audit.sh`
- `tests/ready-stale-daemon-hygiene.sh`
- `scripts/aos-clean.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor 57c3b79611d28a263b154e434751d92cb0e9c057 HEAD; echo "cross_process_audit_head_ancestor=$?"
./aos ready --json
./aos status --json
./aos clean --dry-run --json
./aos show audit --json
./aos dev recommend --json --paths src/display/canvas.swift,scripts/aos-show-client.mjs,tests/canvas-visible-surface-audit.sh,tests/ready-stale-daemon-hygiene.sh,scripts/aos-clean.mjs
rg -n "visibleSurfaceAudit|externalAOSNativeWindows|externalAOSProcessIdentity|processCommandLine|aosCleanStaleDaemonCandidatePIDs|runProcess|show audit|IPC failure" src/display/canvas.swift scripts tests
```

If `./aos ready --json` or `./aos ready --post-permission` reports a repo-mode
TCC, Accessibility, Input Monitoring, or inactive input-tap blocker, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention`. After the human returns with `finished`,
continue in the same Implementer session and run:

```bash
./aos ready --post-permission
```

Do not start permission setup, readiness repair, or ad-hoc retry loops from
Implementer. Do not classify the duplicate Accessibility UI row alone as stale TCC if
`./aos ready` reports ready.

## Required Behavior

### Audit Returns Promptly

`./aos show audit --json` must succeed on the live desktop with no registered
canvases and no external AOS windows. It must not hit the show-client IPC
timeout.

The daemon audit path must avoid per-window synchronous shell-outs on the hot
response path. Prefer one of these patterns after inspecting the code:

- cheap prefilter native windows by owner name, current/stale candidate PID, or
  obvious executable evidence before any process metadata lookup;
- batch process metadata once per unique PID rather than once per window;
- make expensive provenance fields explicitly unavailable in the fast path;
- move slow metadata enrichment behind a bounded helper with a strict timeout
  and fallback unavailable reasons.

Do not solve this by only increasing the show-client timeout. A small timeout
adjustment is acceptable only after the daemon path is bounded and fast.

### Preserve Audit Semantics

Keep the strict field meanings from the accepted audit cards:

- `orphan_native_windows` remains current-daemon only and visible/on-screen;
- `non_visible_unmatched_native_windows` remains separate;
- `external_aos_native_windows` remains separate from current-daemon registry
  rows and current-daemon orphan rows;
- current-daemon registered rows still include requested frame and actual
  native frame truth;
- external rows include native truth and process/provenance truth where
  available, or explicit unavailable reasons.

### Point Winner Remains Bounded

`./aos show audit --json --point x,y` must also return promptly. If external
window winner classification requires expensive process metadata, classify from
bounded cached or prefiltered metadata only.

### TCC Duplicate Entry Evidence

Do not build a broad TCC-reset workflow in this correction. Record in the
completion report whether `./aos status --json` and `./aos ready --json` show:

- active input tap count/attempt status available from AOS;
- stale daemons;
- installed-mode socket reachability;
- any runtime ownership mismatch.

If AOS cannot observe duplicate TCC database rows or multiple active event taps
outside its own daemon, say that explicitly and recommend a separate AOS
input-tap/TCC duplicate observability card.

## Hard Boundaries / Non-Goals

- Do not resume toolkit placement, Sigil avatar avoidance, or live panel drag.
- Do not make `./aos ready` a visual-surface or TCC-entry exclusivity proof.
- Do not hide the live failure by removing `external_aos_native_windows`.
- Do not rely on test-only fixture injection as the only proof.
- Do not leave repo service running at the end if live checks fail and mouse
  lag is still reported.
- Do not mutate unrelated untracked work cards or reports.

## Verification

Run deterministic checks:

```bash
git diff --check
./aos dev recommend --json --paths src/display/canvas.swift,scripts/aos-show-client.mjs,tests/canvas-visible-surface-audit.sh,tests/ready-stale-daemon-hygiene.sh,scripts/aos-clean.mjs
./aos dev build
bash build.sh --no-restart
bash tests/canvas-visible-surface-audit.sh
bash tests/canvas-owner-metadata.sh
bash tests/daemon-input-surface-ownership.sh
```

Run live acceptance checks after readiness:

```bash
./aos ready --json
./aos status --json
./aos clean --dry-run --json
./aos show audit --json
./aos show audit --json --point 90,100
```

The two audit commands must return `status: success` and include
`external_aos_native_windows` without timing out.

If feasible, repeat `./aos show audit --json` several times and report the
rough elapsed behavior. Exact benchmarking is not required, but a live command
that repeatedly takes near the IPC timeout is not accepted.

Final cleanup:

```bash
./aos show remove-all
./aos show list --json
./aos status --json
./aos clean --dry-run --json
```

## Completion Report

Include:

- branch name and head SHA;
- changed paths;
- root cause of the live IPC timeout;
- exact changes made to bound external process metadata lookup;
- whether `external_aos_native_windows` and point winner still work;
- deterministic test commands and pass/fail results;
- live `./aos show audit --json` and `--point` results;
- final AOS status/clean/show-list state;
- whether duplicate Accessibility `aos` entries or mouse lag are still
  observable after the correction;
- whether a separate input-tap/TCC duplicate observability card is recommended.

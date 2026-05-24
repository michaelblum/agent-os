# Codex Goal Rebuild Pause Guard Plan

Date: 2026-05-24

## Problem

Repo-mode Swift rebuilds can invalidate or stale the macOS
Accessibility/Input Monitoring grant for `./aos`. Today GDI often spends a full
extra loop after `./aos dev build`:

- waits for build output;
- runs or interprets readiness;
- runs the TCC helper;
- runs status/ref commands;
- writes a verbose `human_needed` report;
- only then stops.

For long-running `/goal` work, this is the wrong shape. The successful rebuild
itself is the deterministic checkpoint: the goal should pause immediately and
wait for the human permission repair path instead of spending another loop
classifying readiness.

## Constraint

Codex does not currently expose a documented config/API switch for hard
conditions like "pause after rebuild if TCC is stale." The available control is
the normal `/goal pause` command plus goal text, hooks, and local wrappers.

## Plan

### 1. Contract Layer

Every long-running GDI goal that may rebuild `./aos` should include an explicit
pause condition:

```text
After any successful `./aos dev build`, immediately issue `/goal pause` and
wait. Do not run readiness/status/helper loops before pausing. After the human
returns, run only `./aos ready --post-permission` before resuming verification.
```

This is necessary but not sufficient because natural-language compliance can
drift.

### 2. Codex Hook Layer

Add a dock/Codex hook on `PostToolUse` or the nearest supported tool-result
event. This should live in the dock hook configuration, not in a GDI-only work
habit, so it applies whenever Codex runs `./aos dev build` from Foreman, GDI,
Operator, or a future dock.

Responsibilities:

- inspect the completed tool call and identify successful invocations of
  `./aos dev build` from this repo;
- write the existing short-lived stop-condition marker for the Stop hook;
- return a concise system message or hook response that tells Codex to issue
  `/goal pause` immediately;
- avoid running `ready --repair`, `permissions reset-runtime`, `git status`, or
  other expensive ritual unless explicitly requested.

The hook packet should begin with a stable token such as
`goal_pause_required: repo-mode AOS permission repair` and tell Codex to type
`/goal pause` immediately.

### 3. Harness Enforcement Layer

If the provider loop still does not pause reliably from hook output alone, add a
harness-level watcher where available:

- detect the stable `goal_pause_required:` token in the GDI session output;
- send `/goal pause` into the session;
- let the existing Stop hook consume the stop-condition marker and speak the
  short TCC notice.

This is the stronger form because it does not rely only on instruction
following.

### 4. Optional Wrapper Fallback

A wrapper around `./aos dev build` can still be useful for manual/non-Codex
invocations, but it is not the primary solution. Do not make GDI depend on
remembering a special wrapper command when a Codex hook can enforce the rule for
the actual tool call.

### 5. Tests

Use fake `./aos` fixtures rather than real TCC:

- build fails: hook does not hide compiler failure or synthesize a permission
  pause;
- build succeeds: hook prints `goal_pause_required`, writes
  `tcc_permission_reset`, and does not run any `./aos` readiness, repair, or
  status command;
- non-build commands: hook exits quietly and does not request pause;
- Stop hook still converts the marker into the existing concise TCC stop notice.

Likely test homes:

- `tests/dock-hook-isolation.sh`
- `tests/dock-session-pickup.sh`
- a new focused shell test if the post-tool hook deserves one.

### 6. Rollout Into The Long Rearchitecture Goal

Before command-surface demolition, GDI should commit the hook-level guardrail and
verify it with fake-AOS tests.

Success for this preliminary fix:

- one rebuild/TCC blocker produces one concise pause packet;
- the current goal is paused with `/goal pause`;
- the human returns with `ready`;
- GDI runs only `./aos ready --post-permission` before resuming.

## Non-Goals

- Do not invent a fake Codex config option.
- Do not service-wide reset TCC.
- Do not make every test failure pause the goal.
- Do not block deterministic non-live verification when readiness is irrelevant.

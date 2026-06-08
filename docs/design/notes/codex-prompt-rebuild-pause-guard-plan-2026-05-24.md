# Codex Goal Rebuild Pause Guard Plan

Date: 2026-05-24

Status: retired. Per-tool Codex hooks were removed because they added latency
to every tool result by forcing provider hook payload transfer, and the project
now relies on Foreman-owned rebuilds plus markdown contracts rather than hook
enforcement for AOS binary/TCC policy.

## Problem

Repo-mode Swift rebuilds can invalidate or stale the macOS
Accessibility/Input Monitoring grant for `./aos`. Today Implementer often spends a full
extra loop after `./aos dev build`:

- waits for build output;
- runs or interprets readiness;
- runs the TCC helper;
- runs status/ref commands;
- writes a verbose `manual_intervention` report;
- only then stops.

For long-running `` work, this is the wrong shape. The successful rebuild
itself is the deterministic checkpoint: the goal should pause immediately and
wait for the human permission repair path instead of spending another loop
classifying readiness.

## Constraint

Codex does not currently expose a documented config/API switch for hard
conditions like "pause after rebuild if TCC is stale." The available control is
the normal `pause` command plus goal text, hooks, and local wrappers.

## Plan

### 1. Contract Layer

Every long-running Implementer goal that may rebuild `./aos` should include an explicit
pause condition:

```text
After any successful `./aos dev build`, immediately issue `pause` and
wait. Do not run readiness/status/helper loops before pausing. After the human
returns, run only `./aos ready --post-permission` before resuming verification.
```

This is necessary but not sufficient because natural-language compliance can
drift.

### 2. Retired Per-Tool Hook Layer

Do not add a `PostToolUse`, `PreToolUse`, or equivalent provider per-tool hook
for rebuild/TCC policy. The previous pass-through hooks still forced Codex to
serialize and pipe hook payloads after every tool call, which made large command
outputs feel like hook stalls even when the hook did no work.

The current contract is:

- Foreman owns repo-mode `./aos` rebuilds.
- Implementer and Operator must not auto-build or install hook guardrails for rebuilds.
- If the binary changes, Foreman stops and tells the human to manually
  remove/re-add the repo binary in macOS TCC.
- The Stop hook may remain for dock stop notices, but per-tool hooks stay
  absent.

### 3. Harness Layer

No harness-level prompt-pause injection is active. The old automatic pause,
permission-reset, Settings-open, and manual-intervention surface helpers were removed.
Future enforcement should stay in explicit work-card instructions and Foreman
review, not provider per-tool hooks.

### 4. Optional Wrapper Fallback

A wrapper around `./aos dev build` can still be useful for manual/non-Codex
invocations, but it is not the primary solution. Do not make Implementer depend on
remembering a special wrapper command when a Codex hook can enforce the rule for
the actual tool call.

### 5. Tests

Use fake fixtures rather than real TCC:

- dock Codex config declares only the Stop hook;
- per-tool hook wrappers and runners do not exist;
- deleted build-checkpoint, permission-reset, Settings-open, and manual-intervention
  surface helpers stay absent;
- Stop hook behavior remains bounded and independent from rebuild/TCC policy.

### 6. Rollout Into The Long Rearchitecture Goal

Before command-surface demolition, Implementer should commit the hook-level guardrail and
verify it with fake-AOS tests.

Success for this preliminary fix:

- one rebuild/TCC blocker produces one concise pause packet;
- the current goal is paused with `pause`;
- the human returns with `finished`;
- Implementer runs only `./aos ready --post-permission` before resuming.

## Non-Goals

- Do not invent a fake Codex config option.
- Do not service-wide reset TCC.
- Do not make every test failure pause the goal.
- Do not block deterministic non-live verification when readiness is irrelevant.

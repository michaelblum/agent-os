# GDI Work Card Authoring

Use this reference when Foreman writes or revises a work card for a fresh GDI
session. The goal is reliable context transfer without freezing one permanent
prompt format. GDI starts from a new context window, so the work card must carry
the minimum map needed to rediscover state, inspect the right files, avoid old
wrong paths, and verify the slice.

This is a Foreman session-transfer reference, not a role-neutral recipe or a
schema. Omit slots that do not apply. Add specialty slots when the slice crosses
a boundary.

## Core Shape

### Tracker

Name the durable workstream:

- GitHub issue or epic.
- Design note, API doc, schema, or prior work card that owns the plan.
- Any draft evidence commit or branch that GDI must classify as retain, amend,
  supersede, or revert.

### Fresh Context Contract

State that GDI must not rely on parent-thread memory:

```md
GDI starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.
```

Keep this short. It is a posture reset, not a second AGENTS file.

### Goal

Write one narrow outcome in product or platform terms. Prefer "make X true" over
"change files A/B/C." If there is a user report, quote or summarize the observed
defect before implementation advice.

### Read First

List the smallest durable files GDI should read before searching:

- `AGENTS.md`;
- nearest subtree `AGENTS.md` for every owned area;
- the active design note or issue;
- the relevant `docs/api/` file if behavior crosses an interface;
- relevant schemas when data shape changes;
- one or two prior work cards only when they are current and directly adjacent.

Do not create a universal fixed read list for every GDI task. Use a reusable
foundation plus task-specific files.

### Rediscover State

Include commands when runtime or branch state matters:

```bash
git status --short --branch
git rev-parse --show-toplevel
git branch --show-current
./aos dev recommend --json
```

Add `./aos ready` only when live AOS readiness is actually required and the
round is allowed to start/restart live AOS. If the task is deterministic-only,
docs-only, pure Node tests, or explicitly says AOS is intentionally stopped,
state that live readiness is skipped.

For AOS-stopped or live-paused rounds, use passive classification instead of a
live readiness gate:

```bash
./aos service status --mode repo --json
ps -axo pid,ppid,stat,etime,command | rg '(/Users/Michael/Code/agent-os/aos|AOS\.app|aos serve|Agent-OS)' || true
lsof -nP -U | rg '/Users/Michael/.config/aos/repo/sock|/Users/Michael/Code/agent-os/aos' || true
```

Do not tell GDI to stop merely because `pgrep` or `ps` finds
`/Users/Michael/Code/agent-os/aos serve --idle-timeout none` or because PPID is
1. A normal launchd-managed repo service has that shape. Require classification
before blocking:

- managed repo service: `./aos service status --mode repo --json` reports
  `running:true`, `target_matches_expected:true`, and the service PID explains
  the wrapper/child process; continue deterministic work without live readiness.
- unmanaged owner: service/launchd facts do not explain the socket owner, or the
  owner is a foreground/dev process outside the accepted mode; stop with
  `human_needed` and report PID, PPID, command line, socket owner, and service
  status evidence.

Under `local_relay`, GDI must work from the single checkout at
`/Users/Michael/Code/agent-os`. Do not tell GDI to create linked git worktrees;
preserve unrelated work with named stashes, scoped commits, or local branches.

Add focused commands only when relevant:

```bash
gh issue view <n> --json number,title,state,url,body,labels
./aos show list --json
./aos dev recommend --json --files <likely-files...>
```

If the slice is pure docs or pure Node tests, say which runtime checks may be
skipped.

When live AOS verification can hit repo-mode Accessibility, Input Monitoring,
or inactive input-tap blockers, include the deterministic GDI stop branch:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

The GDI helper prints the human-needed TCC blocker and does not write hook
markers, reset permissions, open Settings, or start AOS. GDI must stop with
`human_needed` instead of retrying live checks or running permission setup
commands. After the human returns with `finished`, GDI returns the blocker to
Foreman for the next controlled step.

### Existing Code To Inspect

Name concrete files and why they matter. This is often the highest-leverage
section in a fresh GDI session.

Good:

```md
- `packages/toolkit/panel/chrome.js` - owns current minimize sequence.
- `packages/toolkit/panel/placement.js` - shared chip/frame placement helpers.
- `tests/toolkit/panel-chrome.test.mjs` - deterministic panel behavior tests.
```

Avoid broad directories unless the task is explicitly an audit.

### Required Behavior

Describe observable behavior and invariants. Use subsections for state machines,
failure behavior, cleanup, data shape, or UI behavior. Include rollback and
idempotence when relevant.

### Scope

Name the likely ownership boundary:

- daemon/native primitive;
- toolkit runtime;
- toolkit panel/windowing;
- toolkit controls;
- toolkit workbench/component;
- Sigil app;
- schema/API/docs;
- tests/verification only.

This helps GDI keep implementation at the right layer while still allowing it to
adjust after reading code.

### Hard Boundaries / Non-Goals

Use explicit anti-scope language. Strong prior GDI work cards were good because
they told GDI what not to resume:

- do not continue adjacent workstreams;
- do not open live websites;
- do not add a broad framework;
- do not move policy into daemon unless the card explicitly says so;
- do not mutate fixtures or capture artifacts unrelated to this slice.

Keep these concrete. Generic "stay focused" is weak.

### Suggested Implementation Areas

Offer likely files/modules, but label them as suggestions. GDI should inspect
before editing and may choose the narrower correct layer.

### Verification

Name exact deterministic tests first. Add live AOS smoke only when runtime
readiness allows.

Prefer this shape:

```bash
node --test tests/toolkit/<focused>.test.mjs
git diff --check
```

Then:

```md
If `./aos ready` passes, run this bounded smoke:
1. ...
```

Say what to do when readiness is blocked: use the repo repair path, or report
the blocker if the task can still be verified deterministically.

### Completion Report

Require the information Foreman needs next:

- files changed;
- behavior changed;
- tests run with exact result;
- live smoke result or readiness blocker;
- local-only state that remote reviewers cannot see, such as dirty files,
  untracked/generated artifacts, local config, permissions, daemon state, or
  runtime blockers;
- draft evidence retained/amended/superseded/reverted;
- remaining blockers or follow-up slices.

For non-trivial work, especially in a dirty checkout, ask GDI for a lightweight
path-scoped summary instead of a broad status dump. The report should name the
changed paths that belong to the slice, exact verification commands with
pass/fail results, live AOS readiness or the reason live checks were skipped,
known unrelated dirty state, artifact paths for large proof payloads when
applicable, and the remaining follow-up recommendation when the source card has
one. Do not require this shape for tiny one-line fixes where it would add more
noise than review value.

For `agentic_relay` work, the pushed branch is the remote-visible code artifact.
The completion report must also say whether any local-only state exists and
whether it is related. Remote relay can request a bounded `LOCAL_PROBE_REQUEST`
when GitHub-visible evidence is insufficient.

### Post-GDI Review Option

For non-trivial implementation cards, Foreman may plan a separate bounded review
after completion:

- do not make review part of GDI's assigned implementation task unless the user
  explicitly asks;
- after GDI reports completion, Foreman inspects local diff/status/evidence;
- spawn a bounded review or correction only when the slice actually needs it;
- Foreman owns acceptance after reading the returned report and locally
  inspecting the relevant diff, status, and test evidence;
- if the returned tail is only a work report and the slice has meaningful
  behavioral, architectural, or integration risk, Foreman may recommend a
  `/review` round before acceptance;
- route correction work through Foreman when review findings affect behavior,
  architecture, scope, or priority;
- Foreman may send a follow-up or correction prompt for the same GDI session
  when the context is still useful and the fix is narrow;
- let GDI address only tiny mechanical review fixes directly when no acceptance
  judgment is needed.

## Specialty Slots

Add these only when the slice needs them.

### Daemon / Native Primitive Slot

Use for Swift or daemon contract work:

- require `./aos dev recommend --json` before build choices;
- name TCC or permission implications;
- require `./aos dev build` instead of raw `bash build.sh`;
- separate native primitive from toolkit/app policy;
- add or update `shared/schemas/` or `docs/api/` when the wire contract changes.

### Toolkit Surface / Windowing Slot

Use for panel, runtime, controls, workbench, or DesktopWorld changes:

- state whether behavior belongs in `runtime/`, `controls/`, `panel/`,
  `workbench/`, or `components/`;
- keep default surface/windowing policy in toolkit;
- use daemon primitives for lifecycle/input/display instead of app workarounds;
- require accessibility semantics for actionable controls.

### Sigil App Slot

Use for Sigil surfaces:

- separate Sigil product expression from reusable platform behavior;
- prefer toolkit panel/windowing for panels and workbenches;
- prefer shared DesktopWorld stages for simple global visuals;
- keep private 3D DesktopWorld renderers only when a distinct renderer lifecycle
  is justified;
- do not add new daemon product branches.

### Browser / Evidence Capture Slot

Use for browser or evidence work:

- name whether live websites are allowed;
- require fixtures when live capture is out of scope;
- name selector/locator approval rules;
- include source-unavailable, login, CAPTCHA, paywall, and consent blockers;
- prohibit report/export/rendering work unless explicitly in scope.

### Operator / HITL Slot

Use when GDI prepares work for Operator:

- make the human decision point explicit;
- define what Operator should observe, not implement;
- require structured artifacts or completion report fields that Foreman can
  consume;
- do not make Operator infer hidden terminal state.

### Docs / Governance Slot

Use for architecture, recipe, issue, or instruction work:

- name the source-of-truth boundary: `AGENTS.md`, subtree `AGENTS.md`,
  `.docks/`, `docs/guides/`, `docs/design/`, `docs/api/`, or
  `shared/schemas/`;
- avoid duplicating long policy in multiple files;
- update provider-specific compatibility files only as pointers when possible;
- run contradiction scans for retired phrases or superseded paths.

## Quality Checklist

Before handing to GDI, Foreman should be able to answer:

- Could GDI start from a blank context and find the right files?
- Is the goal narrow enough to finish and verify in one session?
- Are adjacent tempting workstreams explicitly excluded?
- Are layer boundaries clear without blocking code-informed adjustment?
- Is the verification concrete enough that GDI cannot hand-wave success?
- Does the completion report ask for what Foreman needs to choose the next
  slice?

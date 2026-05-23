# Dock Session Pickup Recipe v0

## Recipient

GDI

## Transfer Kind

GDI round

## Profile

`agentic_relay`

## Tracker

Source discussion: repeated GDI/Foreman/Operator session startup work is useful
for handoff safety, but too much of it is procedural boilerplate repeated in
prose and model habit.

Accepted context head before this routing:

- `gdi/afk-warm-reuse-agent-terminal-session-fixture-correction-v0` at
  `28b0c1830a5cc617ded1ee9a097dff1051e8f053`.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, provider, or prior implementation state. Read and rediscover
before editing.

## Goal

Add a first-class deterministic dock session pickup primitive that makes
cross-session work-card startup cheap, consistent, and machine-readable without
moving task judgment out of the model.

The primitive should factor shared pickup mechanics into scripts/config:

- verify repo root;
- inspect current branch/status/head;
- check work card existence and lightly surface card metadata;
- resolve the required start ref;
- prepare or validate the output branch safely;
- run bounded AOS readiness;
- report the standard TCC/human-needed stall path when readiness blocks;
- emit compact structured output that future AFK and dock sessions can consume.

Task-specific intent stays in work cards. Dock entry behavior stays in
`.docks/<dock>/inbound-contract.json`. The model still owns judgment,
implementation choices, and tradeoffs after pickup.

## Branch / Base

- card_branch: `foreman/dock-session-pickup-recipe-v0`
- branch_from: `gdi/afk-warm-reuse-agent-terminal-session-fixture-correction-v0`
  at `28b0c1830a5cc617ded1ee9a097dff1051e8f053`
- required_start_ref: `foreman/dock-session-pickup-recipe-v0`
- expected_output_branch: `gdi/dock-session-pickup-recipe-v0`

Create or update the expected output branch from the required start ref. Do not
reset to `origin/main`; this card exists on a feature branch.

## Read First

- `AGENTS.md`
- `.docks/AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `.docks/gdi/inbound-contract.json`
- `.docks/gdi/scripts/human-needed-tcc-reset`
- `scripts/dock-handoff-clipboard`
- `scripts/dock-inbound-message-contract`
- `tests/dock-handoff-clipboard.sh`
- `tests/foreman-handoff-wrapper.sh`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline --decorate --max-count=8
./aos ready
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or
inactive input-tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `ready`, run:

```bash
./aos ready --post-permission
```

Only continue if it reports ready.

## Existing Code To Inspect

- `.docks/gdi/AGENTS.md` - currently documents the manual pickup sequence that
  this primitive should partially automate.
- `.docks/AGENTS.md` - owns shared dock vocabulary and cross-session transfer
  boundaries.
- `scripts/dock-handoff-clipboard` and
  `scripts/dock-inbound-message-contract` - examples of shared repo scripts
  with dock-specific behavior and deterministic tests.
- `.docks/gdi/scripts/human-needed-tcc-reset` - standard stall helper that the
  pickup result should reference, not duplicate.
- `tests/dock-handoff-clipboard.sh` and `tests/foreman-handoff-wrapper.sh` -
  shell-test style for small dock harness scripts.

## Required Behavior

Implement the smallest useful v0 pickup surface:

- Add a shared repo-level script, suggested path:
  `scripts/dock-session-pickup`.
- Add a GDI convenience wrapper, suggested path:
  `.docks/gdi/scripts/pickup`, that delegates to the shared script with
  `--dock gdi`.
- The GDI wrapper should support the motivating shape:

```bash
.docks/gdi/scripts/pickup \
  --card docs/design/work-cards/foo.md \
  --start-ref <branch-or-sha> \
  --output-branch gdi/foo
```

- The shared script should emit compact JSON by default or through `--json`.
  If you choose non-JSON default output, `--json` is still required.
- The JSON should include at least:
  - `record_type`, for example `aos.dock_session_pickup`;
  - `schema_version`;
  - `dock`;
  - `repo_root`;
  - `worktree.branch`, `worktree.head`, and a compact status summary;
  - `card.path`, `card.exists`, and best-effort metadata such as title,
    recipient, transfer kind, `required_start_ref`, and expected output branch
    when parseable from common work-card headings;
  - `start_ref.input`, `start_ref.resolved`, and `start_ref.sha` or failure
    reason;
  - `output_branch.name` and action taken or refused;
  - `readiness.status` plus the bounded `./aos ready` command/result summary;
  - `stall_path` equal to the dock's TCC helper when relevant;
  - `next_action`: one of `proceed`, `human_needed`, `misrouted`, or `blocked`;
  - `diagnostics`.
- If the worktree is dirty before branch preparation, do not switch or reset
  branches. Report `next_action="blocked"` with a dirty-worktree diagnostic.
- If the work card does not exist after resolving/preparing the requested base,
  report `next_action="misrouted"` and do not infer another base.
- If `--output-branch` already exists, be conservative. Either:
  - validate that it already points at the requested start ref and switch to it;
  - or refuse with a diagnostic that names the branch and current SHA.
  Do not silently rebase, reset, or delete an existing branch in v0.
- Do not mutate main.
- Do not use provider CLI state, provider transcript bodies, or live dock TUI
  state.

## Safety And Scope

- Safety/pickup mechanics belong in scripts/config.
- Task-specific intent remains in work cards.
- Dock entry behavior remains in inbound contracts.
- Judgment stays with the model.
- Keep v0 deterministic and local. No GitHub mutation, no PR creation, no live
  provider launch, no Operator live proof.
- Do not rewrite `.docks/gdi/AGENTS.md` wholesale. A short mention of the new
  helper is fine if useful, but keep the existing prose contract as fallback
  until the primitive has proved itself.

## Suggested Implementation Notes

- Prefer Node or Bash, whichever keeps the code simplest and testable. If using
  Bash, keep JSON escaping correct; if that becomes awkward, use Node.
- Use environment overrides in tests, for example:
  - fake `AOS_DOCK_PICKUP_AOS_BIN` or similar for readiness output;
  - temp git repositories for branch/status behavior.
- A first slice does not need perfect Markdown parsing. Best-effort extraction
  from common headings and `- key: value` lines is enough if the output clearly
  marks unknown fields.

## Verification

Add focused tests for the new pickup primitive. Suggested test file:

```bash
tests/dock-session-pickup.sh
```

Run:

```bash
./aos ready
bash tests/dock-session-pickup.sh
bash tests/dock-handoff-clipboard.sh
bash tests/foreman-handoff-wrapper.sh
git diff --check
```

If implementation touches inbound contract schema behavior, also run:

```bash
node --test tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs
```

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- files changed;
- pickup command examples and JSON fields implemented;
- branch-preparation safety behavior;
- readiness/TCC stall behavior;
- exact verification commands and results;
- local-only dirty/generated artifacts;
- remaining risk or follow-up;
- confirmation that no live provider launch, real terminal drive, transcript
  body read, provider mutation, GitHub issue/PR/main mutation, async routing, or
  Operator live proof occurred.

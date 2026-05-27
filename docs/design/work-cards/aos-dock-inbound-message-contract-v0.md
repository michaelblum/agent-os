# Work Card: AOS Dock Inbound Message Contract V0

**Status:** Routed 2026-05-23

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: make dock/provider inbound message formatting an AOS-owned,
  dock-declared contract so Foreman and Operator do not carry private knowledge
  of GDI `/goal` syntax and repeated-completion prompt risks are rejected
  deterministically.
- Source artifacts:
  - `.docks/README.md`
  - `.docks/foreman/AGENTS.md`
  - `.docks/foreman/skills/session-transfer/SKILL.md`
  - `.docks/foreman/skills/session-transfer/references/gdi.md`
  - `.docks/foreman/skills/session-transfer/references/operator.md`
  - `.docks/foreman/packets/README.md`
  - `.docks/gdi/AGENTS.md`
  - `.docks/operator/AGENTS.md`
  - `.docks/foreman/dock.json`
  - `.docks/gdi/dock.json`
  - `.docks/operator/dock.json`
  - `shared/schemas/aos-dock-profile-v0.schema.json`
  - `shared/schemas/aos-dock-profile-v0.md`
  - `scripts/dock-handoff-clipboard`
  - `.docks/foreman/scripts/handoff`
  - `tests/dock-handoff-clipboard.sh`
  - `tests/schemas/aos-dock-profile-v0.test.mjs`
  - `docs/design/work-cards/operator-afk-warm-dock-tui-reuse-live-proof-v0.md`
- Branch/Base:
  - `branch_from: gdi/afk-warm-dock-tui-reuse-contract-v0`
  - `required_start_ref: gdi/afk-warm-dock-tui-reuse-contract-v0`
  - Foreman routing head:
    `8b690ed9c655007c8e76b7f0ee0750a2e2493f41`
- Branch/output expectation: create or reuse
  `gdi/aos-dock-inbound-message-contract-v0` from the required start ref.
  Commit and push that GDI branch when verification passes under the active
  `agentic_relay` profile. Do not open a PR, merge, mutate main, or mutate
  GitHub issues/projects.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider runtime, live terminal state, prior Operator proof state, or Foreman
chat memory. Read and rediscover before editing.

## Problem To Fix

Foreman currently knows too much about GDI message shape:

- Foreman copies a plain transfer pointer.
- The human manually enters `/goal ` in the GDI Codex CLI.
- The working payload is a pointer such as:
  `follow the transfer packet in ...; start from ...`.
- Operator improvised a one-shot proof prompt:
  `/goal Warm TUI reuse live proof only. Reply with exactly: ...`.
- That one-shot goal caused a repeated completion loop: GDI repeatedly satisfied the same
  objective and the normal Stop hook spoke `GDI finished.` each time.

This means the message contract is currently implicit, scattered across
Foreman docs, GDI docs, AFK prototype helpers, and human habit. The receiving
dock should declare how it wants to be addressed, and AOS should own the
contract vocabulary.

## Goal

Add an AOS-owned Dock Inbound Message Contract V0 and wire enough deterministic
tooling/tests so:

- GDI declares Codex inbound messages use `/goal ` for work goals but clipboard
  transfer payloads remain plain pointers;
- Operator declares supervised instructions are plain, not command-prefixed
  goals;
- Foreman and Operator can discover the target dock contract instead of
  hardcoding recipient prompt rules;
- Repeated-completion-prone one-shot GDI goal prompts are rejected or flagged before
  dispatch;
- future Claude Code or other providers can add provider-specific entry syntax
  without changing Foreman policy text.

## Required Behavior

### Core Contract Shape

Create an AOS-owned contract schema and docs. Suggested names:

- `shared/schemas/aos-dock-inbound-message-contract-v0.schema.json`
- `shared/schemas/aos-dock-inbound-message-contract-v0.md`

The contract should be dock-local and provider-aware. It must express at least:

- dock name and role;
- provider key, initially `codex`;
- context reset command, e.g. `/clear`;
- stale goal recovery command, e.g. `/goal clear`;
- clipboard payload policy: copied payload stays plain, without `/goal`;
- provider entry command/prefix for interactive entry, e.g. `/goal `;
- allowed payload kinds/templates:
  - transfer packet pointer;
  - work-card pointer;
  - successor handoff pointer if applicable;
  - plain supervised instruction for Operator;
- forbidden or risky prompt shapes:
  - one-shot `reply exactly` / `reply with exactly` goals for GDI;
  - status-only proof goals that do not point to a durable contract;
  - any prompt that asks GDI to self-accept architecture/product decisions;
- recovery and stop guidance for goal-mode loops.

Prefer a separate `.docks/<dock>/inbound-contract.json` file for V0. Do not
force all fields into `dock.json` unless the local schema/docs strongly point
that way. If you do add a `dock.json` reference, update
`aos-dock-profile-v0` schema/docs/tests accordingly.

### Canonical Dock Instances

Add or update dock-local contract instances for:

- `.docks/foreman/inbound-contract.json`
- `.docks/gdi/inbound-contract.json`
- `.docks/operator/inbound-contract.json`

Expected semantics:

- GDI/Codex:
  - context reset: `/clear`;
  - work entry prefix: `/goal `;
  - copied transfer payload: plain pointer;
  - allowed pointer examples:
    `follow the transfer packet in <path>; start from <ref>` and
    `follow the instructions in <path>; start from <ref>`;
  - stale goal recovery: `/goal clear`;
  - forbidden: one-shot reply-exactly goals.
- Operator/Codex:
  - context reset: `/clear`;
  - dispatch entry: plain Foreman payload, no `/goal`;
  - allowed payload: Operator work-card/packet pointer or bounded supervised
    instruction;
  - forbidden: asking Operator to route implementation or own branch strategy.
- Foreman/Codex:
  - context reset: `/clear`;
  - successor handoff entry: plain handoff payload;
  - allowed payload: successor-Foreman state compression or coordination task.

### Deterministic Formatter/Validator

Add the smallest deterministic tool surface that lets Foreman or tests ask:

```text
target dock + provider + payload -> clipboard payload + provider entry preview + validation
```

Suggested implementation options:

- a small script such as `scripts/dock-inbound-message-contract`;
- or a mode on `scripts/dock-handoff-clipboard`;
- or a small JS module plus script wrapper if that better fits current tests.

Required behavior:

- For GDI/Codex transfer-pointer payloads, validation passes and output records:
  - `clipboard_payload` is the plain pointer;
  - `provider_entry_prefix="/goal "`;
  - provider entry preview starts with `/goal follow ...`;
  - `context_reset_command="/clear"`;
  - `stale_goal_recovery_command="/goal clear"`.
- If a caller accidentally includes a leading `/goal ` in the clipboard payload,
  compatibility cleanup may still strip it, but the contract should make clear
  this is cleanup, not the canonical copied payload.
- For GDI/Codex one-shot `Reply with exactly...` or `Reply exactly...` payloads,
  validation fails or returns an explicit warning/error code such as
  `forbidden_goal_prompt_shape` or `repeated_completion_loop_risk`.
- For Operator/Codex, plain Operator pointer payloads pass with no `/goal`
  prefix.
- The tool must not write to the clipboard in validation/format-preview mode
  unless explicitly invoked through the existing handoff path.

### Documentation Updates

Update the smallest relevant docs so the new boundary is explicit:

- `.docks/README.md` should say dock inbound message contracts live with docks
  and Foreman should use them instead of hardcoding provider slash syntax.
- `.docks/foreman/AGENTS.md` should stop being the only source of GDI prompt
  formatting truth; it can say Foreman writes transfer artifacts and formats
  dispatches according to the target dock inbound contract.
- `.docks/gdi/AGENTS.md` should mention the contract file and repeated-loop
  recovery: `/goal clear`, then `/clear`, then wait for a real Foreman pointer.
- `.docks/operator/AGENTS.md` should avoid inventing GDI `/goal` prompts and
  should route GDI work back through Foreman/GDI contract.

Do not turn this into a broad rewrite of dock docs.

## Existing Code To Inspect

- `scripts/dock-handoff-clipboard` - current generic target-dock clipboard
  wrapper and legacy `/goal ` cleanup.
- `.docks/foreman/scripts/handoff` - Foreman wrapper used for dispatch copying.
- `tests/dock-handoff-clipboard.sh` and `tests/agent-handoff.sh` - existing
  handoff behavior tests.
- `shared/schemas/aos-dock-profile-v0.*` and
  `tests/schemas/aos-dock-profile-v0.test.mjs` - existing dock schema/test
  patterns.
- `.docks/*/dock.json` - current dock profiles, including thin `handoff`
  fields.
- `.docks/*/AGENTS.md` - role policy that should reference, not duplicate, the
  inbound contract details.

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD gdi/afk-warm-dock-tui-reuse-contract-v0 8b690ed9c655007c8e76b7f0ee0750a2e2493f41
./aos ready
./aos dev recommend --json --paths shared/schemas/aos-dock-profile-v0.schema.json,shared/schemas/aos-dock-profile-v0.md,.docks/README.md,.docks/foreman/AGENTS.md,.docks/gdi/AGENTS.md,.docks/operator/AGENTS.md,scripts/dock-handoff-clipboard,tests/dock-handoff-clipboard.sh,tests/agent-handoff.sh
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or
inactive input-tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Only continue if it reports ready.

## Verification

Run and report the relevant deterministic checks. Expected minimum:

```bash
node --test tests/schemas/aos-dock-profile-v0.test.mjs
```

If you add a new schema test, run it explicitly, for example:

```bash
node --test tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs
```

Run existing handoff tests if scripts changed:

```bash
bash tests/agent-handoff.sh
bash tests/dock-handoff-clipboard.sh
```

Run any new targeted formatter/validator tests you add.

Always run:

```bash
git diff --check
```

## Hard Boundaries

- Do not run a live Operator proof.
- Do not drive real Foreman, GDI, or Operator terminals.
- Do not run live Codex/provider launches.
- Do not mutate provider configs, provider stores, provider catalogs,
  telemetry, gateway state, dock runtime state, GitHub issues, PRs, or main.
- Do not read provider transcript bodies.
- Do not remove or relax `--i-am-present`.
- Do not implement async result routing.
- Do not make Foreman add `/goal` to copied clipboard payloads; the copied
  payload remains plain unless a later human-approved contract changes that.

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- contract files and schema/docs added or changed;
- exact formatter/validator command(s) and example outputs for:
  - valid GDI transfer packet pointer;
  - valid GDI work-card pointer;
  - rejected GDI reply-exactly one-shot prompt;
  - valid Operator plain pointer;
- verification commands and exact pass/fail counts;
- whether dock profile schema was changed or whether V0 used separate
  `inbound-contract.json` files;
- remaining follow-up recommendation, especially whether Foreman should next
  consume the contract in `.docks/foreman/scripts/handoff` or whether that was
  completed in this slice;
- explicit statement that no live provider launch, real terminal drive,
  transcript body read, provider store/catalog/telemetry mutation,
  gateway/dock runtime mutation, GitHub issue/PR/main mutation, external
  notifier, async result route, or unsupervised trigger behavior occurred.

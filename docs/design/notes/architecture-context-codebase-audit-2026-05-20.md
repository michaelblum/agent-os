# Architecture and Context Codebase Audit - 2026-05-20

## Status

Foreman first-pass audit. No source or contract files were changed by this
audit. Findings should be independently validated before `ARCHITECTURE.md` or
`CONTEXT.md` are revised.

## Scope

This audit compared top-level architecture and terminology claims in:

- `ARCHITECTURE.md`
- `CONTEXT.md`

against the current codebase on branch
`gdi/toolkit-panel-theme-consistency-audit-v0`.

The audit focused on claims that are concrete enough to verify against command
registries, Swift implementations, toolkit helpers, schemas, and package
layout.

## Summary

`CONTEXT.md` is mostly aligned with the current schema-backed workbench subject
model and Work Record v0 terminology. Its main drift is that it describes
`screen:` and `ax:` as if they are live CLI target dialects, and one ambiguity
note says Subject Entry Handle shape is still undefined even though toolkit now
has a concrete helper.

`ARCHITECTURE.md` has broader drift. The most important mismatches are the
JSON-only command contract, browser/DOM ownership wording, daemon-held Sigil
position state, `say` versus `tell human`, and an outdated monorepo/toolkit
roster.

## Findings

### A1 - `ARCHITECTURE.md` overstates the JSON-only command contract

`ARCHITECTURE.md` says:

- success responses are stdout JSON;
- failure responses are stderr JSON;
- no tool emits unstructured text.

The failure side remains broadly true through `exitError`, but the success side
is too broad. `./aos help` intentionally emits human-readable text by default
and only emits registry JSON when `--json` is supplied. The command registry
also marks some command families as JSON only behind an explicit `--json` flag,
for example `aos ops explain|dry-run|run`.

Evidence:

- `ARCHITECTURE.md`, command contract section.
- `src/shared/command-help.swift`, `helpCommand` chooses text output when
  `--json` is absent.
- `src/shared/command-registry-data.swift`, `ops` forms use `[--json]` and
  `outJSONFlag`.
- `./aos help` prints text output.

Suggested direction: rewrite the contract as "agent-facing command forms expose
machine-readable JSON; some user-facing or discovery surfaces intentionally
default to text."

### A2 - `ARCHITECTURE.md` contradicts live browser target support

`ARCHITECTURE.md` has a current "Browser as a target" section that says browser
tabs are first-class targets for `see`, `do`, and `show`. Later, the feedback
loop section says "No DOM involved" and states browser automation lives outside
agent-os.

The code supports the first claim, not the second. Browser target parsing lives
under `src/browser/`, and `aos do click` accepts `browser:<session>/<ref>`.

Evidence:

- `ARCHITECTURE.md`, "Browser as a target".
- `ARCHITECTURE.md`, "The Feedback Loop".
- `src/browser/target-parser.swift`.
- `src/shared/command-registry-data.swift`, `do-click` usage.
- `src/perceive/capture-pipeline.swift`, browser capture handling.

Suggested direction: keep the native macOS feedback loop description for screen
and canvas flows, but describe browser/DOM as an in-repo target adapter rather
than outside orchestration.

### A3 - Daemon-held Sigil position state conflicts with the documented canvas boundary

`ARCHITECTURE.md` says per-agent or per-entity position state should live in the
owning app's state, not in canvases or the canvas subsystem. The daemon still
has a Sigil-specific `lastPositions` store keyed by agent id, with comments
describing renderer resume behavior.

Evidence:

- `ARCHITECTURE.md`, DesktopWorld invariants.
- `src/daemon/unified.swift`, `lastPositions` storage and comments.
- `src/daemon/unified.swift`, `position.get` and `position.set` canvas message
  handling.

Suggested direction: either move the state to the owning app/toolkit layer, or
document this as transitional daemon state with exit criteria.

### A4 - `say` is not implemented as literal `tell human` sugar

`ARCHITECTURE.md` says `say` is sugar for `tell human` and inherits future
`tell` capabilities. In code, `say` is a direct TTS command path, while `tell`
sends a daemon envelope to service `tell`, action `send`; the daemon then routes
audience `human` to the voice route.

Evidence:

- `ARCHITECTURE.md`, verb taxonomy.
- `src/voice/say.swift`, direct `sayCommand` TTS flow.
- `src/commands/tell.swift`, daemon envelope send.
- `src/daemon/unified.swift`, `deliverHumanVoiceRoute` path for `tell human`.

Suggested direction: preserve the conceptual verb taxonomy but make the
implementation wording accurate: `say` is a convenience direct-TTS command with
overlapping purpose, while `tell human` is the daemon-routed communication path.

### A5 - `ARCHITECTURE.md` monorepo and toolkit roster is outdated

The monorepo tree omits package roots that are now present, including
`packages/cli`, `packages/daemon`, and `packages/design-tokens`. The toolkit
description also still emphasizes "base class" and "legacy single-file
overlays" instead of the current toolkit taxonomy.

Evidence:

- `ARCHITECTURE.md`, monorepo structure and component table.
- `packages/toolkit/AGENTS.md`, current layer intent:
  `runtime`, `controls`, `panel`, `workbench`, `components`.
- `packages/toolkit/CLAUDE.md`, compatibility pointer with current toolkit
  details, including `adapters/zag`.
- Current `packages/` directory layout.

Suggested direction: update the roster to the current package set and describe
toolkit through the canonical taxonomy:
`runtime`, `controls`, `adapters/zag`, `panel`, `workbench`, `components`.

### C1 - `CONTEXT.md` overstates current `screen:` and `ax:` target grammar

`CONTEXT.md` defines `browser`, `canvas`, `screen`, and `ax` as target dialects
and says coordinate actions use `screen:<state-id>/<x,y>`. The live CLI accepts
raw coordinate targets with optional `--state-id`; it does not accept
`screen:<state-id>/<x,y>` for `aos do click`. AX actions are currently exposed
through flags such as `--pid` and `--role`, not `ax:<...>` target strings.

Evidence:

- `CONTEXT.md`, Target and State ID terms.
- `src/shared/command-registry-data.swift`, `do-click` usage.
- `src/shared/command-registry-data.swift`, AX-style `do press` flags.
- `docs/api/aos.md`, action command descriptions.
- `AOS_BYPASS_PREFLIGHT=1 ./aos do click 'screen:see_abc/1,2' --dry-run`
  returns a missing-argument error.
- `AOS_BYPASS_PREFLIGHT=1 ./aos do click 1,2 --dry-run --state-id see_abc123def456`
  returns a dry-run response with the state id echoed as metadata.

Suggested direction: distinguish target-model vocabulary or future dialects
from the live CLI grammar. Current live grammar is raw coordinate plus
`--state-id`, `canvas:<canvas-id>/<ref>`, and `browser:<session>/<ref>`.

### C2 - `CONTEXT.md` Subject Entry Handle ambiguity note is stale

`CONTEXT.md` says schema work still needs to define Subject Entry Handle shape.
Toolkit now has a concrete Subject Entry Handle helper with type, schema version,
parser, formatter, and normalization helpers.

Evidence:

- `CONTEXT.md`, ambiguity notes.
- `packages/toolkit/workbench/subject-entry-handle.js`.
- `tests/toolkit/subject-entry-handle.test.mjs`.
- `docs/api/toolkit/components.md`, Subject Entry Handle helper references.

Suggested direction: if a shared JSON schema is still desired, say that
explicitly. Do not say the handle shape itself is undefined.

## Aligned Areas

### Workbench Subject model

The `CONTEXT.md` direction for Subjects, Facets, high-level capabilities,
contracts, hosts, and subject references is broadly aligned with code and
schemas.

Evidence:

- `shared/schemas/aos-workbench-subject.schema.json`, capability enum,
  `facets[]`, `hosts[]`, and `subject_references[]`.
- `shared/schemas/aos-workbench-subject-vnext.md`.
- `packages/toolkit/workbench/subject.js`, high-level capability registry and
  dotted operation strings moved to contracts.
- `packages/toolkit/workbench/wiki-subject.js`.
- `packages/toolkit/workbench/sigil-subject.js`.

### Work Record v0 terminology

The Work Record terminology in `CONTEXT.md` broadly matches the v0 schema for
origin, references, execution map, evidence, claims, claim results, verifier
report, and health. The key caveat is that the schema describes itself as a
design-schema sketch that is not wired to live toolkit helpers yet.

Evidence:

- `shared/schemas/aos-work-record-v0.schema.json`.
- `shared/schemas/aos-work-record-v0.md`.

## Verification Commands Used In First Pass

Representative commands:

```bash
git status --short --branch
wc -l ARCHITECTURE.md CONTEXT.md
find src packages apps shared -maxdepth 2 -type d
find shared/schemas -maxdepth 2 -type f
rg "browser:<|screen:<|ax:<|subject_entry_handle|lastPositions|position.get|position.set" src packages docs shared tests
./aos help
./aos help say --json
./aos help tell --json
AOS_BYPASS_PREFLIGHT=1 ./aos do click 'screen:see_abc/1,2' --dry-run
AOS_BYPASS_PREFLIGHT=1 ./aos do click 1,2 --dry-run --state-id see_abc123def456
```

No live canvas or daemon readiness verification was needed for this first pass.

## Recommended Next Step

Route a second-pass validation to GDI before changing `ARCHITECTURE.md` or
`CONTEXT.md`. GDI should independently re-run focused evidence checks, validate
or refute each finding, and amend this report with a short second-pass section
or correction notes.

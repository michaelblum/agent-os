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
for example `aos recipe explain|dry-run|run`.

Evidence:

- `ARCHITECTURE.md`, command contract section.
- `src/shared/command-help.swift`, `helpCommand` chooses text output when
  `--json` is absent.
- `manifests/commands/source/external/26-recipe.json`, recipe forms use
  `[--json]` and JSON-flag output contracts.
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
report, and health. Historical caveat: at the time of this audit, the schema
described itself as a design-schema sketch before the bounded live CLI/toolkit
surfaces existed.
That caveat is no longer current; verify Work Record truth in
`shared/schemas/aos-work-record-v0.schema.json`, `docs/api/aos.md`, current
`aos work-record` help, and toolkit tests.

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

## Second-Pass Validation

Validation date: 2026-05-20.

Commands run:

```bash
git status --short --branch
node scripts/aos-dev-workflow.mjs recommend --json
rg -n "JSON|stdout|stderr|unstructured|Browser as a target|No DOM|position state|lastPositions|say|tell human|monorepo|packages/toolkit|DesktopWorld|Feedback Loop" ARCHITECTURE.md
rg -n "screen:|ax:|Subject Entry Handle|subject_entry_handle|Work Record|Subject|target dialect|State ID" CONTEXT.md
rg -n "helpCommand|printFullRegistryText|outJSONFlag|--json|do-click|do press|browser:<|canvas:<|state-id|screen:" src/shared/command-help.swift src/shared/command-registry-data.swift src/shared/helpers.swift src/browser/target-parser.swift src/perceive/capture-pipeline.swift
rg -n "sayCommand|sendEnvelopeRequest|deliverHumanVoiceRoute|lastPositions|position\\.get|position\\.set|tell human|service.*tell|action.*send" src/voice/say.swift src/commands/tell.swift src/daemon/unified.swift
rg -n "subject_entry_handle|Subject Entry Handle|parseSubjectEntryHandle|formatSubjectEntryHandle|capabilities|contracts|subject_references|hosts|origin|claim_results|Design-schema" packages/toolkit/workbench/subject.js packages/toolkit/workbench/subject-entry-handle.js packages/toolkit/workbench/wiki-subject.js packages/toolkit/workbench/sigil-subject.js tests/toolkit/subject-entry-handle.test.mjs shared/schemas/aos-work-record-v0.schema.json shared/schemas/aos-workbench-subject.schema.json docs/api/toolkit/components.md
find packages -maxdepth 2 -type d | sort
./aos help
./aos help say --json
./aos help tell --json
AOS_BYPASS_PREFLIGHT=1 ./aos do click 'screen:see_abc/1,2' --dry-run
AOS_BYPASS_PREFLIGHT=1 ./aos do click 1,2 --dry-run --state-id see_abc123def456
```

No live daemon readiness check was needed for this validation. Static source
inspection and bounded CLI dry-runs were sufficient for the named findings.

Per-finding classification:

- A1: confirmed with severity/wording adjustment. The `ARCHITECTURE.md`
  sentence "No tool emits unstructured text" is false for discovery/user-facing
  surfaces such as `./aos help`, and `src/shared/command-help.swift` explicitly
  selects text output unless `--json` is present. The failure contract is still
  broadly supported by JSON stderr helpers, and many agent-facing command forms
  remain JSON-first, so the later doc edit should avoid implying the entire CLI
  is text-oriented.
- A2: confirmed. `ARCHITECTURE.md` contains both a current "Browser as a
  target" section and later "No DOM involved" feedback-loop wording. Source
  evidence confirms browser targets are in-repo: `src/browser/target-parser.swift`
  parses `browser:<session>[/<ref>]`, `src/shared/command-registry-data.swift`
  advertises browser click/fill/navigate forms, and
  `src/perceive/capture-pipeline.swift` handles browser capture support.
- A3: confirmed with severity/wording adjustment. The daemon does hold
  `lastPositions` and handles `position.get` / `position.set` in
  `src/daemon/unified.swift`, while `ARCHITECTURE.md` says per-agent position
  data belongs in the owning app state rather than the canvas subsystem. The
  conflict is real, but it is specifically a Sigil/renderer resume store in the
  daemon, not generic canvas bounds state.
- A4: confirmed. `src/voice/say.swift` implements a direct TTS path, while
  `src/commands/tell.swift` sends a daemon envelope with service `tell`, action
  `send`, and `src/daemon/unified.swift` routes `human` through
  `deliverHumanVoiceRoute`. The conceptual taxonomy can still call `say` a
  convenience for speaking to the human, but the implementation wording should
  not say it literally inherits the `tell human` path.
- A5: confirmed with severity/wording adjustment. The package roster in
  `ARCHITECTURE.md` is stale relative to the current `packages/` layout, which
  includes `packages/cli`, `packages/daemon`, and `packages/design-tokens`.
  `packages/toolkit/AGENTS.md` confirms the canonical toolkit layers are
  `runtime`, `controls`, `panel`, `workbench`, and `components`, and the live
  tree also includes `adapters`, `markdown`, and `shell`. The later doc update
  should present the canonical layer intent without overfitting to every helper
  directory.
- C1: confirmed. `CONTEXT.md` presents `screen:<state-id>/<x,y>` and `ax:<...>`
  as target dialects, but the live `aos do click` grammar is raw coordinates
  plus optional `--state-id`, or `canvas:<canvas-id>/<ref>` /
  `browser:<session>/<ref>`. The dry-run for `screen:see_abc/1,2` returned
  `MISSING_ARG`, while `1,2 --state-id see_abc123def456` returned a dry-run
  response with the state id echoed in execution metadata. `do press` exposes
  AX-style action selection through flags such as `--pid` and `--role`, not an
  `ax:` target string.
- C2: confirmed. The `CONTEXT.md` ambiguity note that schema work still needs
  to define Subject Entry Handle shape is stale. The live helper
  `packages/toolkit/workbench/subject-entry-handle.js`, its test, and
  `docs/api/toolkit/components.md` define and document the canonical
  `<facet-key>:<subject-id>` parser/formatter helper. A future shared JSON
  schema may still be useful, but the handle shape is no longer undefined.

Aligned-area validation:

- Workbench Subject model: confirmed. `CONTEXT.md` aligns with the schema-backed
  model for high-level `capabilities[]`, dotted operation/event `contracts[]`,
  `facets[]`, `facets[].hosts[]`, and top-level `subject_references[]`.
  `packages/toolkit/workbench/subject.js`, `wiki-subject.js`, and
  `sigil-subject.js` produce or normalize those same concepts.
- Work Record v0 terminology: confirmed with caveat. `CONTEXT.md` aligns with
  `shared/schemas/aos-work-record-v0.schema.json` for origin, references,
  execution map, evidence, claims, claim results, verifier report, and health.
  The caveat in the first-pass report is important and should be preserved: the
  schema describes itself as a design-schema sketch that is not wired to live
  toolkit helpers yet.

Evidence corrections:

- The A1 "JSON-only" finding should be framed as an overbroad architecture
  invariant, not as a collapse of the CLI contract. There is still a strong JSON
  contract for command forms that declare JSON output, while some discovery and
  user-facing commands intentionally default to text.
- The A3 conflict should be described as daemon-held Sigil/renderer position
  state, not as canvas subsystem state storing all app positions.
- The A5 toolkit roster should include `adapters/zag` or `adapters` when
  updating architecture prose, but the canonical public taxonomy should stay
  anchored to the layer intent in `packages/toolkit/AGENTS.md`.
- C2 is stale wording rather than a broken live contract. If later docs still
  want a shared schema artifact for handles, they should say that explicitly.

Recommendation for the later doc-update slice:

Route a doc-update work card for `ARCHITECTURE.md` and `CONTEXT.md`. All named
findings are confirmed or confirmed with wording adjustment; none were refuted.
The slice should update prose only, preserve the aligned Subject and Work Record
terminology, and avoid source changes. Suggested edits are: soften the global
JSON-only invariant into a JSON-first machine-readable contract with documented
text discovery exceptions; reconcile the feedback-loop section with in-repo
browser target support; either document daemon-held Sigil position state as
transitional or move the wording away from implying the invariant is already
fully implemented; make `say` versus `tell human` conceptual rather than
literal implementation inheritance; refresh the monorepo/toolkit roster; update
`CONTEXT.md` target grammar for live `screen`/AX behavior; and remove or narrow
the stale Subject Entry Handle ambiguity note.

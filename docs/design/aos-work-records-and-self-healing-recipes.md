# AOS Work Records And Self-Healing Recipes

**Status:** design rationale; active contracts are Work Record V1 and Step Descriptor V1
**Parent epic:** #234
**First contract sketch:** #235

## Problem

AOS has primitives for perception, action, projection, communication, and wiki
workflows. It also has source-backed executable recipes, browser targets, workbench
subjects and a few specialized traces. Those pieces are useful,
but they do not yet describe one first-class thing: work that was done and can
be understood, used to propose repair, superseded, or retired later.

Raw event replay is too brittle. A click coordinate, selector, or accessibility
reference can decay quickly. The durable part of a work record is the human or
agent intent, backed by evidence and a repairable execution map.

AOS should record work as:

```text
intent + execution map + evidence + health
```

This is the work-record specialization of the broader
**Layered Subject Expression** pattern in
`docs/design/aos-workbench-pattern.md`. The intent layer is the durable repair
spine; the execution map, evidence, and health layers make that spine
source-bound, inspectable, and trustworthy without turning raw action data into
the source of truth.

## Core Vocabulary

**Trace:** immutable evidence of what happened. A trace may include `see`
summaries, `do` envelopes, daemon events, screenshots, Playwright traces,
timestamps, exit codes, and artifact paths. A trace is never edited to make
future replay easier.

**Recipe:** mutable execution knowledge for how work might happen again. A
recipe can be repaired when target references drift, or retired when the intent
can no longer be satisfied.

**Workflow:** a caller-owned chain or graph of recipes, steps, sub-workflows,
structured inputs, outputs, and artifacts.

**Work record:** an optional durable evidence/history record tying intent,
execution map, evidence, and health together for one piece of work. It is never
a permission grant.

**Execution map:** semi-durable structured evidence that describes a step:
target strings, Playwright-like locators, AX refs, canvas object ids, waits,
assertions, repair hints, artifact routes, and generated script hints.

**`do_step`:** the smallest portable unit. It is one intentional action plus the
perception context that made the action reasonable and the postcondition that
proves whether it worked.

**Health:** the current validity state of a recipe or step. Health is distinct
from historical success.

## Layer Model

A work record has four layers.

1. The intent layer is the natural-language spine: purpose, constraints,
   acceptance conditions, and human meaning.
2. The execution-map layer is structured but allowed to drift. It stores the
   best known target refs, locators, waits, assertions, and action details.
3. The evidence layer is immutable. It stores receipts of observed behavior and
   produced artifacts.
4. The health layer reports whether the record is still usable and why.

The natural-language layer is not commentary. It is the repair spine. When a
browser locator, AX ref, or canvas id fails, the agent can use the intent plus
evidence to re-resolve the target. If the intent itself is no longer possible,
the recipe should say so.

These layers intentionally mirror other AOS subject layers: narrative
description, structured descriptor, generated or specialized controls,
artifacts/evidence, and health/verification. That common shape lets a wiki
browser, radial menu editor, 3D object editor, replay timeline, and verifier
report stay different views over one subject model instead of becoming separate
private UI systems.

## Primitive Boundary

`aos do` should remain the primitive actuator. It should not become a macro
recorder and should not be reshaped into Playwright globally.

The work-record layer sits above primitives:

```text
work record
  -> do_step
    -> see
    -> target resolution
    -> do
    -> see
    -> verify
```

Any caller-owned future action should re-perceive and re-resolve before acting:

```text
intent -> see -> resolve target -> do -> see -> verify
```

Runtime `aos see capture` responses expose an opaque `state_id`, and `aos do`
responses expose an `execution` object with the actuator backend, strategy,
fallback flag, and originating `state_id` when supplied. Work records should
carry those fields as correlation metadata between the natural-language spine,
the structured execution map, and immutable evidence.

For AOS-owned target interactions, the legacy fixture split between intent,
execution result metadata, optional gesture evidence, state patches, and replay
plans is recorded in
[`aos-interaction-grammar-v0.md`](aos-interaction-grammar-v0.md). Work Records
store that family in their intent, execution-map, evidence, health, and replay
policy layers. The linked note is migration evidence, not public target-handle
authority.

Work Recording frame packs over that family are defined in
[`aos-work-recording-frame-contract-v0.md`](aos-work-recording-frame-contract-v0.md).
The recording layer owns baseline snapshots, compact delta frames, periodic
keyframes, evidence refs, replay policy, and frame health. The interaction
grammar still owns target descriptors, action intents, execution results,
optional gesture frames, observed input evidence, and state patches.

Coordinates can be recorded as evidence. The legacy fixture descriptor combines
state-scoped `ref`/`state_id` with `target.target_id`,
`target.owner_namespace`, `provenance`, and `reacquisition` material. ADR 0040
supersedes that mixed public model with separate Observation Ref and Locator
types; labels and accessibility text remain hints, not identity.

The active AOS action capture slice is intentionally saved-evidence only. A
single source records before perception, the caller-supplied AOS `do` result,
and after perception, then `buildWorkRecordV1FromAosActionEvidence()`
normalizes that source into Work Record V1. The Step Descriptor V1 simulation
harness reads the same evidence envelope, emits a Work Record V1, and runs the
report-only verifier. Both simulation and execution-adapter evidence must
exactly match the descriptor action, target-resolution semantic identity,
conditions, and promotion identity/scope. An execution-mode harness accepts
only a caller-supplied adapter; Work Record commands expose no fixture executor. Work Records and
verifier reports are evidence around a run, not action admission. Gate remains
a separate structured-input primitive and no Gate answer authorizes a later
Work Record attempt.

## Target Dialects

The persisted model should allow target dialects without making every surface
look like a browser.

Examples:

```text
browser:<session>/<ref>
canvas:<canvas-id>/<state-scoped-ref>
ref:<snapshot-id>:<ref-id>
screen coordinate fallback: raw x,y with --state-id rejected (current CLI); screen:<state-id>/<x,y> is target-model/replay shorthand
native AX: selector flags such as --pid and --role (current CLI); ax:<...> is reserved target-model vocabulary
```

The exact grammar can harden later. The important point is that direct target
strings and saved refs stay compact current-address/provenance handles while
the execution map can carry richer target descriptors: owner namespace, durable
target id, primitive actions, state, provenance, and machine-first stale-ref
repair hints. Screen coordinate and native AX bridges should be recorded as
structured descriptors until they gain first-class live target strings.

## Playwright And Codegen

Playwright contributes useful ideas:

- semantic locators
- actionability checks
- re-resolving locators before action
- traces with before/after state
- screenshots and video receipts
- codegen as a way to derive a reusable action recipe

AOS should borrow those ideas without making generated Playwright code the
canonical record.

The canonical AOS record is the work record. Playwright traces, videos, and
generated scripts are evidence or execution-map hints. A browser work record
can export generated Playwright code, but it should still preserve the
natural-language intent and AOS-level step/evidence envelope.

Tracked in #239.

## Computer-Use Control-Plane Lessons

`pi-computer-use` validates a similar semantic-first direction for macOS
desktop control: ref-first actions, state-scoped Observation Refs, explicit raw
coordinate fallback, strict AX/background-safe policies, execution metadata, and quality
benchmarks. AOS should adopt those lessons natively in its `see`, `do`, and
work-record contracts instead of routing through `pi-computer-use` as a live
intermediary.

See
[`pi-computer-use-lessons-for-aos-see-do.md`](pi-computer-use-lessons-for-aos-see-do.md).

## BNF, Schemas, And Logit Masking

BNF-like grammar is useful for compact target strings and CLI forms. JSON
Schema is better for persisted records. The command registry should remain the
source of legal command forms.

Provider logit masking, grammar-constrained sampling, and JSON-schema decoding
are adapter optimizations. They can reduce invalid model output when a provider
supports them, but they are not the safety contract. AOS must validate every
record and action before execution.

```text
model proposes -> AOS validates -> AOS executes or rejects
```

## Bounded Flight Recorder

AOS should eventually have a bounded flight recorder, not permanent raw
recording. The buffer keeps recent structured context for debugging, repair,
and trace promotion.

Candidate buffer entries:

- `see` summaries and artifact handles
- `do` envelopes
- focus, app, window, browser session, and canvas context
- target refs and locator candidates
- daemon event summaries
- errors and recovery attempts
- selected screenshot handles or image hashes

Promotion to durable trace should happen only when explicit:

- the user or agent starts recording
- a workflow run requires evidence
- a failure promotes the last N seconds
- a human or agent asks to save recent context

Redaction, summarization, retention, and persistence are explicit caller-owned
transforms. A recorder must preserve selected raw facts unless the caller asks
for a projection, and any durable screen/video/text retention must use the
caller's explicit scope and lifecycle. AOS does not assign default sensitivity
policy. Tracked in #238.

## Health, Repair, And Retirement

Recipe health should be explicit.

Suggested states:

- `valid`: last check passed or the recipe is known usable.
- `stale`: deterministic data is old or unverified.
- `repairable`: replay failed, but enough semantic context exists to attempt
  repair.
- `blocked`: an external condition prevents execution, such as login or a
  missing permission.
- `impossible`: the NL intent cannot currently be satisfied.
- `superseded`: a newer recipe should be used instead.
- `retired`: do not run automatically; keep only for history/search.

Repair patches the execution map. It does not rewrite historical traces.
Retirement keeps the intent and evidence searchable while preventing accidental
replay.

Examples:

- The user uninstalls an app required by a desktop recipe:
  `required_surface_missing`.
- Indeed removes a page section the recipe was intended to collect:
  `intent_no_longer_supported`.
- A website redesign changes selectors but the section still exists:
  `target_drift_repaired`.
- A better recipe replaces a fragile one:
  `superseded_by`.

Tracked in #236.

## Workbench Projection

The workbench should be the human/agent editing and inspection surface for work
records. It should not own the recorder.

Useful views:

- NL intent editor
- execution-map JSON editor
- generated form from execution-map fields
- step timeline
- workflow graph
- evidence/artifact gallery
- repair history
- health and retirement status

This matches the existing layered workbench pattern: one subject, multiple
expressions. The NL layer is the editable spine; structured layers make the
subject executable or inspectable. Tracked in #237.

## Relationship To Existing Work

- At the time of writing, #141 was the browser-only steerable-collection V0
  projection. It should stay scoped and can adopt work-record vocabulary when
  stable.
- #148 should keep replay codegen deferred until #239 defines how codegen
  attaches to AOS work records.
- #149 supervised runs already wants run control, timelines, evidence packs,
  and human feedback sidecars. Those concepts should converge here.
- #211 and #215 define wiki-backed workbench/workflow subjects. Work records
  should attach to those subjects later as run/evidence layers.
- #129 `aos recipe` recipes are source-backed executable recipes. The older
  `aos ops` spelling is retired and must not be used as a compatibility path.
  Recipes can become
  one execution backend or compiled projection, not the whole work-record model.
- #161 and #163 can supply friction telemetry and semantic target-resolution
  evidence.
- #223 supplies the surface/workbench UI substrate, not the recording model.

## Historical Design Fixtures

These pre-V1 fixtures remain design examples, not active contracts:

- `docs/design/fixtures/aos-work-records/browser-artifact-collection-step.json`
- `docs/design/fixtures/aos-work-records/desktop-workflow-demo-step.json`
- `docs/design/fixtures/aos-work-records/canvas-toolkit-control-step.json`
- `docs/design/fixtures/aos-work-records/recipe-health-retirement.json`

They remain parser-tested historical inputs. Active ownership now lives in the
versioned Work Record V1, Step Descriptor V1, Repair Plan V1, Attempt Plan V1,
and Attempt Artifact V1 contracts under `shared/schemas/`. The old examples do
not define active producer, replay, repair, or execution behavior.

## Implemented V1 Path

1. Work Record V1 and Step Descriptor V1 are the active neutral evidence
   contracts; V0 bytes are historical-only and rejected by active readers.
2. Capture, verifier, harness, browser prototype, and workbench consumers use
   the V1 contracts.
3. Repair Plan V1 and Attempt Plan V1 are non-executing, exact mechanical
   proposals. `ready` means complete and source-bound, never authorized.
4. Attempt Artifact V1 records caller-supplied outcomes, evidence, timing,
   cleanup, rollback, postconditions, and source immutability.
5. Replacement publication, supersession lookup, bundle inspection, and
   finalization remain separate bounded mechanics with exact digest checks and
   receipts. AOS exposes no public Work Record executor.

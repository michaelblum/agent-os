# AOS Work Records And Self-Healing Recipes

**Status:** design seed, not a public API contract
**Parent epic:** #234
**First contract sketch:** #235

## Problem

AOS has primitives for perception, action, projection, communication, and wiki
workflows. It also has source-backed ops recipes, browser targets, workbench
subjects, gateway jobs, and a few specialized traces. Those pieces are useful,
but they do not yet describe one first-class thing: work that was done and can
be understood, repaired, replayed, or retired later.

Raw event replay is too brittle. A click coordinate, selector, or accessibility
reference can decay quickly. The durable part of a work record is the human or
agent intent, backed by evidence and a repairable execution map.

AOS should record work as:

```text
intent + execution map + evidence + health
```

## Core Vocabulary

**Trace:** immutable evidence of what happened. A trace may include `see`
summaries, `do` envelopes, daemon events, screenshots, Playwright traces,
timestamps, exit codes, and artifact paths. A trace is never edited to make
future replay easier.

**Recipe:** mutable execution knowledge for how work might happen again. A
recipe can be repaired when target references drift, or retired when the intent
can no longer be satisfied.

**Workflow:** a chain or graph of recipes, steps, sub-workflows, inputs,
approval gates, outputs, and artifacts.

**Work record:** a durable record tying intent, execution map, evidence, and
health together for one piece of work.

**Execution map:** semi-durable structured data that helps execute or replay a
step: target strings, Playwright-like locators, AX refs, canvas object ids,
waits, assertions, retry hints, artifact routes, and generated script hints.

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

Replay should re-perceive before each action:

```text
intent -> see -> resolve target -> do -> see -> verify
```

Coordinates can be recorded, but they are fallback material. When semantic
targets exist, prefer them.

## Target Dialects

The persisted model should allow target dialects without making every surface
look like a browser.

Examples:

```text
browser:<session>/<ref>
ax:<pid>/<ref>
canvas:<canvas-id>/<object-ref>
screen:<frame-id>/<x,y>
```

The exact grammar can harden later. The important point is that target strings
are compact handles while the execution map can carry richer candidates,
metadata, and stale-ref repair hints.

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
desktop control: ref-first actions, perception state ids, stale-coordinate
rejection, strict AX/background-safe policies, execution metadata, and quality
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

The recorder should redact or summarize sensitive data by default. Permanent
recording of raw screen/video/text is out of scope until privacy boundaries are
designed. Tracked in #238.

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

- #141 is the browser-only steerable-collection V0 projection. It should stay
  scoped and can adopt work-record vocabulary when stable.
- #148 should keep replay codegen deferred until #239 defines how codegen
  attaches to AOS work records.
- #149 supervised runs already wants run control, timelines, evidence packs,
  and human feedback sidecars. Those concepts should converge here.
- #211 and #215 define wiki-backed workbench/workflow subjects. Work records
  should attach to those subjects later as run/evidence layers.
- #129 `aos ops` recipes are source-backed operator recipes. They can become
  one execution backend or compiled projection, not the whole work-record model.
- #161 and #163 can supply friction telemetry and semantic target-resolution
  evidence.
- #223 supplies the surface/workbench UI substrate, not the recording model.

## Schema-Shaped Fixtures

These fixtures are intentionally examples, not contracts:

- `docs/design/fixtures/aos-work-records/browser-artifact-collection-step.json`
- `docs/design/fixtures/aos-work-records/desktop-workflow-demo-step.json`
- `docs/design/fixtures/aos-work-records/canvas-toolkit-control-step.json`
- `docs/design/fixtures/aos-work-records/recipe-health-retirement.json`

They are parser-tested so future edits do not drift into invalid JSON, but no
`shared/schemas/` contract exists yet. Promote a schema only after browser,
desktop, and canvas examples keep the same shape under implementation pressure.

## First Implementation Path

1. Land this design seed and schema-shaped fixtures (#235).
2. Add a draft shared schema only after a concrete producer and consumer are
   selected.
3. Pick one narrow producer: likely browser collection, supervised run trace,
   or a workbench-driven manual record.
4. Pick one narrow consumer: likely a workbench projection that reads fixtures
   before executing anything.
5. Only then add runtime recording, replay, or repair logic.

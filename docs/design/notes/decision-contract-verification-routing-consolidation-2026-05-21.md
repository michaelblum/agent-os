# Decision Contract Verification Routing Consolidation

**Date:** 2026-05-21
**Status:** docs-only consolidation for `decision-contract-verification-routing-consolidation-v0`

## Summary

Live-versus-deterministic verification routing is a credible third Decision
Contract candidate. It fits the same reusable judgment shape:

```text
given these inputs and this evidence, classify/choose/route this way
```

The route decision takes a task's evidence need, changed behavior, entry path,
runtime readiness, TCC/input-tap state, and role boundary as inputs. It then
chooses deterministic tests, AOS runtime checks, Operator-supervised live
evidence, human-needed recovery, or an explicit skip when the task is docs-only.

This third mapping proves the Decision Contract idea is not just the current
dev workflow router and not just Foreman transfer policy. It also shows that a
near-term schema would be premature. The fields mostly hold, but the guidance
must split source-authority evidence from current-state evidence, allow
composite outputs, keep recompute commands optional, and treat live runtime
state as volatile evidence rather than static schema data.

## Candidate Mapping

### Inputs

Verification routing uses bounded inputs from the task, repo state, and runtime
state:

- Task kind: docs-only, source change, schema/API contract change, toolkit/app
  UI change, display/visual change, input-routing change, live website/browser
  control, or human-in-the-loop review.
- Active entry path: Agent harness, AOS developer, testing, visual diagnostics,
  user-input diagnostics, or a narrower app-specific layer.
- Changed files and changed behavior, including whether Swift, schemas, pure
  Node/TypeScript, toolkit/app DOM, daemon input, canvases, or display topology
  changed.
- Evidence need: deterministic state-machine proof, command/schema validation,
  screenshots, `./aos see` visual proof, real pointer/keyboard evidence,
  controlled fixture smoke, Operator/HITL judgment, or no runtime evidence for
  docs-only changes.
- Runtime readiness: whether `./aos ready` is required, whether it reports
  ready, ownership mismatch, inactive input tap, stale/missing TCC grant, or a
  human-required recovery phase.
- Human involvement: whether the human is explicitly the sensor, whether
  Operator must collect supervised live evidence, or whether GDI must stop with
  `human_needed`.
- Workflow/router advice from `./aos dev recommend --json`, especially
  docs-only routing, rebuild guidance, TCC sensitivity, commands, verification,
  and notes.

### Source-Authority Evidence

The stable authority surfaces are docs and manifests:

- `AGENTS.md` defines entry paths, AOS as the shell, readiness guidance,
  build/rebuild posture, visual verification, and human-as-sensor handling.
- `.docks/AGENTS.md` separates dock role, entry path, and workflow profile, and
  states that GDI handles deterministic implementation while Operator handles
  supervised live or HITL evidence.
- `.docks/foreman/AGENTS.md` gives Foreman the next-step ladder, including
  routing live verification to Operator or stopping on TCC/input-tap blockers.
- `.docks/gdi/AGENTS.md` defines deterministic verification, completion
  reporting, and the `human_needed` TCC stall path.
- `.docks/operator/AGENTS.md` defines supervised runtime/HITL evidence
  collection and stop conditions.
- `docs/recipes/agent-entry-paths-and-verification.md` is the central
  role-neutral recipe for selecting entry path and verification loop.
- `docs/recipes/aos-surface-interaction-decision-tree.md` routes surface work
  to DOM, toolkit, StageAffordance, passive stage, full WebView, private
  renderer, or daemon primitive.
- `docs/recipes/surface-inspector-controlled-browser-dom-smoke.md` defines a
  controlled, non-live-website smoke for Browser DOM Element Picker targets.
- `docs/dev/workflow-rules.json` and `./aos dev recommend --json` provide the
  source-backed changed-file workflow recommendation.

### Current-State Evidence

The current-state side is volatile and must be inspected at decision time:

- `git status --short --branch` and the active branch/base determine whether
  the route is docs-only, branch-scoped, or contaminated by unrelated dirty
  state.
- `./aos dev recommend --json` recomputes changed-file workflow posture and can
  say no runtime verification is required for docs-only changes.
- `./aos ready`, only when live runtime proof is required, reports whether the
  repo-mode daemon, input tap, and macOS permission state can support live
  evidence.
- `./aos ready --repair`, `./aos permissions reset-runtime --mode repo`,
  `./aos permissions setup --once`, and `./aos ready --post-permission` are
  bounded recovery surfaces when readiness is blocked and the user has chosen
  repair.
- Deterministic test outputs, schema checks, controlled fixture smoke JSON,
  screenshots, `./aos see` output, trace files, or Operator reports prove the
  selected route after it runs.

### Outputs/Decisions

Verification routing emits a composite route, not just one label:

- Whether runtime verification is required, optional, or explicitly skipped.
- Which entry path is active for the proof: AOS developer, testing, visual
  diagnostics, user-input diagnostics, Operator-supervised live evidence, or
  human-needed recovery.
- Which commands or checks to run: `git diff --check`, schema tests,
  package-local Node tests, `./aos dev build`, `./aos ready`, controlled smoke,
  `./aos see`, `./aos do`, or no extra command beyond docs review.
- Whether a Swift rebuild is required before a command or test.
- Whether a synthetic deterministic proof is sufficient or a real-input/live
  proof is required.
- Whether GDI should stop with `human_needed` through
  `.docks/gdi/scripts/human-needed-tcc-reset`.
- Whether Foreman should route a bounded Operator dispatch for live/HITL
  evidence.
- What the completion report must disclose: exact commands and pass/fail
  results, skipped live smoke and reason, readiness blocker, local-only state,
  and any remaining Operator or human action.

### Consumers

The consumers are active roles and future automation:

- GDI consumes the route to choose deterministic checks, avoid unsupported live
  proof, and report blockers.
- Foreman consumes the route to accept deterministic evidence, ask for Operator
  evidence, or apply the safe permission recovery path before live-dependent
  work continues.
- Operator consumes supervised live/HITL dispatches when the route requires
  visual, browser, page interaction, or bounded human judgment.
- Human users consume human-needed recovery packets and may act as the sensor
  when they explicitly enter the verification loop.
- Future session trigger, async result routing, work records, and evidence
  records could consume a structured version of this route.

### Invalidation Triggers

Recheck the mapping when any of these change:

- New entry path, changed entry-path semantics, or changed host-shell boundary.
- Changed `./aos ready`, `ready --repair`, `ready --post-permission`, or
  permission-reset behavior.
- Changed TCC/Input Monitoring/Accessibility recovery policy.
- New deterministic harness for a previously live-only behavior, or a new live
  smoke requirement for a previously deterministic-only behavior.
- Changes to `docs/dev/workflow-rules.json`, router schema, `./aos dev
  recommend --json`, or build/rebuild policy.
- Changed Foreman, GDI, or Operator role boundaries or completion-report
  requirements.
- New Surface Inspector, visual diagnostics, user-input diagnostics, or
  controlled browser smoke procedure.
- Introduction of transfer packets, session trigger/scheduler, async result
  routing, work records, or evidence records.

## Consolidated Field Guidance Across Three Candidates

### Fields That Hold

- `id` still matters as a stable handle, but it may identify a manifest rule, a
  route rule inside a policy cluster, or a docs-backed decision family.
- `summary` holds as the human-readable boundary and decision statement.
- `inputs` holds, provided it means recompute-time facts rather than stored
  historical context.
- `decision_outputs` holds if it explicitly permits composite outputs: commands,
  routes, recipients, stop conditions, evidence requirements, and result
  disclosures.
- `consumers` holds because each candidate has real consumers, including
  agents, commands, role docs, and future services.
- `invalidation_triggers` holds and is one of the strongest cross-candidate
  fields because every candidate depends on evolving authority surfaces.

### Fields That Need Renaming Or Clarifying

- `required_evidence` should split into `source_authority_evidence` and
  `current_state_evidence`, at least in guidance. Dev workflow routing needs
  schema/tests plus current changed files. Transfer routing needs role docs plus
  branch/profile/blocker state. Verification routing needs recipes/manifests
  plus live readiness, test output, or Operator evidence.
- `decision_outputs` should be described as `outputs` or
  `decision_outputs` with composite route packets explicitly allowed.
- `confidence` should not imply a numeric score. Use backing type and maturity:
  schema-backed, command-backed, test-backed, docs-backed, recently validated,
  partial, or exploratory.
- `last_validated_at` should become an evidence pointer in any future machine
  form. A bare timestamp is weak unless it names what was inspected or what
  command proved the route.
- `recompute_command` should be `recompute` or `recompute_command` with a
  nullable shape. Some docs-backed decisions have no command today.

### Fields That Should Stay Optional

- `recompute_command`: available for `./aos dev recommend --json`, absent for
  current transfer routing, conditional for verification routing.
- `confidence`: useful in notes, but too easy to overstate in schema.
- `last_validated_at`: useful when backed by a commit, test run, audit output,
  or evidence record; weak as required metadata.
- `consumers`: useful for design review, but can drift unless generated or tied
  to actual command/service call sites.
- Rule-level `id` under a contract-level `id`: needed for manifests, but not
  always for a single docs-backed decision table.

### Fields That Should Not Be In A Near-Term Schema

- Live readiness state, TCC diagnosis, current branch, dirty files, and current
  test results. These are current-state evidence or evidence-record content, not
  stable Decision Contract metadata.
- Workflow profile branch/commit/PR policy. It can be an input to a decision,
  but it should not be collapsed into a generic Decision Contract schema.
- Transfer packet delivery, session trigger launch details, async result-route
  state, provider selection, or work-record lifecycle. Decision Contracts may
  feed those primitives later; they should not absorb them.
- Human-needed recovery instructions as schema fields. They belong in role docs,
  transfer packets, or recovery recipes until a human-gate/evidence primitive
  exists.
- Broad actor authority definitions. Foreman, GDI, and Operator contracts stay
  in `.docks` docs unless session automation needs a source-backed capability
  manifest.

## Readiness Decision

Do not add a generic schema yet.

The three mapped candidates prove Decision Contract is a useful docs vocabulary:

- dev workflow routing is a machine-readable, schema-backed, command-backed
  candidate;
- Foreman transfer routing is a docs-backed policy cluster with composite
  route outputs;
- live-versus-deterministic verification routing is a docs-backed and
  current-state-sensitive route that crosses entry paths, runtime readiness,
  Operator/HITL evidence, and human-needed recovery.

That is enough to stop doing one-note candidate mappings. It is not enough to
commit a `shared/schemas/decision-contract` contract because two of the three
examples still rely on role docs, recipes, manual state inspection, and
future-AFK primitives. The concept should remain docs-only while AFK/session
primitives mature, but the next slice can be larger than another mapping pass.

The next schema-adjacent move should be a design-only descriptor sketch, not a
committed schema or migration. It should model:

- contract id and optional rule ids;
- summary;
- inputs;
- source-authority evidence;
- current-state evidence;
- composite outputs;
- consumers;
- invalidation triggers;
- optional recompute command or procedure;
- optional backing/maturity note;
- evidence pointer for validation.

## Recommended Next Slice

Write a single design note for a Decision Contract descriptor plus AFK primitive
touchpoints. It should be larger than the prior mapping rounds because the
candidate evidence is now consolidated and the remaining risk is at the
boundary between artifacts:

- sketch the docs-only descriptor shape above;
- show how `docs/dev/workflow-rules.json` would be referenced by adapter rather
  than migrated;
- show how a future transfer packet would carry selected outputs from transfer
  routing and verification routing;
- show how a work record or evidence record would hold current-state proof such
  as test output, readiness state, screenshots, or Operator reports;
- explicitly defer committed schemas, transfer packet implementation, session
  trigger, provider dispatch, and async result routing.

This is not another tiny mapping because it would integrate the three studied
candidates into one artifact-boundary sketch and decide what belongs in
Decision Contract, transfer packet, work record, evidence record, and AFK
session primitives before any schema or implementation work begins.

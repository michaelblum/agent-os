# agent-os

The shared context for the `agent-os` repo: the unified `aos` runtime, its
toolkit, and contracts consumed by external apps. This file captures terminology that
domain experts (designers, agent operators, plan authors) need to share with
implementers.

## Language

**Ambient Authority**:
The user grants authority to the agent host, macOS TCC constrains the process,
and AOS faithfully observes or acts. AOS adds no independent authorization,
approval, risk, or default privacy policy. Exact identity, stale/ambiguous
rejection, bounds, cleanup, typed errors, and receipts are mechanical
correctness, not permission decisions. Defined by ADR 0040.
_Avoid_: AOS permission token, action approval layer, Work Record authorization.

**Subject**:
A coherent thing in the system that can be perceived, edited, or verified — an app, a wiki entry, a 3D object, a work record. The unit of identity in AOS.
_Avoid_: object (overloaded), entity, item.

**Subject Owner**:
The authority for a Subject's mutable state and contracts. A Subject Owner receives patches or commands, validates them against current Subject state, applies or rejects them, and decides what propagation or persistence follows. The owner may be a source-of-truth service, app model, host runtime, or daemon primitive; it is not necessarily the Facet or display surface currently showing the Subject.
_Avoid_: view owner, editor, lock holder.

**Layer**:
One of the ordered conceptual categories through which a Subject is projected: narrative → descriptor / execution map → controls / editor → artifacts / evidence → health / verification. The taxonomy is fixed; not every Subject uses every Layer.
_Avoid_: tier, level, stage.

**Facet**:
A concrete, addressable projection of a Subject that a workbench or browser can open — e.g. a Markdown facet, a JSON descriptor facet, an editor facet, a verifier-report facet. Each Facet declares which Layer it occupies. A single Layer may be served by multiple Facets.
_Avoid_: view, panel, pane (those are display-layer terms; a Facet is a model-layer concept the chrome happens to render).

**Subject Entry Handle**:
A string that resolves to a Subject *plus an entry Facet*, used in links and navigation. Form: `<facet-key>:<subject-id>` (e.g. `wiki:service-catalog` opens the canonical service-catalog Subject and lands on its wiki/narrative Facet). The handle preserves Subject identity — opening a different entry Facet on the same Subject does not change which Subject is in focus.
_Avoid_: subject id alone (loses the entry Facet hint), URL (overloaded), target (reserved for `aos see/do` dialects like `browser:`, `canvas:`).

**Navigation Trail**:
An ordered list of Subject Entry Handles describing how a user reached the current Facet — e.g. `wiki:service-catalog → service:gateway → health:gateway`. The trail crosses Subject boundaries (parent Subject → child Subject), unlike a Facet list, which stays within one Subject.
_Avoid_: subject chain, breadcrumb (those imply a flat hierarchy; trails can branch and collapse).

**Work Record**:
An optional durable layered evidence/history artifact for one run of work. Carries an **intent spine** (durable narrative of what the run was for), an **execution map** (structured but repairable: refs, locators, waits, assertions, action hints, artifact routes, replay hints), **evidence** (immutable see/do/see frames, artifacts, traces), and **health** (the verifier's verdict). A Work Record is itself a Subject; the verifier health is its health Layer. It never grants permission to observe or act.
The active contract is `shared/schemas/aos-work-record-v1.md`. V0 is frozen
historical input and active readers reject it.
_Avoid_: log, audit entry, transcript, trace (those are Evidence-Layer terms; a Work Record is the larger composite).

**AOS Execution Model**:
The canonical execution taxonomy for AOS: Primitive -> Block -> Recipe ->
Workflow -> Run -> optional Work Record + Evidence, with Gates, Signals, Checkpoints,
Guides, and Playbooks as control/guidance concepts around that stack. Defined
by ADR-0013.
_Avoid_: recipe ladder (allowed only as shorthand), execution ladder as the
formal contract name.

**Primitive**:
One raw AOS capability or action, such as `ready`, `status`, `see`, `do`,
`show`, `tell`, `listen`, or `gate`.
_Avoid_: molecule, micro-workflow.

**Block**:
One typed executable procedure step inside a Recipe or future Workflow
executor. Current source-backed Recipe block kinds include `aos_command`,
repo-owned `shell`, `assert`, and `cleanup`; `gate`, `signal`, `condition`,
`loop`, and `recipe_call` are reserved until orchestration needs them.
_Avoid_: molecule, opaque script fragment.

**Recipe**:
A bounded, reusable executable procedure made of Blocks and
discovered through `aos recipe`. Scope: one bounded procedure with explicit
inputs, outputs, resources, and cleanup behavior where relevant. Explain and
dry-run are optional mechanics, not prerequisites for run. The historical
`aos ops` command surface is retired. Markdown procedures under
`docs/guides/` are Guides/SOPs, not executable Recipes.
_Avoid_: documentation-only recipe, tutorial, molecule.

**Playbook**:
Method guidance that shapes human or agent judgment but does not itself execute
as the primary substrate. The active `aos.step_descriptor` V1 contract is
neutral descriptive input to a caller-selected harness; it has no Workflow
Gate, approval, risk, or operation-registry fields. The frozen V0 sketch is
historical input and does not make Playbook the general workflow engine or
evidence log.
_Avoid_: macro, script, executable recipe, workflow engine.

**Workflow**:
An orchestration graph or chain across Recipes, agents, gates, retries,
branches, human decisions, external operations, inputs, outputs, artifacts, and
evidence. A Workflow is a Subject. Scope: multi-step process, often crossing
systems or human gates. A Workflow run typically emits one or more Work Records
(one per meaningful execution unit or child run).
_Avoid_: pipeline, process (too generic), automation.

**Run**:
One execution instance of ad-hoc work, a Recipe, a Workflow, or a gated harness.
A Run is the event boundary that emits Evidence and, when durable proof is
needed, a Work Record.
_Avoid_: workflow (unless orchestration is actually involved), transcript.

**Evidence**:
Proof material emitted by a Run and referenced by Work Records: command output,
before/action/after captures, artifacts, screenshots, local diagnostic traces,
or human responses. Evidence is immutable once attached to a Work Record.
_Avoid_: Work Record (larger composite), trace (reserved for specific proof
streams or future trace schema).

**Trace**:
A proof stream or ordered diagnostic record that may become Evidence. A general
AOS trace schema is planned/reserved, not active contract, unless a local
schema or runtime feature explicitly says it emits traces.
_Avoid_: using trace as a synonym for every Work Record or evidence bundle.

**Gate / Signal / Checkpoint**:
Explicit structured-input or control points for uncertainty, retry, branching,
lifecycle state, or handoff. A Gate is invoked only when a caller wants that
input; it does not authorize unrelated AOS actions. Signals communicate state
or intent; Checkpoints preserve progress and resumability.
_Avoid_: hidden retry, implicit approval, bare status.

**Guide**:
Reusable method guidance for humans or agents. Current Markdown procedures live
under `docs/guides/` and can guide work without becoming executable Recipes.
_Avoid_: Recipe when the artifact is not executable through `aos recipe`.

**Capability Package**:
A distributable or activatable bundle of capability assets. A Capability
Package may contain Guides/SOPs, Skills, Plugins, commands, schemas, Recipes,
Workflows, fixtures, UI, or evidence templates. Packaging and activation do not
make the bundle an execution-model rung.
_Avoid_: workflow, recipe, plugin (unless the package is specifically a Plugin).

**Skill**:
Agent-loadable guidance or capability instructions, usually a `SKILL.md`
bundle. A Skill may guide, wrap, or activate execution, but it is not itself a
Recipe, Workflow, Run, or Work Record.
_Avoid_: recipe, workflow, executable substrate.

**Plugin**:
An installable or wiki/package capability extension. A Plugin may contain
Skills, Guides/SOPs, scripts, schemas, assets, Recipes, Workflows, or UI. It is
packaging and activation vocabulary, not an execution ladder rung.
_Avoid_: workflow as a synonym for plugin, recipe.

**Work Card**:
A durable Markdown coordination contract for an assigned work slice, most often
an Implementer implementation, validation, correction, or relay round. Older
work cards may say GDI; read that as stale historical terminology superseded by
Implementer, not as a current dock or `/goal` command persona. A Work Card may
route work that creates or runs execution-model artifacts, but it is not itself
a Workflow.
_Avoid_: workflow, work record, successor handoff.

**Dock**:
A retired runtime launch-envelope term from the historical `.docks/` scaffold.
It is not an active root-session instruction source, project-agent identity
store, or AOS product surface. Current sessions use repo DOX, direct user
intent, and installable AOS skills instead.
_Avoid_: workflow, workflow template, generated run, source workspace, project
agent.

**Docked Session**:
A retired term for a Codex session launched from the historical dock scaffold.
Do not use it as current product vocabulary.
_Avoid_: workflow run, Workflow run, automation run.

**Verifier Health**:
The terminal verdict the verifier writes to a Work Record's health Layer. One
of: `valid`, `stale`, `repairable`, `blocked`, `impossible`, `superseded`,
`retired`. It describes whether the evidence remains valid and source-bound and
whether a caller may need a new run or a proposed repair; it does not authorize
replay, repair, or mutation.
_Avoid_: status, state (overloaded with `state_id`).

**Claim**:
A durable, agent/human-readable assertion on a Work Record about what the run accomplished — e.g. "the subscription was cancelled," "the radial menu item render was updated." Claims live on the **intent spine** and survive selector/ref drift. A Claim references zero or more **Postconditions** that operationalise the check.
_Avoid_: assertion (overloaded with code-level asserts), expectation, outcome.

**Postcondition**:
A structured, machine-checkable condition tied to a `see` capture — DOM state, AX state, canvas object state, artifact presence, file contents, command exit, etc. Lives on the **execution map** and is repairable: when a selector or ref drifts, the Postcondition is patched, not the Claim. May be a step-local gate in an `aos.step_descriptor` and not promoted, or referenced from a Claim.
_Avoid_: precondition (those are the per-step *entry* checks), expectation, check (too generic).

**Claim Result**:
The per-Claim verdict produced by the verifier: status (`verified | failed | unverified`), evidence references, confidence, and reason. Aggregated over a Work Record's Claims, the Claim Results determine the run's overall **Verifier Health**.
_Avoid_: claim status (looks like a field on the Claim itself; it's a separate verifier output).

**Target**:
A scope address in an AOS target dialect. Live ref-addressed CLI target strings
currently include `browser:<session>[/<ref>]` and
`canvas:<canvas-id>/<ref>`. `screen` and `ax` remain useful target-model
vocabulary, but their current CLI wire forms are not `screen:` or `ax:` target
strings: coordinate actions use raw `x,y` and AX actions are selected through
flags such as `--pid` and `--role`. Coordinate actions reject `--state-id`;
state validation belongs only to Observation Refs.
_Avoid_: address (too generic), URL.

**Observation Ref**:
The ephemeral public handle `(state_id, ref)` produced by one perception state.
The pair addresses only that observed target in that state; a stale or mismatched
pair rejects with a typed stale error and is never silently reacquired.
_Avoid_: durable ref, saved locator, permanent object id.

**Ref**:
The dialect-specific `ref` component of an Observation Ref. In browser/canvas
DOMs it may be materialized as `data-aos-ref`; AX producers may derive it from
observed AX facts. A bare ref is not a complete public target handle.
_Avoid_: durable name, locator, selector.

**Locator**:
A declarative machine query that re-resolves against current state for every
operation. It must resolve to exactly one action-compatible target; zero matches
return a typed missing result and multiple matches return a typed ambiguous
result. Labels and geometry may be hints but are not identity by themselves.
_Avoid_: saved ref, observation ref, automatic stale-ref reacquisition.

**Target-with-Ref**:
A complete address for one semantic element inside a Target's scope:
`<dialect>:<scope-id>/<ref>`. This is the live wire form for browser and
canvas targets and the target-model shape for other ref-addressed resolvers as
they converge. It is a current transport string, not a complete Observation Ref
without its `state_id`, and it is not a Locator unless the command contract
explicitly defines action-time query resolution.
_Avoid_: full target (ambiguous), qualified ref.

**Saved Ref**:
The current implementation's persisted perception handle in an agent
workspace: `ref:<snapshot-id>:<ref-id>`. Saved Refs are produced by
`aos see capture --save` and read back with `aos see refs`. A Saved Ref names a
workspace snapshot record containing exactly one discriminated Observation Ref
or Locator. It is storage indirection, not a third live target type. It is not
a live Observation Ref or Locator. Browser
Observation Ref requests validate the saved record or exact direct grammar and
then fail closed before managed-session dispatch; canvas and native AX Locators
re-resolve at action time and require exactly one current match. Bare
`ref:<ref-id>` and automatic reacquisition are invalid V1 behavior.
_Avoid_: saved target, locator, observation ref, permanent object id.

**Semantic Target**:
A discovered candidate emitted by perception, typically from `aos see ... --xray`. A structured record carrying ref, name, role, bounds, state, AOS ownership metadata, etc. Not a new address grammar — Semantic Targets *contain* Refs and report what's resolvable inside a Target.
_Avoid_: hit, candidate, probe result.

**Anchor (role)**:
A role played by an admitted target when `aos show` uses it as a placement reference for a Subject's display. Today exposed through `--anchor-window` and `--anchor-channel`; managed browser anchoring is deferred until a later contract proves browser-window locality. A generic `--anchor <target>` may consolidate admitted resolvers once their contract is shared. *Anchor* is the input-grammar role — see also **Anchor Binding** for the resolved form.
_Avoid_: mount point, attach point, parent target.

**Anchor Binding**:
The resolved, stored representation of an Anchor inside the display subsystem after the input has been parsed and resolved. Carries the lower-level placement state (e.g. `anchor_window + offset`) plus lifecycle behavior. Distinct from the input Anchor: the display system can re-resolve an Anchor Binding without changing the original Target-with-Ref string.
_Avoid_: placement, attachment.

**Host**:
The runtime/container that renders a Facet and exposes it to agents through a Target dialect. The two Host kinds today are **Browser Host** (renders in a managed browser session; checkpoint 2B admits session operations and observations but defers ref actions) and **Canvas Host** (renders in an AOS canvas, addressed as `canvas:<canvas-id>/<ref>`, operated through AOS canvas semantic targets and runtime plumbing). Subjects are host-neutral; *Facets* declare which Hosts they support.
_Avoid_: container, runtime (too generic), surface (overloaded with display-system "surface").

**Browser-Compatible (Facet)**:
A Facet that can run correctly in a Browser Host. It supplies semantic Refs (`data-aos-ref`), accessible/ARIA controls, no reliance on AOS-only window-server behavior, no hidden canvas-only APIs, and enough DOM/ARIA structure for browser observations. Checkpoint 2B does not make those refs actionable.
_Avoid_: web-compatible, portable.

**Browser-First (posture)**:
A design default: for wiki/editor/artifact workbenches, prefer Browser-Hosted Facets unless a runtime reason requires Canvas Hosting. A posture, not a ban on Canvas Hosts.
_Avoid_: web-first, browser-only.

**AOS-Native (Facet)**:
A Facet that requires Canvas Hosting because it depends on privileged runtime behavior: DesktopWorld overlays, Canvas Inspector, input routing diagnostics, spatial telemetry, readiness/permission surfaces, or other daemon-owned projection/control behavior. AOS-Native Facets cannot be Browser-Compatible by definition.
_Avoid_: native (overloaded with macOS-native), canvas-only (correct in effect but loses the "requires runtime privilege" rationale).

**State ID**:
An opaque perception identifier minted by `aos see capture` that names one
observed state. Paired with `ref`, it forms an Observation Ref; a stale pair must
reject. Locators re-resolve current state and do not use an old State ID as
authority. Coordinate actions cannot validate captured semantic state and
reject a supplied State ID with `TARGET_STATE_UNSUPPORTED`.
_Avoid_: state, version, snapshot id (those are storage-layer terms), perception id (technically equivalent but State ID is the wire term).

**Subject Reference**:
A typed pointer from one Subject (or one of its Facets) to another Subject (or one of its Facets). Used to express that a domain Subject's narrative Facet sources from a `wiki.entity` Subject at a separate path. A Subject Reference does not change either Subject's identity or `subject_type`; both Subjects remain stable, the reference is the relationship between them.
_Avoid_: link (overloaded with Markdown/HTML links), pointer, embed (embedding implies inclusion, which we explicitly rejected — see ADR-0007).

**Subject Browser**:
A surface (Browser-Hosted or Canvas-Hosted) that lets a user or agent open Subject Entry Handles, inspect the Subject in focus, view and open its Facets, follow Subject References, and maintain a Navigation Trail. A class of surfaces, not a single named thing. The wiki is the first Subject Browser; Canvas Inspector may implement AOS-Native Subject Browser behavior for runtime Subjects; a future Work Record browser would be another. Subject Browsers *navigate* Subjects but do not own them — Subject identity and source of truth stay with the underlying source (wiki path, runtime registry, audit store, etc.).
_Avoid_: wiki (Subject Browser is the abstraction; the wiki is one instance), navigator, explorer.

**Capability**:
A named contract a Subject promises to support — not a button label, not a
Facet name. Used by consumers (Subject Browsers, verifiers, exporters, replay
tooling) to *negotiate* which behaviors the Subject implements. The v0
high-level set is: `inspectable` (read-only viewing baseline), `editable` (has
at least one controls/editor Facet plus a persistence or patch contract),
`verifier-target` (has enough claims/evidence/health structure for verifier
evaluation), `replayable` (advertises a current source-backed executable
Workflow or Recipe; a Work Record or Step Descriptor alone is insufficient),
and `exportable` (can produce or expose serializable artifact bundles). Each
Capability has a documented contract in
`shared/schemas/aos-subject-capabilities.md`.
_Avoid_: feature, role, ability (too generic); permission (overloaded with macOS permissions).

**Control (Verb)**:
An operation exposed through a Facet or Host — `open`, `edit`, `save`, `verify`, `export`, etc. Controls are *derived* from the combination of a Subject's Capabilities and its Facets, not stored separately on the Subject. A Subject Browser that sees `editable` in `capabilities[]` knows to surface an Edit Control on whichever Facet sits in the controls Layer.
_Avoid_: action (overloaded with `aos do`), affordance (UX term, not a model term), command.

**Patch Channel**:
A contract through which controls, views, agents, or hosts submit structured changes to a Subject Owner and receive explicit owner results. It is a logical mutation contract, not necessarily one transport. Existing examples include `canvas_object.transform.patch` / `.result` and `canvas_object.effects.patch` / `.result`.
_Avoid_: direct edit, sync channel, lock.

**Patch Result**:
The terminal owner response to one patch attempt. Canonical patch result statuses are `applied`, `rejected`, and `stale`: `applied` means the owner changed state and returns the owner-applied state fragment; `rejected` means the owner did not apply the patch, often with a reason or validation detail; `stale` means the patch was based on state the owner no longer accepts. Validation diagnostics can be attached to a rejection or returned by a separate preflight/validate operation; a revised edit is a new patch attempt, not a continuation of a pending patch.
_Avoid_: accepted (schema term is `applied`), validation-result (diagnostic detail, not a terminal patch status).

## Relationships

- A **Subject** is projected through one or more **Layers**.
- A **Facet** belongs to exactly one **Layer** of one **Subject**.
- A **Layer** can be served by multiple **Facets** (e.g. a Markdown narrative and an audio narrative both occupy the narrative Layer).
- A **Subject** has a stable identity that survives Facet additions or removals; opening a different Facet does not change which Subject is in focus.
- A **Subject Entry Handle** resolves to one Subject and one entry Facet on that Subject.
- A **Navigation Trail** is a sequence of Subject Entry Handles where each handle's Subject is typically a child or related Subject of the previous handle's Subject.
- `subject_type` (a schema field on `aos.workbench.subject`) names *what kind of Subject* the descriptor represents (e.g. `wiki.concept`, `service.runtime`); facet keys are a separate namespace and do not collide with `subject_type` values.
- A **Run** emits Evidence and may emit exactly one **Work Record** for the
  bounded unit being proven. A Verifier consumes Work Records, never Guides or
  Playbooks directly, because trust attaches to what actually happened.
- **Workflows** may invoke **Recipes**, gated harnesses, agent tasks, or
  human decisions. A Recipe may be one executable child of a Workflow, but a
  Recipe does not orchestrate multi-system gates and child runs. Active Work
  Record V1 origins use `origin.kind` values (`ad_hoc | recipe | workflow`).
  Markdown Guides/SOPs that shaped a run without executing should
  be cited via `references[]` (`relationship: "guided_by"`), not as `origin`.
- Historical **Dock** and project-agent role material are archived outside the
  active repo tree. They do not define current AOS session routing, Workflow
  semantics, or native provider registration.
- Within a Work Record: the **intent spine** is durable, the **execution map** is repairable, **evidence** is immutable, **Verifier Health** can be re-evaluated.
- **Claims** belong to the intent spine; **Postconditions** belong to the execution map. A Claim references zero or more Postconditions; a Postcondition can exist as a step-local gate without being referenced by any Claim.
- The verifier produces one **Claim Result** per Claim by evaluating the Claim's referenced Postconditions against captured Evidence; aggregated Claim Results determine the run's **Verifier Health**.
- A **Target-with-Ref** is a current browser/canvas transport string. The public
  observed handle is the **Observation Ref** pair `(state_id, ref)`; the public
  re-resolving handle is a **Locator**. An **Anchor** is one role a target can
  play; on resolution it becomes an **Anchor Binding** in the display subsystem.
- A **Saved Ref** (`ref:<snapshot-id>:<ref-id>`) is current workspace storage and
  dispatch plumbing, not a third public target type. It stores exactly one
  Observation Ref or Locator; automatic reacquisition and bare-ref shorthand are
  invalid V1 behavior.
- Refs are dialect-specific components of Observation Refs. Locators carry
  declarative machine queries. Screen coordinate actions carry only raw
  coordinates and reject `--state-id`.
- A **Subject** is host-neutral. A **Facet** declares one or more **Hosts** it supports; opening a Facet means picking one of its Hosts and addressing the resulting render through that Host's Target dialect.
- **Browser-First** is a posture for wiki/editor/artifact Facets; **AOS-Native** is a *requirement* for Facets that depend on AOS runtime privileges. Most Facets fall in between and can declare multiple Hosts.
- A **State ID** plus `ref` is required-for-correctness for an Observation Ref;
  a stale pair rejects. Locators and coordinates reject State ID. Dry-run, when
  explicitly chosen, follows identical validation/resolution and stops before
  mutation without minting a new perception.
- `subject_type` names the **kind** of a Subject (`wiki.entity`, `service.runtime`, `artifact.bundle`, etc.) and is stable per Subject. Cross-Subject relationships use **Subject References**, not by switching `subject_type` based on context.
- A **Subject Reference** carries a Subject Entry Handle (or Facet path) plus optional metadata (relationship type, role); a **Subject Entry Handle** is the resolver address. They are different layers — references express *relationships*; handles express *navigation*.
- A **Subject Browser** consumes Subject Entry Handles, renders Navigation Trails, and follows Subject References. It is hosted via a normal **Host** (Browser or Canvas). The wiki, Canvas Inspector (when navigating runtime Subjects), and any future Work Record browser are all instances of this surface kind.
- **Capabilities** declare *what contracts* a Subject implements; **Facets** declare *what projections* it offers; **Controls** are operations *derived* from the combination. A Subject Browser uses `capabilities[]` to decide which classes of behavior are safe to offer, then finds the matching Facets to attach those behaviors to.
- A **Subject Owner** owns mutation authority for a Subject. Controls and agents submit edits through **Patch Channels**; callers do not hold implicit locks.
- **Patch Results** are scoped to the Patch Channel that produced them. A `stale` Patch Result means refresh the relevant Subject or Facet state and submit a new patch.

## Example dialogue

> **Plan author:** "Phase 3 adds `facets[]` to `aos.workbench.subject`. Should that replace `layers`?"
> **Domain lead:** "No — **Layers** are the taxonomy and stay fixed. **Facets** are the concrete projections the wiki browser actually opens. Each Facet declares its Layer."
> **Plan author:** "So a wiki page is a Facet, not a Layer?"
> **Domain lead:** "Right — it's a narrative-Layer Facet of whichever Subject it documents. The Layer is `narrative`; the Facet is the specific Markdown projection."

## Flagged ambiguities

- "facet" vs "layer" — resolved: Facets are concrete projections; Layers are the ordered taxonomy a Facet declares membership in. See ADR-0001.
- "wiki page as Subject" vs "wiki page as Facet" — **resolved (ADR-0007)**: the wiki page is *always* a Subject (`wiki.entity` / `wiki.concept` / etc.). Domain Subjects carry a **Subject Reference** to the wiki document Subject as the source of their narrative-Layer Facet. Two stable Subjects, related by reference; no Subject ever has a context-dependent `subject_type`.
- Cutover note — wiki helper output keeps wiki documents as wiki-oriented Subjects. Consumer-owned domain Subjects are emitted by consumer adapters and relate back to wiki narrative documents through top-level `subject_references[]`.
- `capabilities[]` now contains only high-level registry names such as `inspectable`, `editable`, `verifier-target`, `replayable`, and `exportable` in live writer output. Dotted operation/event strings like `markdown_document.text.patch`, `wiki.invoke`, `work_record.execution_map.edit`, and `canvas_object.effects.patch` are live `contracts[]` values. Reader fallback for archived descriptors stays isolated in compatibility helpers and should not drive new Subject Browser behavior.
- "subject chain" — resolved: this is a **Navigation Trail** of Subject Entry Handles, not a chain of Subjects. Toolkit now defines the canonical `<facet-key>:<subject-id>` handle helper; only a future shared JSON schema for handles, if desired, remains pending.
- Work Record `origin` field shape — **resolved (ADR-0009, refined by
  ADR-0013 and ADR-0040)**: `origin: { kind, ref }` where `kind ∈ ad_hoc |
  recipe | workflow` in active Work Record V1. Markdown Guides/SOPs and Playbooks are
  *not* origins unless a live executable Workflow or Recipe wraps them; guidance
  is cited via a separate `references[]` array with `relationship: "guided_by"`.
  Active contract: `shared/schemas/aos-work-record-v1.md`; V0 is frozen
  historical input and active readers reject it.
- AOS Execution Model: **resolved (ADR-0013)**: the formal taxonomy is
  Primitive -> Block -> Recipe -> Workflow -> Run -> optional Work Record +
  Evidence, with Gates, Signals, Checkpoints, Guides, and Playbooks around that
  stack.
  `Recipe` means executable source-backed procedure; `docs/guides/` is the
  home for Markdown Guides/SOPs.
- The active Step Descriptor V1 harness is neutral: descriptors end at one
  source-bound action plus postconditions, claim promotions, and evidence
  requirements. The caller selects the harness; no Workflow Gate, approval,
  risk, or operation-registry field authorizes execution. When a caller elects
  to invoke the harness, it emits a Work Record V1 and runs the report-only
  verifier. The Gate-coupled V0 schema and fixtures are frozen history.
- Verifier Report shape — resolved direction (ADR-0003): use
  `claim_results[]` as the source of truth, with `verified`, `failed`, and
  `unverified` as derived indexes of Claim IDs, not independent storage. When a
  Verifier Report is embedded in a Work Record it should not echo the full
  `claims` list (single source of truth); when reports travel standalone, they
  include a `claims_digest` for auditability. Active Work Record V1 keeps
  `claim_results[]` top-level and makes report indexes derived.
- Claim promotion — **resolved in Step Descriptor V1**: `claim_promotions[]`
  maps exact descriptor postconditions into Work Record V1 Claims. Promotion
  is evidence projection, not a Gate or action-admission field.
- `--anchor-window` and `--anchor-channel` are role flags, not a parallel target
  dialect. Managed browser anchoring remains deferred. Longer-term a generic
  `--anchor <target>` flag may consolidate admitted resolvers, but that is a
  separate cleanup. See ADR-0004 and `docs/api/aos.md`.
- `facets[].host` enum (`"browser" | "canvas" | "either"`) was considered and rejected as too coarse — a Facet may have *multiple Host implementations* with different entry points, target dialects, or fidelity. Resolved direction: `facets[].hosts[]` array of `{ kind, target_dialect, entry, ... }` records, with optional preference ordering. Initial sketch: `shared/schemas/aos-workbench-subject-vnext.md`.
- "Dual-hosting" — resolved meaning: shipping a Facet with both Browser-Host
  and Canvas-Host implementations. A Facet may expose one or multiple Hosts;
  dual-hosting is never a blanket requirement for every editor Facet.
- Dock vs Workflow — resolved: **Dock** and **Docked Session** are retired
  historical persona/session-isolation concepts. Keep **Workflow** reserved for
  AOS/domain orchestration Subjects, not persona/session isolation. Do not add
  compatibility files that couple role/persona docks into a separate
  orchestration layer.
- `stale` — resolved direction: `stale` is a qualified freshness failure, not one global verdict. The field path or namespace owns the recovery path: Patch Result `stale` means refresh Subject/Facet state and submit a new patch; Verifier Health `stale` means the Work Record no longer proves current truth; an Observation Ref stale error means the `(state_id, ref)` pair is no longer current; Locator `missing` or `ambiguous` is a separate action-time resolution result. V1 target-handle routes enforce that distinction. Bare `stale` in logs, UI, or dashboards is under-namespaced.
- `validation-result` in patch prose — resolved: validation detail is diagnostic information attached to a `rejected` Patch Result or returned by a separate preflight/validate operation. It is not a terminal Patch Result status, and revised input is a new patch attempt.

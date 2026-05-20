# agent-os

The shared context for the `agent-os` repo: the unified `aos` runtime, its
toolkit, and consumer apps such as Sigil. This file captures terminology that
domain experts (designers, agent operators, plan authors) need to share with
implementers.

## Language

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
A string that resolves to a Subject *plus an entry Facet*, used in links and navigation. Form: `<facet-key>:<subject-id>` (e.g. `wiki:Sigil` opens the canonical `Sigil` Subject and lands on its wiki/narrative Facet). The handle preserves Subject identity — opening a different entry Facet on the same Subject does not change which Subject is in focus.
_Avoid_: subject id alone (loses the entry Facet hint), URL (overloaded), target (reserved for `aos see/do` dialects like `browser:`, `canvas:`).

**Navigation Trail**:
An ordered list of Subject Entry Handles describing how a user reached the current Facet — e.g. `wiki:Sigil → sigil.radial_menu:default → sigil.radial_menu.item:wiki-graph`. The trail crosses Subject boundaries (parent Subject → child Subject), unlike a Facet list, which stays within one Subject.
_Avoid_: subject chain, breadcrumb (those imply a flat hierarchy; trails can branch and collapse).

**Work Record**:
The canonical layered artifact for one run of work. Carries an **intent spine** (durable narrative of what the run was for), an **execution map** (structured but repairable: refs, locators, waits, assertions, action hints, artifact routes, replay hints), **evidence** (immutable see/do/see frames, artifacts, traces), and **health** (the verifier's verdict). A Work Record is itself a Subject; the verifier health is its health Layer.
Current v0 schema sketch: `shared/schemas/aos-work-record-v0.md`.
_Avoid_: log, audit entry, transcript, trace (those are Evidence-Layer terms; a Work Record is the larger composite).

**Recipe**:
A reusable, bounded procedure: how a piece of work might happen again. Two flavors coexist in the repo: **documentation-only Recipes** under `docs/recipes/` (Markdown SOPs read by humans/agents to shape judgment) and **source-backed Recipes** runnable through AOS surfaces such as `aos ops` (re-executable knowledge with explicit inputs/outputs). Scope: one bounded procedure. A Recipe may compile into Playbook-like executable steps but is not itself constrained to the `see/do/see/verify` shape.
_Avoid_: SOP (only one flavor), tutorial, doc.

**Playbook**:
Reusable execution knowledge over the `see → resolve → do → see → verify` shape: a named, replayable plan composed of steps, where each step has preconditions, target-resolution strategy, the action, postconditions, and optional repair hints. A Playbook is the *agent-operable* variant of a Recipe — verifier-oriented, target-aware. A Playbook is itself a Subject. Running a Playbook *emits* a Work Record; the Playbook is not the run.
_Avoid_: macro, script, runbook.

**Workflow**:
An orchestration graph or chain of Recipes, Playbooks, agent tasks, approvals, external operations, inputs, outputs, and artifacts. A Workflow is a Subject. Scope: multi-step process, often crossing systems or human gates. A Workflow run typically emits one or more Work Records (one per meaningful execution unit or child run).
_Avoid_: pipeline, process (too generic), automation.

**Dock**:
A repo-local Codex session profile rooted under `.docks/`, used to isolate persona or work-role instructions, hooks, and config from the normal session entry point.
_Avoid_: workflow, workflow template, generated run, source workspace.

**Docked Session**:
One Codex session launched from a Dock so it adopts that Dock's local instructions, hooks, and config.
_Avoid_: workflow run, Workflow run, automation run.

**Verifier Health**:
The terminal verdict the verifier writes to a Work Record's health Layer. One of: `valid`, `stale`, `repairable`, `blocked`, `impossible`, `superseded`, `retired`. Drives whether a run can be replayed, must be repaired, or has aged out of relevance.
_Avoid_: status, state (overloaded with `state_id`).

**Claim**:
A durable, agent/human-readable assertion on a Work Record about what the run accomplished — e.g. "the subscription was cancelled," "the radial menu item render was updated." Claims live on the **intent spine** and survive selector/ref drift. A Claim references zero or more **Postconditions** that operationalise the check.
_Avoid_: assertion (overloaded with code-level asserts), expectation, outcome.

**Postcondition**:
A structured, machine-checkable condition tied to a `see` capture — DOM state, AX state, canvas object state, artifact presence, file contents, command exit, etc. Lives on the **execution map** and is repairable: when a selector or ref drifts, the Postcondition is patched, not the Claim. May be a step-local gate (used inside one Playbook step and not promoted) or referenced from a Claim.
_Avoid_: precondition (those are the per-step *entry* checks), expectation, check (too generic).

**Claim Result**:
The per-Claim verdict produced by the verifier: status (`verified | failed | unverified`), evidence references, confidence, and reason. Aggregated over a Work Record's Claims, the Claim Results determine the run's overall **Verifier Health**.
_Avoid_: claim status (looks like a field on the Claim itself; it's a separate verifier output).

**Target**:
A scope address in an AOS target dialect. Live ref-addressed CLI target strings
currently include `browser:<session>[/<ref>]` and
`canvas:<canvas-id>/<ref>`. `screen` and `ax` remain useful target-model
vocabulary, but their current CLI wire forms are not `screen:` or `ax:` target
strings: coordinate actions use raw `x,y` plus optional `--state-id`, and AX
actions are selected through flags such as `--pid` and `--role`.
_Avoid_: address (too generic), URL.

**Ref**:
A stable, semantic identifier of an element inside a Target's scope, when that dialect supports refs. In browser/canvas DOMs, materialized as `data-aos-ref`; in AX model terms, materialized as the AX path. Refs are dialect-specific — screen coordinate actions do not have Refs, so coordinates are correlated with a `state_id` for staleness/provenance.
_Avoid_: id, selector, locator (those are implementation strategies; a Ref is the durable name).

**Target-with-Ref**:
A complete address for one semantic element inside a Target's scope:
`<dialect>:<scope-id>/<ref>`. This is the live wire form for browser and
canvas targets and the target-model shape for other ref-addressed resolvers as
they converge.
_Avoid_: full target (ambiguous), qualified ref.

**Semantic Target**:
A discovered candidate emitted by perception, typically from `aos see ... --xray`. A structured record carrying ref, name, role, bounds, state, AOS ownership metadata, etc. Not a new address grammar — Semantic Targets *contain* Refs and report what's resolvable inside a Target.
_Avoid_: hit, candidate, probe result.

**Anchor (role)**:
A role played by a Target-with-Ref when `aos show` uses it as a placement reference for a Subject's display. Today exposed via dialect-specific flags (`--anchor-browser`, `--anchor-window`, `--anchor-channel`); a generic `--anchor <target>` may consolidate these once the resolver contract is shared. *Anchor* is the input-grammar role — see also **Anchor Binding** for the resolved form.
_Avoid_: mount point, attach point, parent target.

**Anchor Binding**:
The resolved, stored representation of an Anchor inside the display subsystem after the input has been parsed and resolved. Carries the lower-level placement state (e.g. `anchor_window + offset`) plus lifecycle behavior. Distinct from the input Anchor: the display system can re-resolve an Anchor Binding without changing the original Target-with-Ref string.
_Avoid_: placement, attachment.

**Host**:
The runtime/container that renders a Facet and exposes it to agents through a Target dialect. The two Host kinds today are **Browser Host** (renders in a browser session, addressed as `browser:<session>/<ref>`, operated through Playwright/DOM/ARIA semantics) and **Canvas Host** (renders in an AOS canvas, addressed as `canvas:<canvas-id>/<ref>`, operated through AOS canvas semantic targets and runtime plumbing). Subjects are host-neutral; *Facets* declare which Hosts they support.
_Avoid_: container, runtime (too generic), surface (overloaded with display-system "surface").

**Browser-Compatible (Facet)**:
A Facet that can run correctly in a Browser Host and be operated through the `browser:` Target dialect. Implies semantic Refs (`data-aos-ref`), accessible/ARIA controls, no reliance on AOS-only window-server behavior, no hidden canvas-only APIs, and enough DOM/ARIA structure for `aos see/do browser:<session>/<ref>` to work.
_Avoid_: web-compatible, portable.

**Browser-First (posture)**:
A design default: for wiki/editor/artifact workbenches, prefer Browser-Hosted Facets unless a runtime reason requires Canvas Hosting. A posture, not a ban on Canvas Hosts.
_Avoid_: web-first, browser-only.

**AOS-Native (Facet)**:
A Facet that requires Canvas Hosting because it depends on privileged runtime behavior: DesktopWorld overlays, Canvas Inspector, input routing diagnostics, spatial telemetry, readiness/permission surfaces, or other daemon-owned projection/control behavior. AOS-Native Facets cannot be Browser-Compatible by definition.
_Avoid_: native (overloaded with macOS-native), canvas-only (correct in effect but loses the "requires runtime privilege" rationale).

**State ID**:
An opaque perception identifier minted by `aos see capture` that names the state the agent acted from. Guards the *premise* of an action: "I chose this based on this observed state." For **coordinate actions** it is supplied in the live CLI as `--state-id <id>` alongside the raw `x,y` coordinate, because coordinates have no semantic identity without a referenced perception. For **Ref-based actions** it is correlation/provenance metadata — Refs can be re-resolved against the current scope, so a stale State ID does not invalidate a Ref. Today AOS echoes and correlates State IDs but does not reject stale coordinate actions; future enforcement is scoped to coordinate fallbacks only.
_Avoid_: state, version, snapshot id (those are storage-layer terms), perception id (technically equivalent but State ID is the wire term).

**Subject Reference**:
A typed pointer from one Subject (or one of its Facets) to another Subject (or one of its Facets). Used to express things like "Sigil's narrative Facet sources from the `wiki.entity` Subject at path X." A Subject Reference does not change either Subject's identity or `subject_type`; both Subjects remain stable, the reference is the relationship between them.
_Avoid_: link (overloaded with Markdown/HTML links), pointer, embed (embedding implies inclusion, which we explicitly rejected — see ADR-0007).

**Subject Browser**:
A surface (Browser-Hosted or Canvas-Hosted) that lets a user or agent open Subject Entry Handles, inspect the Subject in focus, view and open its Facets, follow Subject References, and maintain a Navigation Trail. A class of surfaces, not a single named thing. The wiki is the first Subject Browser; Canvas Inspector may implement AOS-Native Subject Browser behavior for runtime Subjects; a future Work Record browser would be another. Subject Browsers *navigate* Subjects but do not own them — Subject identity and source of truth stay with the underlying source (wiki path, runtime registry, audit store, etc.).
_Avoid_: wiki (Subject Browser is the abstraction; the wiki is one instance), navigator, explorer.

**Capability**:
A named contract a Subject promises to support — not a button label, not a Facet name. Used by consumers (Subject Browsers, verifiers, exporters, replay tooling) to *negotiate* which behaviors the Subject implements. The v0 high-level set is: `inspectable` (read-only viewing baseline), `editable` (has at least one controls/editor Facet plus a persistence or patch contract), `verifier-target` (has enough claims/evidence/health structure for verifier evaluation), `replayable` (has an origin or execution map that can be re-run under policy), `exportable` (can produce or expose serializable artifact bundles). Each Capability has a documented contract in `shared/schemas/aos-subject-capabilities.md`.
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
- `subject_type` (a schema field on `aos.workbench.subject`) names *what kind of Subject* the descriptor represents (e.g. `wiki.concept`, `sigil.radial_menu.item_3d`); facet keys are a separate namespace and do not collide with `subject_type` values.
- A **Playbook** execution emits exactly one **Work Record**. Ad-hoc work also emits a Work Record (without a Playbook origin). A Verifier consumes Work Records, never Playbooks directly — trust attaches to what actually happened, not to the reusable plan.
- **Workflows** may invoke **Recipes** or **Playbooks**; **Recipes** may compile into Playbook-like executable steps; **Playbooks** should not invoke Workflows (that would invert the abstraction — anything orchestrating multi-system gates and child runs *is* a Workflow). All three can be the **origin** of a Work Record (`origin.kind: ad_hoc | recipe | playbook | workflow`); documentation-only Recipes that *guided* a run without executing should be cited via `references[]` (`relationship: "guided_by"`), not as `origin`.
- A **Dock** is adopted by launching Codex from that dock's directory, or with `codex --cd <dock-dir>`. A **Docked Session** may work on a **Workflow**, but the Dock is not the Workflow and does not create a parallel Workflow type.
- Within a Work Record: the **intent spine** is durable, the **execution map** is repairable, **evidence** is immutable, **Verifier Health** can be re-evaluated.
- **Claims** belong to the intent spine; **Postconditions** belong to the execution map. A Claim references zero or more Postconditions; a Postcondition can exist as a step-local gate without being referenced by any Claim.
- The verifier produces one **Claim Result** per Claim by evaluating the Claim's referenced Postconditions against captured Evidence; aggregated Claim Results determine the run's **Verifier Health**.
- A **Target-with-Ref** is the model unit of address for ref-addressed `aos see`/`aos do`/`aos show` operations. Live CLI forms currently expose it for browser and canvas targets. An **Anchor** is one role a Target-with-Ref can play (placement reference for `show`); on resolution it becomes an **Anchor Binding** in the display subsystem.
- Refs are dialect-specific: `browser` and `canvas` live CLI targets carry Refs, and AX model targets identify elements by AX path/filters. Screen coordinate actions carry raw coordinates plus `--state-id` instead.
- A **Subject** is host-neutral. A **Facet** declares one or more **Hosts** it supports; opening a Facet means picking one of its Hosts and addressing the resulting render through that Host's Target dialect.
- **Browser-First** is a posture for wiki/editor/artifact Facets; **AOS-Native** is a *requirement* for Facets that depend on AOS runtime privileges. Most Facets fall in between and can declare multiple Hosts.
- A **State ID** is required-for-correctness on coordinate actions and is passed
  in the current CLI as `--state-id <id>` next to raw `x,y`; it is
  recommended-for-provenance on Ref-based actions. Dry-run preserves and echoes
  the supplied State ID without minting a new perception.
- `subject_type` names the **kind** of a Subject (`wiki.entity`, `sigil.agent`, `sigil.radial_menu.item_3d`, etc.) and is stable per Subject. Cross-Subject relationships use **Subject References**, not by switching `subject_type` based on context.
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
- "wiki page as Subject" vs "wiki page as Facet" — **resolved (ADR-0007)**: the wiki page is *always* a Subject (`wiki.entity` / `wiki.concept` / etc.). Domain Subjects (`sigil.agent`, etc.) carry a **Subject Reference** to the wiki document Subject as the source of their narrative-Layer Facet. Two stable Subjects, related by reference; no Subject ever has a context-dependent `subject_type`.
- Cutover note — wiki helper output now keeps wiki documents as wiki-oriented Subjects. App-specialized domain Subjects such as `sigil.agent` are emitted by domain helpers and relate back to wiki narrative documents through top-level `subject_references[]`.
- `capabilities[]` now contains only high-level registry names such as `inspectable`, `editable`, `verifier-target`, `replayable`, and `exportable` in live writer output. Dotted operation/event strings like `markdown_document.text.patch`, `wiki.invoke`, `work_record.execution_map.edit`, and `canvas_object.effects.patch` are live `contracts[]` values. Reader fallback for archived descriptors stays isolated in compatibility helpers and should not drive new Subject Browser behavior.
- "subject chain" — resolved: this is a **Navigation Trail** of Subject Entry Handles, not a chain of Subjects. Toolkit now defines the canonical `<facet-key>:<subject-id>` handle helper; only a future shared JSON schema for handles, if desired, remains pending.
- Work Record `origin` field shape — **resolved (ADR-0009)**: `origin: { kind, ref }` where `kind ∈ ad_hoc | recipe | playbook | workflow`. Documentation-only Recipes are *not* origins; they are cited via a separate `references[]` array with `relationship: "guided_by"`. Schema sketch: `shared/schemas/aos-work-record-v0.md`; representative Work Record helpers now preserve v0 origin/reference data in descriptor projections.
- Phase 6 of `aos-grand-unification-plan.md` lists "save a work record" and "run verifier report" as Playbook steps — they are *harness obligations* around running a Playbook, not steps inside it. Playbook step sequences end at the final action + postcondition. Pending: plan revision.
- Verifier Report shape — the plan lists `claims`, `verified`, `failed`, `unverified` as four parallel fields. Resolved direction (ADR-0003): use `claim_results[]` as the source of truth; if the four parallel fields persist, they are *derived indexes of Claim IDs*, not independent storage. When a Verifier Report is embedded in a Work Record it should not echo the full `claims` list (single source of truth); when reports travel standalone, they include a `claims_digest` for auditability. The v0 sketch keeps `claim_results[]` top-level and makes report indexes derived.
- A Playbook needs explicit syntax to *promote* a step Postcondition into a Work Record Claim (Playbooks should be able to declare run-wide outcomes, not only step-local gates). The v0 Work Record examples show promoted run Claims referencing execution-map Postconditions; Playbook step grammar design remains pending.
- `--anchor-browser` (and sibling `--anchor-window`, `--anchor-channel`) is a *role flag* whose value is a regular Target-with-Ref, not a parallel target dialect. The plan now says this explicitly; longer-term a generic `--anchor <target>` flag may consolidate them, but that is a future cleanup, not a plan rewrite. See ADR-0004.
- `facets[].host` enum (`"browser" | "canvas" | "either"`) was considered and rejected as too coarse — a Facet may have *multiple Host implementations* with different entry points, target dialects, or fidelity. Resolved direction: `facets[].hosts[]` array of `{ kind, target_dialect, entry, ... }` records, with optional preference ordering. Initial sketch: `shared/schemas/aos-workbench-subject-vnext.md`.
- "Dual-hosting" (used in `aos-grand-unification-plan.md` Phase 4) — resolved meaning: shipping a Facet with both Browser-Host and Canvas-Host implementations. The plan now says every editor Facet does not need to ship both Browser-Host and Canvas-Host implementations.
- Dock vs Workflow — resolved: **Dock** and **Docked Session** are the canonical concepts for persona/session isolation. Keep **Workflow** reserved for AOS/domain orchestration Subjects such as the Employer Brand Comparative Audit Workflow. Do not add compatibility files that couple role/persona docks into a separate orchestration layer.
- `stale` — resolved direction: `stale` is a qualified freshness failure, not one global verdict. The field path or namespace owns the recovery path: Patch Result `stale` means refresh Subject/Facet state and submit a new patch; Verifier Health `stale` means the Work Record no longer proves current truth; projection `stale` means re-resolve or re-render the addressed view; State ID freshness is not a first-class enum today, and the active diagnostic remains `state_id_inconsistency`. Bare `stale` in logs, UI, or dashboards is under-namespaced.
- `validation-result` in patch prose — resolved: validation detail is diagnostic information attached to a `rejected` Patch Result or returned by a separate preflight/validate operation. It is not a terminal Patch Result status, and revised input is a new patch attempt.

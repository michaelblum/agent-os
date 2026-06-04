# Agent UI Affordance Synthesis V0 — Analyst Review

Objective architecture critique of `agent-ui-affordance-synthesis-v0.md`.
Grounded in current code at the same commit (`f38768bd…`), not in roadmap
language. Stance: skeptical, code-anchored, ingenuity over validation.

Files read for grounding: `packages/toolkit/runtime/semantic-targets.js`,
`packages/toolkit/panel/form.js`, `apps/sigil/avatar-editor/compact-surface.js`,
`apps/sigil/context-menu/snapshot-projection.js`,
`packages/toolkit/workbench/annotation-projection.js`,
`packages/toolkit/components/surface-inspector/index.js`,
`packages/toolkit/workbench/html-workbench-expression.js`,
`packages/toolkit/components/markdown-workbench/index.js`, plus the
`runtime-semantic-targets`, `panel-form`, and annotation test suites.

---

## Verdict: **REVISE**

Approve the direction. The two-layer model is correct — but it is **not a
proposal, it is a description of the architecture that already exists in tested
code**, and the synthesis under-sells that fact while over-softening three real
gaps. Reframe from "introduce a seam" to "formalize and de-duplicate the seam
that is already load-bearing," fix the named gaps, and it is ready to become an
ADR.

Not *reject* (the model is sound and half-built). Not *clean approve* (the
synthesis omits the single highest-frequency regression trap — casing — and
mis-frames its own strongest argument).

---

## 0.5 Stance update — breaking frozen contracts is sanctioned

Directive from the owner: *we can break things in service of cohesion and strong
foundations.* This removes the two brakes that several recommendations below were
hedging against — **migration cost** and **test-locked contracts**. The
recompute:

**What this flips (from "open question" to "decided"):**
- **Casing → snake_case, end to end, no internal/wire dialect split.** The
  camelCase `normalizeSemanticTarget` output (`aosRef`, `parentCanvasId`) is the
  lone holdout and gets migrated, including the attribute-stamping reads inside
  the same module. Do **not** "solve" this with a `toWireRecord()` translator —
  that just relocates the drift into an internal-vs-wire dialect. One vocabulary.
- **Kill the `ref`/`aosRef` duplicate.** `panel-form.test.mjs:272-273` gets
  rewritten to assert a single `ref`. The frozen contract was the only reason to
  preserve it; that reason is gone.
- **Delete the workbench parallel vocabulary outright** (`aos_ref` +
  `data_aos_ref` + `target_id`) rather than aliasing it through a compat shim.
  Fold `semanticTarget()` into the canonical normalizer in one move.

**What does NOT change — and this is the principled pushback:** breaking-license
de-risks *migration*, not *abstraction*. The expensive mistake is not "we broke a
test" — it is "we broke twelve call sites to enshrine a record shape modeled on
form controls, then discovered workbench source-line ranges and AX windows don't
fit it." That cost is unaffected by permission to break. **Strong foundations
therefore means slice 1 (read-only conformance fixtures, §10) still runs first.**
The license raises the ceiling on what slices 2–3 may change; it does not lower
the bar on proving the shape first. Move decisively, in the right order.

---

## 1. The headline finding (corrected for precision)

The synthesis says schemes are "converging but not unified." The code says
something sharper and more actionable: **producer-side identity has fractured
into a duplicate-spelling mess, and the consumer adapter pays for it at runtime
by sniffing six different id keys.**

`buildSemanticTargetProjectionAdapterResult(target, owner)`
(`annotation-projection.js:450`) opens with:

```js
const targetId = text(
  target.id || target.target_id || target.semantic_target_id
    || target.ref || target.do_target || target.data_aos_ref,
  'target',
);
```

That six-key probe is not defensive politeness — it is the **direct cost of the
producer side never agreeing on one identity field.** Surface Inspector calls
this adapter at `surface-inspector/index.js:329`, so the cost is paid on every
candidate.

But disaggregate the drift carefully, because a skeptical reader will otherwise
discount the whole finding:

**(a) Producer-side drift — the indefensible part.** Identity is spelled three
ways across producers, and two of those are *self-duplicating within a single
record*:

- `semantic-targets.js` emits `aosRef` (camelCase).
- `form.js` `controlRecordFor` spreads that and adds `ref`, where
  `ref === normalized.aosRef` — a literal duplicate inside one object
  (`form.js:329`). This is **test-locked**: `panel-form.test.mjs:272-273`
  asserts *both* `mode.ref` and `mode.aosRef` equal the same string. The wart is
  frozen, not accidental.
- `html-workbench-expression.js` `semanticTarget()` (`:151`) bypasses
  `normalizeSemanticTarget` entirely and emits **both** `aos_ref` *and*
  `data_aos_ref` carrying the identical value (`:167-168`), plus `target_id`,
  plus a `selector`.

**(b) Consumer-side vocabulary — NOT drift.** `subject_id` / `subject_path` /
`subject_kind` / `root_id` are the projection adapter's deliberate, consistent
snake_case vocabulary. That is not fracture — **that is the two-layer seam
already showing through in working, tested code.** The synthesis lumps these in
with the drift; they should be cited as evidence the second layer already
exists.

Raw key frequency across the five producer/consumer files (mechanical count):
`subject_id`×12, `target_id`×11, `ref`×11, `aosRef`×9, `data_aos_ref`×3,
`aos_ref`×3, `semantic_target_id`×2, `do_target`×1.

---

## 2. Is the two-layer model correct? (Q1)

**Yes, and it is already built.** The split is not aspirational:

| | Producer record | Projection adapter result |
|---|---|---|
| Function | `normalizeSemanticTarget` / `controlRecordFor` | `normalizeAnnotationProjectionAdapterResult` / `buildSemanticTargetProjectionAdapterResult` |
| Identity field | `id` + `aosRef` | `subject_id` + `subject_path` |
| Geometry | producer-local `frame` | `display_space_rect` (clipped), `local_space_rect`, `coordinate_space` |
| Visibility | — | `current_render_status`, clip/scroll chains, `blocker_reason(s)`, `can_reveal` |
| **Freshness** | **absent** | **`refreshed_at`, `stale`, `out_of_viewport`** |

Because Q1 explicitly offers "one canonical record with optional projection
fields" as the alternative, and because the owner's directive favors *cohesion*
(which leans toward consolidation), this needs a real steelman, not a one-stroke
dismissal.

#### Steelman: one record with a nested `projection` block

The strongest one-record form is **not** flat optional fields — it is a single
record with a nested, nullable `projection: { … }` sub-object:

- The "carries ~20 null fields" objection fails: it is one field, `projection:
  null`, when unprojected.
- The "blurs durable vs. ephemeral" objection fails: `refreshed_at` lives
  *inside* the `projection` block, co-located with exactly the ephemeral geometry
  it qualifies. Structural fields stay top-level and untimestamped. No blur.

So the freshness/lifecycle observation below is real but does **not** settle Q1:
it justifies *separating and independently stamping the projection facet*; it
does not discriminate between "two records joined on `ref`" and "one record with
a nested `projection`." (An earlier draft over-claimed here.) The lifecycle fact:
producer fields (`role`, `name`, `actions`) are structural and carry no
`refreshed_at`; projection fields carry `refreshed_at` + staleness statuses
(`stale`, `out_of_viewport`). True, and it kills the *flat* one-record option —
but not the nested one.

#### What actually decides it: cardinality and ownership

Three discriminators tip it to two records, and all three are visible in code:

1. **The projection layer is many-adapters→one-shape, not one-producer's tail.**
   `normalizeAnnotationProjectionAdapterResult` is the normalization target for
   **four** distinct adapters that key on `adapter_id`:
   `aos-toolkit-semantic-target`, `browser-content-seam`,
   `browser-dom-element-picker`, and `aos-canvas-window`
   (`annotation-projection.js:418,491`; `surface-inspector/index.js:280,341,642`).
   Most of these project subjects that are **not semantic targets at all** (a
   browser content seam, a canvas window). A nested `projection` on the producer
   record cannot model "this shape is produced by adapters that have no producer
   record."
2. **One `ref` can have multiple simultaneous projections (the strongest
   argument).** The result set is conceptually keyed by `(adapter_id, ref)`, not
   by `ref`. The same subject can be projected by the semantic-target adapter
   *and* a browser-DOM adapter at once. A single nested `projection` block holds
   exactly one adapter result; a separate, adapter-keyed result holds N. This is
   structural, not stylistic — it is the reason consolidation actually loses.
3. **Cross-component ownership/timing.** The producer emits at render; Surface
   Inspector computes projection on demand against live geometry. Merging them
   into one record implies someone updates half the record out-of-band — exactly
   the staleness footgun, now at the object level.

Net: keep two records — but on cardinality + ownership grounds, **not** on the
freshness argument the synthesis (and my first pass) reached for.

---

## 2.5 How many projection adapters? (3, not 4 — and *why* the count is not 1)

The cardinality argument in §2 invites the obvious follow-up: if four adapters
key the projection layer, is four *required*? No — and the reframe matters.

**They are not four schemas.** All four normalize to one result shape
(`normalizeAnnotationProjectionAdapterResult`); they differ only by `adapter_id`.
The count is not a contract — it is just how many distinct *identity/capability
strategies* exist. So the question is purely: how many genuinely-distinct
strategies are there?

**Don't collapse toolkit into browser, even though "it's all HTML."** This is the
tempting consolidation and it is the one to resist, because it would regress the
exact strict-contract line the rest of this review defends:

- `aos-toolkit-semantic-target` works on HTML **AOS owns and instruments** — we
  stamp `data-aos-ref`/`data-semantic-target-id` into the DOM and run our runtime
  inside it. Identity is a stable, pre-agreed `ref`.
- `browser-dom-element-picker` works on HTML **we do not own** — nothing is
  pre-stamped, so identity is reached over CDP and falls back to *sniffed
  selectors*, with session/tab/window identity resolved across a process
  boundary.

Stamped-ref vs. sniffed-selector is precisely the input-identity boundary §4.3
and trap §6.2 protect. "It's all HTML, treat the browser like a toolkit surface"
is the move that promotes a foreign page's selector to first-class identity.
Keep owned-DOM and un-owned-DOM as separate strategies.

**Do fold the two browser adapters — they are one capture ladder, not two
concerns.** This is the real consolidation:

- `browser-content-seam` (`annotation-projection.js:410`) is the *coarse* rung:
  "a session exists — is it local? which window/tab? is the DOM even reachable?"
  It is almost entirely blockers and defaults to `unsupported`
  (`browser_session_unresolved`, `browser_tab_identity_unresolved`,
  `browser_dom_cdp_deferred`).
- `browser-dom-element-picker` (`surface-inspector/index.js:280`) is the *fine*
  rung: once DOM/CDP access works, here is the specific element + selector.

Those are the **blocked state and the resolved state of the same concern** — the
rungs described in `docs/design/browser-capture-ladder-projection.md`. One
`browser` adapter with a render-status ladder (seam blockers when DOM is
unreachable → element targets when it is) is cleaner and removes a real seam in
the adapter set. `aos-canvas-window` stays separate regardless — that is
whole-window/canvas granularity, not in-DOM targeting.

**Net: 3 strategies — `owned-surface`, `browser` (laddered), `canvas-window`.**
And note the floor: the count cannot collapse to 1, for the same reason §2 gives
— a single subject can be projected by more than one of these at once
(`(adapter_id, ref)` cardinality), so the adapter axis is load-bearing no matter
how tidy the strategy list gets.

---

## 3. Should `normalizeSemanticTarget` grow, or get a sibling? (Q2)

**Sibling — and note that the sibling pattern already exists informally.**
`controlRecordFor` (`form.js:310`) *is* a sibling normalizer today: it composes
`normalizeSemanticTarget` and adds `descriptor_id`, `field_id`, `kind`,
`options`, `actions`. So `normalizeAgentUiTarget` is **formalizing an existing
pattern, not inventing one.**

Keep `normalizeSemanticTarget` as the small, test-locked semantic core (it
throws without id — `runtime-semantic-targets.test.mjs:100`; it refuses to
default `action` — `:111`). Growing it to carry source/provenance/projection
would break its one virtue: being small enough to trust.

**But** the sibling cannot just be "the union of today's bolt-ons," because
today's bolt-ons are inconsistent (see §4.1). The sibling must *normalize the
naming*, which means it must answer a question the synthesis never asks.

**Does the sibling survive once breaking is sanctioned?** Re-examined honestly:
two of the three reasons I would have kept a thin separate core were caution
artifacts (test-lock, camelCase legacy) — and §0.5 dissolves both. What remains
is a *layering* reason, and it is genuine but weaker than "required":
`normalizeSemanticTarget` has a second consumer that is **not** the agent JSON
record — it drives DOM attribute stamping (`semanticTargetAttributeEntries`,
`applySemanticTargetAttributes`), which reads only identity + role + name +
state, never `actions`/`options`/`provenance`. Be honest about the strength of
this: a *single* normalizer emitting optional `actions`/`extension` fields would
feed the stamper just as well (it would simply ignore them). So keeping two
**functions** is a defensible code-organization preference (small composable base
+ richer composer), **not** a contract requirement. Under a cohesion directive
the bar is: justify the second function as a real seam or fold it into one. My
call: keep the base+composer split — the attribute-stamper is a real second
caller and the base stays trivially testable — but migrate the base's output to
canonical snake_case + single `ref` (§0.5) so `normalizeAgentUiTarget` composes
it *without re-casing*. The split is a preference held on merit; the casing soup
at the composition boundary is the part that dies regardless.

---

## 4. Where the synthesis is too soft (the teeth)

### 4.1 Casing convergence is unaddressed — and it is the #1 regression trap

`controlRecordFor` produces **one object with two casing conventions**:
camelCase from the spread `normalizeSemanticTarget` output (`aosRef`,
`parentCanvasId`, `name`) plus snake_case bolt-ons (`descriptor_id`, `field_id`)
plus the duplicate `ref`. The consumer layer and workbench are uniformly
snake_case; only `normalizeSemanticTarget` is camelCase.

The synthesis proposes a sibling normalizer **without specifying which casing
the canonical wire record uses.** This is the highest-frequency trap because
every field touches it. If unspecified, the sibling will inherit the mixed-case
soup by default.

### 4.2 The `name` problem is 3-way, not 2-way

The synthesis's open question ("should `name` and `label` both exist?")
under-counts. Code has **three**: `name` (`semantic-targets.js`), `label`
(form/compact bolt-on + `controlOptions`), and `accessible_label`
(`html-workbench-expression.js:170`). Pick one public semantic field; demote the
rest to source metadata.

### 4.3 Selector nuance is conflated — sharpen it to *strengthen* the strict contract

The synthesis treats "selector present" as a regression risk. That is too
blunt. Workbench emits `selector` as a value **derived from the ref**
(`[data-semantic-target-id="${targetId}"]` — `html-workbench-expression.js:174`).
Selector-derived-from-ref is *good* — it is a reveal/locate hint downstream of
canonical identity. The actual trap is selector-as-**input**-identity (a
producer or `aos do` accepting a selector *as* the target address). Drawing this
line makes the strict-contract stance more precise, not weaker.

---

## 5. Core vs extension/provenance/diagnostic fields (Q3)

**Core producer (structural, durable, every target has them):**
`ref` (single canonical identity), `role`, `name`, `surface`, `enabled`,
`actions`.

**Core projection (ephemeral, computed, carries `refreshed_at`):**
`current_render_status`, `display_space_rect` + `coordinate_space`, `can_reveal`,
`blocker_reasons`, `refreshed_at`.

**Extension (kind-specific, optional):** `value`, `options` (controls);
`source_path` + `source_line_start/end` (workbench); `descriptor_id`,
`field_id`, `state_path`, `object_ids` (form binding).

**Provenance/diagnostic (never identity):** `selector`, `do_target`,
`provenance_source_payload_id`, `z_order_evidence`, `ancestor_viewport_clip_chain`,
`source_tree_node_metadata`, the raw `metadata` bag.

State flags (`pressed`/`selected`/`checked`/`expanded`/`current`) sit between
core and extension: structural in shape but value-like in volatility. Keep them
producer-side but document that they reflect *declared* state, not *projected*
state.

---

## 6. Regression traps from following older issue language literally (Q4)

1. **#164 Playwright-shaped dialect → second semantic vocabulary.** The single
   biggest trap. The codebase already standardizes on `see/do/show/tell/listen`.
   A `getByRole`-style alias layer added *before* the canonical ref is stable
   would add a *seventh* identity spelling. Aliases are safe only as sugar over a
   stable ref — defer hard.
2. **Selector-first addressing.** §4.3 — guard the input boundary, not the
   presence of selector strings.
3. **Surface-Inspector vocabulary leaking upstream.** `subject_id`,
   `blocker_reason`, `current_render_status`, `subject_path` are *consumer*
   terms. If they appear in a *producer* record, the layer boundary has
   collapsed. The producer should never emit `current_render_status` — it cannot
   know it.
4. **Casing soup canonized (§4.1).** Following the current code "as-is" would
   freeze the mixed-case `controlRecordFor` shape into the wire contract.
5. **Re-introducing silent fallback.** Current direction treats DOM-selector
   fallback as a *broken-contract signal*. #136's "structured DOM perception"
   language could be read as "scrape the DOM when the record is missing" — that
   would reverse hard-won progress. Keep blockers explicit
   (`blocker_reasons`), never silently substitute.

---

## 7. A more elegant framing (Q6): one `ref` spine, two facets by change-frequency

Reframe from "two records" to **one canonical `ref` as the spine, with two
facets attached to it, separated by change-frequency:**

- **Structural facet** — semantics + affordances. Producer-emitted. Changes only
  when UI structure changes. (`role`, `name`, `actions`, `state`, `kind`.)
- **Projection facet** — geometry + visibility + staleness. Computed on demand.
  Carries `refreshed_at`. (`display_space_rect`, `current_render_status`,
  clip/scroll chains, `blocker_reasons`.)

The `ref` is the **join key**, defined exactly once. This:

- explains *why* two layers exist (different lifecycles) rather than asserting
  it;
- gives a trivial join/caching model (refresh the projection facet without
  re-emitting structure);
- **eliminates the spelling drift by construction** — there is one `ref`, so
  there is nothing to sniff;
- is grounded: it is exactly what `buildSemanticTargetProjectionAdapterResult`
  does today, *minus* the six-key sniffing.

Offered as a candidate framing, not a mandate. The practical difference from the
synthesis's "two records" is mostly conceptual — but it directly motivates
killing the drift, which the synthesis treats as a side note.

---

## 8. Recommended canonical record shape

Producer record (`agent_ui_target`). Recommended wire casing: **snake_case**
(see Open Questions — this is a human call). `ref` is the *only* identity field.

```json
{
  "ref": "toolkit.panel.form:avatar-opacity",
  "surface": "toolkit.panel.form",
  "role": "slider",
  "name": "Avatar Opacity",
  "kind": "slider",
  "enabled": true,
  "state": { "value": 0.8, "pressed": null, "selected": null,
             "checked": null, "expanded": null, "current": null },
  "actions": ["drag", "set-value"],
  "extension": {
    "descriptor_id": "avatar-opacity",
    "field_id": "opacity",
    "options": [],
    "source": { "path": null, "line_start": null, "line_end": null }
  },
  "provenance": {
    "selector": "[data-semantic-target-id=\"avatar-opacity\"]",
    "metadata": {}
  }
}
```

Projection adapter result (`agent_ui_target_projection`) — joins on `ref`:

```json
{
  "ref": "toolkit.panel.form:avatar-opacity",
  "adapter_id": "aos-toolkit-semantic-target",
  "root_id": "avatar-main",
  "subject_path": ["canvas", "avatar-main", "semantic", "avatar-opacity"],
  "current_render_status": "visible",
  "can_project_display_overlay": true,
  "can_reveal": true,
  "coordinate_space": "native_display",
  "display_space_rect": { "x": 12, "y": 340, "width": 220, "height": 28 },
  "local_space_rect": { "x": 12, "y": 40, "width": 220, "height": 28 },
  "ancestor_viewport_clip_chain": [],
  "scrollable_ancestor_chain": [],
  "blocker_reasons": [],
  "refreshed_at": "2026-06-01T00:00:00.000Z",
  "provenance_source_payload_id": "payload-123"
}
```

Note the consumer record keys on `ref` (renamed from today's `subject_id`) so
the join is explicit. `subject_path`/`root_id` stay — they are genuine
projection concepts (where the target sits in the canvas tree), not identity
duplicates.

---

## 9. Regression test gates

Lock these before migrating any producer:

1. **Single-identity gate.** Assert the canonical record exposes exactly one
   identity key (`ref`). A test that greps the serialized record for
   `aosRef|aos_ref|data_aos_ref|target_id|subject_id` and fails on >1 spelling.
   This is the gate that prevents the disease from recurring.
2. **Casing gate.** Assert no key mixes conventions (regex: every top-level key
   matches `^[a-z][a-z0-9_]*$` for the wire record).
3. **No-projection-in-producer gate.** Assert the producer record contains
   *none* of `current_render_status`, `display_space_rect`, `refreshed_at`,
   `blocker_reason`. Catches layer-boundary collapse (trap §6.3).
4. **Explicit-blocker gate.** Reproduce the existing strict-contract test:
   missing/clipped/offscreen target yields a `blocker_reasons` entry, never a
   silently substituted selector path.
5. **Lossless mapping gate.** Each of the four current producer shapes maps to
   the canonical record without dropping a field that a current test asserts on
   (esp. `descriptor_id`, `options`, `source_line_*`).
6. **Preserve proven cores.** Keep `normalizeSemanticTarget` throwing without id
   and refusing to default `action` (both currently tested).

---

## 10. First three implementation slices, ranked by abstraction-wrongness risk

The task's named risk is "locking in the wrong abstraction," so rank by how much
each slice *de-risks the shape* before any runtime commitment.

1. **Read-only conformance/mapping test + fixture pack** over all four producer
   shapes and the consumer shape. Assert each maps losslessly onto the candidate
   canonical record. **Zero runtime change; maximum shape-validation.** If the
   canonical record can't represent a workbench source-line target *and* a slider
   *and* a tab without contortion, you learn it here for free.
2. **`normalizeAgentUiTarget` + the base migration, in one sweep.** Build the
   composing normalizer *and* migrate `normalizeSemanticTarget` to snake_case +
   single `ref` together (§0.5), behind the slice-1 fixtures. Rewrite
   `panel-form.test.mjs:272-273` and the camelCase assertions in
   `runtime-semantic-targets.test.mjs` as part of this slice — they are the
   contract being changed, not collateral. With breaking sanctioned there is no
   reason to stage this as "add sibling, leave base alone, reconcile later"; the
   half-migrated state is the incoherent one.
3. **Delete and re-derive workbench `semanticTarget()`** — the only producer that
   bypasses `normalizeSemanticTarget` entirely, carries the worst drift
   (`aos_ref` + `data_aos_ref` duplicate), *and* targets non-controls (document
   regions, source-line ranges). Do this **third on the schedule but treat it as
   the real proof**: if the canonical record can represent a source-line range
   and a checklist item as cleanly as a slider, the abstraction is sound. If it
   can't, slice 1 should already have caught it — and if slice 1 missed it,
   stop and fix the record before continuing the sweep. This is the gate that
   protects "strong foundations" from becoming "fast and wrong."

(The synthesis suggests migrating form/compact records first because they are
"already close." That is the lower-information choice — it validates the shape
against the data it was modeled on. With breaking allowed, the temptation to do
the easy migration first is stronger and more dangerous; resist it.)

---

## 11. Open questions needing human judgment

*(Items 1 and 2 below were resolved by the §0.5 breaking-license directive and
are recorded here as decisions, not open questions.)*

1. ~~**Wire casing.**~~ **Decided: snake_case, end to end.** `normalizeSemanticTarget`
   migrates off camelCase as part of slice 2 (§10). No internal/wire dialect.
2. ~~**Retire the `ref`/`aosRef` duplicate.**~~ **Decided: yes, single `ref`.**
   `panel-form.test.mjs:272-273` is rewritten in slice 2.
3. **Do projection fields nest under `projection` or sit flat?** Recommend nested
   (reinforces the facet boundary and the freshness semantics). Validate against a
   real `aos see` consumer before locking.
4. **Should the record carry children, or stay flat with `parent_ref`?**
   Recommend flat + `parent_ref`/`subject_path` first (matches current adapter
   `subject_path`); add `children` only where a producer can guarantee stable
   hierarchy without duplicating large trees.
5. **How literally to honor #164.** Is the Playwright-shaped dialect a real
   near-term commitment or strategic context? If real, the canonical ref must land
   first regardless; if context, deprioritize explicitly so it stops pulling
   design gravity.

---

## Appendix: proven contracts vs. roadmap language

**Proven (test-locked at this commit):**
- `normalizeSemanticTarget` requires `id`, refuses implicit `action` default.
- `aosRef` precedence: explicit `aosRef` > generated `surface:id`.
- `controlRecordFor` emits both `ref` and `aosRef` with equal value
  (duplicate is *enshrined*, not incidental).
- Form `actions` arrays per kind (`['select']`, `['drag','set-value']`, etc.).
- Annotation projection schema/version assertions + known status enums.
- `buildSemanticTargetProjectionAdapterResult` is live (Surface Inspector
  `:329`), today, with six-key id sniffing.

**Roadmap / not yet contract (treat as non-authoritative):**
- #164 Playwright dialect, #223 surface-system epic, #297 adapter ownership,
  #136 structured DOM perception. Useful lenses; none constrains the canonical
  record shape.
- The synthesis's own "Now/Next/Later" sequencing — directionally fine, but
  re-rank migration by abstraction-wrongness risk (§10), not by ease.

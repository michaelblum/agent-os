# Surface Hit-Test Inspect V0

Surface Hit-Test Inspect V0 describes the deterministic local inspect step that
sits between Spatial Subject Tree style structured surface state and Annotation
Perception Verification V0.

The contract accepts a pointer-like point inside a known surface binding, asks a
surface adapter or explicit fixture adapter for structured target candidates,
selects the deepest candidate whose bounds contain the point, converts that
candidate to an annotation draft, and emits a verification seed that can be
passed to the Annotation Perception Verification helper.

The V0 contract is local and structured-state only. It does not define global
pointer hover or click capture, does not use screenshot pixels as an oracle, and
does not harvest arbitrary user application AX trees.

## Result Shape

Each report has:

- `schema: "surface_hit_test_inspect"`
- `version`
- `created_at`
- `summary`
- `cases[]`

Each case has the original `request`, normalized `surface` context, normalized
`candidates[]`, a deterministic `selected_candidate`, an `annotation_draft`, an
optional `verification_seed`, and a case `summary`.

The request declares:

- `surface_binding`: stable ids and local source path or URL for the inspected
  surface.
- `point`: the pointer-like coordinate and its coordinate space.
- optional active surface path or selected surface id.
- the requested adapter type.
- allowed target kinds.

Candidates preserve:

- target id, path, kind, label, depth, and ancestor chain.
- role, text, source ids, source metadata, and adapter metadata.
- bounds in all available coordinate spaces.
- hit-test status: `hit`, `miss`, `blocked`, `unsupported`, or `ambiguous`.
- confidence, child-discovery state, capabilities, blockers, and reasons.

## Selection

The harness prefers candidates whose bounds contain the request point in the
declared coordinate space. It sorts hits by deepest path depth, then higher
adapter confidence, then smaller target area, then stable path order. If a tied
candidate remains after those criteria, the report preserves the ambiguity while
still making the stable path-order selection.

## Verification Seed

When a candidate is selected, the harness emits a `verification_seed` with the
fields accepted by `buildAnnotationPerceptionVerificationCase`. This keeps the
inspect step compatible with Annotation Perception Verification V0 without
requiring screenshot comparison or Operator visual confirmation.

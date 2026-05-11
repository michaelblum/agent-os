# Annotation Perception Verification V0

`annotation_perception_verification` is a neutral report contract for proving
that annotation intent records can round-trip through projection and structured
re-perception without Operator visual confirmation or screenshot pixel
assertions.

The verification loop is:

```text
choose target from structured perception
  -> create annotation intent
  -> project/render annotation
  -> re-perceive surface through structured state
  -> assert identity, bounds, decorator, and layer behavior
```

## Case Model

Each case records:

- `case_id`
- `surface_class`
- `surface_binding`
- `perception_source`
- `target` identity, path, kind, label, source ids, perceived bounds, role, and
  capabilities
- `annotation` intent derived from the target
- `projection` result using `annotation_projection`
- `reperception` structured state after projection/rendering
- `assertions`
- `status`
- `blockers` and `notes`

Case status is one of:

- `passed`: the structured adapter or fixture produced enough evidence and all
  required assertions passed.
- `failed`: at least one required assertion failed.
- `blocked`: live verification was expected but unavailable for a concrete
  reason.
- `adapter_fixture_only`: the harness shape is covered by controlled fixture
  data because no live adapter exists yet for that surface class.

## Assertions

`target_identity_path_match` compares the selected structured target path/id
with the re-perceived target path/id.

`bounds_overlap_ratio` compares the projected annotation rectangle with the
re-perceived target rectangle. The default threshold is IoU `>= 0.75` unless a
surface-specific case provides a stricter value.

`ordinal_decorator_discoverability` checks whether the annotation ordinal or
decorator is discoverable through structured state, semantic targets, xray-like
state, DOM state, or adapter fixture output.

`hide_show_layer_state` checks explicit annotation-layer hide/show state when
the surface exposes it.

`content_mutation_guard` checks that rendering the annotation layer did not
mutate the annotated content when the surface can expose before/after content
state.

## Surface Classes

V0 covers required passing structured cases for:

- `aos_canvas_semantic_target`
- `markdown_workbench_text_range`
- `mac_window_topology`

It also covers controlled local/fixture cases for:

- `browser_page_local_html`
- `generic_ax_element`
- `mermaid_svg`
- `three_scene`
- `pdf_image`

The fixture-only classes intentionally exercise the same target -> annotation ->
projection -> perception comparison shape while keeping missing live adapters
explicit.

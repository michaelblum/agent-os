# Agent UI Target Conformance V0 Mapping

This table documents how the current producer and projection shapes map to the
candidate read-only `agent_ui_target` and `agent_ui_target_projection` fixtures.
The canonical producer record uses `ref` as its only identity key. Legacy
identity spellings are accounted for as provenance in the fixture metadata; they
are not copied into the canonical producer identity.

| Current shape | Current identity spellings | Canonical landing |
| --- | --- | --- |
| Toolkit runtime semantic target | `id`, `ref` | `ref` remains the canonical route identity; runtime-only `id` is listed as provenance when composed into `agent_ui_target` |
| Toolkit panel form control | `ref` | Already canonical `agent_ui_target`; form ids land in `extension.descriptor_id` and `extension.field_id` |
| Example compact control/tab | `ref` | Already canonical `agent_ui_target`; tab/section/label fields land in `extension`; local source ids stay provenance-only |
| HTML workbench semantic target | `ref` | Canonical `ref` remains the producer identity; selector and DOM slug stay provenance-only reveal hints. This fixture has no surviving source-document owner, so it does not claim source-line provenance. |
| Native `aos see` canvas semantic target | `ref` | Canonical `agent_ui_target`; canvas id, `do_target`, parent canvas, local geometry, and local DOM id land in provenance/extension |
| Annotation/Surface Inspector projection | `subject_id` | Projection fixture renames join identity to `ref`; `subject_path`, `root_id`, geometry, render status, blockers, and freshness stay projection-only |

## Field Accounting

| Field family | Canonical producer location | Projection location | Notes |
| --- | --- | --- | --- |
| `ref` | Top-level `ref` | Top-level `ref` join key | The only canonical identity key. |
| `role` / `name` | Top-level `role`, `name` | `subject_kind` only when adapter needs it | Producer semantics, not projection identity. |
| `surface` | Top-level `surface` | `root_id` / `subject_path` | Surface remains producer ownership; projection describes where it was observed. |
| `state` | `state.value/current/pressed/selected/checked/expanded` | None | Declared structural state, not render status. |
| `actions` | Top-level `actions` | None | Runtime semantic `action` is normalized to a one-item actions list when present. |
| Control extensions | `extension.descriptor_id`, `field_id`, `options`, `hidden`, `tab`, `section`, `label` | None | Covers fields asserted by panel and Example compact tests. |
| Workbench extensions | `extension.annotation_eligible`, `reveal_eligible` | None | Source evidence is optional and must be omitted when no current document owns it. |
| Provenance selectors | `provenance.selector` | `source_tree_node_metadata.selector` only as adapter source evidence | Selectors are reveal/provenance hints, never canonical identity. |
| Local producer frame | `provenance.frame` | `local_space_rect` / `display_space_rect` after projection | Current asserted producer frames are accounted for without making projection fields producer-owned. |
| Canvas action routing | `provenance.do_target` | None | Derived `canvas:<canvas-id>/<ref>` routing identity for `aos do`; not a top-level producer identity. |
| Projection fields | Forbidden | Top-level projection fixture fields | Includes `current_render_status`, `display_space_rect`, `refreshed_at`, and `blocker_reasons`. |

## Drift Exposed

The projection fixtures intentionally keep projection identity (`subject_id`,
`subject_path`, `root_id`) separate from producer identity. The canonical
projection join key remains `ref`, and legacy producer spellings are no longer
listed as current sources.

The fixtures also include two projection adapter results for the same
canonical `ref`: `aos-toolkit-semantic-target` and `aos-canvas-window`. This
proves projection records are keyed by `(adapter_id, ref)`, not by `ref` alone
and not by an embedded producer projection block.

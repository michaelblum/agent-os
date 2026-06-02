# Agent UI Target Conformance V0 Mapping

This table documents how the current producer and projection shapes map to the
candidate read-only `agent_ui_target` and `agent_ui_target_projection` fixtures.
The canonical producer record uses `ref` as its only identity key. Legacy
identity spellings are accounted for as provenance in the fixture metadata; they
are not copied into the canonical producer identity.

| Current shape | Current identity spellings | Canonical landing |
| --- | --- | --- |
| Toolkit runtime semantic target | `id`, `aosRef` | `ref` from `aosRef`; `id` and `aosRef` listed in `provenance.legacy_identity_keys` |
| Toolkit panel form control | `id`, `aosRef`, `ref` | `ref` from existing `ref`; form ids land in `extension.descriptor_id` and `extension.field_id` |
| Sigil compact control/tab | `id`, `aosRef`, `ref` | `ref` from existing `ref`; tab/section/label fields land in `extension`; old ids stay provenance-only |
| HTML workbench source-line target | `target_id`, `data_aos_ref`, `aos_ref` | `ref` from `data_aos_ref`; source path/lines land in `extension.source`; selector lands in `provenance.selector` |
| Annotation/Surface Inspector projection | `subject_id` plus drift-prone source metadata | Projection fixture renames join identity to `ref`; `subject_path`, `root_id`, geometry, render status, blockers, and freshness stay projection-only |

## Field Accounting

| Field family | Canonical producer location | Projection location | Notes |
| --- | --- | --- | --- |
| `ref` | Top-level `ref` | Top-level `ref` join key | The only canonical identity key. |
| `role` / `name` | Top-level `role`, `name` | `subject_kind` only when adapter needs it | Producer semantics, not projection identity. |
| `surface` | Top-level `surface` | `root_id` / `subject_path` | Surface remains producer ownership; projection describes where it was observed. |
| `state` | `state.value/current/pressed/selected/checked/expanded` | None | Declared structural state, not render status. |
| `actions` | Top-level `actions` | None | Runtime semantic `action` is normalized to a one-item actions list when present. |
| Control extensions | `extension.descriptor_id`, `field_id`, `options`, `hidden`, `tab`, `section`, `label` | None | Covers fields asserted by panel and Sigil compact tests. |
| Workbench extensions | `extension.annotation_eligible`, `reveal_eligible`, `source.path`, `line_start`, `line_end` | None | Source line identity does not become a producer identity spelling. |
| Provenance selectors | `provenance.selector` | `source_tree_node_metadata.selector` only as adapter source evidence | Selectors are reveal/provenance hints, never canonical identity. |
| Local producer frame | `provenance.frame` | `local_space_rect` / `display_space_rect` after projection | Current asserted producer frames are accounted for without making projection fields producer-owned. |
| Projection fields | Forbidden | Top-level projection fixture fields | Includes `current_render_status`, `display_space_rect`, `refreshed_at`, and `blocker_reasons`. |

## Drift Exposed

The projection fixtures intentionally include source metadata containing both
`subject_id` and `target_id` for one record, while the canonical projection join
key remains `ref`. This exposes today's identity drift without preserving it as
canonical producer shape.

The fixtures also include two projection adapter results for the same
canonical `ref`: `aos-toolkit-semantic-target` and `aos-canvas-window`. This
proves projection records are keyed by `(adapter_id, ref)`, not by `ref` alone
and not by an embedded producer projection block.

# Annotation Schema

**File:** `annotation.schema.json`
**Version:** 0.2.0
**Producers:** `aos see capture --label`, workbench checkpoint helpers, future show/capture layers
**Consumers:** `aos show`, orchestrators, workbenches, vision models

## What This Is

The annotation schema now accepts two compatible record families:

- structured annotation intent records, used when a human or operator points,
  selects, marks a region, or leaves a note on a visible surface;
- legacy labeled-region records, used by older `aos see capture --label`
  producers that only emit `{ bounds, label }`.

Structured records are the durable contract for intent convergence. They are not
screenshot-only markup and they are not a live overlay system. Rendering layers
can draw badges from them later, but the record itself must be agent-readable.

## Structured Intent Records

A structured annotation includes an explicit `ordinal`. Array position alone is
not enough for durable references. Once a show layer renders badges, phrases
such as "use annotation 2" should resolve through this field.

Required fields include:

- `id`, `ordinal`, `kind`, `surface_id`, and `coordinate_space`;
- non-empty `source_url` or non-empty `source_path`;
- `note`, `actor`, `status`, `created_at`, and `updated_at`;
- lifecycle data for clear/commit/recover/resolve/reject behavior;
- capture `prepare` and `restore` objects so future capture steps can hide
  annotation controls while keeping target evidence visible.

Supported V0 kinds are:

- `point_comment`;
- `region_comment`;
- `element_selection`;
- `selection_comment`.

Selectors are optional candidates, not the only anchor. Use bounds, text
excerpt, role, label, ancestor chain, source identity, and coordinate space
where available.

## Example

```json
{
  "schema": "annotations",
  "version": "0.2.0",
  "annotations": [
    {
      "id": "ann-1",
      "ordinal": 1,
      "kind": "region_comment",
      "surface_id": "markdown-workbench",
      "source_url": null,
      "source_path": "docs/example.md",
      "coordinate_space": "viewport",
      "point": null,
      "bounds": { "x": 100, "y": 120, "width": 320, "height": 90 },
      "viewport_bounds": { "x": 100, "y": 120, "width": 320, "height": 90 },
      "page_bounds": null,
      "selector_candidates": [],
      "text_excerpt": "Initial text.",
      "text_range": { "start_line": 3, "end_line": 3 },
      "role": "",
      "label": "Body region",
      "ancestor_chain": [],
      "note": "Clarify this paragraph.",
      "actor": { "role": "human", "id": "operator" },
      "status": "committed",
      "lifecycle": {
        "clearable": true,
        "committed_at": "2026-05-09T12:00:00.000Z",
        "resolved_at": null,
        "rejected_at": null,
        "recovered_from": null
      },
      "capture": {
        "prepare": {
          "hide_annotation_controls": true,
          "keep_target_evidence_visible": true
        },
        "restore": {
          "restore_annotation_controls": true
        }
      },
      "created_at": "2026-05-09T12:00:00.000Z",
      "updated_at": "2026-05-09T12:00:00.000Z",
      "metadata": {}
    }
  ]
}
```

## Legacy Regions

Legacy records are still accepted:

```json
{
  "schema": "annotations",
  "version": "0.1.0",
  "annotations": [
    { "bounds": { "x": 100, "y": 200, "width": 50, "height": 30 }, "label": "Search" }
  ]
}
```

For these records only, array index remains the display ordinal. New structured
records should always include `ordinal`.

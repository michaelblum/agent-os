# Annotation Schema

**File:** `annotation.schema.json`
**Version:** 0.1.0
**Producer:** `aos see capture --label`
**Consumers:** `aos show`, orchestrators, vision models

## What This Is

A minimal data format describing labeled regions on a surface. An annotation is a rectangular region plus an optional text label. Array position is the ordinal — no explicit ordinal field.

## Coordinate Space

The schema is coordinate-space-agnostic. The coordinate space depends on the producer:

| Producer | Coordinate space |
|---|---|
| `aos see capture --label` | LCS (top-left of captured region = 0,0) |
| Spatial topology cross-reference | Use the referenced topology layer directly. Current daemon/topology producers may still emit Native desktop compatibility, while shared-world consumers should prefer DesktopWorld. |

The consumer knows which space it's operating in.

## How Ordinals Work

Array index = ordinal. Index 0 renders as badge "1", index 1 as badge "2", etc. There is no explicit ordinal field — array position is the single source of truth (same convention as `spatial-topology.schema.json` where array position = z-order).

## Example

```json
{
  "schema": "annotations",
  "version": "0.1.0",
  "annotations": [
    { "bounds": { "x": 100, "y": 200, "width": 50, "height": 30 }, "label": "Search" },
    { "bounds": { "x": 300, "y": 400, "width": 120, "height": 25 }, "label": "Submit" }
  ]
}
```

Badge "1" marks the Search field at (100, 200). Badge "2" marks the Submit button at (300, 400).

## Rendering

The schema describes WHAT to label, not HOW to render it. An HTML/CSS/SVG template turns annotation data into visual content. The `aos show render` command rasterizes the template to a bitmap. Different templates can produce different visual styles from the same data.

## Relationship to `aos see --xray`

`--xray` returns a flat array of interactive UI elements with `role`, `title`, `label`, `value`, `enabled`, `context_path`, and (for macOS-sourced elements or browser-sourced elements captured with `--label`) `bounds`. Browser-sourced elements captured with `--xray` alone carry a `ref` identifier instead of `bounds`; their geometry is fetched per-element on demand when `--label` is passed.

`--label` converts annotatable elements (those with `bounds`) into the annotation schema format, using the AX element's `title` or `label` as the annotation label. Elements without `bounds` are silently skipped by `buildAnnotations`. The annotation array is a strict subset of the xray data — just `bounds` + `label`.

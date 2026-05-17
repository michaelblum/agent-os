# Surface Inspector Annotation Snapshot V0

`surface_inspector_annotation_snapshot` is the durable Annotation Mode artifact
inside a Surface Inspector see bundle. It captures the in-memory annotation
state at one point in time without creating a long-lived annotation database.

Canonical schema:
[`surface-inspector-annotation-snapshot-v0.schema.json`](./surface-inspector-annotation-snapshot-v0.schema.json)

## Identity

- `schema`: `surface_inspector_annotation_snapshot`
- `version`: `0.1.0`

## Capture Metadata

`capture` records when and why the artifact was created, the source Surface
Inspector canvas id, the Surface Inspector frame at capture time, and
bundle-relative asset references. Asset fields point at sibling bundle files
such as `capture.png`, `capture.json`, `display-geometry.json`,
`canvas-list.json`, and `inspector-state.json`. Image data must stay external;
JSON payloads must not embed image binary or base64 strings.

## Shared Session Boundary

The artifact includes a `session` object derived from the display-first
`aos_annotation_session` boundary. It records the entry source, active root,
committed scope stack, preview scope stack, hover candidate as preview evidence
only, live anchors with optional `comment_text`, projection status, stale or
blocker reasons, and `snapshot_count`. The session object is point-in-time
evidence; it is not a persistent live annotation database.

## Annotation State

The artifact includes `annotation_mode`, `empty_state`, selected edge/frame
fields, active root or scope context, frame pins, comments, hover candidate
state, projection capabilities, adapter summaries, blockers, reveal state, and
the current annotation scope stack. Pin and comment records include actor,
timestamps, status, subject identity/path/role/label/value/text excerpt fields,
and projection or visibility proof when available.

`empty_state=true` is valid and expected for non-annotation captures or captures
where Annotation Mode is inactive. Consumers should use `empty_state`, `pins`,
and `comments` instead of inferring absence from the existence of the file.

## Bundle Contract

When `see.canvas_inspector_bundle.include.annotation_snapshot=true` (the
default), Surface Inspector see bundles write `annotation-snapshot.json` and
record it in `bundle.json.files.annotation_snapshot_json`.

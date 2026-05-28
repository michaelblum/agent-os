# AOS Context Session V0

`aos_context_session` is the V0 wrapper for authored workspace context. It does
not replace `aos_annotation_session`; it gives future Reticle, Selection Mode,
Surface Inspector, recording, and keyframe work a shared contract for multiple
context artifacts and point-in-time keyframes.

Canonical schema:
[`aos-context-session-v0.schema.json`](./aos-context-session-v0.schema.json)

## Identity

- `schema`: `aos_context_session`
- `version`: `0.1.0`

## Relationship To Annotation Session

`aos_annotation_session` remains the canonical V0 live session core. It owns the
current display-first in-memory state: root subject, committed and preview scope
stacks, hover candidate, anchors, optional `comment_text`, projection evidence,
status, and snapshot count.

`aos_context_session` wraps that core when a workflow needs more structure than a
single live scope stack can express. It can summarize a source
`aos_annotation_session`, expose one or more `aos_context_artifact` records, and
capture `aos_context_keyframe` records over those artifacts. Runtime writers
should keep producing or adapting the shared annotation session instead of
creating another annotation model.

`surface_inspector_annotation_snapshot` remains the public Surface Inspector
bundle artifact. It can travel beside a context keyframe as an asset reference
or compatibility artifact, but it is not the owner of future context truth.

## Context Artifacts

A context artifact is one authored unit of context inside a session. It records:

- a stable artifact id and kind;
- an ordered root-to-leaf `path`;
- one `active_target_node_id`;
- acquisition evidence for how the artifact was chosen;
- anchors that can render or carry comments for path nodes;
- optional source/session metadata.

The active target is the node the user means. It can be the clicked or hovered
leaf, or it can be an ancestor chosen through disambiguation. Acquisition
evidence preserves both `leaf_node_id` and `selected_node_id` so bottom-up
Selection Mode can keep the clicked leaf while targeting an ancestor.

## Path Nodes

A path node maps one normalized annotation subject/address into context artifact
space. The `address` is the authoritative subject address. The `subject` block
keeps adapter, root, subject identity, source metadata, and fallback evidence so
adapters can explain or reacquire the subject without depending on old screen
rectangles.

Projection evidence is copied as current evidence only. Stale, absent,
unsupported, or blocked states belong in `projection` and `blocker`; consumers
must not treat a last-known rectangle as live display truth.

## Comments And Anchors

Comments attach to path nodes as first-class records with actor and timestamps.
Anchors can reference those comments by id and may also carry the V0
compatibility field `comment_text`, matching `aos_annotation_session` anchors.
This keeps existing frame/comment behavior compatible while leaving room for
multiple comments on one path node or anchor.

## Acquisition Evidence

Acquisition records the entry mode, pointer evidence when available, leaf node,
selected node, optional hovered node, candidate report, and source metadata.
Candidate reports can include adapter rankings, rejected candidates, fallback
reasons, and source event ids. The schema keeps this object flexible because the
candidate adapters are still evolving.

## Context Keyframes

A context keyframe is a point-in-time capture of a context session or a subset
of artifacts. It records id, capture time, trigger, referenced artifact ids,
optional embedded artifacts or session summary, and external asset references.

Keyframes must not embed screenshots, base64 image payloads, or data URLs. Image
and capture data belong in sibling files such as `capture.png`,
`annotation-snapshot.json`, or bundle metadata, referenced through `asset_refs`.

Future recordings should be ordered sequences of context keyframes plus optional
events between them. Recordings should reference keyframes and their source
`aos_annotation_session` summaries rather than introducing a second annotation
session or anchor model.

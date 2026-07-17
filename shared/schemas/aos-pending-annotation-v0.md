# AOS Pending Annotation v0

The JSON schema is `shared/schemas/aos-pending-annotation-v0.schema.json`.

Pending annotations are runtime-mode-scoped operator intent records. They are
created when a human points at a visible target and optionally adds a comment.
Agents read them as compact JSON, consume them exactly once, and then act from
the saved-ref or explicit fallback evidence carried by the record.

## Storage

Records live under:

```text
$AOS_STATE_ROOT/{repo|installed}/pending-annotations/
~/.config/aos/{repo|installed}/pending-annotations/
```

The state root contains:

- `records/<annotation-id>.json` with the full compact annotation record.
- optional `index.json` compact summaries as a rebuildable cache.

Store readback validates record shape and filesystem invariants before records
can contribute to list, cache, or summary output. Records are the authoritative
durable state; `index.json` is optional and cannot decide mutation success.
Each record id must match its filename, `paths.root` must equal the
runtime-mode pending annotation root, `paths.record` must equal the canonical
`records/<id>.json` path, and the resolved record path must stay under the
pending annotation root. Corrupt records or mismatched paths fail closed with
structured pending annotation state errors.

Heavy evidence such as screenshots, UI trees, snapshots, bundles, overlays, and
Work Records stays in separate disk-backed artifacts referenced by path.

## Lifecycle

Valid lifecycle states are:

- `pending`: consumable exactly once.
- `consumed`: drained by an agent and no longer consumable.
- `resolved`: intentionally completed by a consumer.
- `deleted`: explicitly removed from the pending queue.
- `stale`: no longer safe to act from.
- `unsupported`: target or capability is unsupported.
- `blocked`: permission, ambiguity, or other blocker prevents use.

`aos see annotation consume <id> --json` transitions only consumable `pending`
records and writes `consumed_at` plus `consumed_by`. `aos see annotation
delete <id> --json` writes the deleted state plus `deleted_at`. Consuming
`consumed`, `resolved`, `deleted`, `stale`, `unsupported`, or `blocked` records
fails closed with structured JSON. Pending records whose `capability.status` is
`unsupported`, `ambiguous`, or `blocked` also fail closed instead of pretending
a target can be acted on.

Durable terminal records must carry their transition evidence: `consumed`
requires `consumed_at` and `consumed_by`, and `deleted` requires `deleted_at`.
Public create input cannot import `consumed`, `resolved`, or `deleted`; future
full-record import must be a separate explicit API with its own lifecycle
evidence validation.

## Target Evidence

Each record includes:

- stable `id`;
- lifecycle timestamps;
- actor/session metadata;
- optional `comment.text`;
- target `kind` and `summary`;
- optional `target.saved_ref` with `workspace_id`, `snapshot_id`, and `ref`;
- `fallback_evidence[]` when no saved ref is available or when fallback context
  remains relevant;
- `capability.status` and reasons;
- `source_capture` metadata when the record was projected from a saved
  perception capture or refs readback, or `null` when no source capture exists;
- optional `desktop_selection` metadata with bounded mode, top-left desktop
  geometry, application/window facts, and the native selection id;
- `artifact_refs[]` for disk-backed heavy evidence;
- `recommended_next[]` as structured argv arrays;
- `work_record_links[]` for later action/readback evidence connection.

Saved refs are preferred. A selected target may be represented by explicit
`target.kind` and `target.summary` without manufacturing fallback evidence.
Coordinate, region, screenshot, or prose-only fallback context must be supplied
as explicit `fallback_evidence[]` with an honest capability status; the
normalizer does not invent fallback rows for missing refs.

## CLI

```bash
aos see annotation select --mode rectangle --source companion --follow
aos see annotation create --target-kind region --target-summary "top-right button" --comment "Use this one" --json
aos see annotation create --target-kind browser --target-summary "Save button" --workspace default --snapshot snap1 --ref r2 --json
aos see annotation create --from-capture-json capture.json --ref r2 --json
aos see annotation list --state pending --json
aos see annotation read ann-example --json
aos see annotation consume ann-example --actor agent --json
aos see annotation link-work-record ann-example --work-record work-record:annotation-action-proof --relation annotation_action_evidence --json
aos see annotation delete ann-example --json
```

The native select form persists one record before emitting
`selection_completed`. Its public event includes the pending annotation id and
`has_text`, but never repeats entered text. The durable record keeps text only
in `comment.text`; `desktop_selection` contains no text or filesystem path.
Freehand paths are limited to 256 points, and native selection starts as honest
`fallback_only` evidence until a consumer resolves a semantic saved ref through
the separate perception contract.

`create --from-json <path|->` accepts create-time annotation fields and
normalizes missing ids, lifecycle timestamps, default recommended next
commands, fallback evidence, and paths. It can create `pending`, `blocked`,
`unsupported`, and `stale` records, but it cannot import terminal lifecycle
states or saved-capture envelopes.
Operator-selection surfaces should pass generic selection evidence through the
pending-owned `pendingAnnotationInputFromOperatorSelection()` adapter before
calling create; toolkit runtime helpers must not manufacture this record shape.

`create --from-capture-json <path|->` projects compact saved perception output
from `aos see capture --save --json` or `aos see refs --json` into an
annotation record. Browser, AOS canvas, and native AX saved refs become
`saved_ref` annotations only when their backend-specific ref class is
actionable: browser `snapshot_scoped`, AOS canvas `reacquirable`, and native AX
`stable`. Backend/resolution mismatches become `fallback_only`; missing refs
become `fallback_only`; stale captures become `stale`; unsupported refs become
`unsupported`; multiple refs without `--ref <id>` become blocked records with
`capability.status: ambiguous`.

`link-work-record <id> --work-record <ref>` appends a durable evidence link to
an existing annotation, including optional path-backed `--artifact <role=path>`
entries. It does not mutate Work Records and does not replay actions; it only
keeps the annotation boundary connected to action/readback evidence produced
elsewhere.

## Verification

Run:

```bash
node --test tests/schemas/aos-pending-annotation-v0.test.mjs
node --test tests/toolkit/pending-annotation-model.test.mjs tests/toolkit/pending-annotation-cli-lifecycle.test.mjs tests/toolkit/pending-annotation-store-index.test.mjs tests/toolkit/pending-annotation-lock.test.mjs
bash tests/help-contract.sh
bash tests/external-command-dispatch.sh
node scripts/generate-command-manifests.mjs --check
```

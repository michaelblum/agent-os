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

- `index.json` with compact summaries for list output.
- `records/<annotation-id>.json` with the full compact annotation record.

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
records. Consuming `consumed`, `resolved`, `deleted`, `stale`, `unsupported`,
or `blocked` records fails closed with structured JSON. Pending records whose
`capability.status` is `unsupported`, `ambiguous`, or `blocked` also fail
closed instead of pretending a target can be acted on.

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
- optional `source_capture` metadata when the record was projected from a saved
  perception capture or refs readback;
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
aos see annotation create --target-kind region --target-summary "top-right button" --comment "Use this one" --json
aos see annotation create --target-kind browser --target-summary "Save button" --workspace default --snapshot snap1 --ref r2 --json
aos see annotation create --from-capture-json capture.json --ref r2 --json
aos see annotation list --state pending --json
aos see annotation read ann-example --json
aos see annotation consume ann-example --actor agent --json
aos see annotation link-work-record ann-example --work-record work-record:annotation-action-proof --relation annotation_action_evidence --json
aos see annotation delete ann-example --json
```

`create --from-json <path|->` accepts the same logical fields as the stored
record input and normalizes missing ids, lifecycle timestamps, default
recommended next commands, fallback evidence, and paths.

`create --from-capture-json <path|->` projects compact saved perception output
from `aos see capture --save --json` or `aos see refs --json` into an
annotation record. Browser, AOS canvas, and native AX saved refs become
`saved_ref` annotations when their ref class is actionable. Missing refs become
`fallback_only`; stale captures become `stale`; unsupported refs become
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
bash tests/help-contract.sh
bash tests/external-command-dispatch.sh
node scripts/generate-command-manifests.mjs --check
```

# Generated Artifact Lifecycle Policy

**Status:** V0 policy
**Owner layers:** daemon primitives, toolkit workbench policy, app/domain producers
**Related:** #300, #293, #306, #359 through #362

## Purpose

AOS uses generated artifacts to make work inspectable: HTML workbench
expressions, runtime wiki projections, artifact bundles, screenshots, evidence
captures, user-signal records, and test proof payloads. These artifacts are
useful only when their source of truth, storage location, cleanup path, and
surviving result are explicit.

This policy keeps generated output from becoming a second canonical source. A
generated projection may be rich, visual, or human-facing, but it must link back
to the canonical source or durable runtime record that owns the truth.

## Current Producers

HTML Workbench Expressions are generated projections of durable Markdown or
structured source. Their canonical source is Markdown or JSON, the HTML path is
the review surface, and the metadata sidecar carries source hashes, generated
HTML paths, semantic targets, source maps, security policy, and export/resume
behavior. They belong in Git only as checked-in fixtures or intentionally
reviewed examples.

Artifact Bundle Subjects describe archived or collected bundle members with
provenance, validation, exports, and linked work-record evidence. The bundle
descriptor is the subject; individual artifacts may be generated projections,
evidence artifacts, or archived bundle members depending on their origin.

Runtime wiki repo-doc projections are generated projections from canonical Git
docs into runtime wiki state. The manifest in `docs/wiki/repo-docs-projection-v0.json`
is source-controlled, but projected wiki pages live under runtime state and
carry generated/projection metadata plus source hashes and backlinks.

User-signal gate records, deferred continuations, resume events, and guided
user-signal session records are runtime records, not generated projections.
They are written under the active runtime mode, honor `AOS_STATE_ROOT`, redact
sensitive human-authored payloads by default, and preserve provider boundaries
by writing adapter hints/events rather than auto-running resume backends.

Work-record captures and evidence adapters produce evidence artifacts plus
structured work-record evidence. The structured evidence/result survives; bulky
captures may be bundled, archived, or deleted according to the workflow policy.

Employer Brand evidence fixtures and proof artifacts are checked-in test
fixtures or domain pilot artifacts. They remain domain-owned until #293's
neutral evidence workflow extraction gate is met.

Live AOS screenshots, visual smoke captures, and local proof payloads are
evidence artifacts or disposable scratch unless a work card explicitly archives
them in an artifact bundle or fixture directory.

Test output artifacts belong in isolated temp roots or repo fixture directories
only when the test contract needs stable checked-in proof. Runtime-state tests
must avoid canonical `~/.config/aos/{mode}` unless they are explicitly live
daemon tests with documented cleanup.

## Lifecycle Classes

| Class | Owner layer | Source of truth | Storage locations | Git? | Cleanup or archive trigger | Surviving result | Privacy and provenance |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Canonical source | App, docs, schema, or workflow owner | The editable source file or record | Repo docs, schemas, source packages, or durable domain stores | Yes when repo-owned | Normal source review | The source itself | No generated-only facts; normal repo privacy rules |
| Generated projection | Producing toolkit/daemon/app policy | Canonical source plus producer metadata | Runtime state, build output, temp dirs, or checked-in fixtures | Only as fixtures/examples | Delete when stale, regenerate from source, or archive into bundle | Metadata sidecar/result with source hash and backlinks | Must identify producer, source path/hash, output path, and security policy |
| Runtime record | Daemon or toolkit runtime policy | The runtime record | `$AOS_STATE_ROOT/{repo|installed}` or `~/.config/aos/{repo|installed}` | No, except fixtures | Retain by runtime policy; never silently migrate/delete in implementation slices | JSON/JSONL record and readback surface | Redact human-authored payloads by default; record runtime mode and provenance |
| Evidence artifact | Test, verifier, work-record, or domain workflow | Structured evidence/result plus capture metadata | Temp roots, evidence folders, artifact bundles, selected fixtures | Only when intentionally fixture/proof | Archive when needed for review; delete disposable captures after verification | Work-record evidence, manifest row, acceptance report, or failure record | Must separate runtime failure from subject failure and cite capture provenance |
| Archived bundle member | Artifact bundle owner | Bundle descriptor and provenance | Artifact bundle folder or controlled archive | Yes only for reviewed bundles/fixtures | When a generated/evidence artifact must remain inspectable after the run | Bundle descriptor with validation and exports | Must preserve provenance, validation state, and source/work-record links |
| Disposable scratch | Current task or test harness | None beyond the active run | Temp dirs, ignored local state, isolated `AOS_STATE_ROOT` | No | Delete at end of run or leave only when reported as local-only state | None, or a concise terminal command result | Do not store private/human payloads; do not rely on scratch as completion evidence |
| Test fixture | Test owner | The fixture contract | `tests/`, `shared/schemas/fixtures/`, or `docs/design/fixtures/` | Yes | Update only with test/schema contract changes | Passing deterministic test and fixture content | Must be synthetic or approved; include stable provenance when relevant |
| Stale generated output | Producing policy owner | Canonical source, not the stale file | Any generated location | No new commits unless proving stale handling | Delete, regenerate, or mark stale when source hash/provenance no longer matches | Stale marker, regenerated output, or deleted projection with sidecar retained | Must not be treated as truth; source hash mismatch is the blocker |

## Producer Requirements

Every new generated-artifact producer must define these fields or explain why a
field is not applicable before it ships:

| Requirement | Contract |
| --- | --- |
| Producer id | Stable producer name plus schema/version when applicable. |
| Source expression | Canonical source path, subject id, runtime record id, or bundle member id. |
| Output locator | Generated output path, runtime state path, or bundle entry. |
| Source hash/provenance | Deterministic hash for file sources or equivalent provenance for runtime records. |
| Human-facing target map | Semantic targets, source map, selectors, or equivalent when humans inspect or annotate the artifact. |
| Cleanup/archive policy | Whether output is disposable, regenerated, archived as a bundle member, or checked in as a fixture. |
| Privacy/redaction policy | Default handling for prompt bodies, answer payloads, comments, screenshots, and other human-authored or sensitive data. |
| Surviving structured result | The JSON sidecar, work-record evidence, manifest row, resume event, or other durable result that remains if the projection is deleted. |

## User-Signal Consolidation Finding

The current user-signal pieces intentionally stay split by responsibility. The
blocking gate service owns caller-facing request/receptor/timeout behavior.
Durable gate records own JSONL audit records. Deferred continuations and resume
events own pause/resume state and idempotent submit. The trusted local UI submit
bridge calls the same continuation submit path from a canvas without shelling
out. Guided user-signal sessions are toolkit runtime records for guidance,
capture intent, optional gate links, and daemon-owned input authority. Provider
adapter fields remain hints/events only; AOS core does not auto-run Codex,
Claude, or any other resume backend.

The consolidation point is small service policy, not a new lifecycle daemon:
runtime-mode path selection, isolated `AOS_STATE_ROOT` handling, public source
projection, redaction defaults, and JSON atomic write mechanics are shared.
Terminal states remain local to each service because `answered`, `dismissed`,
`timeout`, `submitted`, `captured`, `cancelled`, `expired`, and `error` mean
different things at different layers.

## Operating Rules

Do not commit generated projections merely because they were useful during a
session. Commit them only as fixtures, docs examples, or archived bundle members
with provenance.

Do not delete or migrate existing runtime records as part of a policy or docs
slice. Cleanup commands must be explicit work with their own verification.

Do not treat screenshots or HTML as canonical source. Link them to source,
record, or work-record evidence that can survive deletion.

Do not expand HTML Workbench Expression kinds without defining lifecycle,
security, source map, surviving sidecar, and cleanup/archive behavior.

Use isolated state roots for tests and smokes that write runtime records. Report
any local-only generated artifacts left behind in the completion report.

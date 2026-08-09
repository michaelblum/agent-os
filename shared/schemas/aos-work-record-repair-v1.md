# AOS Work Record Repair V1

The active repair contracts are:

- `aos-work-record-repair-plan-v1.schema.json`: a non-executing mechanical proposal.
- `aos-work-record-repair-attempt-plan-v1.schema.json`: an exact source-bound proposal. `ready` means its inputs are complete; it does not mean a caller is permitted to act.
- `aos-work-record-repair-attempt-artifact-v1.schema.json`: caller-supplied outcomes with the complete validated Attempt Plan payload plus its exact digest/identity, timing, operation mapping, cleanup, rollback, verifier-after health, and source immutability checks. V1 carries at most one atomic candidate patch; successful artifacts require its source-digest-bound outcome, every planned required evidence item, the complete proposed execution-map payload and digest, unique evidence identities, and exact evidence-to-postcondition mappings.

Proposed execution maps validate against the active Work Record V1
execution-map definition before Replacement Proposal construction.

Replacement Proposal validates and projects the caller-supplied execution map;
Replacement Writer copies that projection and the caller evidence metadata.
Because the patch target is only `execution_map`, the Proposal and Writer
preserve source type/schema, label, origin, references, intent, Claims, and
metadata exactly while adding only defined replacement provenance, evidence,
verifier/health, and repair-history fields. A source metadata key that collides
with reserved replacement provenance fails closed; it is never overwritten.
Evidence and postcondition maps are
complete, ordered, unique, and one-to-one; every source evidence item is copied
byte-for-byte and omission is invalid. The Writer does not infer
observations from expected postconditions or relabel historical Claim Results.
Caller evidence metadata remains byte-exact and its `created_at` comes from the
caller evidence timing or caller Artifact completion receipt; replacement
provenance does not overwrite that metadata. Source evidence and Claim Results
remain exact historical facts. Repair Guide
readiness additionally binds an Artifact to the current source and derived
Attempt Plan. Supersession additionally binds a supplied Writer Result's exact
Proposal identity to the provenance embedded in the replacement record, checks
the structured-record digest against canonical content and the
serialized-output digest against the exact raw replacement-file bytes, and commits
the persisted Proposal/Writer mirrors into the entry identity. The entry stores
only the stable Writer projection covered by that identity, not unbound status
or temporary-publication receipt fields. Persisted Proposal provenance is the
closed id/digest/schema identity projection; supplied Proposal type and status
must validate before supersession publication. A successful supersession write
receipts the serialized index-file digest separately from the structured entry
identity digest.

These artifacts contain no permission grant, approval policy, risk classification,
operation registry, or provider policy. Replacement writing and source
supersession remain separate exact-digest finalization steps.
Create-if-absent publication never overwrites existing bytes. If the destination
was published but adjacent-temp cleanup failed, Writer, bundle, supersession,
and finalizer results report that material side effect and its recovery path.
Replacement Writer re-checks the source bytes after publication. Supersession
Writer re-checks the exact source and replacement identities after publication;
any drift blocks success while preserving the index-publication receipt.
Each exact source identity has one canonical create-if-absent active entry, so
concurrent distinct replacements cannot both become active. Index readback and
lookup failures after publication are typed and retain the publication receipt.
Index discovery rejects symlinked trees or entries outside the explicit index
root, including a symlinked explicit root. Replacement and index roots nested
under a regular-file or non-system symlink ancestor fail during planning, and
root-containment I/O failures return typed results. Bundle artifact I/O failures
retain all earlier publication receipts.
Finalization succeeds only after re-reading the replacement after supersession
publication, matching both its canonical record and serialized file digests to
the Writer receipt, and proving lookup readability through an explicit root.
Post-publication JSON or digest readback failures return a receipted partial
finalization result rather than throwing. Partial recovery emits no
supersession-write command until the caller persists a successful Writer Result
and supplies its path.
Raw source labels, commands, targets, State IDs, paths, and URIs remain exact
through capture, projection, verification, and recovery recommendations.

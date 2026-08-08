# AOS Work Record v1

Status: active neutral evidence/history contract. The JSON Schema in
`aos-work-record-v1.schema.json` is the only Work Record schema accepted by
active producers, consumers, verification, repair planning, and finalization.

## Contract

A Work Record is optional. When a caller chooses to emit one, it preserves the
intent, exact source identity, execution map, immutable evidence references,
claims, verifier results, and current health for one run. It does not grant
permission, classify risk, require approval, select allowed operations, or
authorize replay or mutation.

The active top-level shape is:

```json
{
  "type": "aos.work_record",
  "schema_version": "2026-08-work-record-v1",
  "id": "work-record:<stable-id>",
  "label": "Human label",
  "created_at": "2026-08-06T12:00:00Z",
  "origin": {},
  "references": [],
  "intent": {},
  "execution_map": {
    "targets": [],
    "steps": [],
    "postconditions": [],
    "artifact_routes": []
  },
  "evidence": [],
  "claims": [],
  "claim_results": [],
  "verifier_report": {},
  "health": {},
  "metadata": {}
}
```

Evidence entries remain immutable and retain caller-supplied bytes, digests,
state identities, targets, and metadata without silent rewriting. Repair Plans
and Attempt Plans may describe future mechanical work but never execute it.
Attempt Artifacts record caller-supplied outcomes and must bind back to the
exact plan, evidence, cleanup, rollback, verifier-after health, and unchanged
source record.

## Historical V0

`aos-work-record-v0.schema.json`, its Markdown, and its fixtures are frozen
historical bytes. Active readers reject V0. AOS does not translate, repair,
replay, or execute a V0 record and provides no compatibility alias or dual
active reader.

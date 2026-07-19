#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

python3 - <<'PY'
import json
import jsonschema
from pathlib import Path
from referencing import Registry, Resource

schema_root = Path("shared/schemas")
req_schema = json.loads((schema_root / "daemon-request.schema.json").read_text())
resp_schema = json.loads((schema_root / "daemon-response.schema.json").read_text())

jsonschema.Draft202012Validator.check_schema(req_schema)
jsonschema.Draft202012Validator.check_schema(resp_schema)

registry = Registry()
for candidate in schema_root.glob("*.json"):
    document = json.loads(candidate.read_text())
    if document.get("$id"):
        registry = registry.with_resource(document["$id"], Resource.from_contents(document))

descriptor = {
    "schema_version": "aos.status_item.descriptor.v1",
    "owner": "io.example.app",
    "item_id": "companion",
    "revision": 3,
    "label": "Example Companion",
    "primary_action_id": "summon",
    "menu": [
        {"kind": "item", "id": "park", "action_id": "park", "label": "Park"},
        {"kind": "separator"},
    ],
}

good_requests = [
    {"v":1,"service":"system","action":"ping","data":{}},
    {"v":1,"service":"see","action":"observe","data":{"depth":1,"scope":"cursor"}},
    {"v":1,"service":"see","action":"snapshot","data":{}},
    {"v":1,"service":"show","action":"create","data":{"id":"x","at":[0,0,10,10],"html":"<div/>"}},
    {"v":1,"service":"show","action":"create","data":{"id":"hit","at":[0,0,10,10],"window_level":"screen_saver","html":"<div/>"}},
    {"v":1,"service":"show","action":"create","data":{"id":"world","surface":"desktop-world","url":"aos://toolkit/components/surface-inspector/index.html"}},
    {"v":1,"service":"show","action":"post","data":{"id":"x","message":"hello"}},
    {"v":1,"service":"tell","action":"send","data":{"audience":["ops"],"text":"hi"}},
    {"v":1,"service":"session","action":"register","data":{"session_id":"abc"}},
    {"v":1,"service":"status_item","action":"register","data":{"descriptor":descriptor},"ref":"register-1"},
    {"v":1,"service":"status_item","action":"update","data":{"owner":"io.example.app","item_id":"companion","generation":7,"current_revision":3,"descriptor":{**descriptor,"revision":4}}},
    {"v":1,"service":"status_item","action":"inspect","data":{"owner":"io.example.app","item_id":"companion","generation":7,"descriptor_revision":3}},
    {"v":1,"service":"status_item","action":"invoke","data":{"owner":"io.example.app","item_id":"companion","action_id":"summon","generation":7,"descriptor_revision":3}},
    {"v":1,"service":"status_item","action":"invoke_dry_run","data":{"owner":"io.example.app","item_id":"companion","action_id":"summon","generation":7,"descriptor_revision":3}},
]
validator = jsonschema.Draft202012Validator(req_schema, registry=registry)
for r in good_requests:
    errors = list(validator.iter_errors(r))
    assert not errors, f"unexpected errors for {r}: {errors}"

bad_requests = [
    {"v":1,"service":"system","action":"ping"},  # missing data
    {"v":2,"service":"system","action":"ping","data":{}},  # wrong v
    {"v":1,"service":"system","action":"PING","data":{}},  # uppercase action
    {"v":1,"service":"unknown","action":"ping","data":{}},  # bad service
    {"v":1,"service":"tell","action":"send","data":{"audience":["ops"]}},  # no text or payload
    {"v":1,"service":"session","action":"register","data":{"name":"only-a-name"}},  # missing session_id
    {"v":1,"service":"show","action":"create","data":{"id":"x"}},  # no geometry source
    {"v":1,"service":"show","action":"create","data":{"id":"x","surface":"union","html":"<div/>"}},  # bad surface
    {"v":1,"service":"show","action":"create","data":{"id":"x","at":[0,0,10,10],"window_level":"menu_bar","html":"<div/>"}},  # bad window level
    {"v":1,"service":"show","action":"create","data":{"id":"x","surface":"desktop-world","track":"union","html":"<div/>"}},  # surface + track
    {"v":1,"service":"show","action":"create","data":{"id":"x","surface":"desktop-world","at":[0,0,10,10],"html":"<div/>"}},  # surface + at
    {"v":1,"service":"show","action":"create","data":{"id":"x","surface":"desktop-world","anchor_window":1,"offset":[0,0,10,10],"html":"<div/>"}},  # surface + anchor
    {"v":1,"service":"show","action":"post","data":{}},  # show.post missing required id
    {"v":1,"service":"status_item","action":"unknown","data":{}},  # status item action vocabulary is closed
    {"v":1,"service":"status_item","action":"register","data":{"descriptor":{**descriptor,"owner":"io..example"}}},  # runtime rejects dot-dot identifiers
    {"v":1,"service":"status_item","action":"update","data":{"owner":"io.example.app","item_id":"companion","generation":7,"descriptor":{**descriptor,"revision":4}}},  # missing current revision
    {"v":1,"service":"status_item","action":"inspect","data":{"owner":"io.example.app","item_id":"companion","generation":7,"descriptor_revision":3,"extra":True}},  # strict action data
    {"v":1,"service":"status_item","action":"invoke","data":{"owner":"io.example.app","item_id":"companion","action_id":"summon..now","generation":7,"descriptor_revision":3}},  # invalid action id
]
for r in bad_requests:
    errors = list(validator.iter_errors(r))
    assert errors, f"expected errors for {r} but got none"

response_validator = jsonschema.Draft202012Validator(resp_schema, registry=registry)
good_responses = [
    {"v":1,"status":"success","data":{"generation":7},"ref":"register-1"},
    {"v":1,"status":"dry_run","data":{"owner":"io.example.app","item_id":"companion","action_id":"summon"},"ref":"invoke-1"},
    {"v":1,"status":"error","error":"status item not found","code":"STATUS_ITEM_NOT_FOUND"},
    {"v":1,"status":"error","error":"invalid descriptor","code":"INVALID_STATUS_ITEM_DESCRIPTOR"},
    {"v":1,"status":"error","error":"bad argument","code":"INVALID_ARG"},
]
for response in good_responses:
    errors = list(response_validator.iter_errors(response))
    assert not errors, f"unexpected response errors for {response}: {errors}"

bad_responses = [
    {"v":1,"status":"dry_run"},  # missing data
    {"v":1,"status":"dry_run","data":{},"extra":True},  # envelope remains closed
    {"v":1,"status":"error","error":"unknown","code":"SOME_NEW_ERROR"},  # unrelated error vocabulary remains closed
    {"v":1,"status":"error","error":"unknown","code":"STATUS_ITEM_"},  # status item code requires a suffix
]
for response in bad_responses:
    errors = list(response_validator.iter_errors(response))
    assert errors, f"expected response errors for {response} but got none"

print("PASS")
PY

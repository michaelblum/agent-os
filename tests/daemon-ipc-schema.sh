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
invoke_result_schema = json.loads((schema_root / "aos-status-item-invocation-result-v1.schema.json").read_text())

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
    "item_id": "status",
    "revision": 3,
    "label": "Example Status",
    "primary_action_id": "activate",
    "menu": [
        {"kind": "item", "id": "park", "action_id": "park", "label": "Park"},
        {"kind": "separator"},
    ],
}

scene_extension = {
    "ownerId": "io.example.app",
    "id": "panel-renderer",
    "digest": "a" * 64,
    "sceneAbi": "aos.scene.projection.v1",
    "threeRevision": "183",
}

display_topology = json.loads((
    schema_root / "fixtures/display-topology-v1/valid/uuid-members.json"
).read_text())

see_capture = {
    "capture_id": "11111111-1111-4111-8111-111111111111",
    "display_topology": display_topology,
    "displays": [{
        "display_id": 42,
        "index": 0,
        "topology_ordinal": 1,
    }],
    "display_ids": [42],
    "excluded_window_ids": [901],
    "window_targets": [],
    "maximum_pixels_per_display": 2073600,
    "shows_cursor": False,
}

window_target = {
    "display_id": 42,
    "window_id": 902,
    "owner_pid": 7001,
    "expected_bounds": {"x": 10, "y": 10, "width": 40, "height": 30},
    "fallback": "display",
}

good_requests = [
    {"v":1,"service":"system","action":"ping","data":{}},
    {"v":1,"service":"see","action":"observe","data":{"depth":1,"scope":"cursor"}},
    {"v":1,"service":"see","action":"snapshot","data":{}},
    {"v":1,"service":"see","action":"capture","data":see_capture,"ref":see_capture["capture_id"]},
    {"v":1,"service":"see","action":"capture","data":{**see_capture,"window_targets":[window_target]},"ref":see_capture["capture_id"]},
    {"v":1,"service":"see","action":"capture","data":{**see_capture,"window_targets":[{**window_target,"fallback":"none"}]},"ref":see_capture["capture_id"]},
    {"v":1,"service":"focus","action":"create","data":{"id":"work","window_id":902,"depth":0}},
    {"v":1,"service":"focus","action":"update","data":{"id":"work","depth":15}},
    {"v":1,"service":"graph","action":"deepen","data":{"id":"work","depth":15}},
    {"v":1,"service":"graph","action":"collapse","data":{"id":"work","depth":0}},
    {"v":1,"service":"show","action":"create","data":{"id":"x","at":[0,0,10,10],"html":"<div/>"}},
    {"v":1,"service":"show","action":"create","data":{"id":"hit","at":[0,0,10,10],"window_level":"screen_saver","html":"<div/>"}},
    {"v":1,"service":"show","action":"create","data":{"id":"world","surface":"desktop-world","url":"aos://toolkit/components/surface-inspector/index.html"}},
    {"v":1,"service":"show","action":"post","data":{"id":"x","message":"hello"}},
    {"v":1,"service":"tell","action":"send","data":{"audience":["ops"],"text":"hi"}},
    {"v":1,"service":"session","action":"register","data":{"session_id":"abc"}},
    {"v":1,"service":"permissions","action":"screen_capture_direct_status","data":{}},
    {"v":1,"service":"permissions","action":"screen_capture_direct_prime","data":{}},
    {"v":1,"service":"status_item","action":"register","data":{"descriptor":descriptor},"ref":"register-1"},
    {"v":1,"service":"status_item","action":"update","data":{"owner":"io.example.app","item_id":"status","generation":7,"current_revision":3,"descriptor":{**descriptor,"revision":4}}},
    {"v":1,"service":"status_item","action":"inspect","data":{"owner":"io.example.app","item_id":"status","generation":7,"descriptor_revision":3}},
    {"v":1,"service":"status_item","action":"invoke","data":{"owner":"io.example.app","item_id":"status","action_id":"activate","generation":7,"descriptor_revision":3,"action_sequence":1}},
    {"v":1,"service":"status_item","action":"invoke_dry_run","data":{"owner":"io.example.app","item_id":"status","action_id":"activate","generation":7,"descriptor_revision":3,"action_sequence":1}},
    {"v":1,"service":"scene","action":"follow","data":{"stage":"desktop-world/main","owner":"io.example.app","resource":"panel/main","operation":{"op":"mount","extension":scene_extension}}},
    {"v":1,"service":"scene","action":"follow","data":{"stage":"desktop-world/main","owner":"io.example.app","resource":"panel/main","operation":{"op":"subscribe","events":["gesture"]}}},
    {"v":1,"service":"scene","action":"follow","data":{"stage":"desktop-world/main","owner":"io.example.app","resource":"panel/main","operation":{"op":"unsubscribe","events":["gesture"]}}},
]
validator = jsonschema.Draft202012Validator(req_schema, registry=registry)
for r in good_requests:
    errors = list(validator.iter_errors(r))
    assert not errors, f"unexpected errors for {r}: {errors}"

bad_requests = [
    {"action":"subscribe"},  # non-envelope subscription requests are retired
    {"v":1,"service":"system","action":"ping"},  # missing data
    {"v":2,"service":"system","action":"ping","data":{}},  # wrong v
    {"v":1,"service":"system","action":"PING","data":{}},  # uppercase action
    {"v":1,"service":"unknown","action":"ping","data":{}},  # bad service
    {"v":1,"service":"see","action":"unknown","data":{}},  # see action vocabulary is closed
    {"v":1,"service":"tell","action":"send","data":{"audience":["ops"]}},  # no text or payload
    {"v":1,"service":"session","action":"register","data":{"name":"only-a-name"}},  # missing session_id
    {"v":1,"service":"permissions","action":"unknown","data":{}},  # permission action vocabulary is closed
    {"v":1,"service":"permissions","action":"screen_capture_direct_prime","data":{"display":1}},  # permission request data is strict
    {"v":1,"service":"show","action":"create","data":{"id":"x"}},  # no geometry source
    {"v":1,"service":"show","action":"create","data":{"id":"x","surface":"union","html":"<div/>"}},  # bad surface
    {"v":1,"service":"show","action":"create","data":{"id":"x","at":[0,0,10,10],"window_level":"menu_bar","html":"<div/>"}},  # bad window level
    {"v":1,"service":"show","action":"create","data":{"id":"x","surface":"desktop-world","track":"union","html":"<div/>"}},  # surface + track
    {"v":1,"service":"show","action":"create","data":{"id":"x","surface":"desktop-world","at":[0,0,10,10],"html":"<div/>"}},  # surface + at
    {"v":1,"service":"show","action":"create","data":{"id":"x","surface":"desktop-world","anchor_window":1,"offset":[0,0,10,10],"html":"<div/>"}},  # surface + anchor
    {"v":1,"service":"show","action":"post","data":{}},  # show.post missing required id
    {"v":1,"service":"see","action":"capture","data":{**see_capture,"maximum_pixels_per_display":67108865}},  # public pixel budget is bounded
    {"v":1,"service":"see","action":"capture","data":{k:v for k,v in see_capture.items() if k != "display_topology"}},  # canonical display topology is required
    {"v":1,"service":"see","action":"capture","data":{**see_capture,"topology_identity":"sha256:" + "a" * 64}},  # independent identity authority is forbidden
    {"v":1,"service":"see","action":"capture","data":{**see_capture,"path":"/private/capture.png"}},  # transport cannot accept artifact paths
    {"v":1,"service":"see","action":"capture","data":{**see_capture,"window_targets":[{k:v for k,v in window_target.items() if k != "fallback"}]}},  # fallback policy is required
    {"v":1,"service":"see","action":"capture","data":{**see_capture,"window_targets":[{**window_target,"fallback":"crop"}]}},  # fallback policy is closed
    {"v":1,"service":"see","action":"capture","data":{**see_capture,"window_targets":[{**window_target,"expected_bounds":{**window_target["expected_bounds"],"x":10.2}}]}},  # expected bounds are canonical integers
    {"v":1,"service":"focus","action":"create","data":{"id":"work","window_id":902,"depth":-1}},  # focus depth is non-negative
    {"v":1,"service":"focus","action":"update","data":{"id":"work","depth":16}},  # focus depth is bounded
    {"v":1,"service":"graph","action":"deepen","data":{"id":"work","depth":16}},  # graph depth is bounded
    {"v":1,"service":"graph","action":"collapse","data":{"id":"work","depth":-1}},  # graph depth is non-negative
    {"v":1,"service":"status_item","action":"unknown","data":{}},  # status item action vocabulary is closed
    {"v":1,"service":"status_item","action":"register","data":{"descriptor":{**descriptor,"owner":"io..example"}}},  # runtime rejects dot-dot identifiers
    {"v":1,"service":"status_item","action":"update","data":{"owner":"io.example.app","item_id":"status","generation":7,"descriptor":{**descriptor,"revision":4}}},  # missing current revision
    {"v":1,"service":"status_item","action":"inspect","data":{"owner":"io.example.app","item_id":"status","generation":7,"descriptor_revision":3,"extra":True}},  # strict action data
    {"v":1,"service":"status_item","action":"invoke","data":{"owner":"io.example.app","item_id":"status","action_id":"activate","generation":7,"descriptor_revision":3}},  # missing action sequence
    {"v":1,"service":"status_item","action":"invoke","data":{"owner":"io.example.app","item_id":"status","action_id":"activate","generation":7,"descriptor_revision":3,"action_sequence":1,"unexpected":True}},  # invoke data key set is closed
    {"v":1,"service":"status_item","action":"invoke","data":{"owner":"io.example.app","item_id":"status","action_id":"activate","generation":7,"descriptor_revision":3,"action_sequence":1,"action":"status-item-invoke"}},  # transport action is not invoke data
    {"v":1,"service":"status_item","action":"invoke","data":{"owner":"io.example.app","item_id":"status","action_id":"activate","generation":7,"descriptor_revision":3,"action_sequence":1,"__envelope_ref":"attacker"}},  # envelope ref is not invoke data
    {"v":1,"service":"status_item","action":"invoke","data":{"owner":"io.example.app","item_id":"status","action_id":"activate","generation":7,"descriptor_revision":3,"action_sequence":1,"__envelope_active":True}},  # envelope state is not invoke data
    {"v":1,"service":"status_item","action":"invoke","data":{"owner":"io.example.app","item_id":"status","action_id":"activate..now","generation":7,"descriptor_revision":3,"action_sequence":1}},  # invalid action id
    {"v":1,"service":"scene","action":"follow","data":{"stage":"desktop-world/main","owner":"io.example.app","resource":"panel/main","operation":{"op":"signal","extension":scene_extension}}},  # extensions are mount-only
]
for r in bad_requests:
    errors = list(validator.iter_errors(r))
    assert errors, f"expected errors for {r} but got none"

response_validator = jsonschema.Draft202012Validator(resp_schema, registry=registry)
status_bounds = {"x":1,"y":2,"width":24,"height":24,"origin_x":13,"origin_y":14,"display_id":1}
status_anchor = {
    "schema_version":"aos.status_item.anchor.v1",
    "anchor_id":"native-status-item/io.example.app/tool",
    "host":"native_status_item",
    "coordinate_space":"global_display_top_left",
    "visible":True,
    "bounds":status_bounds,
    "display":{"id":1,"frame":{"x":0,"y":0,"width":1920,"height":1080,"origin_x":960,"origin_y":540},"visible_frame":{"x":0,"y":24,"width":1920,"height":1056,"origin_x":960,"origin_y":552}},
    "topology":{"display_count":1,"display_ids":[1],"truncated":False},
}
good_responses = [
    {"v":1,"status":"success","data":{"generation":7},"ref":"register-1"},
    {"v":1,"status":"success","data":{"capture_id":see_capture["capture_id"],"topology_identity":display_topology["identity"],"frames":[{"display_id":42,"frame_index":0,"chunk_count":1,"byte_count":4,"sha256":"b"*64,"width":2,"height":2,"capture_source":"display","window_fallback":False}]},"ref":see_capture["capture_id"]},
    {"v":1,"status":"dry_run","data":{"owner":"io.example.app","item_id":"tool","action_id":"activate","generation":7,"descriptor_revision":3,"action_sequence":1,"event_type":"primary_activation","bounds":status_bounds,"anchor":status_anchor},"ref":"invoke-1"},
    {"v":1,"status":"error","error":"status item not found","code":"STATUS_ITEM_NOT_FOUND"},
    {"v":1,"status":"error","error":"invalid descriptor","code":"INVALID_STATUS_ITEM_DESCRIPTOR"},
    {"v":1,"status":"error","error":"bad argument","code":"INVALID_ARG"},
]
for response in good_responses:
    errors = list(response_validator.iter_errors(response))
    assert not errors, f"unexpected response errors for {response}: {errors}"

ipc_doc = Path("shared/schemas/daemon-ipc.md").read_text()
documented_dry_run = json.loads(
    ipc_doc.split("Validated no-side-effect response:", 1)[1]
    .split("```json", 1)[1]
    .split("```", 1)[0]
)
assert not list(response_validator.iter_errors(documented_dry_run)), "documented dry-run envelope is invalid"
documented_invoke_result = {**documented_dry_run["data"], "status": documented_dry_run["status"]}
invoke_result_validator = jsonschema.Draft202012Validator(invoke_result_schema, registry=registry)
assert not list(invoke_result_validator.iter_errors(documented_invoke_result)), "documented dry-run invocation result is invalid"

bad_responses = [
    {"v":1,"status":"dry_run"},  # missing data
    {"v":1,"status":"dry_run","data":{},"extra":True},  # envelope remains closed
    {"v":1,"status":"error","error":"unknown","code":"SOME_NEW_ERROR"},  # unrelated error vocabulary remains closed
    {"v":1,"status":"error","error":"unknown","code":"STATUS_ITEM_"},  # status item code requires a suffix
    {"v":1,"status":"error","error":"unknown","code":"STATUS_ITEM_FUTURE_ERROR"},  # status item error vocabulary is exact
    {"v":1,"status":"success","data":{"capture_id":see_capture["capture_id"],"topology_identity":display_topology["identity"],"frames":[{"display_id":42,"frame_index":0,"chunk_count":1,"byte_count":4,"sha256":"b"*64,"width":2,"height":2,"capture_source":"display","window_fallback":False,"extra":True}]},"ref":see_capture["capture_id"]},  # capture frame metadata is closed
    {"v":1,"status":"success","data":{"capture_id":see_capture["capture_id"],"topology_identity":display_topology["identity"],"frames":[{"display_id":42,"frame_index":0,"chunk_count":1,"byte_count":4,"sha256":"b"*64,"height":2,"capture_source":"display","window_fallback":False}]},"ref":see_capture["capture_id"]},  # capture frame metadata is complete
    {"v":1,"status":"success","data":{"capture_id":see_capture["capture_id"],"topology_identity":display_topology["identity"],"frames":[{"display_id":42,"frame_index":0,"chunk_count":1,"byte_count":4,"sha256":"b"*64,"width":2,"height":2,"capture_source":"window","window_fallback":True,"window_id":901}]},"ref":see_capture["capture_id"]},  # window success cannot also be fallback
]
for response in bad_responses:
    errors = list(response_validator.iter_errors(response))
    assert errors, f"expected response errors for {response} but got none"

print("PASS")
PY

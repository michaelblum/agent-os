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

operation_request = {
    "request_id": "11111111-1111-4111-8111-111111111111",
    "canonical_parameter_digest": "a" * 64,
}

operation_selector = {
    "operation_id": "22222222-2222-4222-8222-222222222222",
    "operation_generation": 7,
}

artifact_selector = {
    "artifact_id": "77777777-7777-4777-8777-777777777777",
    "artifact_generation": 9,
}

screen_recording_request = {
    "schema_version": "aos.screen-recording.request.v1",
    "request_id": "88888888-8888-4888-8888-888888888888",
    "canonical_parameter_digest": "8" * 64,
    "topology": display_topology,
    "target": {"kind": "display", "display_ordinal": 1},
    "duration_ms": 10000,
    "frame_rate": 30,
    "max_pixel_count": 33177600,
    "max_queue_frames": 3,
    "max_output_bytes": 268435456,
    "tracks": {"video": True, "system_audio": False, "microphone": False},
    "codec": "h264",
    "container": "quicktime",
}

external_spawn_intent = {
    "schema_version": "aos.operation.external-spawn-intent-request.v1",
    "request_id": "33333333-3333-4333-8333-333333333333",
    "route_source_id": "listen",
    "route_source_revision": "b" * 64,
    "adapter_registration_id": "microphone-capture-adapter",
    "adapter_registration_revision": 1,
    "resolved_executable": {
        "resolved_path_digest": "c" * 64,
        "executable_identity_digest": "d" * 64,
        "device": 7,
        "inode": 11,
        "code_identity_digest": "e" * 64,
        "file_digest": "f" * 64,
        "platform_code_directory_hash": "a" * 40,
        "signing_identifier": "node",
        "signing_team_identifier": "HX7739G8FX",
    },
    "expected_script_identity_digest": "1" * 64,
    "expected_script_digest": "2" * 64,
    "canonical_argv_shape_digest": "3" * 64,
    "reviewed_dependency_set_digest": "4" * 64,
}
external_binding_token = "A" * 43
asserted_attribution = {
    "client_id": "client-1",
    "agent_id": "agent-1",
    "project_id": "project-1",
    "task_id": "task-1",
    "run_id": "run-1",
    "skill_id": "skill-1",
    "target_id": "target-1",
    "capability_label": "microphone",
    "retry_id": "retry-1",
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
    {"v":1,"service":"operation","action":"list","data":{**operation_request,"filters":{}}},
    {"v":1,"service":"operation","action":"recent","data":{**operation_request,"filters":{"task_id":"task-1","capability_id":"microphone-capture"}}},
    {"v":1,"service":"operation","action":"inspect","data":{**operation_request,"selector":operation_selector}},
    {"v":1,"service":"operation","action":"cancel","data":{**operation_request,"selector":operation_selector}},
    {"v":1,"service":"operation","action":"kill_owner","data":{**operation_request,"filters":{"agent_id":"agent-1","project_id":"project-1"}}},
    {"v":1,"service":"operation","action":"record_screen","data":screen_recording_request},
    {"v":1,"service":"operation","action":"record_screen","data":{**screen_recording_request,"tracks":{"video":True,"system_audio":True,"microphone":False}}},
    {"v":1,"service":"operation","action":"tap","data":operation_request},
    {"v":1,"service":"operation","action":"artifact_reveal","data":{**operation_request,"selector":artifact_selector}},
    {"v":1,"service":"operation","action":"artifact_remove","data":{**operation_request,"selector":artifact_selector}},
    {"v":1,"service":"operation","action":"artifact_release","data":{**operation_request,"selector":artifact_selector,"destination":"/private/tmp/recording.mov"}},
    {"v":1,"service":"operation","action":"artifact_retain","data":{**operation_request,"selector":artifact_selector}},
    {"v":1,"service":"operation","action":"stop_all","data":{**operation_request,"schema_version":"aos.host-stop-barrier.stop-all-request.v1","action":"stop_all","expected_barrier_generation":3}},
    {"v":1,"service":"operation","action":"barrier_status","data":{**operation_request,"schema_version":"aos.host-stop-barrier.status-request.v1","action":"barrier_status"}},
    {"v":1,"service":"operation","action":"reopen","data":{**operation_request,"schema_version":"aos.host-stop-barrier.reopen-request.v1","action":"reopen","expected_barrier_generation":3}},
    {"v":1,"service":"operation","action":"external_spawn_intent","data":external_spawn_intent},
    {"v":1,"service":"operation","action":"external_spawn_intent","data":external_spawn_intent,"asserted_attribution":asserted_attribution},
    {"v":1,"service":"operation","action":"external_spawn_child_admit","data":{"schema_version":"aos.operation.external-spawn-child-admit-request.v1","request_id":"44444444-4444-4444-8444-444444444444","one_time_binding_token":external_binding_token,"child_pid":1234}},
    {"v":1,"service":"operation","action":"external_spawn_abandon","data":{"schema_version":"aos.operation.external-spawn-abandon-request.v1","request_id":"55555555-5555-4555-8555-555555555555","one_time_binding_token":external_binding_token}},
    {"v":1,"service":"operation","action":"external_spawn_finalize","data":{"schema_version":"aos.operation.external-spawn-finalize-request.v1","request_id":"66666666-6666-4666-8666-666666666666"}},
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
    {"v":1,"service":"operation","action":"unknown","data":operation_request},  # operation action vocabulary is closed
    {"v":1,"service":"operation","action":"list","data":{**operation_request,"filters":{},"human_initiated":True}},  # human intent is never authority
    {"v":1,"service":"operation","action":"list","data":{**operation_request,"filters":{"owner_root":"forged"}}},  # caller owner roots are forbidden
    {"v":1,"service":"operation","action":"inspect","data":{**operation_request,"selector":{"operation_id":operation_selector["operation_id"]}}},  # generation is required
    {"v":1,"service":"operation","action":"tap","data":{**operation_request,"selector":operation_selector,"tap":{"channel":"metadata","bounds":{"rate_items_per_second":30,"sample_every":2,"max_queue_items":8,"max_items":100,"max_bytes":4096,"idle_timeout_milliseconds":1000,"duration_milliseconds":5000},"follow":False}}},  # retired tap selectors and bounds are rejected
    {"v":1,"service":"operation","action":"artifact_reveal","data":operation_request},  # exact artifact selector is required
    {"v":1,"service":"operation","action":"artifact_reveal","data":{**operation_request,"selector":artifact_selector,"action":"reveal"}},  # transport action is not custody request data
    {"v":1,"service":"operation","action":"artifact_reveal","data":{**operation_request,"selector":artifact_selector,"extra":True}},  # reveal data is closed
    {"v":1,"service":"operation","action":"artifact_remove","data":{**operation_request,"selector":artifact_selector,"destination":"/private/tmp/x.mov"}},  # remove cannot carry release data
    {"v":1,"service":"operation","action":"artifact_retain","data":{**operation_request,"selector":artifact_selector,"extra":True}},  # unavailable retain data is still closed
    {"v":1,"service":"operation","action":"artifact_release","data":{**operation_request,"selector":artifact_selector}},  # release requires a destination
    {"v":1,"service":"operation","action":"artifact_release","data":{**operation_request,"selector":artifact_selector,"destination":"/private/tmp/x.mov","extra":True}},  # release data is closed
    {"v":1,"service":"operation","action":"artifact_release","data":{**operation_request,"selector":artifact_selector,"destination":7}},  # release destination type is exact
    {"v":1,"service":"operation","action":"record_screen","data":{**screen_recording_request,"tracks":{"video":True,"system_audio":False,"microphone":True}}},  # microphone remains structurally rejected
    {"v":1,"service":"operation","action":"record_screen","data":{**screen_recording_request,"tracks":{"video":True,"system_audio":"yes","microphone":False}}},  # system audio selection is exact Boolean
    {"v":1,"service":"operation","action":"stop_all","data":{**operation_request,"schema_version":"aos.host-stop-barrier.stop-all-request.v1","action":"stop_all"}},  # stop-all requires exact barrier CAS
    {"v":1,"service":"operation","action":"barrier_status","data":{**operation_request,"schema_version":"aos.host-stop-barrier.status-request.v1","action":"barrier_status","caller_origin":"status_item_host"}},  # origin evidence is server-attached
    {"v":1,"service":"operation","action":"recent","data":{**operation_request,"task_id":"task-1"}},  # filters are a closed nested object
    {"v":1,"service":"operation","action":"external_spawn_intent","data":{**external_spawn_intent,"human_initiated":True}},  # authority claims are forbidden
    {"v":1,"service":"operation","action":"external_spawn_intent","data":external_spawn_intent,"asserted_attribution":{**asserted_attribution,"owner_root":"forged"}},  # attribution cannot supply mechanical ownership
    {"v":1,"service":"operation","action":"external_spawn_intent","data":external_spawn_intent,"asserted_attribution":{"task_id":"bad value"}},  # identifiers are closed and bounded
    {"v":1,"service":"operation","action":"external_spawn_intent","data":external_spawn_intent,"asserted_attribution":{"unknown_id":"value"}},  # attribution vocabulary is closed
    {"v":1,"service":"system","action":"ping","data":{},"asserted_attribution":{}},  # only operation creation admits attribution
    {"v":1,"service":"operation","action":"external_spawn_intent","data":{**external_spawn_intent,"resolved_executable":{**external_spawn_intent["resolved_executable"],"path":"/usr/local/bin/node"}}},  # raw paths are forbidden
    {"v":1,"service":"operation","action":"external_spawn_intent","data":{k:v for k,v in external_spawn_intent.items() if k != "reviewed_dependency_set_digest"}},  # reviewed closure digest is required
    {"v":1,"service":"operation","action":"external_spawn_intent","data":{**external_spawn_intent,"resolved_executable":{**external_spawn_intent["resolved_executable"],"signing_team_identifier":"ATTACKER"}}},  # trusted Node team is closed
    {"v":1,"service":"operation","action":"external_spawn_child_admit","data":{"schema_version":"aos.operation.external-spawn-child-admit-request.v1","request_id":"44444444-4444-4444-8444-444444444444","one_time_binding_token":"short","child_pid":1234}},  # token is exact base64url length
    {"v":1,"service":"operation","action":"external_spawn_finalize","data":{"schema_version":"aos.operation.external-spawn-finalize-request.v1","request_id":"66666666-6666-4666-8666-666666666666","one_time_binding_token":external_binding_token}},  # child finalize is tokenless and peer-bound
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
    {"v":1,"status":"error","error":"stale operation generation","code":"OPERATION_GENERATION_CONFLICT"},
    {"v":1,"status":"error","error":"host barrier generation changed","code":"OPERATION_BARRIER_GENERATION_CONFLICT"},
    {"v":1,"status":"error","error":"OPERATION_TAP_UNAVAILABLE","code":"OPERATION_TAP_UNAVAILABLE","ref":"tap-request-1"},
    {"v":1,"status":"error","error":"OPERATION_ARTIFACT_CUSTODY_UNAVAILABLE","code":"OPERATION_ARTIFACT_CUSTODY_UNAVAILABLE","ref":"artifact-request-1"},
    {"v":1,"status":"error","error":"OPERATION_ARTIFACT_RETAIN_UNAVAILABLE","code":"OPERATION_ARTIFACT_RETAIN_UNAVAILABLE","ref":"artifact-retain-request-1"},
    {"v":1,"status":"success","data":{"schema_version":"aos.operation.external-spawn-intent-response.v1","request_id":"33333333-3333-4333-8333-333333333333","spawn_record_id":"55555555-5555-4555-8555-555555555555","one_time_binding_token":external_binding_token,"operation_id":operation_selector["operation_id"],"operation_generation":operation_selector["operation_generation"],"adapter_registration_id":"microphone-capture-adapter","adapter_registration_revision":1}},
    {"v":1,"status":"success","data":{"schema_version":"aos.operation.external-spawn-child-admit-response.v1","request_id":"44444444-4444-4444-8444-444444444444","spawn_record_id":"55555555-5555-4555-8555-555555555555","operation_id":operation_selector["operation_id"],"operation_generation":operation_selector["operation_generation"],"child_pid":1234,"child_pid_generation":1234000001,"parent_edge_digest":"9"*64,"platform_code_directory_hash":"a"*40,"platform_code_directory_hash_algorithm":"sha256_truncated_cdhash_20_bytes","outcome":"generation_bound_spawn_child_admitted"}},
    {"v":1,"status":"success","data":{"schema_version":"aos.operation.external-spawn-abandon-response.v1","request_id":"55555555-5555-4555-8555-555555555555","spawn_record_id":"55555555-5555-4555-8555-555555555555","operation_id":operation_selector["operation_id"],"operation_generation":operation_selector["operation_generation"],"outcome":"prepared_operation_abandoned"}},
    {"v":1,"status":"success","data":{"schema_version":"aos.operation.external-spawn-finalize-response.v1","request_id":"66666666-6666-4666-8666-666666666666","spawn_record_id":"55555555-5555-4555-8555-555555555555","operation_id":operation_selector["operation_id"],"operation_generation":operation_selector["operation_generation"],"adapter_registration_id":"microphone-capture-adapter","adapter_registration_revision":1,"outcome":"generation_bound_spawn_record_finalized","receipt":{"spawn_record_id":"55555555-5555-4555-8555-555555555555","operation_id":operation_selector["operation_id"],"operation_generation":operation_selector["operation_generation"],"adapter_registration_id":"microphone-capture-adapter","adapter_registration_revision":1,"resolved_executable_path_digest":"c"*64,"executable_identity_digest":"d"*64,"executable_file_digest":"f"*64,"platform_code_directory_hash":"a"*40,"platform_code_directory_hash_algorithm":"sha256_truncated_cdhash_20_bytes","expected_script_identity_digest":"1"*64,"script_identity_digest":"1"*64,"script_digest":"2"*64,"canonical_argv_shape_digest":"3"*64,"reviewed_dependency_set_digest":"4"*64,"outcome":"generation_bound_spawn_record_finalized"}}},
]
for response in good_responses:
    errors = list(response_validator.iter_errors(response))
    assert not errors, f"unexpected response errors for {response}: {errors}"

ipc_doc = Path("shared/schemas/daemon-ipc.md").read_text()
artifact_doc_lines = "\n".join(
    line for line in ipc_doc.splitlines() if "`operation.artifact_" in line
)
assert "`selector`" in artifact_doc_lines, "artifact IPC docs must name the exact selector wire field"
assert "`destination`" in artifact_doc_lines, "artifact release docs must name the exact destination wire field"
assert "artifact_selector" not in artifact_doc_lines, "artifact_selector is not a wire field"
assert "destination_path" not in artifact_doc_lines, "destination_path is not a wire field"
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
    {"v":1,"status":"success","data":{"schema_version":"aos.operation.external-spawn-intent-response.v1","request_id":"33333333-3333-4333-8333-333333333333","spawn_record_id":"55555555-5555-4555-8555-555555555555","one_time_binding_token":external_binding_token,"operation_id":operation_selector["operation_id"],"operation_generation":operation_selector["operation_generation"],"adapter_registration_id":"microphone-capture-adapter","adapter_registration_revision":1,"owner_root":"forged"}},  # server response remains content-free and closed
    {"v":1,"status":"success","data":{"schema_version":"aos.operation.external-spawn-finalize-response.v1","request_id":"44444444-4444-4444-8444-444444444444","spawn_record_id":"55555555-5555-4555-8555-555555555555","operation_id":operation_selector["operation_id"],"operation_generation":operation_selector["operation_generation"],"adapter_registration_id":"microphone-capture-adapter","adapter_registration_revision":1,"outcome":"generation_bound_spawn_record_finalized","receipt":{"spawn_record_id":"55555555-5555-4555-8555-555555555555","operation_id":operation_selector["operation_id"],"operation_generation":operation_selector["operation_generation"],"adapter_registration_id":"microphone-capture-adapter","adapter_registration_revision":1,"resolved_executable_path_digest":"c"*64,"executable_identity_digest":"d"*64,"executable_file_digest":"f"*64,"expected_script_identity_digest":"1"*64,"script_identity_digest":"1"*64,"script_digest":"2"*64,"canonical_argv_shape_digest":"3"*64,"outcome":"generation_bound_spawn_record_finalized"}}},  # reviewed closure digest is required in receipt
]
for response in bad_responses:
    errors = list(response_validator.iter_errors(response))
    assert errors, f"expected response errors for {response} but got none"

print(
    "PASS "
    f"good_requests={len(good_requests)} "
    f"bad_requests={len(bad_requests)} "
    f"good_responses={len(good_responses)} "
    f"bad_responses={len(bad_responses)}"
)
PY

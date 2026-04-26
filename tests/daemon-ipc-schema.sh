#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

python3 - <<'PY'
import json
import jsonschema

with open("shared/schemas/daemon-request.schema.json") as f:
    req_schema = json.load(f)
with open("shared/schemas/daemon-response.schema.json") as f:
    resp_schema = json.load(f)

jsonschema.Draft202012Validator.check_schema(req_schema)
jsonschema.Draft202012Validator.check_schema(resp_schema)

good_requests = [
    {"v":1,"service":"system","action":"ping","data":{}},
    {"v":1,"service":"see","action":"observe","data":{"depth":1,"scope":"cursor"}},
    {"v":1,"service":"see","action":"snapshot","data":{}},
    {"v":1,"service":"show","action":"create","data":{"id":"x","at":[0,0,10,10],"html":"<div/>"}},
    {"v":1,"service":"show","action":"create","data":{"id":"world","surface":"desktop-world","url":"aos://sigil/renderer/index.html"}},
    {"v":1,"service":"show","action":"post","data":{"id":"x","message":"hello"}},
    {"v":1,"service":"tell","action":"send","data":{"audience":["ops"],"text":"hi"}},
    {"v":1,"service":"session","action":"register","data":{"session_id":"abc"}},
]
validator = jsonschema.Draft202012Validator(req_schema)
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
    {"v":1,"service":"show","action":"create","data":{"id":"x","surface":"desktop-world","track":"union","html":"<div/>"}},  # surface + track
    {"v":1,"service":"show","action":"create","data":{"id":"x","surface":"desktop-world","at":[0,0,10,10],"html":"<div/>"}},  # surface + at
    {"v":1,"service":"show","action":"create","data":{"id":"x","surface":"desktop-world","anchor_window":1,"offset":[0,0,10,10],"html":"<div/>"}},  # surface + anchor
    {"v":1,"service":"show","action":"post","data":{}},  # show.post missing required id
]
for r in bad_requests:
    errors = list(validator.iter_errors(r))
    assert errors, f"expected errors for {r} but got none"

print("PASS")
PY

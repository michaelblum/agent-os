#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node --check scripts/generate-command-manifests.mjs
node scripts/generate-command-manifests.mjs --check
python3 - <<'PY'
import json
from pathlib import Path

root = Path("manifests/commands/source")
assert (root / "aos").is_dir(), "missing AOS command source directory"
assert (root / "external").is_dir(), "missing external command source directory"

for family in ["aos", "external"]:
    files = sorted((root / family).glob("*.json"))
    assert files, f"missing {family} source files"
    seen = set()
    for file in files:
        data = json.loads(file.read_text(encoding="utf-8"))
        assert data["schema_version"] == 1, file
        assert data["id"] == file.stem[3:], file
        assert data["id"] not in seen, data["id"]
        seen.add(data["id"])
        assert isinstance(data["commands"], list), file
        if family == "aos":
            assert isinstance(data.get("path_prefix"), list) and data["path_prefix"], file
            line_count = len(file.read_text(encoding="utf-8").splitlines())
            assert line_count < 1000, f"{file} has {line_count} lines; split command source further"
        for command in data["commands"]:
            assert command["path"], file
            assert command["path"][0] != "dev", f"{file} must not reintroduce the retired dev command family"
            if family == "aos":
                assert command["path"][:len(data["path_prefix"])] == data["path_prefix"], file

registry = json.loads(Path("manifests/commands/aos-commands.json").read_text(encoding="utf-8"))
assert all(command["path"][0] != "dev" for command in registry["commands"]), "generated registry must not contain the retired dev command family"
registry_text = json.dumps(registry).lower()
for retired_route in [
    "aos launch sigil",
    "sigil/start",
    "apps/sigil",
    "tests/fixtures/legacy-sigil/product",
]:
    assert retired_route not in registry_text, f"generated help must not teach embedded Sigil route: {retired_route}"
external = json.loads(Path("manifests/commands/aos-external-commands.json").read_text(encoding="utf-8"))
assert external["schema_version"] == 2, "generated external manifest must use wire schema_version 2"
assert all(command["path"][0] != "dev" for command in external["commands"]), "external registry must not contain retired dev routes"
registered = [command for command in external["commands"] if "spawn_registration" in command]
assert len(registered) == 1, registered
assert registered[0]["path"] == ["listen"], registered[0]
assert registered[0]["spawn_registration"]["adapter_registration_id"] == "microphone-capture-adapter", registered[0]
assert registered[0]["executable"] == "/usr/bin/env", registered[0]
assert registered[0]["argv_prefix"] == ["node", "--input-type=module", "-", "listen"], registered[0]
assert registered[0]["stdio"] == "registered_bundle", registered[0]
assert registered[0]["spawn_registration"]["expected_script_identity"] == "scripts/aos-tell-listen.mjs", registered[0]

print("PASS command manifest source generation")
PY

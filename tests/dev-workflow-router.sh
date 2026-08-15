#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAILS=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; FAILS=$((FAILS + 1)); }

if OUT="$(node scripts/aos-dev-workflow.mjs classify --json --paths src/main.swift,packages/toolkit/runtime/canvas.js,shared/schemas/input-event-v2.schema.json,docs/guides/example.md 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert data["status"] == "success"
assert data["diff_base"] == "explicit"
assert "swift-core" in summary["rule_ids"], summary
assert "toolkit-components" in summary["rule_ids"], summary
assert "schemas" in summary["rule_ids"], summary
assert "docs-only" in summary["rule_ids"], summary
assert summary["requires_swift_build"] is True, summary
assert summary["tcc_identity_sensitive"] is True, summary
assert summary["hot_swappable"] is False, summary
verification = [item["command"] for item in summary["verification"]]
assert all("aos-dev-build.mjs build" not in item["command"] for item in summary["commands"]), summary
assert all(command != "./aos help --json" for command in verification), summary
assert all(not command.startswith("./aos ready") for command in verification), summary
assert any(
    "does not schedule the TCC-sensitive build" in note
    and "Finish all static commands first" in note
    for note in summary["notes"]
), summary
assert any(
    "bash build.sh --force --no-restart" in note
    and "./aos help --json" in note
    and "immediately following command" in note
    for note in summary["notes"]
), summary
assert any(
    "replies `finished`" in note
    and "./aos ready --repair --post-permission --json" in note
    for note in summary["notes"]
), summary
PY
then
    pass "dev classify aggregates manifest-backed workflow classes"
else
    fail "dev classify did not report expected aggregate classes"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files docs/guides/example.md 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["next_commands"] == [], data
assert data["verification"] == [], data
assert data["notes"], data
assert data["summary"]["rule_ids"] == ["docs-only"], data
PY
then
    pass "dev recommend keeps docs-only changes out of runtime loops"
else
    fail "dev recommend docs-only routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files tests/fixtures/legacy-sigil/product/renderer/state.js 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert "legacy-sigil-test-fixture" in data["summary"]["rule_ids"], data
assert data["summary"]["tcc_identity_sensitive"] is False, data
commands = [item["command"] for item in data["next_commands"]]
assert "node --test tests/legacy-sigil-fixture.test.mjs tests/schemas/aos-app-v0.test.mjs tests/schemas/aos-experience-v0.test.mjs tests/active-authority-pointers.test.mjs" in commands, data
assert data["proof_worth"]["status"] == "passed", data
assert data["proof_worth"]["assets"][0]["kind"] == "fixture", data
assert data["proof_worth"]["assets"][0]["coverage"] == "active", data
PY
then
    pass "dev recommend routes relocated Sigil fixture to static bounded proof"
else
    fail "dev recommend relocated Sigil fixture routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files tests/dev-workflow-router.sh 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["proof_worth"]["status"] == "passed", data
assert data["proof_worth"]["changed_asset_count"] == 1, data
commands = [item["command"] for item in data["next_commands"]]
assert commands.count("bash tests/dev-workflow-router.sh") == 1, data
router = next(item for item in data["next_commands"] if item["command"] == "bash tests/dev-workflow-router.sh")
assert "dev-workflow-manifest" in router["source_rules"], router
assert "proof:dev-workflow-router-contract" in router["source_rules"], router
assert all(item["command"] != "bash <changed-test>" for item in data["verification"]), data
PY
then
    pass "dev recommend accepts registered changed tests and deduplicates registry commands"
else
    fail "dev recommend proof-worth registered test routing drifted"
fi

PROOF_TEMP="tests/.proof-worth-unregistered-temp.sh"
rm -f "$PROOF_TEMP"
printf '#!/usr/bin/env bash\nexit 0\n' > "$PROOF_TEMP"
set +e
OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files "$PROOF_TEMP" 2>/dev/null)"
RC=$?
set -e
if [[ "$RC" -eq 0 ]]; then
    fail "dev recommend should fail for existing unregistered proof assets"
elif OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "failed", data
assert data["code"] == "MISSING_PROOF_WORTH", data
assert data["proof_worth"]["status"] == "failed", data
failure = data["proof_worth"]["failures"][0]
assert failure["path"] == "tests/.proof-worth-unregistered-temp.sh", data
assert failure["reason"] == "missing_registry_entry", data
PY
then
    pass "dev recommend fails existing unregistered proof assets"
else
    fail "dev recommend unregistered proof-worth failure shape drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs classify --json --files "$PROOF_TEMP" 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["proof_worth"]["status"] == "failed", data
assert data["proof_worth"]["failures"][0]["reason"] == "missing_registry_entry", data
PY
then
    pass "dev classify reports proof-worth metadata without failing"
else
    fail "dev classify proof-worth metadata behavior drifted"
fi
rm -f "$PROOF_TEMP"

DELETED_PROOF="tests/.proof-worth-deleted-temp.sh"
rm -f "$DELETED_PROOF"
if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files "$DELETED_PROOF" 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["proof_worth"]["status"] == "passed", data
asset = data["proof_worth"]["assets"][0]
assert asset["path"] == "tests/.proof-worth-deleted-temp.sh", data
assert asset["deleted"] is True, data
assert asset["coverage"] == "deleted_unregistered_cleanup", data
assert all(item["command"] != "bash <changed-test>" for item in data["verification"]), data
PY
then
    pass "dev recommend treats deleted unregistered proof assets as cleanup"
else
    fail "dev recommend deleted proof cleanup behavior drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files src/daemon/annotation-target-selection.swift scripts/lib/pending-annotations-model.mjs shared/schemas/aos-pending-annotation-v0.schema.json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "desktop-annotation-selection" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
assert summary["requires_swift_build"] is True, data
assert summary["tcc_identity_sensitive"] is True, data
commands = {item["command"] for item in data["next_commands"]}
assert {
    "node --test tests/annotation-select-cli.test.mjs && bash tests/annotation-selection-native.sh",
    "node --test tests/schemas/aos-pending-annotation-v0.test.mjs tests/schemas/daemon-event.test.mjs tests/toolkit/pending-annotation-model.test.mjs",
    "bash tests/command-manifest-generation.sh",
} <= commands, data
PY
then
    pass "dev recommend routes semantic target selection to static annotation proofs"
else
    fail "dev recommend semantic target selection routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs classify --json --files src/commands/desktop-pixel-native-baseline.swift src/daemon/desktop-pixel-capture-filter.swift src/daemon/desktop-pixel-native-operation.swift src/daemon/desktop-pixel-stream-lifecycle.swift src/display/desktop-world-native-projection-lifecycle.swift src/display/desktop-world-native-projection-manager.swift src/display/desktop-world-native-sheet-geometry.swift src/display/desktop-world-native-sheet-lease.swift src/display/desktop-world-native-sheet.swift src/display/desktop-world-surface.swift src/shared/desktop-pixel-sample-admission.swift src/shared/desktop-world-display-geometry.swift src/shared/desktop-world-resource-identity.swift scripts/aos-runtime-desktop-pixel-baseline.mjs tests/desktop-pixel-native-baseline.test.mjs tests/desktop-pixel-native-baseline-typecheck.sh tests/lib/desktop-pixel-native-baseline-lifecycle-tests.swift tests/lib/desktop-pixel-metal-pipeline-tests.swift tests/lib/desktop-world-display-geometry-tests.swift tests/lib/desktop-world-native-projection-lifecycle-tests.swift tests/lib/desktop-world-native-sheet-geometry-tests.swift tests/lib/desktop-world-native-sheet-lease-tests.swift 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "desktop-pixel-native-baseline" in summary["rule_ids"], data
assert "desktop-pixel-native-baseline-command" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
assert summary["requires_swift_build"] is True, data
assert summary["tcc_identity_sensitive"] is True, data
files = {item["path"]: item for item in data["files"]}
expected_paths = {
    "src/commands/desktop-pixel-native-baseline.swift",
    "src/daemon/desktop-pixel-capture-filter.swift",
    "src/daemon/desktop-pixel-native-operation.swift",
    "src/daemon/desktop-pixel-stream-lifecycle.swift",
    "src/display/desktop-world-native-projection-lifecycle.swift",
    "src/display/desktop-world-native-projection-manager.swift",
    "src/display/desktop-world-native-sheet-geometry.swift",
    "src/display/desktop-world-native-sheet-lease.swift",
    "src/display/desktop-world-native-sheet.swift",
    "src/display/desktop-world-surface.swift",
    "src/shared/desktop-pixel-sample-admission.swift",
    "src/shared/desktop-world-display-geometry.swift",
    "src/shared/desktop-world-resource-identity.swift",
    "scripts/aos-runtime-desktop-pixel-baseline.mjs",
    "tests/desktop-pixel-native-baseline.test.mjs",
    "tests/desktop-pixel-native-baseline-typecheck.sh",
    "tests/lib/desktop-pixel-native-baseline-lifecycle-tests.swift",
    "tests/lib/desktop-pixel-metal-pipeline-tests.swift",
    "tests/lib/desktop-world-display-geometry-tests.swift",
    "tests/lib/desktop-world-native-projection-lifecycle-tests.swift",
    "tests/lib/desktop-world-native-sheet-geometry-tests.swift",
    "tests/lib/desktop-world-native-sheet-lease-tests.swift",
}
assert expected_paths == set(files), data
native_paths = {
    "src/commands/desktop-pixel-native-baseline.swift",
    "src/daemon/desktop-pixel-capture-filter.swift",
    "src/daemon/desktop-pixel-native-operation.swift",
    "src/daemon/desktop-pixel-stream-lifecycle.swift",
    "src/display/desktop-world-native-projection-lifecycle.swift",
    "src/display/desktop-world-native-projection-manager.swift",
    "src/display/desktop-world-native-sheet-geometry.swift",
    "src/display/desktop-world-native-sheet-lease.swift",
    "src/display/desktop-world-native-sheet.swift",
    "src/display/desktop-world-surface.swift",
    "src/shared/desktop-pixel-sample-admission.swift",
    "src/shared/desktop-world-display-geometry.swift",
    "src/shared/desktop-world-resource-identity.swift",
    "tests/lib/desktop-world-display-geometry-tests.swift",
}
for path in native_paths:
    assert "desktop-pixel-native-baseline" in files[path]["rules"], files[path]
for path in native_paths - {"src/commands/desktop-pixel-native-baseline.swift"}:
    assert "desktop-world-scene-engine" in files[path]["rules"], files[path]
for path in expected_paths - native_paths:
    assert "desktop-pixel-native-baseline-command" in files[path]["rules"], files[path]
commands = {item["command"] for item in summary["commands"]}
assert (
    "node --test tests/desktop-pixel-native-baseline.test.mjs "
    "&& bash tests/desktop-pixel-native-baseline-typecheck.sh "
    "&& bash tests/command-manifest-generation.sh"
) in commands, data
PY
then
    pass "dev recommend routes native desktop-pixel baseline owners to focused static proof"
else
    fail "dev recommend native desktop-pixel baseline routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs classify --json --files src/display/aos-scheme-response.swift src/display/canvas.swift src/display/scene-extension-store.swift src/commands/daemon-application-lifecycle.swift src/commands/direct-screen-capture-permission.swift src/commands/serve.swift src/daemon/desktop-frame-capture-consent.swift src/daemon/desktop-frame-warm-pool.swift src/daemon/desktop-pixel-capture-filter.swift src/daemon/desktop-pixel-native-operation.swift src/daemon/desktop-pixel-retirement.swift src/daemon/desktop-pixel-stream-lifecycle.swift src/shared/desktop-frame-capture-consent-contract.swift src/shared/desktop-pixel-sample-admission.swift src/shared/scene-extension-identifier.swift scripts/lib/scene-extension/module-inspector.mjs tests/daemon/aos-scheme-handler-nonblocking.test.mjs tests/daemon-appkit-readiness.test.mjs tests/desktop-world-scene-native-orchestration.test.mjs tests/lib/daemon-appkit-readiness-tests.swift tests/lib/desktop-frame-warm-pool-tests.swift tests/lib/desktop-pixel-capture-filter-tests.swift tests/lib/desktop-pixel-native-lifecycle-tests.swift tests/lib/desktop-pixel-terminal-startup-tests.swift tests/lib/desktop-pixel-startup-callback-tests.swift tests/lib/desktop-pixel-warm-open-operation-tests.swift 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "desktop-world-scene-engine" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
files = {item["path"]: item for item in data["files"]}
commands = {item["command"] for item in summary["commands"]}
expected_paths = {
    "src/display/aos-scheme-response.swift",
    "src/display/canvas.swift",
    "src/display/scene-extension-store.swift",
    "src/commands/daemon-application-lifecycle.swift",
    "src/commands/direct-screen-capture-permission.swift",
    "src/commands/serve.swift",
    "src/daemon/desktop-frame-capture-consent.swift",
    "src/daemon/desktop-frame-warm-pool.swift",
    "src/daemon/desktop-pixel-capture-filter.swift",
    "src/daemon/desktop-pixel-native-operation.swift",
    "src/daemon/desktop-pixel-retirement.swift",
    "src/daemon/desktop-pixel-stream-lifecycle.swift",
    "src/shared/desktop-frame-capture-consent-contract.swift",
    "src/shared/desktop-pixel-sample-admission.swift",
    "src/shared/scene-extension-identifier.swift",
    "scripts/lib/scene-extension/module-inspector.mjs",
    "tests/daemon/aos-scheme-handler-nonblocking.test.mjs",
    "tests/daemon-appkit-readiness.test.mjs",
    "tests/desktop-world-scene-native-orchestration.test.mjs",
    "tests/lib/daemon-appkit-readiness-tests.swift",
    "tests/lib/desktop-frame-warm-pool-tests.swift",
    "tests/lib/desktop-pixel-capture-filter-tests.swift",
    "tests/lib/desktop-pixel-native-lifecycle-tests.swift",
    "tests/lib/desktop-pixel-terminal-startup-tests.swift",
    "tests/lib/desktop-pixel-startup-callback-tests.swift",
    "tests/lib/desktop-pixel-warm-open-operation-tests.swift",
}
assert expected_paths == set(files), data
for path in expected_paths:
    assert "desktop-world-scene-engine" in files[path]["rules"], files[path]
for path in {
    "src/commands/daemon-application-lifecycle.swift",
    "src/commands/serve.swift",
}:
    assert "status-item-contract" in files[path]["rules"], files[path]
assert "bash tests/swift-runtime-typecheck.sh" in commands, data
assert "node --test tests/daemon-appkit-readiness.test.mjs" in commands, data
assert any("tests/daemon/aos-scheme-handler-nonblocking.test.mjs" in command for command in commands), data
assert any("tests/desktop-world-scene-native-orchestration.test.mjs" in command for command in commands), data
assert "node --test tests/status-item-contract.test.mjs" in commands, data
assert any("tests/aos-permissions-microphone-authority.test.mjs" in command for command in commands), data
PY
then
    pass "dev recommend routes desktop-frame owners to scene engine proofs"
else
    fail "dev recommend desktop-frame owner routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs classify --json --files packages/toolkit/scene/scene-native-effect-program.js src/daemon/daemon-idle-timer.swift src/daemon/desktop-world-devtools-native-stage-facts.swift src/daemon/desktop-world-native-effect-contract.swift src/daemon/desktop-world-native-effect-program.swift src/daemon/desktop-world-native-feedback-contracts.swift src/daemon/desktop-world-native-feedback-controller.swift src/daemon/desktop-world-native-feedback-admission.swift src/daemon/desktop-world-native-feedback-host.swift src/display/desktop-world-native-projection-lifecycle.swift src/display/desktop-world-native-projection-manager.swift src/display/desktop-world-native-effect-clock.swift src/display/desktop-world-native-effect-program-compiler.swift src/display/desktop-world-native-effect-pipeline-cache.swift src/display/desktop-world-native-effect-renderer.swift src/display/desktop-world-native-effect-height-field.swift tests/daemon-appkit-readiness.test.mjs tests/desktop-world-native-effect-program.test.mjs tests/desktop-world-scene-native-feedback.test.mjs tests/desktop-world-scene-native-feedback-lifecycle.test.mjs tests/lib/daemon-appkit-readiness-tests.swift tests/toolkit/scene-native-effect-program.test.mjs 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "desktop-world-scene-engine" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
assert summary["requires_swift_build"] is True, data
assert summary["tcc_identity_sensitive"] is True, data
files = {item["path"]: item for item in data["files"]}
expected_paths = {
    "packages/toolkit/scene/scene-native-effect-program.js",
    "src/daemon/daemon-idle-timer.swift",
    "src/daemon/desktop-world-devtools-native-stage-facts.swift",
    "src/daemon/desktop-world-native-effect-contract.swift",
    "src/daemon/desktop-world-native-effect-program.swift",
    "src/daemon/desktop-world-native-feedback-contracts.swift",
    "src/daemon/desktop-world-native-feedback-controller.swift",
    "src/daemon/desktop-world-native-feedback-admission.swift",
    "src/daemon/desktop-world-native-feedback-host.swift",
    "src/display/desktop-world-native-projection-lifecycle.swift",
    "src/display/desktop-world-native-projection-manager.swift",
    "src/display/desktop-world-native-effect-clock.swift",
    "src/display/desktop-world-native-effect-program-compiler.swift",
    "src/display/desktop-world-native-effect-pipeline-cache.swift",
    "src/display/desktop-world-native-effect-renderer.swift",
    "src/display/desktop-world-native-effect-height-field.swift",
    "tests/daemon-appkit-readiness.test.mjs",
    "tests/desktop-world-native-effect-program.test.mjs",
    "tests/desktop-world-scene-native-feedback.test.mjs",
    "tests/desktop-world-scene-native-feedback-lifecycle.test.mjs",
    "tests/lib/daemon-appkit-readiness-tests.swift",
    "tests/toolkit/scene-native-effect-program.test.mjs",
}
assert expected_paths == set(files), data
for path in expected_paths:
    assert "desktop-world-scene-engine" in files[path]["rules"], files[path]
commands = {item["command"] for item in summary["commands"]}
assert any("tests/desktop-world-scene-native-feedback.test.mjs" in command for command in commands), data
assert any("tests/desktop-world-scene-native-feedback-lifecycle.test.mjs" in command for command in commands), data
assert any("tests/desktop-world-native-effect-program.test.mjs" in command for command in commands), data
assert any("tests/toolkit/scene-native-effect-program.test.mjs" in command for command in commands), data
assert "node --test tests/daemon-appkit-readiness.test.mjs" in commands, data
PY
then
    pass "dev classify routes native DesktopWorld feedback owners to focused static proof"
else
    fail "dev classify native DesktopWorld feedback routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs classify --json --files src/perceive/ax-semantic-target.swift tests/lib/annotation-semantic-target-traversal-tests.swift 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "desktop-annotation-selection" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
assert summary["requires_swift_build"] is True, data
assert summary["tcc_identity_sensitive"] is True, data
files = {item["path"]: item for item in data["files"]}
expected_paths = {
    "src/perceive/ax-semantic-target.swift",
    "tests/lib/annotation-semantic-target-traversal-tests.swift",
}
assert expected_paths == set(files), data
for path in expected_paths:
    item = files[path]
    assert "desktop-annotation-selection" in item["rules"], item
    assert "unclassified" not in item["rules"], item
    assert item["hot_swappable"] is False, item
    assert item["tcc_identity_sensitive"] is True, item
commands = {item["command"] for item in summary["commands"]}
assert {
    "node --test tests/annotation-select-cli.test.mjs && bash tests/annotation-selection-native.sh",
    "node --test tests/schemas/aos-pending-annotation-v0.test.mjs tests/schemas/daemon-event.test.mjs tests/toolkit/pending-annotation-model.test.mjs",
    "bash tests/command-manifest-generation.sh",
} <= commands, data
proof_assets = {item["path"]: item for item in data["proof_worth"]["assets"]}
assert proof_assets["tests/lib/annotation-semantic-target-traversal-tests.swift"]["status"] == "passed", data
PY
then
    pass "dev classify routes each canonical semantic target traversal owner to focused annotation proofs"
else
    fail "dev classify canonical semantic target traversal routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files tests/lib/visual-harness.sh 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "visual-harness-primitives" in summary["rule_ids"], data
assert "tests" in summary["rule_ids"], data
commands = {item["command"] for item in data["next_commands"]}
assert {
    "bash tests/visual-harness-boundary.sh",
    "bash tests/visual-harness-canonical-url-primitives.sh",
    "bash tests/harness-composability-contracts.sh",
} <= commands, data
assert summary["requires_swift_build"] is False, data
assert summary["tcc_identity_sensitive"] is False, data
PY
then
    pass "dev recommend routes visual harness primitive changes to deterministic battery"
else
    fail "dev recommend visual harness primitive routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs classify --json --files unknown/path.txt 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["summary"]["rule_ids"] == ["unclassified"], data
assert data["summary"]["actions"] == ["inspect_manually"], data
PY
then
    pass "dev classify reports unmatched paths through fallback"
else
    fail "dev classify fallback routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files scripts/aos-do-native.mjs 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "command-surface-implementations" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
assert summary["hot_swappable"] is True, data
assert summary["requires_swift_build"] is False, data
assert summary["tcc_identity_sensitive"] is False, data
commands = {item["command"] for item in data["next_commands"]}
assert {
    "bash tests/external-command-dispatch.sh",
    "bash tests/external-parser-flags.sh",
    "bash tests/help-contract.sh",
} <= commands, data
PY
then
    pass "dev recommend routes external command wrappers to hot-swappable command-surface checks"
else
    fail "dev recommend external command wrapper routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --paths packages/toolkit/status-item/index.js scripts/aos-status-item.mjs scripts/lib/status-item-output-writer.mjs shared/schemas/daemon-ipc.md shared/schemas/daemon-request.schema.json src/commands/daemon-application-lifecycle.swift src/commands/serve.swift src/daemon/unified.swift src/display/status-item-host-contract.swift src/display/status-item-host-controller.swift tests/daemon-ipc-schema.sh 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "status-item-contract" in summary["rule_ids"], data
assert "desktop-world-scene-engine" in summary["rule_ids"], data
commands = [item["command"] for item in data["next_commands"]]
assert commands.count("node --test tests/status-item-contract.test.mjs") == 1, data
assert commands.count("bash tests/daemon-ipc-schema.sh && node --test tests/schemas/daemon-event.test.mjs") == 1, data
assert summary["requires_swift_build"] is True, data
assert summary["tcc_identity_sensitive"] is True, data
PY
then
    pass "dev recommend routes status-item production sources to their focused contract"
else
    fail "dev recommend status-item contract routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --paths scripts/aos-experience.mjs scripts/lib/experience-manifest.mjs scripts/lib/experience-runtime-context.mjs scripts/lib/experience-runtime-facts.mjs shared/schemas/aos-experience-v1.schema.json shared/schemas/aos-experience-runtime-context-v1.schema.json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["proof_worth"]["status"] == "passed", data
commands = [item["command"] for item in data["next_commands"]]
expected = "node --test --test-concurrency=1 tests/experience-runtime-context-content-roots.test.mjs tests/experience-runtime-context-env.test.mjs tests/experience-runtime-context-pending-annotations.test.mjs tests/experience-runtime-context-probes.test.mjs tests/schemas/aos-experience-runtime-context-v0.test.mjs tests/schemas/aos-experience-runtime-context-v1.test.mjs tests/schemas/aos-experience-v1.test.mjs"
assert commands.count(expected) == 1, data
assert "experience-runtime-contract" in data["summary"]["rule_ids"], data
assert "unclassified" not in data["summary"]["rule_ids"], data
PY
then
    pass "dev recommend routes experience production contracts to v0/v1 proofs"
else
    fail "dev recommend experience production contract routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files shared/swift/ipc/runtime-paths.swift src/perceive/image-file-compare.swift manifests/commands/source/aos/03-see-05-compare.json docs/api/aos.md docs/api/aos-capabilities.md tests/see-image-compare.sh 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert data["status"] == "success", data
assert data["proof_worth"]["status"] == "passed", data
assert "image-file-compare" in summary["rule_ids"], data
assert "command-surface-manifests" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
assert summary["requires_swift_build"] is True, data
assert summary["tcc_identity_sensitive"] is True, data
commands = [item["command"] for item in data["next_commands"]]
assert commands.count("bash tests/see-image-compare.sh") == 1, data
PY
then
    pass "dev recommend routes image comparator changes to hermetic focused proof"
else
    fail "dev recommend image comparator routing drifted"
fi

for IMAGE_COMPARE_ROUTE_OWNER in shared/swift/ipc/runtime-paths.swift src/main.swift manifests/commands/source/external/11-see.json docs/api/aos.md docs/api/aos-capabilities.md; do
    if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files "$IMAGE_COMPARE_ROUTE_OWNER" 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert "image-file-compare" in data["summary"]["rule_ids"], data
commands = [item["command"] for item in data["next_commands"]]
assert commands.count("bash tests/see-image-compare.sh") == 1, data
PY
    then
        pass "dev recommend routes $IMAGE_COMPARE_ROUTE_OWNER to the image comparator proof"
    else
        fail "dev recommend image comparator route-owner routing drifted for $IMAGE_COMPARE_ROUTE_OWNER"
    fi
done

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files manifests/commands/source/aos/03-see-01-capture.json scripts/generate-command-manifests.mjs tests/command-manifest-generation.sh 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "command-surface-manifests" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
assert summary["hot_swappable"] is True, data
assert summary["requires_swift_build"] is False, data
commands = {item["command"] for item in data["next_commands"]}
assert {
    "bash tests/command-manifest-generation.sh",
    "node --test tests/schemas/aos-external-command-manifest-v0.test.mjs",
    "bash tests/external-command-dispatch.sh",
    "bash tests/help-contract.sh",
} <= commands, data
PY
then
    pass "dev recommend routes command source and generator edits to manifest generation checks"
else
    fail "dev recommend command source/generator routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files packages/cli/verbs/gate-ask.js 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "command-surface-implementations" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
assert summary["hot_swappable"] is True, data
assert summary["requires_swift_build"] is False, data
assert summary["tcc_identity_sensitive"] is False, data
commands = {item["command"] for item in data["next_commands"]}
assert {
    "bash tests/external-command-dispatch.sh",
    "bash tests/external-parser-flags.sh",
    "bash tests/help-contract.sh",
} <= commands, data
PY
then
    pass "dev recommend routes package CLI commands to command-surface checks"
else
    fail "dev recommend package CLI command routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files scripts/sign-aos-runtime 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "command-surface-implementations" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
assert summary["hot_swappable"] is True, data
assert summary["requires_swift_build"] is False, data
assert summary["tcc_identity_sensitive"] is False, data
commands = {item["command"] for item in data["next_commands"]}
assert {
    "bash tests/external-command-dispatch.sh",
    "bash tests/external-parser-flags.sh",
    "bash tests/help-contract.sh",
} <= commands, data
PY
then
    pass "dev recommend routes runtime signing script to command-surface checks"
else
    fail "dev recommend runtime signing command routing drifted"
fi

if OUT="$(node - <<'NODE'
const { spawnSync } = require('node:child_process');
const manifest = require('./manifests/commands/aos-external-commands.json');
const targets = [...new Set(
  manifest.commands
    .flatMap((command) => command.argv_prefix || [])
    .filter((arg) => /^(scripts|packages)\//.test(arg))
)].sort();
const result = spawnSync(process.execPath, ['scripts/aos-dev-workflow.mjs', 'classify', '--json', '--files', ...targets], { encoding: 'utf8' });
if (result.stderr) process.stderr.write(result.stderr);
if (result.stdout) process.stdout.write(result.stdout);
process.exit(result.status ?? 1);
NODE
)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["files"], data
files = {item["path"]: item for item in data["files"]}
annotation = files["scripts/aos-annotation-select.mjs"]
assert "desktop-annotation-selection" in annotation["rules"], annotation
assert annotation["hot_swappable"] is False, annotation
assert annotation["tcc_identity_sensitive"] is True, annotation
for item in data["files"]:
    rules = set(item["rules"])
    assert "command-surface-implementations" in rules, item
    assert "unclassified" not in rules, item
    if item["path"] == "scripts/aos-annotation-select.mjs":
        continue
    assert "desktop-annotation-selection" not in rules, item
    assert item["hot_swappable"] is True, item
    assert item["tcc_identity_sensitive"] is False, item
summary = data["summary"]
assert summary["requires_swift_build"] is False, summary
assert summary["hot_swappable"] is False, summary
assert summary["tcc_identity_sensitive"] is True, summary
PY
then
    pass "dev classify routes every external manifest implementation target to command-surface checks"
else
    fail "dev classify external manifest implementation target routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs classify --json --files apps/example/feature.js 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["summary"]["rule_ids"] == ["app-subtree-local-contract"], data
assert data["summary"]["actions"] == ["read_local_contract"], data
assert "nearest subtree AGENTS.md" in data["summary"]["notes"][0], data
assert "sigil" not in json.dumps(data).lower(), data
PY
then
    pass "dev classify routes app subtree changes to local contracts"
else
    fail "dev classify app local-contract routing drifted"
fi

if OUT="$(node scripts/aos-dev-workflow.mjs recommend --json --files docs/api/aos.md 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "command-contract-docs" in summary["rule_ids"], data
assert any(item["command"] == "bash tests/help-contract.sh" for item in data["next_commands"]), data
PY
then
    pass "dev recommend routes command-contract docs to help verification"
else
    fail "dev recommend command-contract docs routing drifted"
fi

if ERR="$(node scripts/aos-dev-workflow.mjs recommend --json --base definitely-not-a-ref 2>&1 >/dev/null)"; then
    fail "dev recommend should reject invalid --base refs"
elif echo "$ERR" | grep -q '"code" : "INVALID_BASE_REF"'; then
    pass "dev recommend rejects invalid --base refs"
else
    fail "dev recommend invalid --base error mismatch: $ERR"
fi

if ERR="$(node scripts/aos-dev-workflow.mjs recommend --base --json 2>&1 >/dev/null)"; then
    fail "dev recommend should reject missing --base values before a flag"
elif echo "$ERR" | grep -q '"code" : "MISSING_ARG"'; then
    pass "dev recommend treats flag-after---base as missing value"
else
    fail "dev recommend missing --base error mismatch: $ERR"
fi

if ERR="$(node scripts/aos-dev-workflow.mjs audit --repo --json 2>&1 >/dev/null)"; then
    fail "dev audit should reject missing --repo values before a flag"
elif echo "$ERR" | grep -q '"code" : "MISSING_ARG"'; then
    pass "dev audit treats flag-after---repo as missing value"
else
    fail "dev audit missing --repo error mismatch: $ERR"
fi

if [[ "${AOS_SKIP_LIVE_CLI_CHECKS:-0}" == "1" ]]; then
    pass "public CLI checks deferred by explicit static-only gate"
else
    if ERR="$(./aos help dev --json 2>&1 >/dev/null)"; then
        fail "aos help dev should not resolve after dev command removal"
    elif echo "$ERR" | grep -q '"code" : "UNKNOWN_COMMAND"'; then
        pass "public help rejects removed dev command"
    else
        fail "aos help dev returned unexpected error: $ERR"
    fi

    if ERR="$(./aos dev classify --json 2>&1 >/dev/null)"; then
        fail "aos dev classify should not dispatch after dev command removal"
    elif echo "$ERR" | grep -q '"code" : "UNKNOWN_COMMAND"'; then
        pass "public dispatch rejects removed dev command"
    else
        fail "aos dev classify returned unexpected error: $ERR"
    fi
fi

echo
if [[ "$FAILS" -eq 0 ]]; then
    echo "dev-workflow-router: all checks passed"
    exit 0
fi

echo "dev-workflow-router: $FAILS failure(s)"
exit 1

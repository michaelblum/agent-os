#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TMPDIR_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-dock-session-pickup.XXXXXX")"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

fake_aos="$TMPDIR_ROOT/aos"
cat >"$fake_aos" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
case "${AOS_FAKE_READY_MODE:-ready}" in
  ready)
    echo "ready=true mode=repo daemon=reachable tap=active"
    ;;
  tcc)
    echo "ready=false blocker=Accessibility permission required"
    exit 1
    ;;
  blocked)
    echo "ready=false blocker=daemon unavailable"
    exit 1
    ;;
esac
SH
chmod +x "$fake_aos"

make_repo() {
  local repo="$1"
  mkdir -p "$repo"
  git -C "$repo" init -q
  git -C "$repo" config user.email "test@example.invalid"
  git -C "$repo" config user.name "Test User"
  mkdir -p "$repo/.docks/harness" "$repo/.docks/gdi/scripts" "$repo/docs/design/work-cards"
  cp "$ROOT/.docks/harness/session-pickup" "$repo/.docks/harness/session-pickup"
  cp "$ROOT/.docks/gdi/scripts/pickup" "$repo/.docks/gdi/scripts/pickup"
  cat >"$repo/docs/design/work-cards/example-v0.md" <<'MD'
# Example Work Card

## Recipient

GDI

## Transfer Kind

GDI round

## Branch / Base

- required_start_ref: `main`
- expected_output_branch: `gdi/example-v0`
MD
  git -C "$repo" add .docks/harness/session-pickup .docks/gdi/scripts/pickup docs/design/work-cards/example-v0.md
  git -C "$repo" commit -qm "seed"
}

repo="$TMPDIR_ROOT/repo"
make_repo "$repo"
start_sha="$(git -C "$repo" rev-parse HEAD)"

out="$(cd "$repo" && AOS_DOCK_PICKUP_AOS_BIN="$fake_aos" .docks/gdi/scripts/pickup --card docs/design/work-cards/example-v0.md --start-ref "$start_sha" --output-branch gdi/example-v0 --json)"
python3 - "$out" "$repo" "$start_sha" <<'PY'
import json
import pathlib
import sys

payload = json.loads(sys.argv[1])
repo = pathlib.Path(sys.argv[2]).resolve()
start_sha = sys.argv[3]
if payload["record_type"] != "aos.dock_session_pickup":
    raise SystemExit(f"FAIL: record type mismatch: {payload}")
if payload["schema_version"] != "2026-05-dock-session-pickup-v0":
    raise SystemExit(f"FAIL: schema version mismatch: {payload}")
if payload["dock"] != "gdi" or payload["provider"] != "codex":
    raise SystemExit(f"FAIL: dock/provider mismatch: {payload}")
if pathlib.Path(payload["repo_root"]).resolve() != repo:
    raise SystemExit(f"FAIL: repo root mismatch: {payload['repo_root']}")
if payload["next_action"] != "proceed":
    raise SystemExit(f"FAIL: expected proceed: {payload}")
if payload["output_branch"]["action"] != "created_from_start_ref":
    raise SystemExit(f"FAIL: expected branch creation: {payload['output_branch']}")
if payload["worktree"]["branch"] != "gdi/example-v0":
    raise SystemExit(f"FAIL: expected switched output branch: {payload['worktree']}")
if payload["start_ref"]["sha"] != start_sha:
    raise SystemExit(f"FAIL: start sha mismatch: {payload['start_ref']}")
card = payload["card"]
if not card["exists"] or card["title"] != "Example Work Card":
    raise SystemExit(f"FAIL: card metadata mismatch: {card}")
if card["recipient"] != "GDI" or card["transfer_kind"] != "GDI round":
    raise SystemExit(f"FAIL: card heading metadata mismatch: {card}")
if card["required_start_ref"] != "main" or card["expected_output_branch"] != "gdi/example-v0":
    raise SystemExit(f"FAIL: card list metadata mismatch: {card}")
if payload["readiness"]["status"] != "ready":
    raise SystemExit(f"FAIL: readiness mismatch: {payload['readiness']}")
PY

out="$(cd "$repo" && AOS_DOCK_PICKUP_AOS_BIN="$fake_aos" .docks/gdi/scripts/pickup --card docs/design/work-cards/example-v0.md --start-ref "$start_sha" --output-branch gdi/example-v0 --json)"
python3 - "$out" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
if payload["next_action"] != "proceed":
    raise SystemExit(f"FAIL: existing matching branch should proceed: {payload}")
if payload["output_branch"]["action"] != "switched_existing_at_start_ref":
    raise SystemExit(f"FAIL: existing matching branch should switch: {payload['output_branch']}")
PY

conflict_repo="$TMPDIR_ROOT/conflict"
make_repo "$conflict_repo"
conflict_start="$(git -C "$conflict_repo" rev-parse HEAD)"
git -C "$conflict_repo" switch -c gdi/example-v0 >/dev/null
printf 'change\n' >"$conflict_repo/other.txt"
git -C "$conflict_repo" add other.txt
git -C "$conflict_repo" commit -qm "move branch"
git -C "$conflict_repo" switch main >/dev/null
out="$(cd "$conflict_repo" && AOS_DOCK_PICKUP_AOS_BIN="$fake_aos" .docks/gdi/scripts/pickup --card docs/design/work-cards/example-v0.md --start-ref "$conflict_start" --output-branch gdi/example-v0 --json || true)"
python3 - "$out" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
if payload["next_action"] != "blocked":
    raise SystemExit(f"FAIL: conflicting branch should block: {payload}")
codes = {item["code"] for item in payload["diagnostics"]}
if "output_branch_exists_at_different_sha" not in codes:
    raise SystemExit(f"FAIL: missing conflict diagnostic: {payload['diagnostics']}")
PY

dirty_repo="$TMPDIR_ROOT/dirty"
make_repo "$dirty_repo"
dirty_start="$(git -C "$dirty_repo" rev-parse HEAD)"
printf 'dirty\n' >"$dirty_repo/dirty.txt"
out="$(cd "$dirty_repo" && AOS_DOCK_PICKUP_AOS_BIN="$fake_aos" .docks/gdi/scripts/pickup --card docs/design/work-cards/example-v0.md --start-ref "$dirty_start" --output-branch gdi/example-v0 --json || true)"
python3 - "$out" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
if payload["next_action"] != "blocked":
    raise SystemExit(f"FAIL: dirty worktree should block: {payload}")
if payload["output_branch"]["action"] != "not_attempted":
    raise SystemExit(f"FAIL: dirty worktree must not prepare branch: {payload['output_branch']}")
codes = {item["code"] for item in payload["diagnostics"]}
if "dirty_worktree" not in codes:
    raise SystemExit(f"FAIL: missing dirty diagnostic: {payload['diagnostics']}")
PY

missing_repo="$TMPDIR_ROOT/missing"
make_repo "$missing_repo"
missing_start="$(git -C "$missing_repo" rev-parse HEAD)"
out="$(cd "$missing_repo" && AOS_DOCK_PICKUP_AOS_BIN="$fake_aos" .docks/gdi/scripts/pickup --card docs/design/work-cards/missing.md --start-ref "$missing_start" --output-branch gdi/missing-v0 --json || true)"
python3 - "$out" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
if payload["next_action"] != "misrouted":
    raise SystemExit(f"FAIL: missing work card should be misrouted: {payload}")
codes = {item["code"] for item in payload["diagnostics"]}
if "work_card_missing" not in codes:
    raise SystemExit(f"FAIL: missing work-card diagnostic: {payload['diagnostics']}")
PY

tcc_repo="$TMPDIR_ROOT/tcc"
make_repo "$tcc_repo"
tcc_start="$(git -C "$tcc_repo" rev-parse HEAD)"
out="$(cd "$tcc_repo" && AOS_FAKE_READY_MODE=tcc AOS_DOCK_PICKUP_AOS_BIN="$fake_aos" .docks/gdi/scripts/pickup --card docs/design/work-cards/example-v0.md --start-ref "$tcc_start" --output-branch gdi/tcc-v0 --json || true)"
python3 - "$out" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
if payload["next_action"] != "human_needed":
    raise SystemExit(f"FAIL: TCC readiness should require human: {payload}")
if payload["readiness"]["status"] != "human_needed":
    raise SystemExit(f"FAIL: readiness status mismatch: {payload['readiness']}")
if payload["stall_path"] != ".docks/gdi/scripts/human-needed-tcc-reset":
    raise SystemExit(f"FAIL: stall path mismatch: {payload['stall_path']}")
PY

echo "PASS: dock session pickup emits deterministic JSON and preserves branch safety."

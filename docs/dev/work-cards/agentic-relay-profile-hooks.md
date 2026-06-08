# Work Card: agentic-relay-profile-hooks

## Goal

Implement the agentic_relay profile hook system so that both Implementer and the relay
partner boot into sessions with automatically injected relay context, and so
the active workflow profile is a single machine-readable configured value rather
than prose scattered across multiple files.

## Problem

The `agentic_relay` profile name was hardcoded in the implementer native subagent instructions prose.
Neither session had a structured context block at startup telling them the
current relay state (open branches, conflict risk, main SHA). The relay partner
had no dock contract at all. This caused:

- Relay partner operating from inferred context rather than declared contract
- Implementer completion reports lacking conflict risk signal
- PR rebase conflicts discovered at merge time rather than at branch time
- No sequencing mechanism for dependent work cards

## Deliverables

This work card was implemented by the relay partner (remote session) directly
as a proof-of-concept of the relay workflow itself.

### New files

- `docs/dev/active-profile.json` — single source of truth for active profile
- `the implementer profile-start hook` — Implementer git context
  block hook: emits open branches, conflict risk, main SHA at session start
- `.docks/relay/session metadata` — relay dock profile
- `.docks/relay/AGENTS.md` — relay partner role contract, session start
  protocol, pre-merge checklist, work card authorship rules
- `.docks/relay/hooks/profile/agentic_relay-session-start.sh` — relay
  orientation hook (local sessions only)
- `docs/dev/work-cards/agentic-relay-profile-hooks.md` — this file

### Modified files

- `.docks/foreman/hooks/stop.sh` — reads `docs/dev/active-profile.json`,
  exports `AOS_ACTIVE_WORKFLOW_PROFILE`, fires per-dock profile hooks at
  `hooks/profile/<profile>-<phase>.sh`
- the implementer native subagent instructions — removed hardcoded profile sections; Implementer now reads
  injected relay context block; structured completion report format added

## Verification

Implementer should verify:

```bash
# 1. Schema/lint: active-profile.json is valid JSON
node -e "JSON.parse(require('fs').readFileSync('docs/dev/active-profile.json','utf8'))"

# 2. Hook runner resolves profile correctly
bash -c '
  export AOS_DOCK_REPO_ROOT=$(pwd)
  python3 - docs/dev/active-profile.json docs/dev/workflow-profiles.json <<PY
import json, sys
a = json.load(open(sys.argv[1]))
assert a["active_profile"] == "agentic_relay", f"expected agentic_relay, got {a['active_profile']}"
print("active-profile.json: ok")
PY
'

# 3. Profile hook scripts are executable
[ -x the implementer profile-start hook ] && echo "implementer hook: executable" || echo "implementer hook: NOT executable"
[ -x .docks/relay/hooks/profile/agentic_relay-session-start.sh ] && echo "relay hook: executable" || echo "relay hook: NOT executable"

# 4. Implementer hook emits expected section headers
bash the implementer profile-start hook 2>/dev/null | grep -q 'Relay Context' && echo "implementer hook output: ok" || echo "implementer hook output: missing section"

# 5. Foreman hook runner.sh resolves profile (smoke test — does not require running daemon)
bash -c '
  source .agents/hooks/session-common.sh 2>/dev/null || true
  grep -q "resolve_active_profile" .docks/foreman/hooks/stop.sh && echo "hook-runner: resolve_active_profile present"
  grep -q "AOS_ACTIVE_WORKFLOW_PROFILE" .docks/foreman/hooks/stop.sh && echo "hook-runner: export present"
  grep -q "run_optional_profile_hook" .docks/foreman/hooks/stop.sh && echo "hook-runner: profile hook dispatch present"
'
```

## Git Section

```
profile: agentic_relay
branch: implementer/agentic-relay-profile-hooks
branch_from: main
```

This work card was authored and implemented by the relay partner. Implementer's role
is verification and any fixups, then push back to the same branch.

## Completion Report Format

```
## Completion Report
- profile: agentic_relay
- branch: implementer/agentic-relay-profile-hooks
- head_sha: <git rev-parse HEAD>
- base_sha: <origin/main SHA at branch time>
- files_changed: <n>
- tests_passed: <n>/<n>
- conflict_risk: <none|low|medium>
- open_prs_on_same_files: <none|list>
- relay_action_required: merge
```

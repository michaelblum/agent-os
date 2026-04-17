# Session Communication Layer — Implementation Plan

> **Status note:** This plan started from a gateway/SQLite polling design. The shipped path now uses daemon-native `./aos tell` / `./aos listen`, canonical `session_id` direct inboxes, shared Claude/Codex startup + post-tool hooks, and hook-driven auto-registration. The detailed checkbox steps below are preserved as implementation archaeology and still contain gateway-era snippets; do not use them as the current contract.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cross-session handoff deterministic and enable parallel session coordination via daemon-native messaging.

**Architecture:** Three layers — bootstrap file for reliable cold start, SessionStart hook for identity resolution + daemon registration, and a PostToolUse turn hook that polls `./aos listen` for thin inbound-message notifications.

**Tech Stack:** Bash (hooks), `./aos` CLI, Python3 (JSON parsing in hooks), existing `scripts/handoff` shell script, Claude Code + Codex hook systems.

**Spec:** `docs/superpowers/specs/2026-04-15-session-comm-layer-design.md`

---

## Current Shipped Snapshot

- Canonical peer routing is `./aos tell --session-id <id> ...` plus `./aos listen --session-id <id>`.
- Human-readable names are display metadata and legacy fallback aliases. The durable inbox/channel key is the canonical `session_id`.
- Shared helpers in `.agents/hooks/session-common.sh` resolve session ids, display names, cursor files, bootstrap locations, and runtime-scoped coordination state.
- `.agents/hooks/session-start.sh` auto-registers sessions for both Claude Code and Codex.
- `.agents/hooks/check-messages.sh` refreshes registration and emits thin inbox notifications for both Claude Code and Codex.
- `.agents/hooks/session-stop.sh` exists, but only Claude currently wires it as a Stop hook; Codex intentionally relies on lease refresh rather than explicit unregister-on-exit.
- `scripts/session-name` renames a session without changing its canonical inbox.
- `scripts/parallel-codex` creates paired display/wiki Codex launchers with embedded coordination guidance.
- Verification lives in `tests/session-registration-startup.sh` and `tests/parallel-codex.sh`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `scripts/handoff` | Modify | Write bootstrap payload + launcher and seed the session with `AOS_SESSION_NAME` |
| `scripts/parallel-codex` | Create | Emit paired display/wiki Codex launchers with coordination guidance |
| `scripts/session-name` | Modify | Inspect and rename the current session registration |
| `.agents/hooks/session-common.sh` | Create | Shared identity, cursor, bootstrap, and runtime-state helpers |
| `.agents/hooks/session-start.sh` | Modify | Resolve identity, auto-register with daemon, read bootstrap payload |
| `.agents/hooks/check-messages.sh` | Create | PostToolUse turn hook — thin daemon message notifications via `./aos listen` |
| `.agents/hooks/session-stop.sh` | Create | Shared unregister helper for clean stop flows |
| `.claude/settings.json` | Modify | Wire SessionStart/PostToolUse/Stop hooks to the shared scripts |
| `.codex/hooks.json` | Modify | Wire SessionStart/PostToolUse hooks to the shared scripts |
| `tests/session-registration-startup.sh` | Modify | Verify canonical ids, rename persistence, restore-after-restart, and direct inbox reads |
| `tests/parallel-codex.sh` | Create | Verify paired Codex launcher generation and coordination instructions |

---

> **Historical note:** The remaining task-by-task sections were written before the daemon-native session contract settled. They still reference gateway posting, SQLite polling, and manual registration prompts. Keep them only as an implementation log; for new work, follow the shipped snapshot above plus the companion spec and current source.

### Task 1: Create the turn hook (`check-messages.sh`)

**Files:**
- Create: `.agents/hooks/check-messages.sh`

This is the new component with no dependencies on the other changes. Build it first.

- [ ] **Step 1: Create the hook script**

```bash
#!/bin/bash
# .agents/hooks/check-messages.sh
# PostToolUse hook — thin gateway message check.
# Returns empty (no tokens consumed) or a short notification.

SESSION_NAME="${AOS_SESSION_NAME:-}"

# Fallback: check for a name file written by the agent for manual sessions.
# The hook receives a JSON payload on stdin with session_id.
if [ -z "$SESSION_NAME" ]; then
  # Read stdin into a variable (hook payload)
  HOOK_INPUT=$(cat)
  SESSION_ID=$(echo "$HOOK_INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null || true)
  if [ -n "$SESSION_ID" ]; then
    SESSION_NAME=$(cat "/tmp/aos-session-name-${SESSION_ID}" 2>/dev/null || true)
  fi
fi

[ -z "$SESSION_NAME" ] && exit 0

# Gateway DB location
GATEWAY_DB="$HOME/.config/aos-gateway/gateway.db"
[ -f "$GATEWAY_DB" ] || exit 0

# Read last-seen cursor from state file
STATE_FILE="/tmp/aos-session-cursor-${SESSION_NAME}"
SINCE=$(cat "$STATE_FILE" 2>/dev/null || echo "")

# Safely quote values for SQL (escape single quotes)
SAFE_NAME=$(printf '%s' "$SESSION_NAME" | sed "s/'/''/g")
SAFE_SINCE=$(printf '%s' "$SINCE" | sed "s/'/''/g")

if [ -n "$SINCE" ]; then
  WHERE_CLAUSE="channel = '${SAFE_NAME}' AND id > '${SAFE_SINCE}'"
else
  WHERE_CLAUSE="channel = '${SAFE_NAME}'"
fi

RESULT=$(sqlite3 "$GATEWAY_DB" "
  SELECT id, from_session, substr(payload, 1, 80)
  FROM messages
  WHERE ${WHERE_CLAUSE}
  ORDER BY id ASC
  LIMIT 5;
" 2>/dev/null || true)

[ -z "$RESULT" ] && exit 0

# Update cursor to latest message ID
LATEST=$(echo "$RESULT" | tail -1 | cut -d'|' -f1)
echo "$LATEST" > "$STATE_FILE"

# Count and summarize
COUNT=$(echo "$RESULT" | wc -l | tr -d ' ')
SENDERS=$(echo "$RESULT" | cut -d'|' -f2 | sort -u | tr '\n' ', ' | sed 's/,$//')

echo "## Inbound Messages"
echo "${COUNT} new message(s) from ${SENDERS} on channel '${SESSION_NAME}'."
echo "Use read_stream(channel='${SESSION_NAME}') to read them."
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x .agents/hooks/check-messages.sh`

- [ ] **Step 3: Smoke-test with no session name (should be silent)**

Run: `echo '{}' | bash .agents/hooks/check-messages.sh`
Expected: no output, exit 0.

- [ ] **Step 4: Smoke-test with a session name but no DB (should be silent)**

Run: `AOS_SESSION_NAME="test-nodb" bash .agents/hooks/check-messages.sh < /dev/null`
Expected: no output, exit 0. (Unless gateway DB already exists — then also silent because no messages on channel "test-nodb".)

- [ ] **Step 5: Commit**

```bash
git add .agents/hooks/check-messages.sh
git commit -m "feat(hooks): add check-messages turn hook for gateway polling"
```

---

### Task 2: Register the turn hook in settings

**Files:**
- Modify: `.claude/settings.json`

- [ ] **Step 1: Add PostToolUse hook entry**

In `.claude/settings.json`, add a new `PostToolUse` entry to the `hooks` object. The existing `PreToolUse` block already shows the pattern. Add this as a sibling:

```json
"PostToolUse": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "bash .agents/hooks/check-messages.sh",
        "timeout": 3
      }
    ]
  }
]
```

The full `hooks` object after the edit:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash .agents/hooks/session-start.sh",
            "timeout": 10
          },
          {
            "type": "command",
            "command": "bash .agents/hooks/git-health.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash .agents/hooks/pre-tool-use.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash .agents/hooks/check-messages.sh",
            "timeout": 3
          }
        ]
      }
    ]
  },
  "enableAllProjectMcpServers": true
}
```

- [ ] **Step 2: Validate JSON**

Run: `python3 -c "import json; json.load(open('.claude/settings.json')); print('valid')"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add .claude/settings.json
git commit -m "feat(hooks): register check-messages as PostToolUse hook"
```

---

### Task 3: Extend SessionStart hook for name resolution, registration, and bootstrap

**Files:**
- Modify: `.agents/hooks/session-start.sh`

Three new blocks added at the top of the script, before the existing `echo "--- agent-os session context ---"` line.

- [ ] **Step 1: Add session name resolution block**

Insert after the `AOS=` line (line 6) and before the `echo "--- agent-os session context ---"` line (line 8). This block resolves `AOS_SESSION_NAME` and outputs a nudge if unset:

```bash
# --- Session Communication Layer ---
SESSION_NAME="${AOS_SESSION_NAME:-}"
```

- [ ] **Step 2: Add gateway registration directive block**

Immediately after the name resolution, output a registration directive if a name is known:

```bash
if [ -n "$SESSION_NAME" ]; then
  echo ""
  echo "## Gateway Registration"
  echo "Register this session: name=\"${SESSION_NAME}\" harness=\"claude-code\" role=\"worker\""
  echo "Call register_session(name='${SESSION_NAME}', harness='claude-code', role='worker') now."
else
  echo ""
  echo "## Session Name"
  echo "No AOS_SESSION_NAME set. Name this session early:"
  echo "  Use /rename and then register with the gateway via register_session()."
fi
```

- [ ] **Step 3: Add bootstrap file reading block**

Immediately after the registration block, check for and consume a bootstrap file:

```bash
if [ -n "$SESSION_NAME" ] && [ -f "/tmp/aos-handoff-${SESSION_NAME}.json" ]; then
  BRIEF=$(python3 -c "
import json, sys
d = json.load(open('/tmp/aos-handoff-${SESSION_NAME}.json'))
print(d.get('brief', ''))
" 2>/dev/null || echo "(failed to parse bootstrap file)")
  echo ""
  echo "## Handoff Brief"
  echo "$BRIEF"
  rm -f "/tmp/aos-handoff-${SESSION_NAME}.json"
fi
```

- [ ] **Step 4: Verify the full file looks correct**

Read the modified file end-to-end. The new blocks should appear between the `AOS=` line and the `echo "--- agent-os session context ---"` line. The rest of the file should be untouched.

- [ ] **Step 5: Test with no env var set (nudge path)**

Run: `bash .agents/hooks/session-start.sh 2>/dev/null | head -20`
Expected: output includes `## Session Name` with the nudge text.

- [ ] **Step 6: Test with env var set (registration path)**

Run: `AOS_SESSION_NAME="test-session" bash .agents/hooks/session-start.sh 2>/dev/null | head -20`
Expected: output includes `## Gateway Registration` with `name="test-session"`.

- [ ] **Step 7: Test bootstrap file consumption**

```bash
# Create a test bootstrap file
echo '{"brief":"Test brief content"}' > /tmp/aos-handoff-test-session.json
AOS_SESSION_NAME="test-session" bash .agents/hooks/session-start.sh 2>/dev/null | head -30
# Verify the file was consumed
ls /tmp/aos-handoff-test-session.json 2>/dev/null && echo "NOT CONSUMED" || echo "CONSUMED OK"
```

Expected: output includes `## Handoff Brief` with `Test brief content`, and file is consumed.

- [ ] **Step 8: Commit**

```bash
git add .agents/hooks/session-start.sh
git commit -m "feat(hooks): session name resolution, gateway registration, bootstrap reading"
```

---

### Task 4: Update `scripts/handoff` for deterministic bootstrap

**Files:**
- Modify: `scripts/handoff`

Three changes: (a) add `AOS_SESSION_NAME` export to launcher, (b) change seed prompt, (c) also post to session's named channel.

- [ ] **Step 1: Add `AOS_SESSION_NAME` export to the launcher script**

In the launcher heredoc (around line 144), change from:

```bash
cat > "$LAUNCHER" << LAUNCHEOF
#!/bin/bash
cd "$ROOT"
exec $CLAUDE_CMD
LAUNCHEOF
```

To:

```bash
cat > "$LAUNCHER" << LAUNCHEOF
#!/bin/bash
cd "$ROOT"
export AOS_SESSION_NAME="$TO"
exec $CLAUDE_CMD
LAUNCHEOF
```

- [ ] **Step 2: Change the seed prompt**

Change line 117 from:

```bash
SEED="Read the gateway handoff channel for the brief from ${FROM}. ${TASK}"
```

To:

```bash
SEED="Bootstrap: /tmp/aos-handoff-${TO}.json"
```

The session-start hook will read this file automatically. The seed prompt is now just a pointer — not an instruction that the agent may misinterpret.

- [ ] **Step 3: Add instruction to post to session's named channel**

Change the final output section (around line 154-161). Replace:

```bash
echo "Handoff ready."
echo ""
echo "  Gateway payload: ${PAYLOAD_FILE}"
echo "  Launcher:        ${LAUNCHER}"
echo "  Clipboard:       bash ${LAUNCHER}"
echo ""
echo "  Post the payload to the gateway handoff channel, then paste to launch."
```

With:

```bash
echo "Handoff ready."
echo ""
echo "  Gateway payload: ${PAYLOAD_FILE}"
echo "  Launcher:        ${LAUNCHER}"
echo "  Clipboard:       bash ${LAUNCHER}"
echo ""
echo "  Post the payload to BOTH channels:"
echo "    1. post_message(channel='handoff', payload=<brief>, from='${FROM}')"
echo "    2. post_message(channel='${TO}', payload=<brief>, from='${FROM}')"
echo "  Then paste the clipboard command in a new terminal to launch."
```

Posting to the session's named channel (`$TO`) ensures the turn hook can detect the handoff if the target session is already running (resume case).

- [ ] **Step 4: Test with --dry-run**

Run:
```bash
bash scripts/handoff --to test-verify --from test-impl --task "Run integration test" --dry-run
```

Expected output should show:
- `AOS_SESSION_NAME="test-verify"` in the launcher section
- Seed prompt: `Bootstrap: /tmp/aos-handoff-test-verify.json`
- Instructions to post to both `handoff` and `test-verify` channels

- [ ] **Step 5: Commit**

```bash
git add scripts/handoff
git commit -m "feat(handoff): deterministic bootstrap with AOS_SESSION_NAME and dual-channel posting"
```

---

### Task 5: End-to-end verification

No new files. This task validates the full flow.

- [ ] **Step 1: Run the handoff script to generate artifacts**

```bash
bash scripts/handoff --to e2e-test --from plan-session --task "Verify comm layer" --context "End-to-end test of the session communication layer."
```

Verify: `/tmp/aos-handoff-e2e-test.json` exists, `/tmp/aos-handoff-e2e-test` launcher exists, launcher contains `export AOS_SESSION_NAME="e2e-test"`.

- [ ] **Step 2: Verify session-start hook reads bootstrap**

```bash
AOS_SESSION_NAME="e2e-test" bash .agents/hooks/session-start.sh 2>/dev/null | grep -A2 "Handoff Brief"
```

Expected: `## Handoff Brief` followed by the brief content. File should be consumed afterward.

- [ ] **Step 3: Verify turn hook is silent when no messages**

```bash
echo '{"session_id":"test123"}' | AOS_SESSION_NAME="e2e-test" bash .agents/hooks/check-messages.sh
```

Expected: no output (no messages on channel "e2e-test").

- [ ] **Step 4: Post a test message via gateway and verify turn hook detects it**

In a Claude Code session with gateway access:
```
post_message(channel="e2e-test", payload="hello from plan-session", from="plan-session")
```

Then run:
```bash
echo '{}' | AOS_SESSION_NAME="e2e-test" bash .agents/hooks/check-messages.sh
```

Expected: `## Inbound Messages` with `1 new message(s) from plan-session`.

- [ ] **Step 5: Verify cursor — second run should be silent**

```bash
echo '{}' | AOS_SESSION_NAME="e2e-test" bash .agents/hooks/check-messages.sh
```

Expected: no output (cursor was advanced past the message).

- [ ] **Step 6: Clean up test artifacts**

```bash
rm -f /tmp/aos-handoff-e2e-test.json /tmp/aos-handoff-e2e-test /tmp/aos-session-cursor-e2e-test
```

- [ ] **Step 7: Final commit (if any fixups were needed)**

```bash
git add -A
git commit -m "fix(comm-layer): fixups from end-to-end verification"
```

Skip this step if no fixups were needed.

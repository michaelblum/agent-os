# Session Communication Layer — Design Spec

**Date:** 2026-04-15
**Branch:** canvas-lifecycle-brainstorm (will move to own branch for implementation)
**Scope:** Claude Code only. Codex will self-scaffold its own hooks later, sharing the gateway protocol.

## Problem

Cross-session handoff is fragile. The current `scripts/handoff` posts a brief to the gateway and generates a seed prompt that says "read the gateway handoff channel." The new session has to figure out which MCP tool to call, with what args, on what channel. This is prompt-hope — it works sometimes, fails silently other times.

Parallel sessions have no way to coordinate. The gateway message bus exists but nothing checks it automatically. Sessions can't talk to each other unless an agent remembers to poll.

## Design

Three components, layered:

```
┌─────────────────────────────────────────────┐
│  scripts/handoff  (orchestration script)     │
│  Writes bootstrap file + posts to gateway    │
│  Generates launcher with AOS_SESSION_NAME    │
├─────────────────────────────────────────────┤
│  SessionStart hook  (cold start)             │
│  Reads AOS_SESSION_NAME or prompts agent     │
│  Registers with gateway                      │
│  Reads bootstrap file if present             │
├─────────────────────────────────────────────┤
│  Turn hook  (ongoing, lightweight)           │
│  Checks gateway for inbound messages         │
│  Thin notification only — no full injection  │
└─────────────────────────────────────────────┘
```

### 1. Bootstrap File

Written by `scripts/handoff` to `/tmp/aos-handoff-<session-name>.json`.

```json
{
  "version": 1,
  "type": "session_handoff",
  "from": "lifecycle-impl",
  "to": "verify-lifecycle",
  "task": "Run Task 8: integration test",
  "brief": "## Handoff: lifecycle-impl -> verify-lifecycle\n\n...",
  "gateway": {
    "channel": "handoff",
    "message_id": "01KP8XC5..."
  }
}
```

- `brief` is self-contained — everything the new session needs to start work.
- `gateway` block is a back-pointer for ACK/reply. Optional for the session to use.
- File is consumed (deleted) after the SessionStart hook reads it.

### 2. Launcher Script

Written by `scripts/handoff` to `/tmp/aos-handoff-<session-name>`.

```bash
#!/bin/bash
cd /Users/Michael/Code/agent-os
export AOS_SESSION_NAME="verify-lifecycle"
exec claude -n "verify-lifecycle" "Bootstrap: /tmp/aos-handoff-verify-lifecycle.json"
```

Key: `AOS_SESSION_NAME` env var is set before `claude` launches. All hooks in that process tree inherit it.

Clipboard gets: `bash /tmp/aos-handoff-verify-lifecycle`

HITL: open terminal, paste, press return.

### 3. SessionStart Hook Changes

Extend `.agents/hooks/session-start.sh` to add three steps at the top, before existing context output:

#### 3a. Resolve session name

```bash
SESSION_NAME="${AOS_SESSION_NAME:-}"
```

If set (handoff-launched): use it.
If unset (manual session): output a nudge:

```
## Session Name
No AOS_SESSION_NAME set. Name this session early:
  Use /rename and then tell the agent to register with the gateway.
```

#### 3b. Register with gateway

If session name is known, the hook outputs a directive telling the agent to register:

```
## Gateway Registration
Register this session: name="verify-lifecycle" harness="claude-code" role="worker"
```

The actual `register_session` MCP call must be made by the agent (hooks can't call MCP). The hook's job is to make the instruction unambiguous.

#### 3c. Read bootstrap file

If `/tmp/aos-handoff-<session-name>.json` exists:

```bash
if [ -n "$SESSION_NAME" ] && [ -f "/tmp/aos-handoff-${SESSION_NAME}.json" ]; then
  BRIEF=$(python3 -c "
import json, sys
d = json.load(open('/tmp/aos-handoff-${SESSION_NAME}.json'))
print(d.get('brief', ''))
")
  echo ""
  echo "## Handoff Brief"
  echo "$BRIEF"
  rm "/tmp/aos-handoff-${SESSION_NAME}.json"
fi
```

The brief lands in context as a system reminder. No prompt-hope. No MCP call needed for cold start.

### 4. Turn Hook (New)

A new hook on `PreToolUse` (or `PostToolUse`) that fires on every tool call.

**Location:** `.agents/hooks/check-messages.sh`

**Hook config addition to `.claude/settings.json`:**

```json
{
  "event": "PostToolUse",
  "command": "bash .agents/hooks/check-messages.sh",
  "timeout": 3000
}
```

**Logic:**

```bash
#!/bin/bash
# Thin gateway message check. Returns empty (free) or one-line notification.
SESSION_NAME="${AOS_SESSION_NAME:-}"
[ -z "$SESSION_NAME" ] && exit 0

ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
AOS="$ROOT/aos"

# Check for messages addressed to this session
# Uses the gateway DB directly for speed (no MCP round-trip)
GATEWAY_DB="$HOME/.config/aos-gateway/gateway.db"
[ -f "$GATEWAY_DB" ] || exit 0

# Read last-seen cursor from state file
STATE_FILE="/tmp/aos-session-cursor-${SESSION_NAME}"
SINCE=$(cat "$STATE_FILE" 2>/dev/null || echo "")

# Query for new messages on the session's named channel
# Use printf to safely quote the session name (no SQL injection from env)
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

**Key design decisions:**

- **Direct SQLite read** instead of MCP call — hooks can't call MCP tools, and shelling out to the gateway would be slow. SQLite WAL mode supports concurrent readers safely.
- **Per-session channel convention**: messages TO a session go on a channel named after that session. `post_message(channel="verify-lifecycle", ...)` reaches the verify-lifecycle session.
- **Cursor file** at `/tmp/aos-session-cursor-<name>` tracks last-seen message ID. Only new messages trigger notifications.
- **Empty output = free** — no tokens consumed when no messages waiting.
- **Thin notification** — just count + senders + instruction to pull. Agent decides when to engage.

### 5. Message Addressing Convention

Current gateway uses free-form channel names. This design establishes a convention:

| Channel | Purpose |
|---------|---------|
| `handoff` | Broadcast handoff briefs (existing) |
| `<session-name>` | Direct messages to a specific session |

A session sending a message to another session uses:
```
post_message(channel="verify-lifecycle", payload={...}, from="lifecycle-impl")
```

The receiving session's turn hook picks it up automatically.

### 6. Manual Session Flow

Sessions not launched via handoff:

1. SessionStart hook sees no `AOS_SESSION_NAME`. Outputs nudge.
2. Agent names itself (or user does via `/rename`).
3. Agent calls `register_session(name=..., harness="claude-code", role="...")`.
4. Agent sets its own env: not possible mid-process. **Workaround**: agent writes name to `/tmp/aos-session-name-<session_id>`. Turn hook reads this file as fallback when `AOS_SESSION_NAME` is unset, using `session_id` from stdin JSON.

```bash
# In check-messages.sh, resolve name:
SESSION_NAME="${AOS_SESSION_NAME:-}"
if [ -z "$SESSION_NAME" ]; then
  SESSION_ID=$(cat /dev/stdin | python3 -c "import json,sys; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null || true)
  if [ -n "$SESSION_ID" ]; then
    SESSION_NAME=$(cat "/tmp/aos-session-name-${SESSION_ID}" 2>/dev/null || true)
  fi
fi
[ -z "$SESSION_NAME" ] && exit 0
```

The agent writes this file once after naming:
```bash
echo "lifecycle-impl" > /tmp/aos-session-name-<session_id>
```

### 7. scripts/handoff Changes

Minimal changes to existing script:

- Add `AOS_SESSION_NAME` export to the launcher script (already partially there)
- Seed prompt changes from `"Read the gateway handoff channel..."` to `"Bootstrap: /tmp/aos-handoff-<name>.json"`
- Also post to the session's named channel (not just `handoff`) so the turn hook can detect it if the session is already running (resume case)
- Add `--resume` flag support: uses `claude --resume` and posts to named channel instead of writing bootstrap file

### 8. What HITL Does

**Sequential handoff (A finishes, B starts):**
1. Session A runs handoff script
2. Session A posts to gateway
3. HITL opens terminal, pastes, presses return

**Parallel coordination (A and B both running):**
1. Session A posts message to B's channel: `post_message(channel="session-b", ...)`
2. B's turn hook picks it up on next tool call
3. B reads full message when ready
4. B replies to A's channel

**Cross-runtime (Claude Code <-> Codex):**
1. HITL informs the session: "the other session is Codex, not Claude Code"
2. Gateway protocol is the same — both runtimes can read/write messages
3. Bootstrap file format is the same — Codex reads it via its own mechanism

## Non-Goals

- **Automatic session discovery**: Sessions must be explicitly named and registered. No magic.
- **Guaranteed delivery**: Best-effort via turn hook polling. If a session isn't checking, messages queue.
- **Codex hook implementation**: Codex will scaffold its own hooks using this same gateway protocol.
- **Message encryption or auth**: Internal to one machine, one user. Trust the filesystem.

## File Changes Summary

| File | Change |
|------|--------|
| `scripts/handoff` | Add `AOS_SESSION_NAME` to launcher, new seed prompt, post to named channel |
| `.agents/hooks/session-start.sh` | Add name resolution, gateway registration directive, bootstrap file reading |
| `.agents/hooks/check-messages.sh` | New file — turn hook for thin message notifications |
| `.claude/settings.json` | Add PostToolUse hook entry for check-messages.sh |

## Open Questions

None — scope is tight. Codex adaptation is explicitly deferred to a Codex agent session.

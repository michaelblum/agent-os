# Session Communication Layer — Design Spec

**Date:** 2026-04-15
**Status:** Shipped in the shared session hooks and daemon-native `aos tell` / `aos listen` flow. The bootstrap launcher helper still emits a Claude-specific command, but the session identity and messaging contract is shared across Claude Code and Codex.

## Current Shipped Snapshot

- Shared identity and routing helpers live in `.agents/hooks/session-common.sh`.
- Startup registration and inbound-message polling are wired in both `.claude/settings.json` and `.codex/hooks.json`.
- Clean stop unregistering is currently Claude-specific via `.agents/hooks/session-stop.sh`; Codex intentionally omits a stop hook and relies on lease refresh plus startup/post-tool registration.
- `scripts/session-name` renames human-readable display metadata while keeping the canonical inbox/channel on `session_id`.
- `scripts/parallel-codex` creates paired display/wiki Codex launchers with embedded coordination guidance and clipboard priming.

## Problem

Before this design shipped, cross-session handoff was fragile. The launcher prompt told the receiving session to go find a brief on the coordination bus, which meant the new session still had to discover the right tool and channel by inference. This was prompt-hope — it worked sometimes, failed silently other times.

Parallel sessions also relied on manual polling. The coordination bus existed, but nothing checked it automatically and direct session routing was not yet the default path.

## Design

Three components, layered:

```
┌─────────────────────────────────────────────┐
│  scripts/handoff  (orchestration script)     │
│  Writes bootstrap file + posts via aos tell  │
│  Generates launcher with AOS_SESSION_NAME    │
├─────────────────────────────────────────────┤
│  SessionStart hook  (cold start)             │
│  Resolves session_id / display name          │
│  Registers with daemon coordination bus      │
│  Reads bootstrap file if present             │
├─────────────────────────────────────────────┤
│  Turn hook  (ongoing, lightweight)           │
│  Checks direct inbox / channels via listen   │
│  Thin notification only — no full injection  │
└─────────────────────────────────────────────┘
```

### 1. Bootstrap File

Written by `scripts/handoff` to `/tmp/aos-handoff-<session-name>.json`.

```json
{
  "type": "session_handoff",
  "from": "lifecycle-impl",
  "to": "verify-lifecycle",
  "task": "Run Task 8: integration test",
  "brief": "## Handoff: lifecycle-impl -> verify-lifecycle\n\n..."
}
```

- `brief` is self-contained — everything the new session needs to start work.
- File is consumed (deleted) after the SessionStart hook reads it.

### 2. Launcher Script

Written by `scripts/handoff` to `/tmp/aos-handoff-<session-name>`.

```bash
#!/bin/bash
cd /Users/Michael/Code/agent-os
export AOS_SESSION_NAME="verify-lifecycle"
exec claude -n "verify-lifecycle" "Bootstrap: /tmp/aos-handoff-verify-lifecycle.json"
```

Key: `AOS_SESSION_NAME` env var is set before `claude` launches. All hooks in that process tree inherit it. Current helper output is Claude-oriented because `scripts/handoff` launches a new Claude Code session today; the shared hook contract itself is not Claude-specific.

Clipboard gets: `bash /tmp/aos-handoff-verify-lifecycle`

HITL: open terminal, paste, press return.

### 3. SessionStart Hook Changes

Extend `.agents/hooks/session-start.sh` to add three steps at the top, before existing context output:

#### 3a. Resolve session identity

```bash
SESSION_ID="$(aos_resolve_session_id "$HOOK_INPUT")"
SESSION_HARNESS="$(aos_detect_harness)"
SESSION_NAME="$(aos_resolve_session_name "$SESSION_ID" "$SESSION_HARNESS")"
SESSION_CHANNEL="$(aos_session_channel "$SESSION_ID" "$SESSION_NAME")"
```

If handoff-launched, `AOS_SESSION_NAME` seeds the human-readable name. If manual, the hook still resolves a canonical `session_id` from provider input and generates a fallback display name such as `codex-019d985f-deb`.

```
## Session Identity
name=wiki-focus harness=codex session_id=019d985f-deb8-7883-ba34-ba89aa402dc8 channel=019d985f-deb8-7883-ba34-ba89aa402dc8 source=env registered=ok
Rename later with: scripts/session-name --name <meaningful-name>
```

#### 3b. Register with the daemon coordination bus

If `./aos` is available and the hook resolved a name, it registers automatically:

```bash
if [[ -n "$SESSION_ID" ]]; then
  "$AOS" tell --register --session-id "$SESSION_ID" --name "$SESSION_NAME" --role worker --harness "$SESSION_HARNESS"
else
  "$AOS" tell --register "$SESSION_NAME" --role worker --harness "$SESSION_HARNESS"
fi
```

No MCP round-trip. The CLI is the registration surface.

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

### 4. Turn Hook

A new hook on `PostToolUse` that fires on every tool call.

**Location:** `.agents/hooks/check-messages.sh`

**Hook config:** provider-specific hook configuration points at the shared script. Today that includes `.claude/settings.json` and `.codex/hooks.json`.

```json
{
  "event": "PostToolUse",
  "command": "bash .agents/hooks/check-messages.sh",
  "timeout": 3000
}
```

Startup + message polling are shared across Claude Code and Codex. Stop-time unregistering is only wired in `.claude/settings.json` today:

```json
{
  "event": "Stop",
  "command": "AOS_SESSION_HARNESS=claude-code bash .agents/hooks/session-stop.sh",
  "timeout": 5000
}
```

Codex intentionally does not call `session-stop.sh` on exit; the current contract is lease-based presence with re-registration on startup and during post-tool refresh.

**Logic:**

```bash
#!/bin/bash
# Thin daemon message check. Returns empty (free) or a short notification.
source "$(dirname "$0")/session-common.sh"

SESSION_ID="$(aos_resolve_session_id "$HOOK_INPUT")"
SESSION_HARNESS="$(aos_detect_harness)"
SESSION_NAME="$(aos_resolve_session_name "$SESSION_ID" "$SESSION_HARNESS")"
SESSION_CHANNEL="$(aos_session_channel "$SESSION_ID" "$SESSION_NAME")"
[ -z "$SESSION_CHANNEL" ] && exit 0

STATE_FILE="$(aos_session_cursor_file "$SESSION_CHANNEL")"
SINCE="$(cat "$STATE_FILE" 2>/dev/null || echo "")"

if [[ -n "$SESSION_ID" ]]; then
  LISTEN_ARGS=(listen --session-id "$SESSION_ID" --limit 5)
else
  LISTEN_ARGS=(listen "$SESSION_NAME" --limit 5)
fi
if [ -n "$SINCE" ]; then
  LISTEN_ARGS+=(--since "$SINCE")
fi

LISTEN_JSON="$("$AOS" "${LISTEN_ARGS[@]}" 2>/dev/null || true)"
[ -z "$LISTEN_JSON" ] && exit 0

# Parse count / senders / latest id, then update cursor
echo "## Inbound Messages"
echo "${COUNT} new message(s) from ${SENDERS} on session '${SESSION_NAME}' (${SESSION_ID})."
echo "Use ./aos listen --session-id ${SESSION_ID} to read them."
```

**Key design decisions:**

- **Use `./aos listen`** instead of gateway DB reads or MCP calls. The daemon is the source of truth.
- **Canonical direct inbox**: messages TO a session should target the canonical `session_id` when available. Human-readable names remain metadata and a legacy fallback.
- **Cursor file** lives under runtime-scoped session state (`~/.config/aos/{mode}/coordination/session-state/cursor-<session-key>`). Only new messages trigger notifications.
- **Empty output = free** — no tokens consumed when no messages waiting.
- **Thin notification** — just count + senders + instruction to pull. Agent decides when to engage.

### 5. Message Addressing Convention

Current coordination uses daemon channels plus direct session routing. This design establishes a convention:

| Channel | Purpose |
|---------|---------|
| `handoff` | Broadcast handoff briefs (existing) |
| `<canonical-session-id>` | Direct messages to a specific live session |
| `<session-name>` | Human-readable alias / legacy fallback only |

A session sending a message to another session uses:
```
./aos tell --session-id 019d985f-deb8-7883-ba34-ba89aa402dc8 "ready for review"
```

The receiving session's turn hook picks it up automatically.

### 6. Manual Session Flow

Sessions not launched via handoff:

1. SessionStart hook resolves `session_id` from hook input or thread metadata.
2. Hook generates a fallback display name if no `AOS_SESSION_NAME` exists.
3. Hook auto-registers with `./aos tell --register ...`.
4. Agent or operator can rename later with `scripts/session-name --name <meaningful-name>`.
5. Turn hook keeps listening on the canonical `session_id` inbox; the renamed value is display metadata and fallback aliasing.

```bash
# Inspect current resolved identity
scripts/session-name --current

# Rename current session after the task becomes clear
scripts/session-name --name lifecycle-impl
```

### 7. scripts/handoff Changes

Minimal changes to existing script:

- Add `AOS_SESSION_NAME` export to the launcher script (already partially there)
- Seed prompt changes from `"Read the gateway handoff channel..."` to `"Bootstrap: /tmp/aos-handoff-<name>.json"`
- Keep bootstrap files keyed by human-readable name for launch ergonomics
- `--resume` support stays launcher-level; ongoing peer-to-peer coordination should switch to `./aos tell --session-id <peer_session_id>` after discovery via `./aos tell --who`
- `scripts/parallel-codex` builds a paired launcher set for display/wiki parallel sessions and primes the clipboard with the peer launcher command

### 8. What HITL Does

**Sequential handoff (A finishes, B starts):**
1. Session A runs handoff script
2. Session A writes bootstrap file and posts the brief to `handoff` via `./aos tell`
3. HITL opens terminal, pastes, presses return

**Parallel coordination (A and B both running):**
1. Session A discovers B via `./aos tell --who`
2. Session A posts directly: `./aos tell --session-id <session-b-id> "..."`
3. B's turn hook picks it up on next tool call
4. B reads full message when ready
5. B replies with `./aos tell --session-id <session-a-id> "..."`

**Cross-runtime (Claude Code <-> Codex):**
1. HITL informs the session: "the other session is Codex, not Claude Code"
2. Daemon protocol is the same — both runtimes can read/write messages through `./aos tell` / `./aos listen`
3. Bootstrap file format is the same — both runtimes enter through the shared session hooks

## Non-Goals

- **Automatic session discovery**: Sessions must be explicitly named and registered. No magic.
- **Guaranteed delivery**: Best-effort via turn hook polling. If a session isn't checking, messages queue.
- **Harness-specific launcher generation**: `scripts/handoff` still emits a Claude launcher instead of auto-selecting a target harness.
- **Message encryption or auth**: Internal to one machine, one user. Trust the filesystem.

## File Changes Summary

| File | Change |
|------|--------|
| `scripts/handoff` | Add `AOS_SESSION_NAME` to launcher, new seed prompt, post to `handoff` |
| `scripts/parallel-codex` | Create paired Codex launchers with embedded coordination guidance |
| `scripts/session-name` | Inspect and rename the current session registration while preserving canonical `session_id` routing |
| `.agents/hooks/session-common.sh` | Shared identity, naming, cursor, and bootstrap helpers |
| `.agents/hooks/session-start.sh` | Add identity resolution, daemon registration, bootstrap file reading |
| `.agents/hooks/check-messages.sh` | New file — turn hook for thin message notifications |
| `.agents/hooks/session-stop.sh` | Shared unregister helper used by Claude stop hooks |
| `.claude/settings.json` | Wire SessionStart/PostToolUse/Stop hooks to the shared scripts |
| `.codex/hooks.json` | Wire SessionStart/PostToolUse hooks to the shared scripts |
| `tests/session-registration-startup.sh` | Verify canonical session ids, rename persistence, restore-after-restart, and direct inbox reads |
| `tests/parallel-codex.sh` | Verify paired launcher generation and coordination guidance |

## Open Questions

None for the shared session contract. The remaining future work is harness-aware launcher generation, not Codex hook support.

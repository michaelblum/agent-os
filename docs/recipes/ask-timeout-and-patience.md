# Recipe: Ask Timeout and Patience

How to handle human response delays in agent→human confirmation flows.

## The capability

`agent_ask` has an optional `--timeout SECONDS` flag. On timeout it returns exit 1, the question stays live on the overlay, and the user can still answer later.

```bash
# With explicit timeout
response=$(agent_ask --timeout 60 "Which file?" "src/main.ts" "src/index.ts")

# With env var default
export AGENT_ASK_TIMEOUT=90
response=$(agent_ask "Which file?" "src/main.ts" "src/index.ts")

# No timeout (blocks forever) — omit both
response=$(agent_ask "Which file?" "src/main.ts" "src/index.ts")
```

## The principle

**The agent should never give up on the human.** A timeout means "stop blocking," not "stop caring." The question stays visible on the overlay. The user might be thinking, in the bathroom, on another display, or making coffee. All of those are fine.

**The agent should also never be stuck.** If there's other work to do, do it. Come back to the unanswered question when the work is done or when the answer arrives.

## Patterns

### 1. Wait patiently, re-chime on timeout

Best for: critical confirmations where the agent can't proceed without approval.

```bash
while true; do
  if response=$(agent_ask --timeout 60 "Deploy to production?" "Yes" "No"); then
    break  # got an answer
  fi
  # Timed out — re-chime, stay patient
  afplay "$CHIME" &
  agent_log "Still waiting for deploy confirmation..." "warn"
done
```

### 2. Do other work, check back

Best for: non-blocking questions where the agent has a backlog.

```bash
# Ask without blocking
_agent_send "$(python3 -c "...")"  # send AskUserQuestion
afplay "$CHIME"

# Do other work
agent_status "Working on task B while you decide..."
do_task_b

# Now check if they answered
event=$(tr -d '\000' < "$EVENTS_FILE" 2>/dev/null | grep '"type":"response"' | tail -1)
if [[ -n "$event" ]]; then
  # They answered while we were working
  value=$(echo "$event" | python3 -c "...")
else
  # They haven't answered yet — now block
  value=$(agent_ask --timeout 120 "Still need your input on..." "Option A" "Option B")
fi
```

### 3. Proceed with safe default, report what you chose

Best for: low-stakes choices where any option is recoverable.

```bash
if response=$(agent_ask --timeout 30 "Naming convention?" "camelCase" "snake_case"); then
  style="$response"
else
  style="camelCase"
  agent_say "No response — going with **camelCase**. Change it anytime."
fi
```

### 4. Escalate the channel

Best for: when the user might not be looking at the overlay display.

```bash
if ! agent_ask --timeout 45 "Approve?" "Yes" "No" > /dev/null; then
  # Try TTS — maybe they're not looking at this display
  say -v "Ava (Premium)" "Hey Michael, I need your approval on something."
  # Try again with a longer window
  if ! response=$(agent_ask --timeout 120 "Approve?" "Yes" "No"); then
    agent_say "I'll park this and move on. Come find me when you're ready."
  fi
fi
```

## Anti-patterns

- **Don't give up silently.** If you stop waiting, tell the user.
- **Don't spam re-chimes.** Once on timeout is fine. Every 10 seconds is annoying.
- **Don't assume "no response" means "no."** It means "not here right now."
- **Don't make irreversible choices on timeout.** If the action is destructive, wait or park.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `AGENT_ASK_TIMEOUT` | 0 (infinite) | Default timeout for all `agent_ask` calls |
| `--timeout N` | overrides env var | Per-call timeout in seconds |

Exit codes: 0 = answered, 1 = timed out.

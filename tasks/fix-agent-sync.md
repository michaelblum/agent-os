# Task: Fix `~/.codex/config.toml` and `scripts/agent-sync.sh`

## Context

This repo is `agent-os` — an open-source agentic orchestration platform for Codex CLI.
You are working in `~/Code/agent-os`.

The global Codex config at `~/.codex/config.toml` is broken and Codex refuses to start:

```
Error loading config.toml:
/Users/Michael/.codex/config.toml:107:13: unclosed table, expected `]`
    |
107 | ["Architect", "Planner", "Design Lead"]
    |             ^
```

## Root cause

`scripts/agent-sync.sh` has a Python regex substitution that patches existing
`[agents.*]` blocks in `~/.codex/config.toml`. When an agent block already
exists, it uses `re.sub()` to replace it. The old hand-written config had
`nickname_candidates` on its own line (not as `key = value`), and the regex
replacement ran multiple times, leaving orphaned bare array literals like:

```toml
["Architect", "Planner", "Design Lead"]
config_file = "/Users/Michael/.codex/agents/architect.toml"
["Architect", "Planner", "Design Lead"]
config_file = "/Users/Michael/Code/subagent-smoke/.codex/agents/architect.toml"
```

These are not valid TOML and cause a parse failure on startup.

## Agent TOML structure

Each file at `ai-agents/providers/codex/<name>.toml` looks like this:

```toml
name        = "architect"
description = "..."
nickname_candidates = ["Architect", "Planner", "Design Lead"]

[model]
name   = "gpt-5.5"
effort = "high"

[sandbox]
mode = "read-only"

[behavior]
...
```

The 7 agents are: `architect`, `explorer`, `implementer`, `operator`,
`reviewer`, `steward`, `validator`.

## What a correct `[agents.*]` block looks like in `~/.codex/config.toml`

```toml
[agents.architect]
description         = "System design, decomposition, interface contracts, tradeoff analysis, and RFC-style planning. Dispatch first for any new feature or major refactor."
nickname_candidates = ["Architect", "Planner", "Design Lead"]
config_file         = "/Users/Michael/.codex/agents/architect.toml"
```

Rules:
- `nickname_candidates` MUST be a single-line inline array on the same line as the key
- `config_file` MUST point to `~/.codex/agents/<name>.toml` (not any subagent-smoke path)
- No other fields are needed in the global config block

## Step-by-step work

### Step 1 — Read and validate the current broken state

Read `~/.codex/config.toml`. Confirm the broken lines are present.
Note the line number where the first `[agents.` block begins — everything
from that line to end of file will be replaced.

### Step 2 — Clean the config

Keep everything ABOVE the first `[agents.` line verbatim.
Discard everything from the first `[agents.` line to end of file.
Write the cleaned content back.

Verify the cleaned file ends with a blank line and no orphaned array literals.

### Step 3 — Read all 7 source TOMLs

For each file in `ai-agents/providers/codex/*.toml`:
- Parse `name`, `description`, `nickname_candidates` from top-level keys
- Do NOT read keys from inside `[model]`, `[sandbox]`, or `[behavior]` sections
  as top-level values — track the current section header and scope reads accordingly
- Build the correct `[agents.<name>]` block as shown above

### Step 4 — Append all 7 blocks to `~/.codex/config.toml`

Append a blank line then all 7 blocks, each separated by a blank line.

### Step 5 — Validate

Run:
```bash
python3 -c "import pathlib; exec(open('/dev/stdin').read())" <<'EOF'
try:
    import tomllib
except ImportError:
    import re
    # minimal check: no bare array lines
    raw = pathlib.Path('/Users/Michael/.codex/config.toml').read_text()
    bad = [l for l in raw.splitlines() if l.strip().startswith('["')]
    if bad:
        print('FAIL - orphaned lines:', bad)
    else:
        print('OK - no orphaned array literals found')
else:
    raw = open('/Users/Michael/.codex/config.toml','rb').read()
    tomllib.loads(raw.decode())
    print('OK - valid TOML')
EOF
```

If validation fails, do not stop — diagnose and fix.

### Step 6 — Fix `scripts/agent-sync.sh`

The bug is in the `updated` path of the Python sync script embedded in the
bash heredoc. The `re.sub()` pattern:

```python
pattern = rf'\[agents\.{re.escape(name)}\][^\[]*'
raw = re.sub(pattern, new_block, raw, flags=re.DOTALL)
```

This works but is fragile when the existing block has `nickname_candidates`
spanning or the replacement runs when the match boundary is ambiguous.

Replace the entire `updated` path with a safer line-by-line block replacer:
- Find the line index of `[agents.<name>]`
- Find the next line that starts with `[` (next section)
- Replace lines between those two indices with the new block lines
- This is unambiguous and cannot produce orphaned content

Also add a TOML validation step at the end of the script (before writing)
that checks for orphaned bare array literals and aborts with a clear error
if any are found, rather than writing a broken file.

### Step 7 — Confirm

Show the final `[agents.*]` section of `~/.codex/config.toml`.
Confirm `codex --version` (or any codex invocation) no longer errors.

## Success condition

`cd ~/.docks/foreman && codex` launches without error.

# Recipe: AOS GDI Handoff Packet V0

Use this recipe after a Goal Driven Implementation session has completed its
implementation, verification, and commit, and the foreman needs a compact
machine-readable handoff. This is a repo-local helper workflow, not a public
`aos` command and not a GDI exit interview.

## Manual Workflow

1. Save or pipe the final GDI completion tail. The tail should include the
   verification commands/results, guardrail claims, goal elapsed time, commit
   summary, and any handoff text the foreman needs.
2. Build the packet:

   ```bash
   node scripts/aos-gdi-handoff-packet.mjs --input /tmp/gdi-tail.txt --write
   ```

   To pipe directly:

   ```bash
   pbpaste | node scripts/aos-gdi-handoff-packet.mjs --write
   ```

3. Paste the emitted JSON, or a short summary plus the written packet path, to
   the foreman.

## Packet Contents

The helper emits compact JSON with:

- `branch`, `commits`, and `changed_paths` from local git state.
- `verification.commands` extracted from the tail, with lightweight result
  labels such as `passed`, `failed`, `skipped`, or `unknown`.
- `guardrail_claims` extracted from a Guardrails section or matching guardrail
  lines in the tail.
- `goal_time` parsed from lines such as `Time spent pursuing goal: 4 minutes`.
- `aos_readiness` from `./aos ready`.
- `open_canvases` from `./aos show list --json`.
- `raw_tail_text` with the original tail.

`--write` stores the same packet under
`.aos-test-tmp/gdi-handoffs/<timestamp>.json`. Use `--out-dir <dir>` only when a
different temporary location is needed.

## Optional Human Notification

Use one short notification only when useful:

```bash
node scripts/aos-gdi-handoff-packet.mjs --input /tmp/gdi-tail.txt --write --say
```

`--say` uses `./aos say`. `--notify` is also available and uses
`./aos tell human`. Both keep the spoken text short. Do not use this helper for
Codex TUI automation, slash-command driving, AppleScript shortcuts, terminal
scripting, mission runtime orchestration, workflow engines, daemon pub/sub, or
public CLI expansion.

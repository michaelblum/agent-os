# Provider Session Catalog

The provider session catalog is a read-only local adapter contract for
provider-owned agent sessions. It normalizes local Codex and Claude Code session
metadata without making AOS or Sigil a native client for either provider
runtime.

The JSON Schema source of truth is
[`provider-session-catalog.schema.json`](provider-session-catalog.schema.json).

## Record Shape

Catalog results are sorted by `updated_at` descending and shaped as:

```json
{
  "provider": "codex",
  "session_id": "019de3a9-2b0b-79f2-bb17-79dfb2c7a706",
  "cwd": "/Users/Michael/Code/agent-os",
  "branch": "codex/provider-session-catalog",
  "created_at": "2026-05-01T13:10:37.580Z",
  "last_message_at": "2026-05-01T13:10:38.000Z",
  "updated_at": "2026-05-01T13:10:38.000Z",
  "source_file": "/Users/Michael/.codex/sessions/2026/05/01/rollout-2026-05-01T09-10-08-019de3a9-2b0b-79f2-bb17-79dfb2c7a706.jsonl",
  "resume_command": ["codex", "--no-alt-screen", "resume", "019de3a9-2b0b-79f2-bb17-79dfb2c7a706"]
}
```

## Provider Rules

Codex records come from `~/.codex/sessions/**/rollout-*.jsonl` and, where
present, `~/.codex/archived_sessions/rollout-*.jsonl`. The adapter reads only a
bounded JSONL head and tail. It uses `session_meta` for identity, workspace, and
creation time, and the newest top-level JSONL timestamp for last-message
recency. File modification time is a fallback when provider timestamps are not
available.

Claude Code records come from `~/.claude/projects/<encoded-cwd>/*.jsonl` and
`~/.claude/sessions/*.json`. Project JSONL files provide transcript-adjacent
metadata such as `cwd`, `gitBranch`, creation time, and last-message recency;
live session JSON files can provide newer `startedAt` and `updatedAt` metadata.
The adapter treats malformed or drifted files as soft per-record failures.

The scanner must not mutate provider files. Provider roots are configurable for
tests and future alternate runtime homes.

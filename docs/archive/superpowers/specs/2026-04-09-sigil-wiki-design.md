# Sigil Wiki — Design Spec

**Date:** 2026-04-09
**Session:** sigil-wiki
**Status:** Draft

## Overview

A persistent, interlinked markdown knowledge base with executable workflows, maintained by agents and humans, browsable and invocable through Sigil. Inspired by Karpathy's "LLM Wiki" concept, extended with first-class workflow support compatible with the Claude Code/Cowork plugin format.

The wiki serves two audiences equally:
- **Agents** read and write wiki pages to maintain shared knowledge across sessions. They invoke workflows by reading bundled plugin content as context.
- **Humans** browse the knowledge graph in Sigil, discover and invoke workflows, and curate content through direct editing or agent-assisted authoring ("Customize with Agent").

### Design Principles

- **Files are canonical.** The wiki is a directory of markdown files. Everything else (index, tools, UI) is derived from them.
- **Plugin-compatible.** Plugins use the Claude Code/Cowork SKILL.md format. Existing plugins can be dropped in and work.
- **CLI-first.** All operations are `aos wiki` subcommands. Any agent that can run bash can use the wiki. MCP/SDK wrapping is additive, not required.
- **User-owned.** The wiki lives in the user's config directory, not the repo. The repo may ship a starter pack, but the user's wiki is theirs.

---

## 1. Data Model

### Storage Location

```
~/.config/aos/{mode}/wiki/
├── plugins/
│   └── <plugin-name>/
│       ├── SKILL.md
│       ├── references/
│       ├── scripts/
│       └── assets/
├── entities/
│   └── <name>.md
├── concepts/
│   └── <name>.md
└── wiki.db
```

Auto-created on first `aos wiki` usage.

### Page Types

**Workflow (plugin):** An executable set of instructions with supporting knowledge. Lives in `plugins/<name>/`. The `SKILL.md` is the entry point.

**Entity:** A thing — a tool, system, API, person. Lives in `entities/<name>.md`.

**Concept:** An idea, pattern, or principle. Lives in `concepts/<name>.md`.

### Page Format

All pages are markdown with YAML frontmatter:

```markdown
---
type: entity
name: Gateway
description: MCP server for typed script execution and cross-harness coordination
tags: [infrastructure, mcp, tools]
---

# Gateway

The gateway is the MCP server at `packages/gateway/`...

## Related
- [IPC Protocol](../concepts/ipc-protocol.md)
- [Canvas System](./canvas-system.md)
```

### Plugin Format

Compatible with Claude Code/Cowork plugin structure:

```
plugins/<plugin-name>/
├── SKILL.md              # Required: frontmatter + instructions
├── references/           # Optional: knowledge pages loaded on demand
│   ├── some-framework.md
│   └── output-schema.md
├── scripts/              # Optional: executable code for deterministic tasks
└── assets/               # Optional: templates, icons, other files
```

**SKILL.md frontmatter** (superset of Cowork format):

```yaml
---
name: plugin-name
description: >
  When to trigger, what it does. Include contexts where this
  should activate even if not explicitly asked for.
version: "1.0.0"             # optional
author: "user or agent name"  # optional
tags: [domain, capability]    # optional
triggers: ["natural language phrases that invoke this"]  # optional
requires: [gateway, aos-daemon]  # optional runtime deps
---
```

Minimum viable plugin: a `SKILL.md` with `name` and `description` in the frontmatter.

Reference files within a plugin are also wiki pages. They have their own frontmatter (`type: entity` or `type: concept`) and can be linked to/from pages outside the plugin. This bridges the plugin model and the knowledge graph. They live only in the plugin directory (not duplicated to `entities/` or `concepts/`) but are indexed as wiki pages with their `plugin` field set, making them reachable via search and graph queries.

### Progressive Disclosure

Skills use a three-level loading system (from Anthropic's skill-creator guide):

1. **Metadata** (name + description) — always available for trigger matching (~100 words)
2. **SKILL.md body** — loaded when skill triggers (<500 lines ideal)
3. **Bundled resources** — loaded on demand (unlimited, scripts can execute without loading)

### Index

`wiki.db` is a SQLite database — a materialized view of the filesystem, not the source of truth. If deleted, `aos wiki reindex` regenerates it fully.

```sql
CREATE TABLE pages (
    path        TEXT PRIMARY KEY,  -- relative to wiki root
    type        TEXT NOT NULL,     -- 'workflow', 'entity', 'concept'
    name        TEXT NOT NULL,
    description TEXT,
    tags        TEXT,              -- JSON array
    plugin      TEXT,              -- plugin name if part of one, NULL otherwise
    modified_at INTEGER NOT NULL   -- file mtime epoch
);

CREATE TABLE links (
    source_path TEXT NOT NULL REFERENCES pages(path),
    target_path TEXT NOT NULL,
    UNIQUE(source_path, target_path)
);

CREATE TABLE plugins (
    name        TEXT PRIMARY KEY,
    version     TEXT,
    author      TEXT,
    description TEXT,
    triggers    TEXT,              -- JSON array
    requires    TEXT,              -- JSON array
    modified_at INTEGER NOT NULL
);
```

---

## 2. CLI Tools (`aos wiki`)

### Plugin Authoring

| Command | Description |
|---------|-------------|
| `aos wiki create-plugin <name>` | Scaffold `plugins/<name>/` with SKILL.md template + references/ dir, update index |
| `aos wiki edit-plugin <name>` | Open SKILL.md in `$EDITOR` (or return path for agent writes) |

### Page Management

| Command | Description |
|---------|-------------|
| `aos wiki add <type> <name>` | Create entity/concept page from template, update index |
| `aos wiki rm <path>` | Remove page, clean up index, warn about broken incoming links |
| `aos wiki link <from> <to>` | Add cross-reference (append to Related section + update index) |

### Discovery

| Command | Description |
|---------|-------------|
| `aos wiki search <query>` | Text search across name, description, body. `--type`, `--plugin` filters. Ranking: name > description > body |
| `aos wiki list [--type <type>]` | List pages. Filters: `--type`, `--plugin <name>`, `--links-to <path>`, `--links-from <path>`, `--orphans` |
| `aos wiki show <path-or-name>` | Display a page. Default: formatted for terminal. `--raw`: raw markdown source for editing. `--json`: structured output with separated frontmatter, body, and raw content |

**`show --json` output:**

```json
{
  "path": "plugins/competitor-audit/SKILL.md",
  "frontmatter": {
    "name": "competitor-audit",
    "description": "...",
    "version": "0.4.0",
    "author": "Symphony Talent"
  },
  "body": "# Employer Brand Competitor Audit...",
  "raw": "---\nname: competitor-audit\n..."
}
```

The UI uses `frontmatter` for the metadata header, `body` for rendered preview, and `raw` for the edit view (markdown/preview toggle).

### Invocation

| Command | Description |
|---------|-------------|
| `aos wiki invoke <plugin-name> [--json]` | Bundle SKILL.md + all references + scripts into a single prompt payload, output to stdout |

The bundle concatenates:
- SKILL.md (full content)
- All files in `references/` (delimited: `--- BEGIN reference: <filename> ---`)
- Any `scripts/` file contents

The chat surface takes this bundle and injects it into the active agent session as context. The agent reads the instructions and follows them. No orchestration engine, no step tracking — the agent drives.

### Maintenance

| Command | Description |
|---------|-------------|
| `aos wiki reindex` | Drop and rebuild wiki.db from filesystem. Idempotent. |
| `aos wiki lint` | Report broken links, orphan pages, missing frontmatter, malformed plugins, index drift |
| `aos wiki lint --fix` | Auto-fix what's safe: rebuild index, remove broken link entries. Does NOT delete pages or rewrite frontmatter. |
| `aos wiki seed [--from <path>]` | Copy starter pack into wiki. No-ops if content exists (unless `--force`). Runs reindex after. |

All commands producing structured data support `--json`.

---

## 3. "Customize with Agent"

A built-in Sigil skill for agent-assisted plugin creation and editing. Derived from Anthropic's skill-creator (captured at `docs/reference/anthropic-skill-creator.md`), adapted for the wiki environment.

### Authoring Flow

1. **Capture intent** — what should this plugin do, when should it trigger. If the current conversation already contains a workflow worth capturing, extract from context first.
2. **Interview** — edge cases, input/output formats, dependencies, success criteria. One question at a time.
3. **Scaffold** — `aos wiki create-plugin <name>`
4. **Write** — author SKILL.md + reference pages following the skill-writing guide:
   - Description should be "pushy" — include trigger contexts even when not explicitly asked for
   - Explain the *why* behind instructions, not just the *what*
   - Keep SKILL.md under 500 lines; move domain knowledge to `references/`
   - Use progressive disclosure — SKILL.md for the workflow, references for deep context
5. **Test** — offer to run the plugin: "want me to try this?"
6. **Iterate** — refine based on feedback, generalize from specific examples

### What We Strip from Anthropic's Skill-Creator for v1

- Eval viewer / benchmark machinery (requires subagent infrastructure we don't have)
- Blind comparison system
- Description optimization loop (`run_loop.py`)
- Packaging (`.skill` file format — we use the wiki directory directly)

### What We Keep

- Intent capture and interview flow
- Skill anatomy and writing guide (SKILL.md + references/ + scripts/ + assets/)
- Progressive disclosure principles
- "Explain the why" writing philosophy
- Test-and-iterate loop (manual, not automated)

---

## 4. Invocation & Chat Integration

### From Chat Compose Menu

The chat UI calls `aos wiki list --type workflow --json` to populate a plugin menu. Each entry shows `name`, `description`, and `triggers` for the tooltip. Selecting one calls `aos wiki invoke <name>`, and the result is injected into the agent session.

### From Browse View ("Try in Chat")

The browse UI shows a "Try in chat" button on each plugin. Clicking it calls `aos wiki invoke <name>` and hands the payload to the chat canvas — same mechanism.

### During Execution

The agent can call `aos wiki show <path>` to pull additional wiki pages on demand if cross-links lead somewhere useful. The initial bundle is the plugin directory contents; the broader wiki is available for on-demand reads.

---

## 5. Seeding & Starter Pack

### First Run

When `aos wiki` is first used and the wiki directory doesn't exist, it auto-creates:

```
~/.config/aos/{mode}/wiki/
├── plugins/
├── entities/
├── concepts/
└── wiki.db
```

### Seed Command

`aos wiki seed [--from <path>]`

- Default source: `wiki-seed/` directory bundled in the repo (or shipped in AOS.app)
- Copies starter pages into the user's wiki without overwriting existing files
- Runs `reindex` after copying
- No-ops if wiki already has content (unless `--force`)

### Starter Pack Contents

Sigil's own knowledge — a bounded domain to validate the system:

**Entities:** gateway, sigil, canvas-system, daemon, studio

**Concepts:** ipc-protocol, daemon-lifecycle, content-server, runtime-modes

**Plugins:** One example workflow (e.g., `self-check` — the existing saved script wrapped as a plugin)

Enough to browse entities, see cross-links, invoke a workflow, and create a new plugin via "Customize with Agent."

### Sharing (Future)

Not v1. The format supports it naturally — a shared wiki is a synced directory (git, Dropbox, etc.). `aos wiki seed --from /path/to/shared/wiki` imports another wiki's content.

---

## 6. Lint & Maintenance

### `aos wiki lint`

Reports issues without auto-fixing:

| Check | Description |
|-------|-------------|
| Broken links | Page references a path that doesn't exist |
| Orphan pages | Pages with zero incoming links (flagged, not necessarily wrong) |
| Missing frontmatter | Pages without required fields (`type`, `name`) |
| Malformed plugins | Plugin directory missing SKILL.md, or SKILL.md missing `description` |
| Index drift | Files on disk not in the index |

### `aos wiki lint --fix`

Auto-fixes safe issues:
- Rebuilds index (same as `reindex`)
- Removes broken link entries from index

Does NOT delete orphan pages or rewrite frontmatter — those require human judgment.

---

## 7. UI Surface

The wiki's browse/edit/invoke UI will be integrated into Sigil's consolidated interface (alongside studio, settings, chat). The exact UI layout is a future design session's concern. This spec defines what the UI needs from the tools layer:

### Browse View
- `aos wiki list --json` — page listing with type, name, description, tags
- `aos wiki list --links-to/--links-from --json` — graph edges for visualization

### Detail View
- `aos wiki show <path> --json` — frontmatter (metadata header), body (rendered preview), raw (edit view)
- Markdown/preview toggle powered by `body` vs `raw` fields

### Plugin View
- Plugin metadata: version, author, triggers, requires
- File tree: SKILL.md + references/ + scripts/
- "Try in chat" button → `aos wiki invoke`
- "Edit" button → opens raw markdown editor
- "Customize with Agent" → injects the plugin-creator skill into chat with the current plugin as context

### Search
- `aos wiki search <query> --json` — results with snippets for a search UI

---

## Non-Goals for v1

- **MCP tool exposure** — CLI is the primitive. Gateway wrapping is additive later.
- **Semantic search** — text search with ranking is sufficient. Embeddings/vector search is future work.
- **Automated eval/benchmarking** — manual test-and-iterate for plugin authoring.
- **Shared/collaborative wikis** — format supports it, but no sync infrastructure in v1.
- **Orchestrated execution** — context injection only. Progress tracking/step reporting is future work.
- **Knowledge graph visualization** — the data supports it (links table), but rendering a visual graph is a UI concern for a later session.

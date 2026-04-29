---
type: concept
name: Research Intake
description: Raw-source intake pattern for compiling meeting transcripts, links, videos, and files into processed AOS wiki knowledge.
tags: [research, intake, personal, evidence, provenance]
---

# Research Intake

Research intake turns raw sources into durable personal or project knowledge.
The raw source stays in an intake pack; the wiki stores processed knowledge and
references back to the source artifacts.

## Shape

```text
raw source
  -> research intake pack
  -> extracted artifacts and evidence records
  -> candidate wiki nodes
  -> runtime AOS wiki pages after review
```

## V0 Pack

Research intake packs live under:

```text
~/.config/aos/{mode}/research-intake/<intake_id>/
```

The V0 contract is `shared/schemas/research-intake-pack.schema.json`.

## Rules

- Do not dump full raw transcripts into wiki pages.
- Keep raw artifacts immutable enough that later agents can inspect exact source
  wording when needed.
- Wiki pages should summarize, connect, and cite source artifact paths or
  transcript segment ranges.
- Personal or private material belongs in the runtime wiki, not in `wiki-seed/`,
  unless the human explicitly wants it committed.

## Related

- [Agent Team Git Worktrees](agent-team-git-worktrees.md)
- [Runtime Modes](runtime-modes.md)

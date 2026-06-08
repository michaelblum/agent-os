# Repo Docs Runtime Wiki Projection V0

## Tracker

- GitHub issue: https://github.com/michaelblum/agent-os/issues/306
- Adjacent wiki/runtime surfaces:
  - `./aos wiki seed`
  - `./aos wiki reindex`
  - `./aos wiki search`
  - `packages/toolkit/components/wiki-kb/`
- Recent source-doc churn that makes this valuable:
  - surface-system boundary docs and AGENTS guidance;
  - HTML Workbench Expression docs;
  - display-first Annotation Mode docs;
  - Sigil radial/context-menu/object-graph docs.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
wiki state, issue state, or prior implementation state. Read and rediscover
before editing. Work in `/Users/Michael/Code/agent-os`, not in `.docks/`.

## Goal

Add a deterministic Repo Docs To Runtime Wiki Projection V0.

Git docs remain canonical source. The runtime wiki becomes a generated,
queryable orientation layer over selected repo docs, with generated pages that
link back to exact source files and carry enough source metadata for agents to
open the canonical file when they need implementation detail.

This is not a summarization or migration project. V0 should project source docs
as deterministic wiki pages with frontmatter, hashes, controlled tags/concepts,
source backlinks, and wiki search/index coverage.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `docs/api/aos.md`
- `docs/api/toolkit/workbench.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/design/aos-3d-object-graph-platform-contract.md`
- `src/commands/wiki.swift`
- `src/commands/wiki-frontmatter.swift`
- `src/commands/wiki-index.swift`
- `src/daemon/wiki-seed.swift`
- `tests/wiki-seed.sh`
- `tests/wiki-integration-isolation.sh`
- `tests/toolkit/wiki-kb.test.mjs`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git worktree list
./aos ready
./aos dev recommend --json
./aos wiki --help
./aos wiki list --json
./aos dev gh issue view 306 --json
```

Use `AOS_STATE_ROOT="$(mktemp -d ...)"` for destructive or projection tests.
Do not point new projection tests at the canonical repo wiki under
`~/.config/aos/repo/wiki`.

## Existing Code To Inspect

- `src/commands/wiki.swift` - owns wiki subcommand routing, reindex, list,
  search, show, graph, add/rm/link, and namespace assumptions.
- `src/commands/wiki-frontmatter.swift` - current frontmatter parser and the
  fields that become index metadata.
- `src/commands/wiki-index.swift` - SQLite index shape and query behavior.
- `src/daemon/wiki-seed.swift` - deterministic file copy/seed behavior and
  namespace handling that may be reusable or instructive.
- `tests/wiki-seed.sh` and `tests/wiki-integration-isolation.sh` - current
  isolated wiki test style using `AOS_STATE_ROOT`.
- `packages/toolkit/components/wiki-kb/` and `tests/toolkit/wiki-kb*.mjs` -
  consumer expectations for graph/search payloads.

## Required Behavior

### 1. Projection Command

Add a repo developer/user-facing command, preferably under the wiki surface:

```bash
./aos wiki project-docs [--manifest <path>] [--dry-run] [--json]
```

If a different command shape fits the existing router better, keep it under
`./aos wiki` and preserve the same capabilities:

- load a source-controlled projection manifest;
- project selected repo Markdown/schema/API docs into the runtime wiki;
- skip unchanged generated pages using source hashes;
- update changed pages when source content changes;
- remove or clearly mark stale generated pages that were previously projected
  by the same manifest but no longer have a live source entry;
- reindex after successful projection unless `--dry-run` is used;
- return useful JSON counts for projected, unchanged, removed/stale, indexed,
  and errored pages.

### 2. Manifest

Add a deterministic manifest in source control, for example:

```text
docs/wiki/repo-docs-projection-v0.json
```

The manifest should support a curated V0 set, not the whole repo. Include enough
sources to prove the model:

- `AGENTS.md`
- `ARCHITECTURE.md`
- `docs/api/aos.md`
- `docs/api/toolkit.md`
- `docs/api/toolkit/runtime.md`
- `docs/api/toolkit/workbench.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `docs/design/aos-surface-system.md`
- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/design/aos-3d-object-graph-platform-contract.md`
- selected current work cards only when useful for active routing, not every
  historical work card.

For each source or source group, capture:

- source path or safe repo-relative glob;
- projected page slug/path;
- type, name, description, and tags;
- controlled concepts to link/tag, such as `DesktopWorld stage`,
  `input_region`, `Surface Inspector`, `Sigil`, `Annotation Mode`,
  `HTML Workbench Expression`, `runtime wiki`, `daemon`, and `toolkit`.

### 3. Generated Page Contract

Every generated wiki page must state that Git is canonical and wiki is a
projection. It should include frontmatter with at least:

- `type`, preferably a distinct value such as `repo_doc` if the index supports
  it cleanly;
- `name`;
- `description`;
- `tags`;
- `generated: true`;
- `projection: repo_docs_v0`;
- `source_path`;
- `source_hash`, preferably `sha256:<hex>`;
- `source_type`, such as `markdown`, `api_doc`, `work_card`, or `schema_doc`.

The body should include:

- a canonical source link/path;
- source hash/revision metadata;
- the source content or a deterministic excerpted/section-preserving projection;
- generated concept links using the controlled concept map;
- no LLM-generated summary.

### 4. Index/Search/Graph Compatibility

V0 must be queryable through existing wiki surfaces:

- `./aos wiki search "DesktopWorld stage" --json` returns projected docs;
- `./aos wiki show <projected-page> --raw` displays source metadata and content;
- `./aos wiki graph --json` includes projected pages and links.

If writing under a new namespace such as `aos/docs/...`, update reindex/show/list
logic so those pages are indexed and visible. If that expansion is too broad,
project V0 pages into an existing indexed namespace such as `aos/concepts/`
with a distinct `type: repo_doc`, and document the reason in the completion
report.

## Scope

Likely ownership:

- Swift `./aos wiki` command and wiki index behavior;
- source-controlled projection manifest and optional manifest schema/docs;
- isolated shell tests using `AOS_STATE_ROOT`;
- docs/API notes for the new command and generated-page contract.

Keep toolkit UI changes out of V0 unless a tiny compatibility fix is required
for existing wiki graph/search payloads.

## Hard Boundaries / Non-Goals

- Do not move canonical docs into the wiki.
- Do not make generated wiki pages source-of-truth files in the repo.
- Do not ingest private/personal/operator-profile material.
- Do not use LLM summarization or non-deterministic text generation.
- Do not project the entire repo or every work card in V0.
- Do not mutate canonical `~/.config/aos/repo/wiki` from tests.
- Do not require a live canvas or human visual verification for this slice.
- Do not broaden into research-intake or external knowledge graph work.

## Suggested Implementation Areas

Treat these as starting points, not mandates:

- Add a focused `src/commands/wiki-project-docs.swift` helper and route it from
  `wikiCommand`.
- Add small reusable helpers for source hashing, slug/path normalization, and
  generated-page frontmatter serialization.
- Keep manifest parsing strict and explicit; fail loudly on missing source
  files, unsafe paths, duplicate slugs, or paths outside the repo root.
- Prefer source-relative links and existing Markdown link extraction so graph
  links remain understandable.
- Add `--dry-run --json` first if it makes tests easier to prove without writes.

## Verification

Run deterministic checks first:

```bash
./aos dev recommend --json
./aos dev build
bash tests/wiki-project-docs.sh
bash tests/wiki-integration-isolation.sh
./aos wiki project-docs --dry-run --json
git diff --check
```

If command names differ, substitute the actual command and report the final
surface. The focused test should prove at least:

1. projection writes generated pages under an isolated `AOS_STATE_ROOT`;
2. rerun is idempotent when sources are unchanged;
3. changing a source changes the generated `source_hash`;
4. search finds a projected concept such as `DesktopWorld stage`;
5. graph/list/show include the generated page;
6. dry-run does not mutate the isolated wiki;
7. canonical repo wiki is not modified by tests.

No live AOS canvas smoke is required for V0. `./aos ready` should still be
reported because this repo uses it as the baseline readiness gate.

## Completion Report

Report:

- files changed;
- final command shape;
- manifest path and V0 source set;
- generated page path convention and frontmatter keys;
- index/search/graph behavior;
- exact tests run and pass/fail results;
- `./aos ready` result;
- whether any local wiki state was modified outside isolated test roots;
- recommended next slice, especially broader source coverage, stale-page
  pruning policy, or Wiki KB UI affordances if they are not included in V0.

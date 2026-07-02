---
name: aos-agent-workspace
description: Use saved AOS perception workspaces and compact refs for agent UI work. Trigger when a task needs repeated observe-act loops, saved `aos see capture --save` snapshots, `aos see refs`, or `aos do ... ref:<snapshot>:<ref>` actions without carrying full screenshots or AX/browser payloads in context.
---

# AOS Agent Workspace

Use this skill when an agent needs durable local perception state for normal
AOS verbs. The goal is a compact, inspectable loop:

```bash
aos see capture browser:work --save --mode som --workspace default
aos see snapshots --workspace default --json
aos see refs --workspace default --query Save --json
aos do click ref:<snapshot-id>:r2 --workspace default --dry-run
aos do set-value ref:<snapshot-id>:r3 --workspace default --value "42" --dry-run
aos do fill ref:<snapshot-id>:r4 "updated text" --workspace default --dry-run
```

## Contract

- Use `aos see capture --save` to persist perception into the active runtime
  mode state root: `${AOS_STATE_ROOT:-~/.config/aos}/{repo|installed}/agent-workspaces/`.
- Prefer scoped refs: `ref:<snapshot-id>:<ref-id>`.
- Use bare `ref:<ref-id>` only when one snapshot in the workspace contains that
  ref. If the command returns `REF_AMBIGUOUS`, retry with the scoped ref.
- Treat compact stdout as the model-facing payload. Full capture JSON,
  screenshots, base64, AX trees, browser elements, and semantic target arrays
  stay file-backed under the snapshot directory.
- The saved file contract is `aos.agent-workspace.v0`; see
  `shared/schemas/aos-agent-workspace-v0.md`.
- Workspace write locks are transient local control state. If a mutation returns
  `AGENT_WORKSPACE_LOCKED`, refresh or retry after the other local writer exits.

## Capture Modes

- `--mode ax`: use when you need tree/ref facts. Browser targets use xray refs;
  non-browser native AX refs are inspection-first in this slice.
- `--mode vision`: use when image inspection matters. Screenshots/base64 are
  stored as artifacts and summarized by path.
- `--mode som`: use for general screen-object loops. It uses xray-backed refs
  where available.

Always read the returned `backend`, `resolution_class`, `confidence`,
`warnings`, and `known_limits` before acting.

## Acting On Refs

Start with dry-run:

```bash
aos do click ref:<snapshot-id>:r2 --workspace default --dry-run
```

Dry-run reports the resolved underlying command and whether validation is
required. Saved refs use a backend action matrix:

- AOS canvas `reacquirable` refs may route `click` and `set-value` through the
  current canvas resolver.
- Browser `snapshot_scoped` click and fill refs run a fresh xray validation
  before mutation. Missing, stale, ambiguous, disabled, or changed current
  targets fail closed with `REF_STALE`, `REF_AMBIGUOUS`, or
  `ACTION_INCOMPATIBLE`.
- Native AX `volatile` refs are inspection-only.
- `focus`, `press`/`open`/`toggle`, browser `type`/`key`, and other unsupported
  saved-ref actions fail closed with structured JSON.
- Unsafe resolution classes that have no current validation path still return
  `REF_REVALIDATION_REQUIRED` rather than mutating.
- Unsupported or incompatible actions return `REF_UNSUPPORTED` or
  `ACTION_INCOMPATIBLE`.

After any successful mutation, run a fresh `aos see capture --save` before using
the next ref from that surface.

## Cleanup

Workspace artifacts are local control state, not Work Recording evidence. Use
explicit cleanup:

```bash
aos see workspace prune default --older-than 7d --dry-run --json
aos see snapshot delete <snapshot-id> --workspace default --i-understand-local-artifacts --json
aos see workspace delete default --i-understand-local-artifacts --json
```

Never delete without the acknowledgement flag unless you are only doing a
`--dry-run` prune.

## References

- CLI API: `docs/api/aos.md`
- Schema contract: `shared/schemas/aos-agent-workspace-v0.md`
- Saved-ref regression: `tests/agent-workspace-saved-ref.sh`

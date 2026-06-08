# Work Card: AFK Sleep Lease Live Mode Provider Sentinel V0

**Status:** Sentinel source artifact for Operator proof

## Transfer Classification

- Recipient: Implementer
- Transfer kind: Implementer round through AFK session trigger only
- Single next goal: prove that a live Codex/Implementer provider launched through the
  sleep-lease live mode accepted this work-card prompt and completed one
  harmless deterministic check.
- Source artifact for:
  `docs/design/work-cards/operator-afk-sleep-lease-live-mode-proof-v0.md`

## Instructions

Do not edit files, create branches, commit, push, open GitHub, route follow-up
work, read provider transcript files, mutate provider stores, or perform any
external publication.

First move to the repository root if your shell is in a dock directory:

```bash
cd /Users/Michael/Code/agent-os
```

Run only these local checks from the repository root:

```bash
git status --short --branch
node --test tests/renderer/agent-terminal-bridge-client.test.mjs
```

Then reply concisely with:

- proof token: `sleep-lease-live-mode-provider-sentinel-v0`
- branch/head relationship observed from `git status --short --branch`
- whether the worktree was clean
- bridge-client test summary, including pass/fail counts

No further work is authorized.

# AOS Agent Runner M2 Implementer Patch Output

Date: 2026-06-09

## Decision

The M2 patch-output lane plus the Foreman-owned apply gate is acceptable as the
next supersession primitive for provider-produced, Foreman-reviewed patch
artifacts.

This does not mean full native Codex subagent supersession. Full supersession
remains blocked by the intentionally disabled general write-capable
`implementer` path and by native subagent/runtime integration decisions beyond
the patch-artifact boundary.

## Branch And Dependency Posture

- Branch: `foreman/aos-agents-m2-implementer-patch-artifact-v0`
- M2 commits:
  - `be7273b9` Add AOS agent implementer patch artifacts
  - `698637af` Add patch-output failure diagnostics
  - `94546c13` Harden patch-output diff instructions
  - `1eec265b` Add patch-output source context
  - `5a139175` Add AOS agent patch artifact check gate
- Provider SDK unblock: ignored local venv under `.runtime/dev/aos-agents/.venv`
- Dependency decision: unchanged from M1. The local venv is a live-smoke-only
  environment, not an optional dev dependency and not a repo-managed dependency
  policy.

## Patch-Output Contract

- The default `implementer` invocation remains rejected before SDK/runtime
  mutation.
- The only enabled `implementer` path is explicit
  `--patch-output --execute`.
- Patch-output mode writes runtime artifacts only under
  `.runtime/dev/aos-agents/runs/implementer/<run-id>/`.
- Patch-output artifacts include `summary.json`, `result.json`, and
  `patch.diff`.
- The runner records target branch, base commit, touched paths, context files,
  and suggested review/apply commands in the artifacts.
- The provider does not apply patches directly, and patch-output mode does not
  mutate the checkout.

## Context-File Guard Summary

`--context-file <repo-relative-path>` is available only for patch-output runs.
The guard rejects absolute paths, path traversal outside the repo, `.git`
paths, runtime artifacts, ignored files, and non-files.

Accepted context files are included as bounded source text in the provider
instructions and recorded in `summary.json`, `result.json`, and command output.

## Provider-Backed Smoke

Command shape:

```bash
PATH="$PWD/.runtime/dev/aos-agents/.venv/bin:$PATH" \
  ./aos dev agents --role implementer \
  --task "Create a one-line comment-only patch for scripts/aos_agents/README.md adding an M2 smoke note under the existing M1 parity reference. Do not modify files directly; output only a unified diff patch." \
  --context-file scripts/aos_agents/README.md \
  --patch-output --execute --max-turns 1 --json
```

Artifacts:

| Artifact | Path |
| --- | --- |
| `summary.json` | `.runtime/dev/aos-agents/runs/implementer/create-a-one-line-comment-only-patch-for-scripts-6d354730fc88/summary.json` |
| `result.json` | `.runtime/dev/aos-agents/runs/implementer/create-a-one-line-comment-only-patch-for-scripts-6d354730fc88/result.json` |
| `patch.diff` | `.runtime/dev/aos-agents/runs/implementer/create-a-one-line-comment-only-patch-for-scripts-6d354730fc88/patch.diff` |

Smoke readback:

- Status: `completed`
- Target branch: `foreman/aos-agents-m2-implementer-patch-artifact-v0`
- Base commit: `1eec265b7d8e3f8b1ec112bcd167f4f9bf15cc8b`
- Context files: `scripts/aos_agents/README.md`
- Touched paths: `scripts/aos_agents/README.md`
- `git apply --check .runtime/dev/aos-agents/runs/implementer/create-a-one-line-comment-only-patch-for-scripts-6d354730fc88/patch.diff`: passed
- Worktree stayed clean.
- Patch was not applied.

## Foreman Apply Boundary

- Foreman may inspect `patch.diff` with
  `./aos dev agents --check-patch <output-dir> --json`.
- Foreman may apply an existing artifact only with
  `./aos dev agents --apply-patch <output-dir> --i-approve-checkout-mutation --json`.
- The apply gate validates the runtime-root-confined `summary.json`,
  `result.json`, and `patch.diff` artifact contract, requires completed status
  in summary/result, requires a clean worktree, reruns `git apply --check`
  immediately before mutation, and applies with plain `git apply`.
- The apply gate leaves checkout changes unstaged.
- The provider never applies patches directly.

## Remaining Blocker

The explicit patch-output and Foreman apply primitive is now scaffolded. Full
supersession still requires a native subagent/runtime path that can replace the
provider proof lane without weakening the direct-mutation boundary, plus a
decision on dependency/runtime packaging beyond the ignored local smoke venv.

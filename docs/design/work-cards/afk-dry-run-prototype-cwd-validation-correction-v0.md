# Work Card: afk-dry-run-prototype-cwd-validation-correction-v0

**Status:** Accepted 2026-05-22
**Owner:** GDI

## Tracker

Transfer classification:

- Recipient: GDI
- Transfer kind: correction round
- Source artifact: review of
  `docs/design/work-cards/afk-dry-run-prototype-v0.md`
- Single next goal: make invalid `cwd` and `worktree` packet values produce a
  structured failed receipt instead of an unstructured prototype error.

Follow-up to GDI output:

- Commit under review:
  `5c679dfca00995ad04bb1e598434e63b30c037e5`
- Changed files under review:
  `scripts/afk-dry-run-prototype.mjs` and
  `tests/afk-dry-run-prototype.test.mjs`

Accepted evidence:

- GDI branch: `gdi/afk-dry-run-prototype-v0`
- Accepted commit: `51dc02dfbc818d378fe8426b5ab8e9f88cd76bf2`
- Corrected behavior: missing `cwd`/`worktree` values now emit the normal
  `aos.afk_dry_run_receipt_bundle.prototype` JSON receipt with
  `final_status: failed`, `scheduler.intake_decision: rejected`, failed
  `cwd_resolves_to_repo_root` and `worktree_exists` validations, and empty
  stderr instead of a top-level `prototype_error`.
- Foreman-side verification passed:
  `node --test tests/afk-dry-run-prototype.test.mjs`,
  `git diff --check 95f9ee188a26f0d35c5122d682acf607b4cdeda7..51dc02dfbc818d378fe8426b5ab8e9f88cd76bf2`,
  `git diff --check c20c85d9e0efd239a2112b5899a8ed164ab745d7..HEAD`,
  `./aos dev recommend --json`, and a manual bad-cwd/bad-worktree probe.

## Finding

The dry-run prototype crashes when a packet supplies a missing `cwd` or
worktree path. That violates the work card's validation requirement: current
state failures should be represented in the emitted receipt with failed
validation records, blocker class, next owner, and `final_status: failed`.

Observed Foreman probe:

```bash
tmpdir=$(mktemp -d)
packet="$tmpdir/packet.json"
printf '%s\n' '{"packet_id":"bad-cwd","source_artifact":"docs/design/work-cards/afk-dry-run-prototype-v0.md","requested_recipient":"gdi","cwd":"/tmp/aos-afk-missing-cwd-never-exists","worktree":"/tmp/aos-afk-missing-cwd-never-exists","required_start_ref":"docs/durable-agent-cognition-v0","provider_hint":"codex"}' > "$packet"
node scripts/afk-dry-run-prototype.mjs --packet "$packet" --provider codex --dock gdi --json
```

Observed output:

```json
{
  "type": "aos.afk_dry_run_receipt_bundle.prototype_error",
  "experimental": true,
  "final_status": "failed",
  "error": "Cannot read properties of undefined (reading 'trim')",
  "script": "afk-dry-run-prototype.mjs"
}
```

Likely sources:

- `runGit()` assumes `spawnSync` always returns string `stdout` and `stderr`;
  when `cwd` is invalid, `stdout`/`stderr` can be undefined.
- `buildReceipt()` calls `resolveRepoRoot(cwdPath)` while computing
  `cwdIsRepo` even when `cwdPath` does not exist.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Patch the dry-run prototype so invalid or missing `cwd`/`worktree` paths are
reported as validation failures inside the normal receipt bundle.

The corrected behavior should:

- still exit non-zero for invalid packet/current-state input;
- still write JSON to stdout for `--json` validation failures;
- set `final_status: failed`;
- set `scheduler.intake_decision: rejected`;
- set `work.blocker_class: validation_failed`;
- mark `cwd_resolves_to_repo_root` failed when cwd is missing or outside the
  repo;
- mark `worktree_exists` failed when worktree is missing;
- include a reason/message that explains the missing or invalid path;
- not use the top-level `prototype_error` path for expected validation
  failures.

## Read First

- `AGENTS.md`
- `.docks/README.md`
- `.docks/AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/design/work-cards/afk-dry-run-prototype-v0.md`
- `docs/design/notes/afk-work-evidence-receipt-shape-2026-05-21.md`
- `scripts/afk-dry-run-prototype.mjs`
- `tests/afk-dry-run-prototype.test.mjs`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
./aos dev recommend --json
```

This is a local correction on the AFK dry-run prototype branch. Do not reset to
`origin/main`.

## Branch/Base

branch_from: `gdi/afk-dry-run-prototype-v0`
required_start_ref: `gdi/afk-dry-run-prototype-v0`

This correction depends on the local-only dry-run prototype commit. Keep the
checkpoint local unless Foreman or Michael explicitly asks for a push or PR.

## Scope

Edit only:

- `scripts/afk-dry-run-prototype.mjs`
- `tests/afk-dry-run-prototype.test.mjs`

Do not edit design notes, schemas, public CLI wiring, or work cards unless this
card itself contains a broken link.

## Hard Boundaries

- Do not wire this into `./aos`, `src/main.swift`, command registry/help, or
  public API docs.
- Do not add or modify schemas.
- Do not launch Codex, Claude, Gemini, tmux, process sessions, or provider
  terminals.
- Do not mutate provider config, provider session files, provider transcripts,
  provider catalogs, telemetry stores, gateway jobs, or notification routes.
- Do not add package dependencies.
- Do not create committed generated receipt artifacts outside tests.
- Do not change `.docks` role instructions, dock profiles, transfer scripts,
  hook behavior, or provider config files.
- Do not move or rename recipes, playbooks, workflows, work cards, docks,
  gateway files, API docs, apps, packages, shared schema files, or
  `docs/dev/workflow-rules.json`.
- Do not push, open a PR, mutate GitHub issues, or publish externally.

## Verification

Run:

```bash
node --test tests/afk-dry-run-prototype.test.mjs
git diff --check
./aos dev recommend --json
```

Add or update focused test coverage for the invalid `cwd`/`worktree` case. The
test should assert the script emits a structured failed receipt on stdout and
does not emit the `prototype_error` payload for this expected validation
failure.

No Swift rebuild, provider launch, or live AOS smoke is expected.

## Completion Report

Report:

- files changed;
- exact bug fixed;
- invalid `cwd`/`worktree` receipt behavior;
- new or updated test assertions;
- exact verification commands and pass/fail results;
- confirmation that public CLI wiring, schemas, providers, gateway, `.docks`,
  generated artifacts, GitHub, push, and PR surfaces were untouched;
- local-only state or unrelated dirty files.

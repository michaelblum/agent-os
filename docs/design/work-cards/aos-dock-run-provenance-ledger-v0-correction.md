# AOS Dock Run Provenance Ledger V0 Correction

## Recipient

GDI

## Transfer Kind

Correction round

## Source Artifact

- Original card: `docs/design/work-cards/aos-dock-run-provenance-ledger-v0.md`
- Reviewed commit: `3c95a90593eb7895ac9877419f52e05782b587df`
- Review profile: Foreman thermo-nuclear code quality review

## Branch / Base

- branch_from: `gdi/aos-dock-run-provenance-ledger-v0`
- required_start_ref: `3c95a90593eb7895ac9877419f52e05782b587df`
- output_branch: keep working on `gdi/aos-dock-run-provenance-ledger-v0`
- publication: do not push or open a PR unless Foreman explicitly asks later

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider transcript, dock state, or prior implementation state. Read and
rediscover before editing.

## Goal

Repair the provenance ledger V0 implementation so the new command surface is a
strict, trustworthy compliance/audit primitive instead of a permissive report
that can falsely certify incomplete or invalid state.

This is a correction round. Preserve the intended V0 behavior, but fix the
review blockers below and keep the implementation easier to maintain.

## Read First

- `AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `docs/design/work-cards/aos-dock-run-provenance-ledger-v0.md`
- `scripts/aos-provenance-ledger.mjs`
- `scripts/aos-dev-workflow.mjs`
- `.docks/harness/post-tool-use-runner.sh`
- `.docks/harness/dock-hook-runner.sh`
- `tests/provenance-ledger.sh`
- `tests/dev-workflow-router.sh`
- `shared/schemas/aos-dock-provenance-ledger-v0.schema.json`
- `packages/host/src/session-telemetry.ts`

## Rediscover State

Run:

```bash
git status --short --branch
git diff --stat 4f0d4e91004d2d5a3915766b759ca8dbb371e6ea..HEAD
./aos dev recommend --json --files scripts/aos-provenance-ledger.mjs scripts/aos-dev-workflow.mjs tests/provenance-ledger.sh tests/dev-workflow-router.sh shared/schemas/aos-dock-provenance-ledger-v0.schema.json
```

This slice is deterministic command/schema/test work. Do not spend time on live
AOS readiness unless a chosen verification command unexpectedly requires it.

## Review Blockers To Fix

### 1. Audit Surface Falsely Passes With Missing Evidence

`scripts/aos-provenance-ledger.mjs:712` builds an audit report, but
`scripts/aos-provenance-ledger.mjs:727` sets `status` from only the recommendation
command status. `scripts/aos-provenance-ledger.mjs:821` exits zero whenever
recommendation generation succeeds, even when `missing_recommended_commands` is
non-empty.

Foreman verified this on the reviewed commit:

```text
./aos dev provenance audit --dock gdi --state-root <empty-fixture> --runtime-mode repo --files scripts/aos-dev-workflow.mjs --json
rc=0
status success
missing 9
```

Required correction:

- Define an explicit compliance result for audit.
- Audit must not report overall success or exit zero when recommended commands
  are missing or observed commands failed.
- Treat lower-level bypass signals as at least non-success evidence unless you
  introduce an explicit warning status with tests and clear JSON semantics.
- Update tests so a ledger missing recommended commands fails deterministically.
- Keep a report mode only if its name and exit semantics are unambiguous.

### 2. Daily Summaries Are Write-Only And Create A Second Source Of Truth

The hook writes daily summaries through `summaryPath` and `updateDailySummary`
at `scripts/aos-provenance-ledger.mjs:403` and `scripts/aos-provenance-ledger.mjs:414`.
The public summary and audit paths only read raw JSONL events through
`readEvents` at `scripts/aos-provenance-ledger.mjs:473`, then call
`summarizeEvents` at `scripts/aos-provenance-ledger.mjs:816` and
`scripts/aos-provenance-ledger.mjs:713`.

Foreman verified that a retained summary-only fixture is ignored:

```text
summary fixture events=7
./aos dev provenance summary --dock gdi --state-root <summary-only-fixture> --runtime-mode repo --json
event_count 0
commands []
```

Required correction:

- Make the retained daily summaries a real read path, or remove them from V0 and
  stop advertising separate summary retention.
- Avoid two drifting sources of truth. If summaries remain, define whether raw
  events or daily summaries are authoritative for each command.
- Fix the read/write model so future pruning of 14-day raw events does not make
  the 90-day summary retention meaningless.
- Address hook-time summary update atomicity. `fs.writeFileSync` after
  read/merge/write can lose increments under concurrent hooks. Use an atomic or
  derivable model, or explicitly avoid hook-time aggregate mutation.
- Add tests that prove summary output uses retained summaries after raw events
  are absent or pruned.

### 3. Command Parsing Is Too Permissive For A Dev Command Contract

`scripts/aos-provenance-ledger.mjs:56` accepts any `--flag value` pair and stores
it in the options object. Unknown or irrelevant flags are silently ignored by
the command actions.

Foreman verified this on the reviewed commit:

```text
./aos dev provenance summary --state-root <fixture> --runtime-mode repo --not-real value --json
rc=0
success unknown 0

./aos dev provenance prune --state-root <fixture> --runtime-mode repo --dry-run --not-real value --json
rc=0
success dry-run 0
```

Required correction:

- Replace the generic permissive parser with strict action-aware parsing.
- Unknown flags must return `UNKNOWN_FLAG`.
- Unexpected positional arguments must return `UNKNOWN_ARG`.
- Action-only flags should not be accepted on unrelated actions unless there is
  a concrete reason and test for it.
- Keep existing missing-value behavior, including the `MISSING_ARG` case covered
  in `tests/dev-workflow-router.sh`.

### 4. Allowlisted Command Summaries Can Leak Secret Arguments

`ALLOWLIST_PREFIXES` at `scripts/aos-provenance-ledger.mjs:18` and
`allowedSummary` at `scripts/aos-provenance-ledger.mjs:231` use broad string
prefixes such as `bash tests/` and `node --test `. Any command beginning with
those prefixes is stored verbatim, including extra arguments that could contain
tokens or credentials.

Required correction:

- Replace broad prefix storage with a sanitizer that recognizes safe command
  shapes rather than trusting the whole command string.
- Store raw summaries only for known deterministic repo commands whose arguments
  are safe to persist.
- Otherwise store only hash/kind/redacted metadata.
- Add a regression test showing an otherwise allowlisted-looking command with a
  secret argument does not persist the secret.

## Maintainability Expectation

`scripts/aos-provenance-ledger.mjs` is already 837 lines and owns CLI parsing,
hook event building, command sanitization, ledger storage, daily aggregates,
retention pruning, audit comparison, and provider telemetry extraction. Do not
make the file harder to scan while fixing these blockers.

Prefer extracting or at least clearly separating the parser policy, command
sanitizer, storage/summary model, audit result model, and telemetry adapter. Do
not introduce a broad framework or new dependency.

## Suggested Verification

Run at minimum:

```bash
git diff --check
bash tests/provenance-ledger.sh
bash tests/dev-workflow-router.sh
bash tests/external-command-dispatch.sh
bash tests/external-parser-flags.sh
bash tests/help-contract.sh
node --test tests/schemas/aos-dock-provenance-ledger-v0.test.mjs
node --test tests/schemas/dev-workflow-rules.test.mjs
```

If parser or schema changes touch broader command surfaces, also run the focused
schema tests recommended by `./aos dev recommend --json`.

## Completion Report

Report:

- files changed;
- which review blockers were fixed;
- exact audit status/exit semantics after the correction;
- whether daily summaries remain and how summary/audit read them;
- privacy behavior for allowlisted-looking commands with secret arguments;
- exact verification commands and pass/fail results;
- local-only state, including fixture ledgers or unrelated dirty files;
- any remaining follow-up that should not block V0 acceptance.

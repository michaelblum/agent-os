# Compact Real-Input Scenario Output V0

## Tracker

- Epic: #223 AOS Surface System
- Source queue:
  `docs/design/work-cards/surface-stack-retrospective-followups-v0.md`
- Checkpoint PR: #307 Surface Stack V0 checkpoint
- Preceding follow-up:
  `docs/design/work-cards/subject-family-runtime-cleanup-primitive-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing. The branch may have unrelated local state such as `.vscode/`,
`.playwright-cli/`, or dock skill edits; do not stage or mutate those unless the
active diff proves they are part of this slice.

## Goal

Make radial real-input scenario output reviewable. Passing runs should print a
compact summary with key proof fields and an artifact path, while full JSON
diagnostics are written to a file for Foreman review. Failure output should stay
rich enough to debug, but large nested payloads should move to the artifact
instead of flooding the terminal.

Do not change the real-input gesture, DesktopWorld path, semantic verification,
or cleanup behavior except where necessary to route reporting through the new
output contract.

## Read First

- `AGENTS.md`
- `tests/README.md`
- `tests/lib/real-input-surface-harness.sh`
- `tests/lib/real_input_surface_primitives.py`
- `tests/lib/sigil/radial-menu.sh`
- `tests/scenarios/sigil/radial-menu/real-input.sh`
- `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh`
- `docs/design/work-cards/surface-stack-retrospective-followups-v0.md`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
rg -n "print\\(\"PASS\"|json\\.dumps|semanticProof|pathPlan|travelSteps|AOS_REAL_INPUT|artifact|diagnostics|xray" tests/lib/sigil/radial-menu.sh tests/lib/real-input-surface-harness.sh tests/lib/real_input_surface_primitives.py tests/scenarios/sigil/radial-menu tests/README.md
```

Before choosing build/test commands after edits, run `./aos dev recommend
--json` again.

## Current Problem

`tests/lib/sigil/radial-menu.sh` currently ends successful Python verification
with:

```python
print("PASS", json.dumps({...}, sort_keys=True))
```

That payload includes inspector probes, path plans, travel steps, radial surface
probes, semantic proof, and expected action details. The data is useful, but it
is too large for terminal review. The failure path similarly embeds a large
diagnostic object directly in the `FAIL:` message.

## Required Behavior

### Success Output

On success, stdout should include:

- a clear `PASS` line;
- scenario name (`base`, `desktop-world-path`, or equivalent);
- avatar id and radial surface id;
- artifact path containing the full JSON proof;
- compact proof fields such as semantic target ids, opened destination surface,
  travel step count, and whether a figure-eight path was used.

The compact success output should be stable enough for Foreman to paste into a
review comment without trimming nested JSON.

### Artifact

Write the full proof JSON to an artifact file. Prefer a deterministic default
directory that is outside the repo unless the caller overrides it, for example:

```bash
${AOS_REAL_INPUT_ARTIFACT_DIR:-${TMPDIR:-/tmp}/aos-real-input-artifacts}
```

The artifact should include at least the data currently printed on success:
inspector probe, initial probe, travel details, path plan, radial surface probe,
semantic proof, cursor evidence, expected action, scenario, timestamp, and
canvas ids.

If an artifact cannot be written, the scenario should fail clearly rather than
silently dropping evidence.

### Failure Output

On failure, print a compact `FAIL` message that includes the scenario, artifact
path when available, and the primary error. Write the full diagnostic payload to
the same artifact contract when possible. Do not strip the diagnostic fields
that currently help debug failures; move them out of stdout.

### Scenario Coverage

Apply the contract to both radial real-input entrypoints:

- `tests/scenarios/sigil/radial-menu/real-input.sh`
- `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh`

Generalize inside `tests/lib/sigil/radial-menu.sh` or
`tests/lib/real-input-surface-harness.sh` only when the helper boundary is
obvious. Avoid broad reporting framework work.

### Documentation

Update `tests/README.md` so developers know that real-input scenarios print a
compact summary and write the full proof or failure diagnostics to an artifact
path.

## Scope

This is a test tooling slice. It may touch radial real-input shell/Python
helpers, the two radial scenarios, and `tests/README.md`. It should not touch
Sigil product code, toolkit runtime behavior, daemon code, or the surface
cleanup primitive except for using existing helper outputs.

## Hard Boundaries

- Do not change real pointer gesture timing or path geometry.
- Do not change semantic target assertions.
- Do not add a new test harness framework.
- Do not make passing stdout contain the full nested proof JSON.
- Do not hide failure diagnostics; preserve them in an artifact.
- Do not stage unrelated `.docks/`, `.vscode/`, or `.playwright-cli/` changes.

## Suggested Implementation Areas

Likely files:

- `tests/lib/sigil/radial-menu.sh`
- `tests/lib/real-input-surface-harness.sh`
- `tests/scenarios/sigil/radial-menu/real-input.sh`
- `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh`
- `tests/README.md`

If adding pure formatting helpers, prefer small Python functions inside the
existing radial verifier before adding a separate module. Add a focused
deterministic test only if the helper boundary becomes testable without real
input.

## Verification

Minimum deterministic checks:

```bash
git diff --check
bash -n tests/lib/sigil/radial-menu.sh \
  tests/scenarios/sigil/radial-menu/real-input.sh \
  tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh
./aos ready
./aos dev recommend --json
```

If a deterministic helper test is added, run it.

If `./aos ready` passes and the environment is safe for physical input, run at
least the canonical radial real-input scenario:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

Run the DesktopWorld path scenario too when feasible:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh
```

For each live run, verify that stdout is compact and the reported artifact path
exists and contains the full JSON proof. If live input is blocked, report the
readiness or human-idle blocker and include deterministic evidence.

## Completion Report

Include:

- files changed;
- exact stdout shape on success and failure;
- artifact directory/path contract;
- tests run and results;
- live real-input result or why it was skipped;
- whether compact real-input output remains fully addressed or needs a follow-up;
- remaining follow-up recommendation from
  `surface-stack-retrospective-followups-v0.md`.
